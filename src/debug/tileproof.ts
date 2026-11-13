/**
 * Tile proof: the 3 x 3 z14 tiles around Albert Square, Manchester, built by the mesh worker from
 * live OpenFreeMap and Mapterhorn tiles and drawn in the Contour look at a fixed golden hour, with
 * a slow orbit. A check page for SK, not the product.
 *
 * Query: ?t=<seconds> holds the orbit at that time (for screenshots). Reduced motion holds it at 0.
 */
import * as THREE from 'three';
import { DPR_CAP } from '../config';
import type { LatLon } from '../geo/coords';
import { tileFrame } from '../world/frame';
import { CONTOUR, DEFAULT_REGION, lightFor, lerpHex, parseHex } from '../world/palette';
import { heightAt } from '../world/terrain';
import { terrainTile, type TerrainTile } from '../world/terrainsrc';
import { vectorTileTemplate } from '../world/vector';
import type { BuildReply, BuildRequest } from '../world/worker';
import type { TileMeshes } from '../world/meshjob';
import { blockBounds, farLandBuffers, gridPlacements, orbitPose, type TilePlacement } from './tilegrid';
import { toGeometry, treeGeometry } from './tilegeom';

const ALBERT: LatLon = { lat: 53.4794, lon: -2.2453 };
const Z = 14;

// ---- the look ----

/** Golden hour: a low sun from the west-south-west, so shadows rake east across the streets. */
const SUN_ELEVATION = 8;
const SUN_AZIMUTH = 250;
const L = lightFor(SUN_ELEVATION);
const TREE_COLOURS = ['#5f8f5a', '#527f50', '#6c9a62', '#4a7449'];

/**
 * One turn in 105 s around the square, starting from the north-north-west (side-lit, the Irwell in
 * front). High enough to read the street pattern; the haze takes the top of a portrait screen.
 */
const ORBIT = { periodSec: 105, startDeg: 330, distance: 1500, pitchDeg: 33 };
const FOG = { near: 1800, far: 5600 };
const FADE_MS = 1100;

const params = new URLSearchParams(location.search);
const fixedT = params.has('t') ? Number(params.get('t')) || 0 : null;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const still = () => fixedT !== null || reducedMotion.matches;

const col = (hex: string) => new THREE.Color(hex);

// ---- renderer, scene, camera ----

const canvas = document.getElementById('scene') as HTMLCanvasElement;
const statusEl = document.getElementById('status') as HTMLElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(DPR_CAP, window.devicePixelRatio || 1));
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.08;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
// Supplies fogNear/fogFar to the materials; withHaze replaces the fog colour with the haze colour.
scene.fog = new THREE.Fog(col(L.skyHorizon), FOG.near, FOG.far);
const camera = new THREE.PerspectiveCamera(40, 1, 5, 30000);

/** Target on the ground at Albert Square; its height arrives with the centre terrain tile. */
const target = new THREE.Vector3(0, 40, 0);

const sunDir = (() => {
  const az = (SUN_AZIMUTH * Math.PI) / 180, el = (SUN_ELEVATION * Math.PI) / 180;
  return new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
})();

const sun = new THREE.DirectionalLight(col(lerpHex(L.sun, '#ffffff', 0.15)), L.sunIntensity * 2.0);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
{
  // Shadows only around the square. The light is low, so the ground disc seen from the sun is wide
  // and short: a tall thin box gives about 1 m by 0.3 m per shadow texel.
  const R = 1150;
  const c = sun.shadow.camera;
  c.left = -R; c.right = R;
  c.top = R * Math.sin((SUN_ELEVATION * Math.PI) / 180) + 160;
  c.bottom = -c.top;
  c.near = 2000; c.far = 6000;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.8;
}
scene.add(sun, sun.target);
// The skylight takes a little of the warm horizon: at golden hour most of the sky is not the zenith.
const hemi = new THREE.HemisphereLight(col(lerpHex(L.hemiSky, L.skyHorizon, 0.35)), col(L.hemiGround), 2.2);
scene.add(hemi);

