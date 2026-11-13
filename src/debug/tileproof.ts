/**
 * Tile proof: the 3 x 3 z14 tiles around Albert Square, Manchester, built by the mesh worker from
 * live OpenFreeMap and Mapterhorn tiles and drawn in the Contour look at a fixed golden hour, with
 * a slow orbit. A check page for SK, not the product.
 *
 * Query: ?t=<seconds> holds the orbit at that time (for screenshots). Reduced motion holds it at 0.
 * ?clean=1 hides the caption, for the social preview image.
 */
import * as THREE from 'three';
import type { LatLon } from '../geo/coords';
import { tileFrame } from '../world/frame';
import { CONTOUR, DEFAULT_REGION, lightFor, lerpHex, parseHex } from '../world/palette';
import { heightAt } from '../world/terrain';
import { terrainTile, type TerrainTile } from '../world/terrainsrc';
import { vectorTileTemplate } from '../world/vector';
import type { BuildReply, BuildRequest } from '../world/worker';
import type { TileMeshes } from '../world/meshjob';
import { blockBounds, farLandBuffers, gridPlacements, orbitPose, type TilePlacement } from './tilegrid';
import { toGeometry } from '../world/geometry';
import { WorkerPool } from '../world/workerpool';
import { createRenderer } from '../world/render';
import { createHaze, setBlockHaze } from '../world/haze';
import { ContourMaterials, noCoverage } from '../world/materials';
import { SkyDome } from '../world/skydome';
import { SunLight, sunDirection } from '../world/sunlight';
import { TileView } from '../world/tileview';

const ALBERT: LatLon = { lat: 53.4794, lon: -2.2453 };
const Z = 14;

// ---- the look ----

/** Golden hour: a low sun from the west-south-west, so shadows rake east across the streets. */
const SUN_ELEVATION = 8;
const SUN_AZIMUTH = 250;
const L = lightFor(SUN_ELEVATION);

/**
 * One turn in 105 s around the square, starting from the north-north-west (side-lit, the Irwell in
 * front). High enough to read the street pattern; the haze takes the top of a portrait screen.
 */
const ORBIT = { periodSec: 105, startDeg: 330, distance: 1500, pitchDeg: 33 };
const FOG = { near: 1800, far: 5600 };
const FADE_MS = 1100;

const params = new URLSearchParams(location.search);
const fixedT = params.has('t') ? Number(params.get('t')) || 0 : null;
if (params.get('clean') === '1') document.documentElement.classList.add('clean');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const still = () => fixedT !== null || reducedMotion.matches;

// ---- renderer, scene, camera ----

const canvas = document.getElementById('scene') as HTMLCanvasElement;
const statusEl = document.getElementById('status') as HTMLElement;
const renderer = createRenderer(canvas);

const scene = new THREE.Scene();
// Supplies fogNear/fogFar to the materials; the haze patch replaces the fog colour with the haze colour.
scene.fog = new THREE.Fog(new THREE.Color(L.skyHorizon), FOG.near, FOG.far);
const camera = new THREE.PerspectiveCamera(40, 1, 5, 30000);

/** Target on the ground at Albert Square; its height arrives with the centre terrain tile. */
const target = new THREE.Vector3(0, 40, 0);

const sunDir = sunDirection(SUN_ELEVATION, SUN_AZIMUTH);
// Shadows only around the square (a tall thin box, about 1 m by 0.3 m per shadow texel).
const sun = new SunLight(L, sunDir, { radius: 1150, mapSize: 2048, snap: 0 });
sun.addTo(scene);
function placeSun() {
  sun.place(target);
  renderer.shadowMap.needsUpdate = true;
}
placeSun();

const haze = createHaze(L, sunDir);
/**
 * Haze at the block's edge: within 760 m of the edge of the tile block, everything dissolves into
 * the haze colour, and past 2.7 km from Albert Square too, which rounds off the corners. So the
 * block never shows an edge from any orbit angle, but each side keeps all the city it has.
 * Camera-distance fog adds depth inside.
 */
