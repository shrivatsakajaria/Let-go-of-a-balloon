/**
 * The Contour materials: one shared, flat-shaded material per mesh bucket (ground, water, roads,
 * walls, roofs, trees...), in two variants:
 *  - solid: haze and per-tile fade from the haze colour. For tiles of the finest level.
 *  - clip: as solid, plus it discards fragments where a finer level of detail is drawn (coverage.ts)
 *    and can dissolve a tile in or out with an ordered dither (for a tile replacing a coarser one,
 *    where fading from the haze would flash). Discarding costs early depth tests on some phones, so
 *    only tiles that need it use this variant.
 *
 * Per-tile values (fade, zoom, fade mode) live in a shared uniform array indexed by a per-vertex
 * (or per-instance) `aSlot` attribute, because a shared material cannot carry a per-object uniform.
 * Every uniform is a shared object, mutable at run time: nothing about the haze, fog or coverage is
 * compiled in.
 */
import * as THREE from 'three';
import { CLOUD_SHADE_GLSL, HAZE_GLSL, WIN_GRID_M, WIN_REPEAT, type HazeUniforms } from './haze';
import { COV_N, type CoverageUniforms } from './coverage';

export const SLOT_COUNT = 64;
/** Slot 0: always fully in, never clipped. Geometry without an aSlot attribute reads it. */
export const SLOT_ALWAYS = 0;

/** The per-tile values the shaders read: x fade 0..1, y zoom, z dither mode (1) or haze fade (0). */
export class TileSlots {
  readonly uniform: { value: THREE.Vector4[] };
  private readonly free: number[] = [];

  constructor() {
    this.uniform = { value: Array.from({ length: SLOT_COUNT }, () => new THREE.Vector4(1, 99, 0, 0)) };
    for (let i = SLOT_COUNT - 1; i >= 1; i--) this.free.push(i);
  }

  get available(): number {
    return this.free.length;
  }

  /** A free slot (fade 0), or -1 when all are taken. */
  alloc(zoom: number, dither = false): number {
    const s = this.free.pop();
    if (s === undefined) return -1;
    this.uniform.value[s].set(0, zoom, dither ? 1 : 0, 0);
    return s;
  }

  set(slot: number, fade: number, dither?: boolean): void {
    const v = this.uniform.value[slot];
    v.x = fade;
    if (dither !== undefined) v.z = dither ? 1 : 0;
  }

  get(slot: number): THREE.Vector4 {
    return this.uniform.value[slot];
  }

  release(slot: number): void {
    if (slot <= SLOT_ALWAYS || slot >= SLOT_COUNT || this.free.includes(slot)) return;
    this.uniform.value[slot].set(1, 99, 0, 0);
    this.free.push(slot);
  }
}

export type Bucket = 'ground' | 'water' | 'waterways' | 'roads' | 'buildings' | 'roofs' | 'trees' | 'boats';
export const BUCKETS: Bucket[] = ['ground', 'water', 'waterways', 'roads', 'buildings', 'roofs', 'trees', 'boats'];

/** Lit windows, street lamps and city glow at night: warm, pale amber (never the balloon's orange). */
export const WINDOW_LIGHT = [1.0, 0.74, 0.42] as const;
export const GLOW_LIGHT = [0.9, 0.6, 0.32] as const;
export const LAMP_LIGHT = [1.0, 0.8, 0.52] as const;
const vec3 = (c: readonly number[]) => `vec3(${c.map((v) => v.toFixed(3)).join(', ')})`;

const VERTEX_PARS = `
attribute float aSlot; attribute float aGlow;
uniform vec4 uSlots[${SLOT_COUNT}];
varying vec3 vWP; varying vec3 vWN; varying float vFade; varying float vZoom; varying float vDither; varying float vGlow;`;

const VERTEX_MAIN = `
  mat4 wm = modelMatrix;
  #ifdef USE_INSTANCING
    wm = modelMatrix * instanceMatrix;
  #endif
  vWP = (wm * vec4(transformed, 1.0)).xyz; vWN = normalize(mat3(wm) * objectNormal);
  vec4 slotV = uSlots[int(aSlot + 0.5)];
  vFade = slotV.x; vZoom = slotV.y; vDither = slotV.z; vGlow = aGlow;`;

const FRAGMENT_PARS = `
varying vec3 vWP; varying vec3 vWN; varying float vFade; varying float vZoom; varying float vDither; varying float vGlow;
uniform vec4 uBlock; uniform vec4 uHazeRing; uniform vec3 uWinShift; uniform float uNight;
${HAZE_GLSL}
${CLOUD_SHADE_GLSL}
#ifdef CONTOUR_CLIP
uniform sampler2D uCoverage; uniform vec4 uCovO; uniform vec4 uMerc;
float bayer4(vec2 p) {
  ivec2 q = ivec2(mod(p, 4.0));
  const float m[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
  return (m[q.x + q.y * 4] + 0.5) / 16.0;
}
#endif`;

