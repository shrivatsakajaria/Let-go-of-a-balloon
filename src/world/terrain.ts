/**
 * Terrain maths and the faceted ground mesh. No three.js imports: this runs in a Web Worker.
 */
import { TERRACE_STEP_M } from '../config';
import { CONTOUR, lerpHex, parseHex, type Color } from './palette';
import { frameFromBounds, type Bounds, type TileFrame } from './frame';

/** Flat triangle buffers; `glow` (ground and roads) is the night glow per vertex, 0..255 (glow.ts). */
export type MeshBuffers = { position: Float32Array; normal: Float32Array; color: Float32Array; glow?: Uint8Array };

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

/**
 * Bilinear sample of a size x size height grid (row 0 = north) at fractional pixel coords, where
 * pixel centres are at integers. Within half a pixel outside the grid it extrapolates linearly from
 * the edge pixels, so a tile's edge meets its neighbour's (exactly so on planar ground).
 */
export function heightAt(heights: Float32Array, size: number, u: number, v: number): number {
  if (size < 2) return heights[0];
  const x0 = Math.min(size - 2, Math.max(0, Math.floor(u)));
  const y0 = Math.min(size - 2, Math.max(0, Math.floor(v)));
  const fx = Math.max(-0.5, Math.min(1.5, u - x0)), fy = Math.max(-0.5, Math.min(1.5, v - y0));
  const a = heights[y0 * size + x0], b = heights[y0 * size + x0 + 1];
  const c = heights[(y0 + 1) * size + x0], d = heights[(y0 + 1) * size + x0 + 1];
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
}

/**
 * The ground's vertex grid: (n+1) x (n+1) vertices, i east, j north, evenly spaced in Web Mercator
 * like the height and vector pixels. Vertex (i, j) sits at tile fraction (i/n, 1 - j/n), i.e. on
 * pixel edges: u = i/n * size - 0.5 (pixel centres are at integers).
 */
export type GroundGrid = {
  frame: TileFrame;
  n: number;
  /** Local x of vertex column i, local z of vertex row j. */
  X: Float64Array;
  Z: Float64Array;
  /** Untouched heights (decide cliffs) and terraced heights (the drawn surface), index j*(n+1)+i. */
  raw: Float32Array;
  terr: Float32Array;
};

export function groundGrid(heights: Float32Array, size: number, frame: TileFrame, n: number): GroundGrid {
  const V = n + 1;
  const X = new Float64Array(V);
  const Z = new Float64Array(V);
  for (let k = 0; k < V; k++) {
    X[k] = frame.fracToLocal(k / n, 0).x;
    Z[k] = frame.fracToLocal(0, 1 - k / n).z;
  }
  const raw = new Float32Array(V * V);
  for (let j = 0; j < V; j++) {
    const v = (1 - j / n) * size - 0.5; // row 0 of the image is north
    for (let i = 0; i < V; i++) raw[j * V + i] = heightAt(heights, size, (i / n) * size - 0.5, v);
  }
  const at = (i: number, j: number) => raw[Math.min(n, Math.max(0, j)) * V + Math.min(n, Math.max(0, i))];
  const terr = new Float32Array(V * V);
  for (let j = 0; j < V; j++) {
    const jm = Math.max(0, j - 1), jp = Math.min(n, j + 1);
    for (let i = 0; i < V; i++) {
      const im = Math.max(0, i - 1), ip = Math.min(n, i + 1);
      const gx = (at(ip, j) - at(im, j)) / (X[ip] - X[im]);
      const gy = (at(i, jp) - at(i, jm)) / (Z[jm] - Z[jp]);
      terr[j * V + i] = terraceHeight(raw[j * V + i], Math.hypot(gx, gy));
    }
  }
  return { frame, n, X, Z, raw, terr };
}

/**
 * Height of the drawn (terraced, faceted) ground at local (x, z): the same two triangles per cell
 * that buildGround emits, so anything placed with this sits exactly on the ground.
 */
/** Ground cell (index j*n+i, row 0 = south) containing local (x, z), clamped to the tile. */
export function cellAt(g: GroundGrid, x: number, z: number): number {
  const { n, X, Z } = g;
  const i = Math.max(0, Math.min(n - 1, Math.floor((x / X[n]) * n)));
  let j = Math.max(0, Math.min(n - 1, Math.floor((z / Z[n]) * n)));
  while (j > 0 && z > Z[j]) j--;
  while (j < n - 1 && z < Z[j + 1]) j++;
  return j * n + i;
}

export function groundHeightAt(g: GroundGrid, x: number, z: number): number {
  const { n, terr, X, Z } = g;
  const V = n + 1;
  // columns are even in x; rows are even in Mercator, so find the row from Z (nearly even in z)
  const fi = Math.max(0, Math.min(n, (x / X[n]) * n));
  let j = Math.max(0, Math.min(n - 1, Math.floor((z / Z[n]) * n)));
  while (j > 0 && z > Z[j]) j--;
  while (j < n - 1 && z < Z[j + 1]) j++;
  const i = Math.min(n - 1, Math.floor(fi));
  const s = fi - i;
  const t = Math.max(0, Math.min(1, (Z[j] - z) / (Z[j] - Z[j + 1])));
  const a = terr[j * V + i], b = terr[j * V + i + 1], c = terr[(j + 1) * V + i], d = terr[(j + 1) * V + i + 1];
  // triangles (a, b, c) and (b, d, c), split along the b-c diagonal; planar in local metres
  return s + t <= 1 ? a + s * (b - a) + t * (c - a) : d + (1 - s) * (c - d) + (1 - t) * (b - d);
}

