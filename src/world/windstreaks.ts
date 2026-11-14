/**
 * Wind streaks (owner's decision, 14 November 2026): once the balloon is well up, thin pale streaks
 * slant along the wind and flow past it, like rain blown sideways, over the whole view. Subtle, never
 * a pattern: the land, the lights and the balloon read through them.
 *
 * - World space, carried by the wind: every streak has a fixed place in an endless lattice of boxes
 *   that drifts with the wind (`anchor`, scene metres, moved with the floating origin). What is drawn
 *   is the part of that lattice inside a few nested boxes (STREAK_LAYERS: 100 to 800 m across) set
 *   one behind another along where the camera looks, each about as wide as the view at its distance,
 *   so most streaks are on screen whatever the view and near ones are as dense as far ones. A box
 *   can move (the camera turns, the balloon flies) without moving any streak: it only changes which
 *   copy of each is drawn. Every face fades to nothing, so a streak never pops in or runs out.
 * - The slab: they keep to the balloon's height band (STREAK_SLAB) and clear of the ground.
 * - Speed: the balloon rides the wind, so in its own frame the air is still, and streaks at the
 *   wind's speed would hang beside it. They flow past the balloon at STREAK_REL_MIN_MS plus
 *   STREAK_REL_GAIN times the wind's speed (so 3x the wind over the ground, plus 5 m/s): a light
 *   wind still flows, a stronger one visibly faster. Their direction eases toward the wind's, so
 *   in a calm they keep drifting slowly the way it last blew rather than stopping dead.
 * - Pause holds them still (spec 7.3), still shown.
 * - Look: off-white quads about 1.5 CSS px wide (screen space), varied in length and brightness,
 *   fading at both ends, near the camera, at the faces of their box and into the haze; each slowly
 *   brightens and fades again as it travels. More visible at night, subtler by day. None is ever
 *   drawn over the balloon: one in front of it, near the line from the camera, fades out.
 * - One draw: an instanced quad, STREAK_COUNT instances (4 vertices each). Every position is worked
 *   out in the vertex shader from a few uniforms; the CPU only advances the wind's offset and places
 *   the boxes (no allocation per frame).
 * - When: the scene asks for streakTarget() each frame and the opacity eases toward it over a few
 *   seconds. Off with reduced motion (they are motion and nothing else).
 */
import * as THREE from 'three';
import type { HazeUniforms } from './haze';

/** The nested boxes' sizes (cubes, metres): each twice the last, so one anchor wraps them all. */
export const STREAK_LAYERS = [100, 200, 400, 800] as const;
export const STREAK_PER_LAYER = 220;
export const STREAK_COUNT = STREAK_LAYERS.length * STREAK_PER_LAYER;
/** The anchor repeats every this many metres (the largest box). */
const ANCHOR_WRAP_M = STREAK_LAYERS[STREAK_LAYERS.length - 1];
/** Each box is this much taller than the view at its distance (it fades at its faces). */
const LAYER_COVER = 1.3;
/** Heights round the balloon they keep to (m below and above), fading over FADE_M. */
export const STREAK_SLAB = { below: 900, above: 400, fadeM: 250 } as const;
/** Streaks flow past the balloon at STREAK_REL_MIN_MS + STREAK_REL_GAIN x the wind's speed (m/s). */
export const STREAK_REL_MIN_MS = 5;
export const STREAK_REL_GAIN = 2;
/**
 * The strongest wind they are moved by (m/s): above the strongest jet streams. A wind from the data that is
 * not finite counts as a calm, and a stronger one is held to this, its direction kept.
 */
export const STREAK_MAX_WIND_MS = 120;
/** Seconds: their direction eases toward the wind's with this time constant. */
export const STREAK_TURN_S = 1;
/** Heights above the ground (m) over which they come in. */
export const STREAK_FADE_AGL = { from: 300, to: 600 } as const;
/** Seconds before the landing over which they go. */
export const STREAK_LAND_S = 300;
/** Seconds: the opacity eases toward its target with this time constant. */
export const STREAK_EASE_S = 1.5;
/** How visible at full opacity, by day and at night (the brightest streak's alpha). */
export const STREAK_DAY = 0.3;
export const STREAK_NIGHT = 0.62;
/** The life cycle of each streak (seconds) divides this period, so the clock can wrap without a jump. */
const LIFE_WRAP_S = 1200;

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const fract = (x: number) => x - Math.floor(x);

