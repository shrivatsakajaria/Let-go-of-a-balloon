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

export const HAZE_GLSL = `uniform vec3 uTop; uniform vec3 uHor; uniform vec3 uLow; uniform vec3 uSunCol; uniform vec3 uSunDir;
vec3 hazeCol(vec3 d) {
  float up = smoothstep(0.0, 0.24, d.y);
  vec3 c = d.y >= 0.0 ? mix(uHor, uTop, up) : mix(uHor, uLow, smoothstep(0.0, -0.32, d.y));
  float s = max(dot(d, uSunDir), 0.0);
  return mix(c, uSunCol, (pow(s, 5.0) * 0.32 + pow(s, 48.0) * 0.3) * (1.0 - up * 0.7));
}`;

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
  /** Added to world positions for the window pattern, so it stays put when the origin moves. */
  uWinShift: U<THREE.Vector3>;
};

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
