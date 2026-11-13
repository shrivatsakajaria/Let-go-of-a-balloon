/**
 * Where each tile of a small square block goes in one shared scene frame, and the land around the
 * block. No three.js.
 *
 * Every tile builds in its own frame (frame.ts): metres from its south-west corner, longitude
 * scaled at its own centre latitude. The scene uses the frame of the tile holding `centre`, moved
 * so `centre` sits at (0, 0). A tile then lands at `offset + (x * scaleX, y, z)`: latitude is the
 * same scale everywhere, so z needs only the offset; longitude scales by the cosine of a slightly
 * different latitude in rows north and south (about 0.45 m across a z14 tile at Manchester), which
 * `scaleX` takes out so the shared edges meet exactly.
 */
import { lonLatToTile, type LatLon } from '../geo/coords';
import { tileFrame } from '../world/frame';
import { MeshBuilder } from '../world/geom';
import type { MeshBuffers } from '../world/terrain';

export type TilePlacement = {
  z: number;
  x: number;
  y: number;
  /** Scene position of the tile's south-west corner. */
  offsetX: number;
  offsetZ: number;
  /** Multiply the tile's local x by this. 1 in the centre row. */
  scaleX: number;
  /** Rings out from the centre tile (0 for the centre), for build order. */
  ring: number;
};

/** The (2r+1)^2 tiles at zoom z around the tile holding `centre`, centre first, then by ring. */
export function gridPlacements(centre: LatLon, z: number, r = 1): TilePlacement[] {
  const t = lonLatToTile(centre.lat, centre.lon, z);
  const cx = Math.floor(t.x), cy = Math.floor(t.y);
  const ref = tileFrame(z, cx, cy);
  const origin = ref.toLocal(centre.lat, centre.lon);
  const out: TilePlacement[] = [];
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const x = cx + dx, y = cy + dy;
      const f = tileFrame(z, x, y);
      const sw = ref.toLocal(f.bounds.south, f.bounds.west);
      const refEast = ref.toLocal(f.bounds.south, f.bounds.east).x;
      out.push({
        z, x, y,
        offsetX: sw.x - origin.x,
        offsetZ: sw.z - origin.z,
        scaleX: (refEast - sw.x) / f.widthM,
        ring: Math.max(Math.abs(dx), Math.abs(dy)),
      });
    }
  }
  return out.sort((a, b) => a.ring - b.ring);
}

/** Scene position of a geographic point, in the frame gridPlacements uses for `centre`. */
export function sceneXZ(centre: LatLon, z: number, p: LatLon): { x: number; z: number } {
  const t = lonLatToTile(centre.lat, centre.lon, z);
  const ref = tileFrame(z, Math.floor(t.x), Math.floor(t.y));
  const o = ref.toLocal(centre.lat, centre.lon);
  const q = ref.toLocal(p.lat, p.lon);
  return { x: q.x - o.x, z: q.z - o.z };
}

/** Orbit camera pose: angle from `t` seconds, then a fixed distance and pitch around a target. */
export function orbitPose(
  tSec: number,
  o: { periodSec: number; startDeg: number; distance: number; pitchDeg: number },
): { x: number; y: number; z: number; azimuthDeg: number } {
  // compass azimuth of the camera as seen from the target, clockwise from north
  const az = (((o.startDeg + (tSec / o.periodSec) * 360) % 360) + 360) % 360;
  const p = (o.pitchDeg * Math.PI) / 180, a = (az * Math.PI) / 180;
  const h = Math.cos(p) * o.distance;
  return { x: Math.sin(a) * h, y: Math.sin(p) * o.distance, z: -Math.cos(a) * h, azimuthDeg: az };
}

/** Scene rectangle the placed tiles cover. */
export function blockBounds(tiles: TilePlacement[]): { minX: number; maxX: number; minZ: number; maxZ: number } {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const t of tiles) {
    const f = tileFrame(t.z, t.x, t.y);
    minX = Math.min(minX, t.offsetX);
    maxX = Math.max(maxX, t.offsetX + f.widthM * t.scaleX);
    minZ = Math.min(minZ, t.offsetZ - f.heightM);
    maxZ = Math.max(maxZ, t.offsetZ);
  }
  return { minX, maxX, minZ, maxZ };
}

/** Grid lines: both block edges, a pair just inside them, and geometric steps outward to `reach`. */
function farLines(lo: number, hi: number, first: number, grow: number, reach: number): number[] {
  const out: number[] = [];
  for (let d = first, s = first; d < reach; s *= grow, d += s) out.push(lo - d);
  out.reverse();
  out.push(lo, lo + 40, hi - 40, hi);
  for (let d = first, s = first; d < reach; s *= grow, d += s) out.push(hi + d);
  return out;
}

const hashCell = (i: number, j: number, k: number) => {
  const s = Math.sin(i * 127.1 + j * 311.7 + k * 74.7) * 43758.5453;
  return s - Math.floor(s);
};

/**
 * Faceted land that carries the tile block on to the horizon, so the block has no edge. It meets
 * the block at its edge heights (`edgeHeight` is the ground on or inside the block, metres), sits
 * `drop` metres below them, and falls well below the tiles inside the block so it never shows
 * through. Outside, facets drift gently up and down, and each takes one of `colours` (weighted by
 * repetition), so the haze has land texture in it. Flat-shaded buffers like the worker's.
 */
export function farLandBuffers(
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number },
  edgeHeight: (x: number, z: number) => number,
  colours: [number, number, number][],
  opts: { reach?: number; first?: number; grow?: number; drop?: number; below?: number } = {},
): MeshBuffers {
  const { reach = 18000, first = 90, grow = 1.13, drop = 1.5, below = 30 } = opts;
  const xs = farLines(bounds.minX, bounds.maxX, first, grow, reach);
  const zs = farLines(bounds.minZ, bounds.maxZ, first, grow, reach);
  const nx = xs.length, nz = zs.length;
  const H = new Float32Array(nx * nz);
  let lowest = Infinity;
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const x = xs[i], z = zs[j];
      const cx = Math.min(bounds.maxX, Math.max(bounds.minX, x));
      const cz = Math.min(bounds.maxZ, Math.max(bounds.minZ, z));
      const h = edgeHeight(cx, cz) - drop;
      lowest = Math.min(lowest, h);
      const out = Math.hypot(x - cx, z - cz);
      H[j * nx + i] = h + (out > 0 ? (hashCell(i, j, 1) - 0.5) * 10 * Math.min(1, out / 1500) : 0);
    }
  }
  // inside the block: well under the tiles
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++)
      if (xs[i] > bounds.minX && xs[i] < bounds.maxX && zs[j] > bounds.minZ && zs[j] < bounds.maxZ) H[j * nx + i] = lowest - below;

  const mb = new MeshBuilder((nx - 1) * (nz - 1) * 2);
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const x0 = xs[i], x1 = xs[i + 1], z0 = zs[j], z1 = zs[j + 1];
      const a = H[j * nx + i], b = H[j * nx + i + 1], c = H[(j + 1) * nx + i + 1], d = H[(j + 1) * nx + i];
      const c1 = colours[Math.floor(hashCell(i, j, 2) * colours.length)];
      const c2 = hashCell(i, j, 3) < 0.7 ? c1 : colours[Math.floor(hashCell(i, j, 4) * colours.length)];
      mb.tri(x0, a, z0, x1, b, z0, x1, c, z1, c1);
      mb.tri(x0, a, z0, x1, c, z1, x0, d, z1, c2);
    }
  }
  return mb.build();
}