function placeSun() {
  sun.target.position.copy(target);
  sun.position.copy(target).addScaledVector(sunDir, 4000);
  sun.target.updateMatrixWorld();
}
placeSun();

/**
 * One colour for the sky and the haze, by view direction, in display (sRGB) values so the sky and
 * every hazed surface agree to the pixel. Up: skyHorizon to skyTop. Down: the haze deepens from the
 * bright horizon to a muted land haze, so the far city fades through a gradient, not a wall.
 * Warmer toward the sun.
 */
const srgb = (hex: string) => {
  const [r, g, b] = parseHex(hex);
  return new THREE.Vector3(r / 255, g / 255, b / 255);
};
const hazeUniforms = {
  uTop: { value: srgb(L.skyTop) },
  uHor: { value: srgb(L.skyHorizon) },
  uLow: { value: srgb(lerpHex(L.skyHorizon, '#a3988a', 0.3)) },
  uSunCol: { value: srgb(L.sun) },
  uSunDir: { value: sunDir },
};
const HAZE_GLSL = `uniform vec3 uTop; uniform vec3 uHor; uniform vec3 uLow; uniform vec3 uSunCol; uniform vec3 uSunDir;
vec3 hazeCol(vec3 d) {
  float up = smoothstep(0.0, 0.24, d.y);
  vec3 c = d.y >= 0.0 ? mix(uHor, uTop, up) : mix(uHor, uLow, smoothstep(0.0, -0.32, d.y));
  float s = max(dot(d, uSunDir), 0.0);
  return mix(c, uSunCol, (pow(s, 5.0) * 0.32 + pow(s, 48.0) * 0.3) * (1.0 - up * 0.7));
}`;

// Sky dome: follows the camera; not tone-mapped, as it is already display colour.
const sky = new THREE.Mesh(
  new THREE.SphereGeometry(20000, 32, 16),
  new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    toneMapped: false,
    uniforms: hazeUniforms,
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `${HAZE_GLSL}
      varying vec3 vP;
      void main(){ gl_FragColor = vec4(hazeCol(normalize(vP)), 1.0); }`,
  }),
);
sky.renderOrder = -1;
scene.add(sky);

// Faceted land around the tile block (built once the terrain is in), so the block has no edge.
const FAR_COLOURS = [
  lerpHex(CONTOUR.land[0], CONTOUR.building[1], 0.5), // built-up, as the tiles draw it
  lerpHex(CONTOUR.land[0], CONTOUR.building[1], 0.5),
  lerpHex(CONTOUR.land[0], CONTOUR.building[1], 0.35),
  CONTOUR.land[2],
  CONTOUR.land[3],
  CONTOUR.land[4],
].map((h) => {
  const c = parseHex(h);
  return [c[0] / 255, c[1] / 255, c[2] / 255] as [number, number, number];
});

// ---- materials ----

/**
 * Haze at the block's edge: within HAZE.band metres of the edge of the tile block, everything
 * dissolves into the haze colour, and past HAZE.radius from Albert Square too, which rounds off the
 * corners. So the block never shows an edge from any orbit angle, but each side keeps all the city
 * it has. Camera-distance fog adds depth inside.
 */
const BLOCK = blockBounds(gridPlacements(ALBERT, Z));
const HAZE = { inner: 40, band: 760, radius: 2700, radiusBand: 700 };

/**
 * Shader patch for every world material: distance fog and the block-edge haze, both in the haze
 * colour of the view direction, then a per-tile fade (the tile emerges from the haze). Walls also get a faint window grid (the prototype's withWindows, in metres,
 * faded out where a window would be under a pixel, so it never shimmers).
 */