/** 0 up to 300 m above the ground, 1 from 600 m, smooth between (NaN: 0). */
export function heightFade(aglM: number): number {
  return Number.isFinite(aglM) ? smooth(STREAK_FADE_AGL.from, STREAK_FADE_AGL.to, aglM) : 0;
}

export type StreakState = {
  released: boolean;
  landed: boolean;
  /** The whole-trip replay is on. */
  replay: boolean;
  /** prefers-reduced-motion. */
  reduced: boolean;
  /** The director's shot ('launch' while the crane shot runs). */
  shot: string;
  aglM: number;
  /** Seconds until the balloon lands (NaN when unknown). */
  toLandS: number;
};

/** How much of the streaks to show now (0..1), before easing. */
export function streakTarget(s: StreakState): number {
  if (!s.released || s.landed || s.replay || s.reduced || s.shot === 'launch') return 0;
  const land = Number.isNaN(s.toLandS) ? 1 : smooth(0, STREAK_LAND_S, s.toLandS);
  return heightFade(s.aglM) * land;
}

/** The wind the streaks are moved by (m/s, u east, v north): a calm for one that is not finite, held to STREAK_MAX_WIND_MS. */
export function streakWind(u: number, v: number, out: { u: number; v: number }): { u: number; v: number } {
  if (!Number.isFinite(u) || !Number.isFinite(v)) {
    out.u = 0;
    out.v = 0;
    return out;
  }
  const s = Math.hypot(u, v);
  const k = s > STREAK_MAX_WIND_MS ? STREAK_MAX_WIND_MS / s : 1;
  out.u = u * k;
  out.v = v * k;
  return out;
}

/** One step of an exponential ease from cur toward target (time constant tauS). */
export function easeToward(cur: number, target: number, dtS: number, tauS: number): number {
  if (!(dtS > 0)) return cur;
  const k = 1 - Math.exp(-dtS / Math.max(1e-6, tauS));
  return k >= 1 ? target : cur + (target - cur) * k;
}

/**
 * The streaks' velocity over the ground (scene m/s: x east, z south) for the wind at the balloon
 * (u east, v north, m/s) and their current direction `dir` (scene xz, unit; eased toward the
 * wind's): the wind itself, plus STREAK_REL_GAIN x the wind and STREAK_REL_MIN_MS along dir past
 * the balloon. Continuous in the wind: in a calm they drift at STREAK_REL_MIN_MS along dir.
 */
export function streakVelocity(u: number, v: number, dir: { x: number; z: number }, out: { x: number; z: number }): { x: number; z: number } {
  const ok = Number.isFinite(u) && Number.isFinite(v);
  const k = 1 + STREAK_REL_GAIN;
  out.x = (ok ? u * k : 0) + dir.x * STREAK_REL_MIN_MS;
  out.z = (ok ? -v * k : 0) + dir.z * STREAK_REL_MIN_MS;
  return out;
}

/** One step of the streaks' direction (scene xz, unit, in place) toward the wind's (u east, v north). */
export function turnToward(dir: { x: number; z: number }, u: number, v: number, dtS: number): { x: number; z: number } {
  const s = Math.hypot(u, v);
  if (!(s > 1e-3) || !Number.isFinite(s) || !(dtS > 0)) return dir;
  const tx = u / s, tz = -v / s;
  // ease the signed angle (an exact about-face turns as fast as any other change)
  const ang = Math.atan2(dir.x * tz - dir.z * tx, dir.x * tx + dir.z * tz);
  const turn = ang * (1 - Math.exp(-dtS / STREAK_TURN_S));
  const cs = Math.cos(turn), sn = Math.sin(turn);
  const x = dir.x * cs - dir.z * sn, z = dir.x * sn + dir.z * cs;
  const l = Math.hypot(x, z) || 1;
  dir.x = x / l;
  dir.z = z / l;
  return dir;
}

type V3 = { x: number; y: number; z: number };

/**
 * Where the wind has carried the streaks (anchor, scene metres) as a fraction of a box from its
 * centre, per axis in [0, 1): what the shader adds to each streak's seed. Worked out here in double
 * precision, so the shader's numbers stay small on any flight.
 */