/**
 * Lower the drawn ground under flat water (sea, lakes) so the water surface shows: a vertex whose
 * every neighbouring cell has a water level (finite in `cellLevel`, n x n, row 0 = south) drops to
 * `depth` metres below the lowest of them. Shore vertices keep their height. Mutates `g.terr`.
 */
export function carveGround(g: GroundGrid, cellLevel: Float32Array, depth = 1): void {
  const { n, terr } = g;
  const V = n + 1;
  for (let j = 0; j < V; j++) {
    for (let i = 0; i < V; i++) {
      let lo = Infinity, all = true;
      for (let dj = -1; dj <= 0 && all; dj++)
        for (let di = -1; di <= 0; di++) {
          const ci = i + di, cj = j + dj;
          if (ci < 0 || cj < 0 || ci >= n || cj >= n) continue;
          const l = cellLevel[cj * n + ci];
          if (!Number.isFinite(l)) { all = false; break; }
          lo = Math.min(lo, l);
        }
      if (all && lo < Infinity) terr[j * V + i] = Math.min(terr[j * V + i], lo - depth);
    }
  }
}

const isFrame = (b: Bounds | TileFrame): b is TileFrame => 'toLocal' in b;

/**
 * Build the flat-shaded ground for one tile.
 *
 * The mesh resolution is the land-cover grid: `landcover.size` cells per side, heights sampled
 * bilinearly at the cell corners (heights themselves are `size` x `size`, row 0 = north, as in a
 * map tile). Positions are local metres in the tile frame (see frame.ts): x east, y up,
 * z = -north from the south-west corner. Two triangles per cell, non-indexed; each face has one
 * colour and one (unit) normal.
 */
export function buildGround(
  heights: Float32Array,
  size: number,
  bounds: Bounds | TileFrame,
  landcover: LandcoverGrid,
): MeshBuffers {
  const frame = isFrame(bounds) ? bounds : frameFromBounds(bounds);
  return buildGroundMesh(groundGrid(heights, size, frame, landcover.size), landcover);
}

/** buildGround from a precomputed grid (whose n must equal landcover.size). */
export function buildGroundMesh(g: GroundGrid, landcover: LandcoverGrid): MeshBuffers {
  const n = landcover.size;
  if (g.n !== n) throw new Error('ground grid and land cover sizes differ');
  const V = n + 1;
  const { X, Z, raw, terr } = g;

  const tris = n * n * 2;
  const position = new Float32Array(tris * 9);
  const normal = new Float32Array(tris * 9);
  const color = new Float32Array(tris * 9);
  let o = 0;
  const p = [0, 0, 0, 0, 0, 0, 0, 0, 0];

  const emit = (cell: number, k: number, i: number, j: number, ia: number[], ja: number[]) => {
    for (let t = 0; t < 3; t++) {
      const vi = i + ia[t], vj = j + ja[t];
      p[t * 3] = X[vi];
      p[t * 3 + 1] = terr[vj * V + vi];
      p[t * 3 + 2] = Z[vj];
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

/**
 * Skirts: short vertical curtains hanging `depth` metres below the four edges of the drawn ground,
 * facing out, each in the colour of the ground cell above it. They close any hairline gap at a tile
 * edge and the step down to a coarser level of detail (which is drawn a little lower), so no seam
 * or hole ever shows the sky. `ground` is buildGroundMesh's output for `g`; returns the ground with
 * the skirts appended.
 */
export function withSkirts(g: GroundGrid, ground: MeshBuffers, depth: number): MeshBuffers {
  const { n, X, Z, terr } = g;
  const V = n + 1;
  const base = ground.position.length;
  const extra = n * 4 * 2 * 9;
  const position = new Float32Array(base + extra);
  const normal = new Float32Array(base + extra);
  const color = new Float32Array(base + extra);
  position.set(ground.position);
  normal.set(ground.normal);
  color.set(ground.color);
  let o = base;
  const quad = (cell: number, i0: number, j0: number, i1: number, j1: number, ox: number, oz: number) => {
    const ax = X[i0], az = Z[j0], ay = terr[j0 * V + i0];
    const bx = X[i1], bz = Z[j1], by = terr[j1 * V + i1];
    // a (top), b (top), b (bottom), a (bottom); wound so the face looks along (ox, oz)
    const flip = (bz - az) * ox - (bx - ax) * oz < 0;
    const P = flip
      ? [ax, ay, az, bx, by - depth, bz, bx, by, bz, ax, ay, az, ax, ay - depth, az, bx, by - depth, bz]
      : [ax, ay, az, bx, by, bz, bx, by - depth, bz, ax, ay, az, bx, by - depth, bz, ax, ay - depth, az];
    const c = (cell * 2) * 9; // first triangle of the edge cell
    for (let k = 0; k < 6; k++) {
      position[o] = P[k * 3]; position[o + 1] = P[k * 3 + 1]; position[o + 2] = P[k * 3 + 2];
      normal[o] = ox; normal[o + 1] = 0; normal[o + 2] = oz;
      color[o] = ground.color[c]; color[o + 1] = ground.color[c + 1]; color[o + 2] = ground.color[c + 2];
      o += 3;
    }
  };
  for (let i = 0; i < n; i++) {
    quad(i, i, 0, i + 1, 0, 0, 1); // south edge (z = 0), facing +z
    quad((n - 1) * n + i, i, n, i + 1, n, 0, -1); // north edge, facing -z
  }
  for (let j = 0; j < n; j++) {
    quad(j * n, 0, j, 0, j + 1, -1, 0); // west edge, facing -x
    quad(j * n + n - 1, n, j, n, j + 1, 1, 0); // east edge, facing +x
  }
  return { position, normal, color };
}
