/**
 * Terrain maths and the faceted ground mesh. No three.js imports: this runs in a Web Worker.
 */
import { TERRACE_STEP_M } from '../config';
import { CONTOUR, lerpHex, parseHex, type Color } from './palette';

export type MeshBuffers = { position: Float32Array; normal: Float32Array; color: Float32Array };

/** One land-cover class per ground cell (row-major, row 0 = south). */
export type LandcoverGrid = { size: number; classes: Uint8Array };

export const LC = { unknown: 0, wood: 1, grass: 2, farmland: 3, sand: 4, rock: 5, builtUp: 6, water: 7 } as const;

/** Decode Terrarium RGBA pixels to metres: R*256 + G + B/256 - 32768. */
export function decodeTerrarium(rgba: Uint8ClampedArray, size: number): Float32Array {
  const out = new Float32Array(size * size);
  for (let i = 0; i < out.length; i++) {
    out[i] = rgba[i * 4] * 256 + rgba[i * 4 + 1] + rgba[i * 4 + 2] / 256 - 32768;
  }
  return out;
}

const BLEND_FROM = 0.12;
const BLEND_TO = 0.3;

/** How strongly terracing applies at a slope (rise over run): 0 up to 0.12, 1 from 0.3, linear between. */
export function terraceBlend(slope: number): number {
  return Math.max(0, Math.min(1, (slope - BLEND_FROM) / (BLEND_TO - BLEND_FROM)));
}

/** Snap h to TERRACE_STEP_M steps, blended in only where the ground is steep. Flat ground is untouched. */
export function terraceHeight(h: number, slope: number): number {
  const f = terraceBlend(slope);
  if (f === 0) return h;
  const snapped = Math.round(h / TERRACE_STEP_M) * TERRACE_STEP_M;
  return h + (snapped - h) * f;
}

const M_PER_DEG = 111320;
const CLIFF_SLOPE = 0.6;
const JITTER = 0.03;

function landColour(cls: number): Color {
  switch (cls) {
    case LC.wood: return CONTOUR.land[4];
    case LC.farmland: return CONTOUR.land[1];
    case LC.sand: return CONTOUR.land[0];
    case LC.rock: return lerpHex(CONTOUR.land[0], CONTOUR.cliff, 0.5);
    case LC.builtUp: return lerpHex(CONTOUR.land[0], CONTOUR.building[1], 0.5);
    case LC.water: return CONTOUR.waterShallow;
    case LC.grass:
    default: return CONTOUR.land[2];
  }
}

const PALETTE_RGB = new Map<Color, [number, number, number]>();
function rgb01(c: Color): [number, number, number] {
  let v = PALETTE_RGB.get(c);
  if (!v) {
    const [r, g, b] = parseHex(c);
    v = [r / 255, g / 255, b / 255];
    PALETTE_RGB.set(c, v);
  }
  return v;
}