const FRAGMENT_CLIP = `
#ifdef CONTOUR_CLIP
  {
    float dl = -vWP.z * uCovO.w;
    vec2 cell = vec2(uCovO.x + vWP.x * uCovO.z, uCovO.y + dl * (uMerc.x + dl * (uMerc.y + dl * (uMerc.z + dl * uMerc.w))));
    ivec2 ci = ivec2(floor(cell));
    if (ci.x >= 0 && ci.y >= 0 && ci.x < ${COV_N} && ci.y < ${COV_N} && texelFetch(uCoverage, ci, 0).r * 255.0 > vZoom + 0.5) discard;
    if (vDither > 0.5 && vFade < bayer4(gl_FragCoord.xy)) discard;
  }
#endif`;

const FRAGMENT_FOG = `
  gl_FragColor.rgb *= cloudShade(vWP);
  vec3 hz = hazeCol(normalize(vWP - cameraPosition));
  #ifdef USE_FOG
    float far = smoothstep(fogNear, fogFar, vFogDepth);
  #else
    float far = 0.0;
  #endif
  float edge = min(min(vWP.x - uBlock.x, uBlock.y - vWP.x), min(vWP.z - uBlock.z, uBlock.w - vWP.z));
  float ring = max(1.0 - smoothstep(uHazeRing.x, uHazeRing.y, edge), smoothstep(uHazeRing.z, uHazeRing.w, length(vWP.xz)));
  gl_FragColor.rgb = mix(gl_FragColor.rgb, hz, max(far, ring));
  gl_FragColor.rgb = mix(hz, gl_FragColor.rgb, vDither > 0.5 ? 1.0 : vFade);`;

/**
 * The prototype's withWindows, in metres (${WIN_GRID_M} x 3.6 m): a subtle darker pane by day, faded out
 * where a window is under a pixel so it never shimmers. At night some windows are lit (a hash of
 * the window's cell, repeating every ${WIN_REPEAT} windows so the shift can stay small), scaled by uNight;
 * where windows are under a pixel the wall takes their average light instead, so a far city still
 * glimmers.
 */
const FRAGMENT_WINDOWS = `
  {
    float side = step(abs(vWN.y), 0.5);
    vec3 wp = vWP + uWinShift;
    vec2 g = vec2((abs(vWN.x) > 0.5 ? wp.z : wp.x) / ${WIN_GRID_M.toFixed(1)}, wp.y / 3.6);
    vec2 f = fract(g);
    float win = step(0.3, f.x) * step(f.x, 0.7) * step(0.32, f.y) * step(f.y, 0.78);
    float px = max(fwidth(g.x), fwidth(g.y));
    float vis = 1.0 - smoothstep(0.18, 0.4, px);
    diffuseColor.rgb *= 1.0 - win * side * vis * 0.16 * (1.0 - uNight);
    if (uNight > 0.0) {
      vec2 cl = mod(floor(g), ${WIN_REPEAT.toFixed(1)});
      float h = fract(sin(dot(cl, vec2(12.9898, 78.233))) * 43758.5453);
      float lit = step(0.56, h) * (0.75 + 0.5 * fract(h * 7.31));
      float light = mix(0.115, win * lit, vis);
      totalEmissiveRadiance += ${vec3(WINDOW_LIGHT)} * (light * side * uNight * 2.2);
    }
  }`;

/** City glow: a soft warm light on the ground and streets where buildings and roads are densest. */
const FRAGMENT_GLOW = `
  totalEmissiveRadiance += ${vec3(GLOW_LIGHT)} * (vGlow * vGlow * uNight * 0.55);`;

type Shared = { haze: HazeUniforms; slots: TileSlots; coverage: CoverageUniforms };

function patch(m: THREE.MeshStandardMaterial, shared: Shared, o: { clip: boolean; windows: boolean; glow: boolean }): THREE.MeshStandardMaterial {
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, shared.haze, { uSlots: shared.slots.uniform });
    if (o.clip) Object.assign(sh.uniforms, shared.coverage);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${VERTEX_PARS}`)
      .replace('#include <project_vertex>', `#include <project_vertex>\n${VERTEX_MAIN}`);
    sh.fragmentShader = `${o.clip ? '#define CONTOUR_CLIP\n' : ''}${sh.fragmentShader}`
      .replace('#include <common>', `#include <common>\n${FRAGMENT_PARS}`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\n${FRAGMENT_CLIP}`)
      .replace('#include <fog_fragment>', FRAGMENT_FOG);
    const extra = (o.windows ? FRAGMENT_WINDOWS : '') + (o.glow ? FRAGMENT_GLOW : '');
    if (extra) sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${extra}`);
  };
  m.customProgramCacheKey = () => `contour-${o.clip ? 'clip' : 'solid'}-${o.windows ? 'win' : 'plain'}-${o.glow ? 'glow' : 'dark'}`;
  return m;
}

