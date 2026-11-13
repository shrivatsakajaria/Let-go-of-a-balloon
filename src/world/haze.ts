/**
 * One colour for the sky and the haze, by view direction, in display (sRGB) values so the sky dome
 * and every hazed surface agree to the pixel. Up: skyHorizon to skyTop. Down: the haze deepens from
 * the bright horizon to a muted land haze, so far land fades through a gradient, not a wall. Warmer
 * toward the sun.
 *
 * The uniforms are shared objects: every material and the sky dome hold the same ones, so changing
 * a `.value` (light, sun, haze bounds) changes them all on the next frame. Nothing is baked into a
 * shader as a constant.
 */
import * as THREE from 'three';
import { lerpHex, parseHex, type Light } from './palette';

/**
 * Takes violet out of a colour: the part that is both red and blue above the green moves half to
 * green, so the brightness holds and what is left leans warm or blue. `amount` 0..1 (0: unchanged).
 * The world materials use it in deep night only (materials.ts): the evening twilight keeps its
 * violet-grey on purpose.
 */
export const NO_PURPLE_GLSL = `vec3 noPurple(vec3 c, float amount) {
  float m = min(c.r, c.b) - c.g;
  if (m > 0.0) c += vec3(-0.5, 0.5, -0.5) * (m * amount);
  return c;
}`;

export const HAZE_GLSL = `uniform vec3 uTop; uniform vec3 uHor; uniform vec3 uLow; uniform vec3 uSunCol; uniform vec3 uSunDir;
${NO_PURPLE_GLSL}
vec3 hazeCol(vec3 d) {
  float up = smoothstep(0.0, 0.24, d.y);
  vec3 c = d.y >= 0.0 ? mix(uHor, uTop, up) : mix(uHor, uLow, smoothstep(0.0, -0.32, d.y));
  float s = max(dot(d, uSunDir), 0.0);
  return mix(c, uSunCol, (pow(s, 5.0) * 0.32 + pow(s, 48.0) * 0.3) * (1.0 - up * 0.7));
}`;

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** The haze colour for a unit view direction, exactly as HAZE_GLSL works it out (for checks). */
export function hazeColor(h: HazeUniforms, d: { x: number; y: number; z: number }): [number, number, number] {
  const up = smoothstep(0, 0.24, d.y);
  const T = h.uTop.value, Hr = h.uHor.value, Lo = h.uLow.value, S = h.uSunCol.value, D = h.uSunDir.value;
  const k = d.y >= 0 ? up : smoothstep(0, -0.32, d.y);
  const to = d.y >= 0 ? T : Lo;
  const c = [Hr.x + (to.x - Hr.x) * k, Hr.y + (to.y - Hr.y) * k, Hr.z + (to.z - Hr.z) * k];
  const s = Math.max(d.x * D.x + d.y * D.y + d.z * D.z, 0);
  const w = (Math.pow(s, 5) * 0.32 + Math.pow(s, 48) * 0.3) * (1 - up * 0.7);
  return [c[0] + (S.x - c[0]) * w, c[1] + (S.y - c[1]) * w, c[2] + (S.z - c[2]) * w];
}

type U<T> = { value: T };

export type HazeUniforms = {
  uTop: U<THREE.Vector3>;
  uHor: U<THREE.Vector3>;
  uLow: U<THREE.Vector3>;
  uSunCol: U<THREE.Vector3>;
  /** Unit vector toward the sun, scene axes. */
  uSunDir: U<THREE.Vector3>;
  /**
   * Optional haze around a fixed block of tiles (the tile proof): minX, maxX, minZ, maxZ of the
   * block, and (inner, inner + band, radius - radiusBand, radius) of the edge and round haze. Off by
   * default (an unbounded block).
   */
  uBlock: U<THREE.Vector4>;
  uHazeRing: U<THREE.Vector4>;
  /**
   * Added to world positions for the window pattern, so it stays put when the origin moves. Kept
   * modulo WIN_PERIOD_M on x and z (the pattern repeats there), so it stays small on any flight.
   */
  uWinShift: U<THREE.Vector3>;
  /** 0 by day, 1 at night (palette Light.night): lit windows, street lamps and city glow. */
  uNight: U<number>;
  /**
   * Cloud shadows (clouds.ts): per cloud x, y (middle of the cloud), z and shadow radius in scene
   * metres; a radius of 0 is no cloud. uCloudSun: xyz toward the sun, w the shadow strength (0: none).
   */
  uClouds: U<THREE.Vector4[]>;
  uCloudSun: U<THREE.Vector4>;
  /** Pixels per unit of projected size (half the drawing buffer's height), for point sizes. */
  uPxScale: U<number>;
};