/** Deterministic hash of integers to [-1, 1). */
function jitter(i: number, j: number, k: number): number {
  let h = (Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(k, 2246822519)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return ((h >>> 0) / 4294967296) * 2 - 1;
}

/** Bilinear sample of a size x size height grid at fractional pixel coords. */
function sample(heights: Float32Array, size: number, u: number, v: number): number {
  const x0 = Math.min(size - 2, Math.max(0, Math.floor(u)));
  const y0 = Math.min(size - 2, Math.max(0, Math.floor(v)));
  if (size < 2) return heights[0];
  const fx = u - x0, fy = v - y0;
  const a = heights[y0 * size + x0], b = heights[y0 * size + x0 + 1];
  const c = heights[(y0 + 1) * size + x0], d = heights[(y0 + 1) * size + x0 + 1];
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
}

/**
 * Build the flat-shaded ground for one tile.
 *
 * The mesh resolution is the land-cover grid: `landcover.size` cells per side, heights sampled
 * bilinearly at the cell corners (heights themselves are `size` x `size`, row 0 = north, as in a
 * map tile). Positions are local metres relative to the tile's south-west corner in three.js
 * convention: x east, y up, z = -north. Metres per degree use the tile's centre latitude.
 * Two triangles per cell, non-indexed; each face has one colour and one (unit) normal.
 */
export function buildGround(
  heights: Float32Array,
  size: number,
  bounds: { west: number; south: number; east: number; north: number },
  landcover: LandcoverGrid,
): MeshBuffers {
  const n = landcover.size;
  const midLat = (bounds.south + bounds.north) / 2;
  const widthM = (bounds.east - bounds.west) * M_PER_DEG * Math.cos((midLat * Math.PI) / 180);
  const heightM = (bounds.north - bounds.south) * M_PER_DEG;
  const dx = widthM / n;
  const dy = heightM / n;

  const V = n + 1;
  const raw = new Float32Array(V * V); // metres, vertex (i east, j north)
  for (let j = 0; j < V; j++) {
    for (let i = 0; i < V; i++) {
      const u = (i / n) * (size - 1);
      const v = (1 - j / n) * (size - 1); // row 0 of the image is north
      raw[j * V + i] = sample(heights, size, u, v);
    }
  }
  const at = (i: number, j: number) => raw[Math.min(n, Math.max(0, j)) * V + Math.min(n, Math.max(0, i))];
  const terr = new Float32Array(V * V);
  for (let j = 0; j < V; j++) {
    for (let i = 0; i < V; i++) {
      const gx = (at(i + 1, j) - at(i - 1, j)) / ((Math.min(n, i + 1) - Math.max(0, i - 1)) * dx);
      const gy = (at(i, j + 1) - at(i, j - 1)) / ((Math.min(n, j + 1) - Math.max(0, j - 1)) * dy);
      terr[j * V + i] = terraceHeight(raw[j * V + i], Math.hypot(gx, gy));
    }
  }

  const tris = n * n * 2;
  const position = new Float32Array(tris * 9);
  const normal = new Float32Array(tris * 9);
  const color = new Float32Array(tris * 9);
  let o = 0;
  const p = [0, 0, 0, 0, 0, 0, 0, 0, 0];

  const emit = (cell: number, k: number, i: number, j: number, ia: number[], ja: number[]) => {
    for (let t = 0; t < 3; t++) {
      const vi = i + ia[t], vj = j + ja[t];
      p[t * 3] = vi * dx;
      p[t * 3 + 1] = terr[vj * V + vi];
      p[t * 3 + 2] = -vj * dy;
    }
    // face normal from the terraced geometry
    const e1x = p[3] - p[0], e1y = p[4] - p[1], e1z = p[5] - p[2];
    const e2x = p[6] - p[0], e2y = p[7] - p[1], e2z = p[8] - p[2];
    let nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    // slope of the untouched ground decides cliffs, so terraces do not turn into cliffs
    const r0 = raw[(j + ja[0]) * V + i + ia[0]], r1 = raw[(j + ja[1]) * V + i + ia[1]], r2 = raw[(j + ja[2]) * V + i + ia[2]];
    const ax = p[3] - p[0], az = p[5] - p[2], bx = p[6] - p[0], bz = p[8] - p[2];
    const det = ax * bz - az * bx || 1;
    const gx = ((r1 - r0) * bz - (r2 - r0) * az) / det;
    const gz = ((r2 - r0) * ax - (r1 - r0) * bx) / det;
    const slope = Math.hypot(gx, gz);

    const base = slope > CLIFF_SLOPE ? CONTOUR.cliff : landColour(landcover.classes[cell]);
    const [r, g, b] = rgb01(base);
    const s = 1 + JITTER * jitter(i, j, k);
    for (let t = 0; t < 3; t++) {
      const q = o + t * 3;
      position[q] = p[t * 3]; position[q + 1] = p[t * 3 + 1]; position[q + 2] = p[t * 3 + 2];
      normal[q] = nx; normal[q + 1] = ny; normal[q + 2] = nz;
      color[q] = Math.min(1, r * s); color[q + 1] = Math.min(1, g * s); color[q + 2] = Math.min(1, b * s);
    }
    o += 9;
  };

  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const cell = j * n + i;
      emit(cell, 0, i, j, [0, 1, 0], [0, 0, 1]); // a, b, c
      emit(cell, 1, i, j, [1, 1, 0], [0, 1, 1]); // b, d, c
    }
  }
  return { position, normal, color };
}