export function boxShift(anchor: V3, center: V3, size: number, out: V3): V3 {
  out.x = fract((anchor.x - center.x) / size);
  out.y = fract((anchor.y - center.y) / size);
  out.z = fract((anchor.z - center.z) / size);
  return out;
}

/** A streak's middle (scene metres), exactly as the vertex shader places it: seed in [0, 1)^3. */
export function streakPos(seed: V3, shift: V3, center: V3, size: number, out: V3): V3 {
  out.x = center.x + (fract(seed.x + shift.x) - 0.5) * size;
  out.y = center.y + (fract(seed.y + shift.y) - 0.5) * size;
  out.z = center.z + (fract(seed.z + shift.z) - 0.5) * size;
  return out;
}

/** Where in a box (share of its size from the centre) the fade toward its faces begins and ends; the shader's too. */
export const EDGE_FADE = { from: 0.32, to: 0.5 } as const;

/** Visibility by place in a box (q: offset from the centre over the box's size, -0.5..0.5): 0 at every face. */
export function edgeFade(q: V3): number {
  return 1 - smooth(EDGE_FADE.from, EDGE_FADE.to, Math.max(Math.abs(q.x), Math.abs(q.y), Math.abs(q.z)));
}

/**
 * How far along the look a box of `size` sits from the camera: where the view (vertical field of
 * view fovDeg, width over height `aspect`) is about as tall, or as wide, as the box, whichever is
 * larger: a landscape screen is covered side to side.
 */
export function layerDistance(size: number, fovDeg: number, aspect = 1): number {
  const tanV = Math.tan((Math.max(10, Math.min(120, fovDeg)) * Math.PI) / 360);
  const a = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  return size / (2 * LAYER_COVER * Math.max(tanV, tanV * a));
}

const N_LAYERS = STREAK_LAYERS.length;
/** Metres from the camera over which they come in; heights over the ground over which they come in. */
const NEAR_FADE = [25, 70] as const;
const GROUND_FADE = [60, 220] as const;

/**
 * How visible a streak is by where it is (0..1), exactly as the shader fades it: the faces of its
 * box (q), near the camera, into the haze (fog, when given), the balloon's height band and the
 * ground. Leaves out its own brightness and life cycle, and the fade in front of the balloon.
 */
export function placeFade(q: V3, c: V3, camera: V3, focusY: number, groundM: number, fog?: { near: number; far: number }): number {
  let a = edgeFade(q);
  const dc = Math.hypot(c.x - camera.x, c.y - camera.y, c.z - camera.z);
  a *= smooth(NEAR_FADE[0], NEAR_FADE[1], dc);
  if (fog) a *= 1 - smooth(fog.near, fog.far, dc);
  const y = c.y - focusY;
  a *= smooth(-STREAK_SLAB.below, -(STREAK_SLAB.below - STREAK_SLAB.fadeM), y);
  a *= 1 - smooth(STREAK_SLAB.above - STREAK_SLAB.fadeM, STREAK_SLAB.above, y);
  a *= smooth(groundM + GROUND_FADE[0], groundM + GROUND_FADE[1], c.y);
  return a;
}