setBlockHaze(haze, blockBounds(gridPlacements(ALBERT, Z)), { inner: 40, band: 760, radius: 2700, radiusBand: 700 });
const materials = new ContourMaterials(haze, noCoverage(), { groundTint: L.groundTint });

const sky = new SkyDome(haze);
scene.add(sky.mesh);

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

// ---- tiles ----

/** Anything fading in from the haze: its slot, and when it arrived. */
type Fading = { slot: number; born: number; fade: number };
const placed: Fading[] = [];
let built = 0, failed = 0;

function addTile(tile: TilePlacement, meshes: TileMeshes) {
  const view = new TileView(meshes, materials, { zoom: Z, castShadow: true, clip: false });
  view.place(tile.offsetX, 0, tile.offsetZ, tile.scaleX);
  scene.add(view.group);
  placed.push({ slot: view.slot, born: performance.now(), fade: 0 });
  renderer.shadowMap.needsUpdate = true;
  built++;
}

/** Ground height at Albert Square from the centre terrain tile. */
function groundAt(t: TerrainTile, tile: TilePlacement): number {
  const f = tileFrame(Z, tile.x, tile.y).localToFrac(-tile.offsetX, -tile.offsetZ);
  return heightAt(t.heights, t.size, f.fx * t.size - 0.5, f.fy * t.size - 0.5);
}

const pool = new WorkerPool<BuildRequest, BuildReply>(
  () => new Worker(new URL('../world/worker.ts', import.meta.url), { type: 'module' }),
  Math.min(3, Math.max(1, (navigator.hardwareConcurrency || 2) - 1)),
  { timeoutMs: 20000 },
);

/** Build one tile in the pool; rejects if the worker fails, times out or reports an error. */
async function build(tile: TilePlacement, tpl: string, terrain: TerrainTile): Promise<TileMeshes> {
  const heights = terrain.heights.slice(); // the terrain cache keeps the original
  const reply = await pool.request(
    {
      type: 'build', z: tile.z, x: tile.x, y: tile.y,
      region: DEFAULT_REGION, vectorUrl: tpl, terrain: { heights, size: terrain.size }, hiddenFootprints: [],
    },
    [heights.buffer],
  );
  if (reply.type !== 'built') throw new Error(reply.message);
  return reply.meshes;
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
  const slot = materials.slots.alloc(Z);
  const g = toGeometry(farLandBuffers(b, edgeHeight, FAR_COLOURS), slot);
  if (!g) return;
  const mesh = new THREE.Mesh(g, materials.solid.ground);
  mesh.receiveShadow = true;
  scene.add(mesh);
  placed.push({ slot, born: performance.now(), fade: 0 });
  renderer.shadowMap.needsUpdate = true;
}

const LOAD_FAILED = 'The map did not load. Check the connection and reload the page.';

async function load() {
  const tiles = gridPlacements(ALBERT, Z);
  try {
    let tpl: string;
    try {
      tpl = await vectorTileTemplate();
    } catch {
      showStatus(LOAD_FAILED);
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
    Promise.allSettled(terrainIn)
      .then(() => addFarLand(tiles, terrains))
      .catch((e) => console.warn('far land', e));
    await Promise.all(
      tiles.map(async (tile, i) => {
        try {
          addTile(tile, await build(tile, tpl, await terrainIn[i]));
        } catch (e) {
          failed++;
          console.warn(`tile ${tile.z}/${tile.x}/${tile.y}`, e);
        }
      }),
    );
    if (failed === tiles.length) showStatus(LOAD_FAILED);
    else if (failed) showStatus(`${failed} of ${tiles.length} map tiles did not load.`);
  } finally {
    hook.done = true;
    pool.terminate();
  }
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
  sky.follow(camera);
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
    if (p.fade < 1) {
      p.fade = ease((now - p.born) / FADE_MS);
      if (p.fade > 0.999) p.fade = 1;
      materials.slots.set(p.slot, p.fade);
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
