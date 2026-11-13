/**
 * Water surfaces: the sea at 0 m, lakes and rivers at the lowest ground on their shore, faceted in
 * pale and mid water tones, with a narrow deep-blue band along true shorelines so coasts read.
 * Edges that lie on the tile border are clipping artefacts, not shore, and get no band. Pure.
 */
import earcut from 'earcut';
import { groundHeightAt, type GroundGrid } from './terrain';
import { CONTOUR } from './palette';
import { MeshBuilder, hash01, mixRGB, rgb, ringArea, type RGB } from './geom';
import type { AreaFeature } from './vector';

const SHALLOW = rgb(CONTOUR.waterShallow);
const DEEP = rgb(CONTOUR.waterDeep);
const WHITE: RGB = [1, 1, 1];
/** The band sits this far above the body so the two never fight for the same pixels. */
const BAND_LIFT_M = 0.05;

/** Width of the deep shoreline band in metres for a tile of this width. */
export const bandWidth = (tileWidthM: number) => Math.max(6, tileWidthM / 150);

/** Body colour of a facet: between pale shallows and a mid blue, with an occasional glint. */
function facetColour(seed: number): RGB {
  const c = mixRGB(SHALLOW, DEEP, 0.22 + 0.2 * hash01(seed, 7));
  return hash01(seed, 8) < 0.03 ? mixRGB(c, WHITE, 0.18) : c;
}

/** Emit a triangle, splitting its longest edge until no edge is longer than maxLen, so the body is faceted. */
function facets(
  ax: number, az: number, bx: number, bz: number, cx: number, cz: number,
  y: (x: number, z: number) => number, maxLen: number, depth: number, seed: number, out: MeshBuilder,
): void {
  const ab = Math.hypot(bx - ax, bz - az), bc = Math.hypot(cx - bx, cz - bz), ca = Math.hypot(ax - cx, az - cz);
  const m = Math.max(ab, bc, ca);
  if (m <= maxLen || depth >= 12) {
    out.tri(ax, y(ax, az), az, bx, y(bx, bz), bz, cx, y(cx, cz), cz, facetColour(seed));
    return;
  }
  const s1 = seed * 2 + 1, s2 = seed * 2 + 2;
  if (m === ab) {
    const mx = (ax + bx) / 2, mz = (az + bz) / 2;
    facets(ax, az, mx, mz, cx, cz, y, maxLen, depth + 1, s1, out);
    facets(mx, mz, bx, bz, cx, cz, y, maxLen, depth + 1, s2, out);
  } else if (m === bc) {
    const mx = (bx + cx) / 2, mz = (bz + cz) / 2;
    facets(ax, az, bx, bz, mx, mz, y, maxLen, depth + 1, s1, out);
    facets(ax, az, mx, mz, cx, cz, y, maxLen, depth + 1, s2, out);
  } else {
    const mx = (cx + ax) / 2, mz = (cz + az) / 2;
    facets(ax, az, bx, bz, mx, mz, y, maxLen, depth + 1, s1, out);
    facets(mx, mz, bx, bz, cx, cz, y, maxLen, depth + 1, s2, out);
  }
}

/** Rivers and canals run downhill: they drape on the ground. Everything else lies flat. */
const DRAPED = new Set(['river', 'canal', 'stream', 'ditch', 'drain']);
/** Draped water floats this far above the ground. */
export const WATER_DRAPE_M = 0.2;

const BORDER_EPS = 0.01;
function borderTest(g: GroundGrid) {
  const W = g.frame.widthM, H = g.frame.heightM, e = BORDER_EPS;
  return (ax: number, az: number, bx: number, bz: number) =>
    (Math.abs(ax) < e && Math.abs(bx) < e) ||
    (Math.abs(ax - W) < e && Math.abs(bx - W) < e) ||
    (Math.abs(az) < e && Math.abs(bz) < e) ||
    (Math.abs(az + H) < e && Math.abs(bz + H) < e);
}