const VERT = /* glsl */ `
uniform vec3 uCenter[${N_LAYERS}]; uniform vec3 uShift[${N_LAYERS}]; uniform float uSize[${N_LAYERS}];
uniform vec3 uDir; uniform vec3 uFocus; uniform float uFocusR; uniform float uGround;
uniform float uPxScale; uniform float uWidthPx; uniform float uTime; uniform float uOpacity;
uniform float fogNear; uniform float fogFar;
attribute vec2 corner;  // x: 0 tail .. 1 head; y: -1 .. 1 across
attribute vec4 aSeed;   // xyz: place in the box, 0..1; w: phase
attribute vec4 aLook;   // length (share of the box), brightness, life cycles per LIFE_WRAP_S, layer
varying float vAlong; varying float vAcross; varying float vA;

void main() {
  int k = int(aLook.w + 0.5);
  float size = uSize[k];
  vec3 q = fract(aSeed.xyz + uShift[k]) - 0.5;
  vec3 c = uCenter[k] + q * size;
  // fades: the box's faces, near the camera, into the haze, the balloon's height band, the ground
  float a = 1.0 - smoothstep(${EDGE_FADE.from.toFixed(2)}, ${EDGE_FADE.to.toFixed(2)}, max(max(abs(q.x), abs(q.y)), abs(q.z)));
  float dc = length(c - cameraPosition);
  a *= smoothstep(${NEAR_FADE[0].toFixed(1)}, ${NEAR_FADE[1].toFixed(1)}, dc);
  #ifdef USE_FOG
    a *= 1.0 - smoothstep(fogNear, fogFar, dc);
  #endif
  float y = c.y - uFocus.y;
  a *= smoothstep(-${STREAK_SLAB.below.toFixed(1)}, -${(STREAK_SLAB.below - STREAK_SLAB.fadeM).toFixed(1)}, y);
  a *= 1.0 - smoothstep(${(STREAK_SLAB.above - STREAK_SLAB.fadeM).toFixed(1)}, ${STREAK_SLAB.above.toFixed(1)}, y);
  a *= smoothstep(uGround + ${GROUND_FADE[0].toFixed(1)}, uGround + ${GROUND_FADE[1].toFixed(1)}, c.y);
  // each one brightens and fades as it travels
  float life = fract(aSeed.w + uTime * aLook.z / ${LIFE_WRAP_S.toFixed(1)});
  a *= smoothstep(0.0, 0.3, life) * (1.0 - smoothstep(0.6, 1.0, life));
  a *= aLook.y * uOpacity;
  vAlong = corner.x;
  vAcross = corner.y;
  vA = a;
  vec3 hl = uDir * (0.5 * aLook.x * size);
  // never over the balloon: one in front of it, whose span comes near the line to it, fades out
  vec3 tb = uFocus - cameraPosition;
  float db = length(tb);
  if (dc < db + 0.5 * aLook.x * size) {
    float sep = acos(clamp(dot((c - cameraPosition) / max(dc, 1e-3), tb / max(db, 1e-3)), -1.0, 1.0));
    float reach = uFocusR / max(db, 1e-3) + 0.5 * aLook.x * size / max(dc, 1e-3);
    a *= smoothstep(reach, reach * 1.5 + 0.02, sep);
  }
  vec4 t = projectionMatrix * viewMatrix * vec4(c - hl, 1.0);
  vec4 hd = projectionMatrix * viewMatrix * vec4(c + hl, 1.0);
  if (a < 0.002 || t.w < 1.0 || hd.w < 1.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0); // nothing to draw: off screen
    return;
  }
  // a quad a pixel or two wide along the projected streak
  vec2 px = vec2(uPxScale * projectionMatrix[1][1] / projectionMatrix[0][0], uPxScale); // NDC to pixels
  vec2 st = t.xy / t.w * px, sh = hd.xy / hd.w * px;
  vec2 d = sh - st;
  float len = length(d);
  d = len > 1e-4 ? d / len : vec2(1.0, 0.0);
  vec2 n = vec2(-d.y, d.x);
  vec4 p = corner.x < 0.5 ? t : hd;
  p.xy += n * (corner.y * 0.5 * uWidthPx) / px * p.w;
  gl_Position = p;
}`;

const FRAG = /* glsl */ `
uniform vec3 uColor;
varying float vAlong; varying float vAcross; varying float vA;
void main() {
  float ends = smoothstep(0.0, 0.45, vAlong) * (1.0 - smoothstep(0.7, 1.0, vAlong));
  float across = 1.0 - vAcross * vAcross;
  float a = vA * ends * across;
  if (a < 0.003) discard;
  gl_FragColor = vec4(uColor, a);
  #include <colorspace_fragment>
}`;

export type StreakFrame = {
  /** The balloon as drawn, scene metres, and its drawn radius (m). */
  focus: THREE.Vector3;
  focusRadius: number;
  /** The camera this frame (its position, look and field of view place the boxes). */
  camera: THREE.PerspectiveCamera;
  /** The drawn ground under the balloon, m. */
  groundM: number;
  /** The wind at the balloon, m/s (u east, v north). */
  wind: { u: number; v: number };
  /** streakTarget() now. */
  target: number;
};

