/**
 * City glow and ships, worked out per tile in the mesh job. Pure (no three.js, no DOM): runs in the
 * worker and in Node tests. Local tile metres (frame.ts): x east from the west edge, z = -north
 * from the south edge; grids are n x n, row 0 = south.
 *
 * - glowGrid: how lit the ground is at night, 0..1. Densest where buildings cover the most ground
 *   and roads run thickest; built-up land use alone gives a faint glow, so far tiles (which have no
 *   buildings in OpenMapTiles) still show their towns. Blurred, so it reads as a soft light.
 * - vertexGlow: that grid sampled at each vertex, one byte each (the `aGlow` attribute).
 * - placeBoats: the odd ship on open water (spec 6.7), about one per 8 km2 of sea.
 */
import type { TileFrame } from './frame';
import { bbox, hash01, pointInPolygon, polygonArea } from './geom';
import type { Features } from './vector';
import { LC } from './terrain';

/** Road weights for the glow, by class (paths, tracks and rail add nothing). */
const ROAD_GLOW: Record<string, number> = {
  motorway: 1, trunk: 1, primary: 0.9, secondary: 0.9, tertiary: 0.7, minor: 0.7, service: 0.3,
};

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** 3 x 3 box blur, edges clamped. */
function blur(g: Float32Array, n: number): Float32Array {
  const tmp = new Float32Array(n * n), out = new Float32Array(n * n);
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const a = g[j * n + Math.max(0, i - 1)], b = g[j * n + i], c = g[j * n + Math.min(n - 1, i + 1)];
      tmp[j * n + i] = (a + b + c) / 3;
    }
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const a = tmp[Math.max(0, j - 1) * n + i], b = tmp[j * n + i], c = tmp[Math.min(n - 1, j + 1) * n + i];
      out[j * n + i] = (a + b + c) / 3;
    }
  return out;
}

/**
 * Night glow per ground cell, 0..1. `landClasses` is the tile's land-cover grid (LC classes, the
 * same n): built-up cells start at 0.2.
 */
export function glowGrid(f: Features, frame: TileFrame, n: number, landClasses: Uint8Array): Float32Array {
  const W = frame.widthM, H = frame.heightM;
  const cw = W / n, ch = H / n, cellArea = cw * ch;
  const cellOf = (x: number, z: number) => {
    const i = Math.floor((x / W) * n), j = Math.floor((-z / H) * n);
    return i < 0 || j < 0 || i >= n || j >= n ? -1 : j * n + i;
  };
  const built = new Float32Array(n * n);
  for (const b of f.building) {
    const bb = bbox(b.polygon[0]);
    const c = cellOf((bb.x0 + bb.x1) / 2, (bb.z0 + bb.z1) / 2);
    if (c >= 0) built[c] += polygonArea(b.polygon);
  }
  const road = new Float32Array(n * n);
  const step = Math.min(cw, ch) / 2;
  for (const l of f.transportation) {
    const w = ROAD_GLOW[l.cls];
    if (!w) continue;
    const p = l.line;
    for (let i = 2; i < p.length; i += 2) {
      const ax = p[i - 2], az = p[i - 1], bx = p[i], bz = p[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      const k = Math.max(1, Math.ceil(len / step));
      for (let s = 0; s < k; s++) {
        const t = (s + 0.5) / k;
        const c = cellOf(ax + (bx - ax) * t, az + (bz - az) * t);
        if (c >= 0) road[c] += (w * len) / k;
      }
    }
  }
  const raw = new Float32Array(n * n);
  for (let c = 0; c < n * n; c++) {
    const cover = Math.min(1, built[c] / cellArea);
    const roads = Math.min(1, road[c] / (3 * cw));
    raw[c] = 2 * cover + 0.35 * roads + (landClasses[c] === LC.builtUp ? 0.2 : 0);
  }
  const g = blur(blur(raw, n), n);
  for (let c = 0; c < n * n; c++) g[c] = clamp01(g[c]);
  return g;
}

/** The glow grid at each vertex (bilinear between cell centres), 0..255. */
export function vertexGlow(position: Float32Array, grid: Float32Array, n: number, widthM: number, heightM: number): Uint8Array {
  const count = position.length / 3;
  const out = new Uint8Array(count);
  const at = (i: number, j: number) => grid[Math.min(n - 1, Math.max(0, j)) * n + Math.min(n - 1, Math.max(0, i))];
  for (let v = 0; v < count; v++) {
    const u = Math.min(n - 1, Math.max(0, (position[v * 3] / widthM) * n - 0.5));
    const w = Math.min(n - 1, Math.max(0, (-position[v * 3 + 2] / heightM) * n - 0.5));
    const i = Math.floor(u), j = Math.floor(w), fu = u - i, fw = w - j;
    const g = (at(i, j) * (1 - fu) + at(i + 1, j) * fu) * (1 - fw) + (at(i, j + 1) * (1 - fu) + at(i + 1, j + 1) * fu) * fw;
    out[v] = Math.round(clamp01(g) * 255);
  }
  return out;
}

/** Floats per boat: x, y (the water level), z, heading (radians from +x toward -z), length (m). */
export const BOAT_STRIDE = 5;
/** Ships per square kilometre of open water. */
const BOATS_PER_KM2 = 0.12;
const BOAT_TRIES = 3;
/** Lakes this large (m2) get boats too. */
const BIG_LAKE_M2 = 2e6;

/** A few ships on the sea and on big lakes; `levels` are the water features' levels (water.ts). */
export function placeBoats(f: Features, levels: number[], frame: TileFrame, z: number, seed: number): Float32Array {
  const open: number[] = [];
  for (let k = 0; k < f.water.length; k++) {
    const w = f.water[k];
    if (!Number.isFinite(levels[k])) continue;
    if (w.cls === 'ocean' || (w.cls === 'lake' && polygonArea(w.polygon) > BIG_LAKE_M2)) open.push(k);
  }
  if (open.length === 0) return new Float32Array(0);
  const W = frame.widthM, H = frame.heightM;
  const expected = BOATS_PER_KM2 * (W * H) / 1e6;
  const out: number[] = [];
  for (let t = 0; t < BOAT_TRIES; t++) {
    if (hash01(seed, t, 11 + z) >= expected / BOAT_TRIES) continue;
    const x = W * (0.05 + 0.9 * hash01(seed, t, 12));
    const zz = -H * (0.05 + 0.9 * hash01(seed, t, 13));
    const k = open.find((i) => pointInPolygon(f.water[i].polygon, x, zz));
    if (k === undefined) continue;
    out.push(x, levels[k], zz, hash01(seed, t, 14) * Math.PI * 2, 30 + 60 * hash01(seed, t, 15));
  }
  return Float32Array.from(out);
}