/**
 * Level of each flat water body: the sea at 0 m, lakes and ponds at the lowest ground on their true
 * shore (tile-border edges are not shore). NaN for draped water (rivers, canals).
 */
export function waterLevels(list: AreaFeature[], g: GroundGrid): number[] {
  const onBorder = borderTest(g);
  return list.map(({ cls, polygon }) => {
    if (cls === 'ocean') return 0;
    if (DRAPED.has(cls)) return NaN;
    let lo = Infinity, any = Infinity;
    for (const r of polygon) {
      const n = r.length;
      for (let i = 0; i < n; i += 2) {
        const h = groundHeightAt(g, r[i], r[i + 1]);
        any = Math.min(any, h);
        const j = (i + 2) % n, k = (i - 2 + n) % n;
        if (!onBorder(r[i], r[i + 1], r[j], r[j + 1]) || !onBorder(r[k], r[k + 1], r[i], r[i + 1])) lo = Math.min(lo, h);
      }
    }
    return Number.isFinite(lo) ? lo : any;
  });
}

/** Water bodies and their shoreline bands for one tile. `levels` from waterLevels (NaN = drape). */
export function buildWater(list: AreaFeature[], levels: number[], g: GroundGrid, out: MeshBuilder): void {
  const W = g.frame.widthM, H = g.frame.heightM;
  const onBorder = borderTest(g);
  const band = bandWidth(W);
  const cell = W / g.n;
  const draped = (x: number, z: number) => groundHeightAt(g, x, z) + WATER_DRAPE_M;
  const clampX = (v: number) => Math.min(W, Math.max(0, v)), clampZ = (v: number) => Math.min(0, Math.max(-H, v));

  for (let w = 0; w < list.length; w++) {
    const { polygon } = list[w];
    const level = levels[w];
    const flatY = Number.isFinite(level);
    const y = flatY ? () => level : draped;
    // flat water facets can be large; draped ones follow the ground cells
    const maxLen = flatY ? W / 20 : cell;
    // body
    const flat: number[] = [];
    const holes: number[] = [];
    polygon.forEach((r, k) => {
      if (k > 0) holes.push(flat.length / 2);
      for (const v of r) flat.push(v);
    });
    const idx = earcut(flat, holes.length ? holes : null, 2);
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t] * 2, b = idx[t + 1] * 2, c = idx[t + 2] * 2;
      facets(flat[a], flat[a + 1], flat[b], flat[b + 1], flat[c], flat[c + 1], y, maxLen, 0, w * 65536 + t, out);
    }

    // deep band along the true shore, inset into the water
    const by = (x: number, z: number) => y(x, z) + BAND_LIFT_M;
    const outerSign = Math.sign(ringArea(polygon[0])) || 1;
    polygon.forEach((r, k) => {
      const s = k === 0 ? outerSign : -(Math.sign(ringArea(r)) || 1);
      const n = r.length;
      for (let i = 0; i < n; i += 2) {
        const j = (i + 2) % n;
        const ax = r[i], az = r[i + 1], bx = r[j], bz = r[j + 1];
        if (onBorder(ax, az, bx, bz)) continue;
        const dx = bx - ax, dz = bz - az;
        const len = Math.hypot(dx, dz);
        if (len < 1e-6) continue;
        const ix = (-dz / len) * s * band, iz = (dx / len) * s * band; // into the water
        const steps = flatY ? 1 : Math.ceil(len / cell); // draped bands follow the ground too
        for (let q = 0; q < steps; q++) {
          const t0 = q / steps, t1 = (q + 1) / steps;
          const sx = ax + dx * t0, sz = az + dz * t0, ex = ax + dx * t1, ez = az + dz * t1;
          const px = clampX(ex + ix), pz = clampZ(ez + iz), qx = clampX(sx + ix), qz = clampZ(sz + iz);
          out.quad(sx, by(sx, sz), sz, ex, by(ex, ez), ez, px, by(px, pz), pz, qx, by(qx, qz), qz, DEEP);
        }
      }
    });
  }
}