export type StreakOptions = {
  haze: HazeUniforms;
  seed?: number;
  /** False: never shown (reduced motion); the mesh stays hidden. */
  enabled?: boolean;
  /** Device pixels per CSS pixel (the streaks are about 1.5 CSS px wide). */
  pixelRatio?: number;
};

export class WindStreaks {
  readonly mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  private readonly haze: HazeUniforms;
  private readonly enabled: boolean;
  private readonly u: {
    uCenter: { value: THREE.Vector3[] };
    uShift: { value: THREE.Vector3[] };
    uSize: { value: number[] };
    uDir: { value: THREE.Vector3 };
    uFocus: { value: THREE.Vector3 };
    uFocusR: { value: number };
    uGround: { value: number };
    uWidthPx: { value: number };
    uTime: { value: number };
    uOpacity: { value: number };
    uColor: { value: THREE.Color };
  };
  /** Where the wind has carried the streaks (scene metres; kept within ANCHOR_WRAP_M of the origin). */
  private readonly anchor = { x: 0, y: 0, z: 0 };
  private readonly vel = { x: 0, z: 0 };
  /** The wind this frame, made safe (streakWind). */
  private readonly wind = { u: 0, v: 0 };
  /** Their direction (scene xz, unit), eased toward the wind's. */
  private readonly dir = { x: 1, z: 0 };
  private dirSet = false;
  /** Pause (spec 7.3): they hold still where they are, still shown. */
  paused = false;
  private readonly look = new THREE.Vector3();
  private eased = 0;
  private clock = 0;