type Spec = { vertexColors: boolean; roughness: number; offset?: number; windows?: boolean; tint?: boolean; glow?: boolean; double?: boolean };
const SPECS: Record<Bucket, Spec> = {
  ground: { vertexColors: true, roughness: 0.95, tint: true, glow: true },
  water: { vertexColors: true, roughness: 0.32, offset: 1 },
  waterways: { vertexColors: true, roughness: 0.32, offset: 2 },
  roads: { vertexColors: true, roughness: 0.95, offset: 2, glow: true },
  buildings: { vertexColors: true, roughness: 0.95, windows: true },
  roofs: { vertexColors: true, roughness: 0.95 },
  trees: { vertexColors: false, roughness: 0.9 },
  boats: { vertexColors: true, roughness: 0.6, double: true },
};

function make(b: Bucket, shared: Shared, clip: boolean, groundTint: string): THREE.MeshStandardMaterial {
  const s = SPECS[b];
  const m = new THREE.MeshStandardMaterial({
    vertexColors: s.vertexColors,
    color: new THREE.Color(s.tint ? groundTint : '#ffffff'),
    roughness: s.roughness,
    metalness: 0,
    flatShading: true,
    side: s.double ? THREE.DoubleSide : THREE.FrontSide,
  });
  if (s.offset) {
    m.polygonOffset = true;
    m.polygonOffsetFactor = -s.offset;
    m.polygonOffsetUnits = -s.offset;
  }
  m.name = `contour-${b}-${clip ? 'clip' : 'solid'}`;
  return patch(m, shared, { clip, windows: !!s.windows, glow: !!s.glow });
}

/**
 * Street lamps: one point each, a soft warm dot a few pixels wide that shows from dusk (uNight),
 * fades with the tile and into the haze, and adds light (it never darkens what is behind it).
 */
function lampMaterial(shared: Shared): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'contour-lamps',
    uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), uSlots: shared.slots.uniform, uNight: shared.haze.uNight, uPxScale: shared.haze.uPxScale },
    fog: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    vertexShader: `attribute float aSlot; uniform vec4 uSlots[${SLOT_COUNT}]; uniform float uPxScale;
      uniform float fogNear; uniform float fogFar; varying float vA;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position + vec3(0.0, 5.0, 0.0), 1.0);
        gl_Position = projectionMatrix * mv;
        float d = max(1.0, -mv.z);
        float px = 9.0 * projectionMatrix[1][1] * uPxScale / d;
        gl_PointSize = clamp(px, 2.0, 10.0);
        vA = uSlots[int(aSlot + 0.5)].x * (1.0 - smoothstep(fogNear, fogFar, d)) * min(1.0, px / 2.0);
      }`,
    fragmentShader: `uniform float uNight; varying float vA;
      void main() {
        float r = length(gl_PointCoord - 0.5) * 2.0;
        float a = (1.0 - smoothstep(0.15, 1.0, r)) * vA * smoothstep(0.15, 0.7, uNight);
        if (a < 0.004) discard;
        gl_FragColor = vec4(${vec3(LAMP_LIGHT)} * a, 1.0);
      }`,
  });
}

/** The shared Contour materials, both variants of every bucket. */
export class ContourMaterials {
  readonly solid: Record<Bucket, THREE.MeshStandardMaterial>;
  readonly clip: Record<Bucket, THREE.MeshStandardMaterial>;
  /** Street lamps (points), shared by every tile. */
  readonly lamps: THREE.ShaderMaterial;
  readonly slots: TileSlots;
  readonly haze: HazeUniforms;

  constructor(haze: HazeUniforms, coverage: CoverageUniforms, opts: { groundTint: string; slots?: TileSlots }) {
    this.haze = haze;
    this.slots = opts.slots ?? new TileSlots();
    const shared: Shared = { haze, slots: this.slots, coverage };
    const all = (clip: boolean) => Object.fromEntries(BUCKETS.map((b) => [b, make(b, shared, clip, opts.groundTint)])) as Record<Bucket, THREE.MeshStandardMaterial>;
    this.solid = all(false);
    this.clip = all(true);
    this.lamps = lampMaterial(shared);
  }

  /** The light-dependent ground tint (palette Light.groundTint). */
  setGroundTint(hex: string): void {
    this.solid.ground.color.set(hex);
    this.clip.ground.color.set(hex);
  }

  dispose(): void {
    for (const b of BUCKETS) {
      this.solid[b].dispose();
      this.clip[b].dispose();
    }
    this.lamps.dispose();
  }
}

/** A coverage that covers nothing, for pages without levels of detail (the tile proof). */
export function noCoverage(): CoverageUniforms {
  const tex = new THREE.DataTexture(new Uint8Array(1), 1, 1, THREE.RedFormat, THREE.UnsignedByteType);
  tex.needsUpdate = true;
  return { uCoverage: { value: tex }, uCovO: { value: new THREE.Vector4(-1e6, -1e6, 0, 0) }, uMerc: { value: new THREE.Vector4() } };
}