function withHaze(m: THREE.MeshStandardMaterial, fade: { value: number }, windows = false): THREE.MeshStandardMaterial {
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uFade = fade;
    sh.uniforms.uBlock = { value: new THREE.Vector4(BLOCK.minX, BLOCK.maxX, BLOCK.minZ, BLOCK.maxZ) };
    sh.uniforms.uHaze = { value: new THREE.Vector4(HAZE.inner, HAZE.inner + HAZE.band, HAZE.radius - HAZE.radiusBand, HAZE.radius) };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWP; varying vec3 vWN;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        mat4 wm = modelMatrix;
        #ifdef USE_INSTANCING
          wm = modelMatrix * instanceMatrix;
        #endif
        vWP = (wm * vec4(transformed, 1.0)).xyz; vWN = normalize(mat3(wm) * objectNormal);`,
      );
    Object.assign(sh.uniforms, hazeUniforms);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vWP; varying vec3 vWN; uniform float uFade; uniform vec4 uHaze; uniform vec4 uBlock;\n${HAZE_GLSL}`)
      .replace(
        '#include <fog_fragment>',
        `vec3 hz = hazeCol(normalize(vWP - cameraPosition));
        float far = smoothstep(fogNear, fogFar, vFogDepth);
        float edge = min(min(vWP.x - uBlock.x, uBlock.y - vWP.x), min(vWP.z - uBlock.z, uBlock.w - vWP.z));
        float ring = max(1.0 - smoothstep(uHaze.x, uHaze.y, edge), smoothstep(uHaze.z, uHaze.w, length(vWP.xz)));
        gl_FragColor.rgb = mix(gl_FragColor.rgb, hz, max(far, ring));
        gl_FragColor.rgb = mix(hz, gl_FragColor.rgb, uFade);`,
      );
    if (windows) {
      sh.fragmentShader = sh.fragmentShader.replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        float side = step(abs(vWN.y), 0.5);
        vec2 g = vec2((abs(vWN.x) > 0.5 ? vWP.z : vWP.x) / 3.4, vWP.y / 3.6);
        vec2 f = fract(g);
        float win = step(0.3, f.x) * step(f.x, 0.7) * step(0.32, f.y) * step(f.y, 0.78);
        float px = max(fwidth(g.x), fwidth(g.y));
        float vis = 1.0 - smoothstep(0.18, 0.4, px);
        diffuseColor.rgb *= 1.0 - win * side * vis * 0.16;`,
      );
    }
  };
  m.customProgramCacheKey = () => `contour-haze-${windows}`;
  return m;
}

/** Flat-shaded, vertex-coloured Contour material. */
function contourMaterial(opts: { windows?: boolean; roughness?: number; offset?: number; tint?: string }, fade: { value: number }) {
  const m = new THREE.MeshStandardMaterial({
    vertexColors: true,
    color: col(opts.tint ?? '#ffffff'),
    roughness: opts.roughness ?? 0.95,
    metalness: 0,
    flatShading: true,
  });
  if (opts.offset) {
    m.polygonOffset = true;
    m.polygonOffsetFactor = -opts.offset;
    m.polygonOffsetUnits = -opts.offset;
  }
  return withHaze(m, fade, opts.windows);
}

const treeGeo = treeGeometry();

// ---- tiles ----

/** Anything fading in from the haze. */
type Fading = { fade: { value: number }; born: number };
const placed: Fading[] = [];
let built = 0, failed = 0;

function addTile(tile: TilePlacement, meshes: TileMeshes) {
  const fade = { value: 0 };
  const group = new THREE.Group();
  group.position.set(tile.offsetX, 0, tile.offsetZ);
  group.scale.set(tile.scaleX, 1, 1);
  const add = (buf: TileMeshes['ground'], mat: THREE.Material, cast: boolean, receive = true) => {
    const g = toGeometry(buf);
    if (!g) return;
    const mesh = new THREE.Mesh(g, mat);
    mesh.castShadow = cast;
    mesh.receiveShadow = receive;
    group.add(mesh);
  };
  add(meshes.ground, contourMaterial({ tint: L.groundTint }, fade), false);
  add(meshes.water, contourMaterial({ roughness: 0.32, offset: 1 }, fade), false);
  add(meshes.waterways, contourMaterial({ roughness: 0.32, offset: 2 }, fade), false);
  add(meshes.roads, contourMaterial({ offset: 2 }, fade), false);
  add(meshes.buildings, contourMaterial({ windows: true }, fade), true);
  add(meshes.roofs, contourMaterial({}, fade), true);

  const count = meshes.trees.length / 16;
  if (count > 0) {
    const mat = withHaze(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0, flatShading: true }), fade);
    const trees = new THREE.InstancedMesh(treeGeo, mat, count);
    trees.instanceMatrix = new THREE.InstancedBufferAttribute(meshes.trees, 16);
    const c = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const h = Math.abs(Math.sin(meshes.trees[i * 16 + 12] * 12.9898 + meshes.trees[i * 16 + 14] * 78.233) * 43758.5453) % 1;
      trees.setColorAt(i, c.set(TREE_COLOURS[Math.floor(h * TREE_COLOURS.length)]));
    }
    trees.computeBoundingSphere();
    trees.castShadow = true;
    trees.receiveShadow = true;
    group.add(trees);
  }
  scene.add(group);
  placed.push({ fade, born: performance.now() });
  built++;
}

/** Ground height at Albert Square from the centre terrain tile. */
function groundAt(t: TerrainTile, tile: TilePlacement): number {
  const f = tileFrame(Z, tile.x, tile.y).localToFrac(-tile.offsetX, -tile.offsetZ);
  return heightAt(t.heights, t.size, f.fx * t.size - 0.5, f.fy * t.size - 0.5);
}

const workers = Array.from({ length: Math.min(3, Math.max(1, (navigator.hardwareConcurrency || 2) - 1)) }, () =>
  new Worker(new URL('../world/worker.ts', import.meta.url), { type: 'module' }),
);
let nextWorker = 0;
let nextId = 1;
const pending = new Map<number, (r: BuildReply) => void>();
for (const w of workers) w.onmessage = (e: MessageEvent<BuildReply>) => {
  const id = e.data.id;
  if (id === undefined) return;
  pending.get(id)?.(e.data);
  pending.delete(id);
};

function build(tile: TilePlacement, tpl: string, terrain: TerrainTile): Promise<BuildReply> {
  const id = nextId++;
  const heights = terrain.heights.slice(); // the terrain cache keeps the original
  const req: BuildRequest = {
    type: 'build', id, z: tile.z, x: tile.x, y: tile.y,
    region: DEFAULT_REGION, vectorUrl: tpl, terrain: { heights, size: terrain.size }, hiddenFootprints: [],
  };
  const w = workers[nextWorker++ % workers.length];
  return new Promise((resolve) => {
    pending.set(id, resolve);
    w.postMessage(req, [heights.buffer]);
  });
}

function showStatus(text: string) {
  statusEl.textContent = text;
  statusEl.hidden = !text;
}

function addFarLand(tiles: TilePlacement[], terrains: Map<TilePlacement, TerrainTile>) {
  const b = blockBounds(tiles);
  const edgeHeight = (x: number, z: number) => {
    for (const t of tiles) {
      const f = tileFrame(t.z, t.x, t.y);
      const lx = (x - t.offsetX) / t.scaleX, lz = z - t.offsetZ;
      if (lx < -0.01 || lx > f.widthM + 0.01 || lz > 0.01 || lz < -f.heightM - 0.01) continue;
      const tt = terrains.get(t);
      if (!tt) continue;
      const fr = f.localToFrac(lx, lz);
      return heightAt(tt.heights, tt.size, fr.fx * tt.size - 0.5, fr.fy * tt.size - 0.5);
    }
    return target.y;
  };
  const g = toGeometry(farLandBuffers(b, edgeHeight, FAR_COLOURS));
  if (!g) return;
  const fade = { value: 0 };
  const mesh = new THREE.Mesh(g, contourMaterial({ tint: L.groundTint }, fade));
  mesh.receiveShadow = true;
  scene.add(mesh);
  placed.push({ fade, born: performance.now() });
}

async function load() {
  const tiles = gridPlacements(ALBERT, Z);
  let tpl: string;
  try {
    tpl = await vectorTileTemplate();
  } catch {
    showStatus('The map did not load. Check the connection and reload the page.');
    return;
  }
  const terrains = new Map<TilePlacement, TerrainTile>();
  const terrainIn = tiles.map(async (tile, i) => {
    const t = await terrainTile(tile.z, tile.x, tile.y);
    terrains.set(tile, t);
    if (i === 0) {
      target.y = groundAt(t, tile);
      placeSun();
    }
    return t;
  });
  // the surrounding land, as soon as every terrain tile has answered
  Promise.allSettled(terrainIn).then(() => addFarLand(tiles, terrains));
  await Promise.all(
    tiles.map(async (tile, i) => {
      try {
        const reply = await build(tile, tpl, await terrainIn[i]);
        if (reply.type === 'built') addTile(tile, reply.meshes);
        else throw new Error(reply.message);
      } catch (e) {
        failed++;
        console.warn(`tile ${tile.z}/${tile.x}/${tile.y}`, e);
      }
    }),
  );
  if (failed === tiles.length) showStatus('The map did not load. Check the connection and reload the page.');
  else if (failed) showStatus(`${failed} of ${tiles.length} map tiles did not load.`);
  hook.done = true;
  for (const w of workers) w.terminate();
}

// ---- frame loop ----

const hook = { done: false, built: 0, failed: 0, calls: 0, triangles: 0, geometries: 0, frames: 0 };
(window as unknown as { __tileproof: typeof hook }).__tileproof = hook;

function frameCamera(tSec: number) {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  const aspect = w / Math.max(1, h);
  // Keep at least 28 degrees across in portrait, without going fish-eye.
  const hFovMin = (28 * Math.PI) / 180;
  const vFromH = (2 * Math.atan(Math.tan(hFovMin / 2) / aspect) * 180) / Math.PI;
  camera.fov = Math.min(58, Math.max(34, vFromH));
  camera.aspect = aspect;
  camera.updateProjectionMatrix();
  const p = orbitPose(tSec, ORBIT);
  camera.position.set(target.x + p.x, target.y + p.y, target.z + p.z);
  camera.lookAt(target);
  sky.position.copy(camera.position);
}

let lastSize = '';
function resize() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  const key = `${w}x${h}`;
  if (key === lastSize) return false;
  lastSize = key;
  renderer.setSize(w, h, false);
  return true;
}

const ease = (x: number) => 1 - Math.pow(2, -10 * Math.min(1, Math.max(0, x)));
const t0 = performance.now();
let shown = false;

function frame(now: number) {
  let dirty = resize();
  for (const p of placed) {
    if (p.fade.value < 1) {
      p.fade.value = ease((now - p.born) / FADE_MS);
      if (p.fade.value > 0.999) p.fade.value = 1;
      dirty = true;
    }
  }
  const moving = !still();
  if (moving || dirty || hook.frames === 0) {
    const t = fixedT ?? (reducedMotion.matches ? 0 : (now - t0) / 1000);
    frameCamera(t);
    renderer.render(scene, camera);
    hook.frames++;
    hook.calls = renderer.info.render.calls;
    hook.triangles = renderer.info.render.triangles;
    hook.geometries = renderer.info.memory.geometries;
    if (!shown) {
      canvas.classList.add('on');
      shown = true;
    }
  }
  hook.built = built;
  hook.failed = failed;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
load();