  constructor(scene: THREE.Scene, opts: StreakOptions) {
    this.haze = opts.haze;
    this.enabled = opts.enabled ?? true;
    let s = (opts.seed ?? 5) >>> 0 || 1;
    const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
    const geo = new THREE.InstancedBufferGeometry();
    // a quad: tail and head, either side of the line
    geo.setAttribute('corner', new THREE.Float32BufferAttribute([0, -1, 1, -1, 1, 1, 0, 1], 2));
    geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(12), 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    const n = STREAK_COUNT;
    const seed = new Float32Array(n * 4), look = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      seed.set([rnd(), rnd(), rnd(), rnd()], i * 4);
      const r = rnd();
      look[i * 4] = 0.04 + 0.2 * r * r; // a share of its box: mostly short, a few long
      look[i * 4 + 1] = 0.3 + 0.7 * rnd() ** 1.5;
      look[i * 4 + 2] = Math.round(LIFE_WRAP_S / (5 + 6 * rnd())); // a 5 to 11 s life, dividing the wrap
      look[i * 4 + 3] = i % N_LAYERS;
    }
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4));
    geo.setAttribute('aLook', new THREE.InstancedBufferAttribute(look, 4));
    geo.instanceCount = n;
    this.u = {
      uCenter: { value: STREAK_LAYERS.map(() => new THREE.Vector3()) },
      uShift: { value: STREAK_LAYERS.map(() => new THREE.Vector3()) },
      uSize: { value: [...STREAK_LAYERS] },
      uDir: { value: new THREE.Vector3(1, 0, 0) },
      uFocus: { value: new THREE.Vector3() },
      uFocusR: { value: 0.15 },
      uGround: { value: 0 },
      uWidthPx: { value: 1.5 * (opts.pixelRatio ?? 1) },
      uTime: { value: 0 },
      uOpacity: { value: 0 },
      uColor: { value: new THREE.Color('#f4efe5') },
    };
    const mat = new THREE.ShaderMaterial({
      name: 'wind-streaks',
      uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), ...this.u, uPxScale: opts.haze.uPxScale },
      vertexShader: VERT,
      fragmentShader: FRAG,
      fog: true,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.name = 'wind-streaks';
    this.mesh.frustumCulled = false; // placed in the shader
    this.mesh.renderOrder = 2; // after the world's own transparent things, which they lie over
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  /** The opacity now (0..1, before day and night): 0 is not drawn. */
  get opacity(): number {
    return this.eased;
  }

  /** Gone at once, to fade in again from nothing (the replay cuts away). */
  cut(): void {
    this.eased = 0;
    this.mesh.visible = false;
  }

  /** The floating origin moved: (dx, dz) is the new origin in the old frame. */
  shift(dx: number, dz: number): void {
    this.anchor.x = (this.anchor.x - dx) % ANCHOR_WRAP_M;
    this.anchor.z = (this.anchor.z - dz) % ANCHOR_WRAP_M;
  }

  /** Advance with the wind, ease toward the target, place the boxes along the camera's look. */
  update(dtSec: number, f: StreakFrame): void {
    const dt = Math.max(0, dtSec);
    this.eased = this.enabled ? easeToward(this.eased, Math.min(1, Math.max(0, f.target)), dt, STREAK_EASE_S) : 0;
    if (this.eased < 1e-3 && f.target === 0) this.eased = 0;
    const u = this.u;
    const w = streakWind(f.wind.u, f.wind.v, this.wind);
    const ws = Math.hypot(w.u, w.v);
    if (!this.dirSet && ws > 1e-3) {
      // the first wind: face it at once
      this.dir.x = w.u / ws;
      this.dir.z = -w.v / ws;
      this.dirSet = true;
    }
    if (!this.paused) {
      turnToward(this.dir, w.u, w.v, dt);
      streakVelocity(w.u, w.v, this.dir, this.vel);
      const sp = Math.hypot(this.vel.x, this.vel.z);
      if (sp > 1e-3) u.uDir.value.set(this.vel.x / sp, 0, this.vel.z / sp);
      // the anchor stays within the largest box of the origin: the lattice repeats there
      this.anchor.x = (this.anchor.x + this.vel.x * dt) % ANCHOR_WRAP_M;
      this.anchor.z = (this.anchor.z + this.vel.z * dt) % ANCHOR_WRAP_M;
      this.clock = (this.clock + dt) % LIFE_WRAP_S;
    }
    this.mesh.visible = this.eased > 0;
    if (!this.mesh.visible) return;
    const cam = f.camera;
    cam.getWorldDirection(this.look);
    for (let k = 0; k < N_LAYERS; k++) {
      const size = STREAK_LAYERS[k];
      const c = u.uCenter.value[k].copy(cam.position).addScaledVector(this.look, layerDistance(size, cam.fov, cam.aspect));
      boxShift(this.anchor, c, size, u.uShift.value[k]);
    }
    u.uFocus.value.copy(f.focus);
    u.uFocusR.value = Number.isFinite(f.focusRadius) ? f.focusRadius : 0.15;
    u.uGround.value = Number.isFinite(f.groundM) ? f.groundM : 0;
    u.uTime.value = this.clock;
    const night = this.haze.uNight.value;
    u.uOpacity.value = this.eased * (STREAK_DAY + (STREAK_NIGHT - STREAK_DAY) * night);
  }

  /**
   * For checks: how many streaks are seen now: their middle within the view and in front of the
   * camera, and visible there by where they are (placeFade, the shader's own fades, at least
   * 0.3), worked out as the shader places them. 0 when not drawn. `fog`: the scene's haze.
   */
  onScreen(camera: THREE.Camera, fog?: { near: number; far: number }): number {
    if (!this.mesh.visible) return 0;
    const seed = this.mesh.geometry.getAttribute('aSeed') as THREE.InstancedBufferAttribute;
    const look = this.mesh.geometry.getAttribute('aLook') as THREE.InstancedBufferAttribute;
    const p = new THREE.Vector3(), q = { x: 0, y: 0, z: 0 }, sd = { x: 0, y: 0, z: 0 };
    let n = 0;
    for (let i = 0; i < seed.count; i++) {
      const k = Math.round(look.getW(i)), size = STREAK_LAYERS[k];
      const c = this.u.uCenter.value[k];
      sd.x = seed.getX(i);
      sd.y = seed.getY(i);
      sd.z = seed.getZ(i);
      streakPos(sd, this.u.uShift.value[k], c, size, p);
      q.x = (p.x - c.x) / size;
      q.y = (p.y - c.y) / size;
      q.z = (p.z - c.z) / size;
      if (placeFade(q, p, camera.position, this.u.uFocus.value.y, this.u.uGround.value, fog) < 0.3) continue;
      p.project(camera);
      if (p.z > -1 && p.z < 1 && Math.abs(p.x) <= 1 && Math.abs(p.y) <= 1) n++;
    }
    return n;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