/** The window grid is 3.4 m across; lit windows repeat every 64 windows, so the pattern repeats here. */
export const WIN_GRID_M = 3.4;
export const WIN_REPEAT = 64;
export const WIN_PERIOD_M = WIN_GRID_M * WIN_REPEAT;
/** Cloud shadow slots (clouds.ts keeps 8 to 14 clouds). */
export const CLOUD_MAX = 14;

/**
 * Soft cloud shadows on anything at p: the sun's ray from p meets each cloud's middle height, and
 * falls off from 45% to 100% of the cloud's shadow radius. Ground above a cloud is not shaded.
 * Returns the light left (1 = none).
 */
export const CLOUD_SHADE_GLSL = `uniform vec4 uClouds[${CLOUD_MAX}]; uniform vec4 uCloudSun;
float cloudShade(vec3 p) {
  if (uCloudSun.w <= 0.0) return 1.0;
  float sh = 0.0;
  for (int i = 0; i < ${CLOUD_MAX}; i++) {
    vec4 c = uClouds[i];
    if (c.w <= 0.0 || c.y <= p.y) continue; // no shade on ground above the cloud
    vec2 q = p.xz + uCloudSun.xz * ((c.y - p.y) / uCloudSun.y) - c.xz;
    sh = max(sh, 1.0 - smoothstep(0.45 * c.w, c.w, length(q)));
  }
  return 1.0 - uCloudSun.w * sh;
}`;

const srgb = (hex: string, out = new THREE.Vector3()) => {
  const [r, g, b] = parseHex(hex);
  return out.set(r / 255, g / 255, b / 255);
};

const FAR = 1e9;

export function createHaze(light: Light, sunDir: THREE.Vector3): HazeUniforms {
  const h: HazeUniforms = {
    uTop: { value: new THREE.Vector3() },
    uHor: { value: new THREE.Vector3() },
    uLow: { value: new THREE.Vector3() },
    uSunCol: { value: new THREE.Vector3() },
    uSunDir: { value: sunDir.clone().normalize() },
    uBlock: { value: new THREE.Vector4(-FAR, FAR, -FAR, FAR) },
    uHazeRing: { value: new THREE.Vector4(0, 1, FAR, FAR * 2) },
    uWinShift: { value: new THREE.Vector3() },
    uNight: { value: 0 },
    uClouds: { value: Array.from({ length: CLOUD_MAX }, () => new THREE.Vector4(0, 0, 0, 0)) },
    uCloudSun: { value: new THREE.Vector4(0, 1, 0, 0) },
    uPxScale: { value: 600 },
  };
  setHazeLight(h, light);
  return h;
}

/** Sky and haze colours from a light (palette.lightFor). */
export function setHazeLight(h: HazeUniforms, light: Light): void {
  srgb(light.skyTop, h.uTop.value);
  srgb(light.skyHorizon, h.uHor.value);
  srgb(lerpHex(light.skyHorizon, '#a3988a', 0.3), h.uLow.value);
  srgb(light.sun, h.uSunCol.value);
}

/**
 * Haze around a fixed block: within `band` metres inside the block's edge (after `inner`), and past
 * `radius` from the scene origin (over `radiusBand`), everything dissolves into the haze. Null turns
 * it off.
 */
export function setBlockHaze(
  h: HazeUniforms,
  block: { minX: number; maxX: number; minZ: number; maxZ: number } | null,
  ring = { inner: 40, band: 760, radius: 2700, radiusBand: 700 },
): void {
  if (!block) {
    h.uBlock.value.set(-FAR, FAR, -FAR, FAR);
    h.uHazeRing.value.set(0, 1, FAR, FAR * 2);
    return;
  }
  h.uBlock.value.set(block.minX, block.maxX, block.minZ, block.maxZ);
  h.uHazeRing.value.set(ring.inner, ring.inner + ring.band, ring.radius - ring.radiusBand, ring.radius);
}
