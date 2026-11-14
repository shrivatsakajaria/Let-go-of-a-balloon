/**
 * Water surfaces: the sea at 0 m, lakes and rivers at the lowest ground on their shore, faceted in
 * pale and mid water tones, with a narrow deep-blue band along true shorelines so coasts read.
 * Edges that lie on the tile border are clipping artefacts, not shore, and get no band. Pure.
 */
import earcut from 'earcut';
import { groundHeightAt, type GroundGrid } from './terrain';
import { CONTOUR } from './palette';
import { MeshBuilder, bbox, hash01, mixRGB, pointInPolygon, rgb, ringArea, type RGB } from './geom';
import type { AreaFeature } from './vector';

const SHALLOW = rgb(CONTOUR.waterShallow);
const DEEP = rgb(CONTOUR.waterDeep);
const WHITE: RGB = [1, 1, 1];
/** How far outside a shore edge to look for adjoining water. */
const SEAM_PROBE_M = 0.5;
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
  calmCell = 0,
): void {
  const ab = Math.hypot(bx - ax, bz - az), bc = Math.hypot(cx - bx, cz - bz), ca = Math.hypot(ax - cx, az - cz);
  const m = Math.max(ab, bc, ca);
  if (m <= maxLen || depth >= 12) {
    // calm water (seen from very high up): one colour per broad patch, so long thin facets never show as fans
    const s = calmCell > 0 ? Math.floor((ax + bx + cx) / 3 / calmCell) * 7919 + Math.floor((az + bz + cz) / 3 / calmCell) * 104729 : seed;
    out.tri(ax, y(ax, az), az, bx, y(bx, bz), bz, cx, y(cx, cz), cz, facetColour(s));
    return;
  }
  const s1 = seed * 2 + 1, s2 = seed * 2 + 2;
  if (m === ab) {
    const mx = (ax + bx) / 2, mz = (az + bz) / 2;
    facets(ax, az, mx, mz, cx, cz, y, maxLen, depth + 1, s1, out, calmCell);
    facets(mx, mz, bx, bz, cx, cz, y, maxLen, depth + 1, s2, out, calmCell);
  } else if (m === bc) {
    const mx = (bx + cx) / 2, mz = (bz + cz) / 2;
    facets(ax, az, bx, bz, mx, mz, y, maxLen, depth + 1, s1, out, calmCell);
    facets(ax, az, mx, mz, cx, cz, y, maxLen, depth + 1, s2, out, calmCell);
  } else {
    const mx = (cx + ax) / 2, mz = (cz + az) / 2;
    facets(ax, az, bx, bz, mx, mz, y, maxLen, depth + 1, s1, out, calmCell);
    facets(mx, mz, bx, bz, cx, cz, y, maxLen, depth + 1, s2, out, calmCell);
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
/**
 * Water bodies and shore bands for one tile. Flat water is faceted into triangles no longer than
 * the tile width / `facetsAcross` (20 by default; far tiles, deep in the haze, use fewer). `calm`: the
 * facets take one colour per broad patch (a sixth of the tile) rather than each its own (the landing
 * card's region tiles, where earcut's long thin triangles would show as fans).
 */
export function buildWater(list: AreaFeature[], levels: number[], g: GroundGrid, out: MeshBuilder, facetsAcross = 20, calm = false): void {
  const W = g.frame.widthM, H = g.frame.heightM;
  const onBorder = borderTest(g);
  const band = bandWidth(W);
  const cell = W / g.n;
  const draped = (x: number, z: number) => groundHeightAt(g, x, z) + WATER_DRAPE_M;
  const clampX = (v: number) => Math.min(W, Math.max(0, v)), clampZ = (v: number) => Math.min(0, Math.max(-H, v));
  // an edge that another water polygon continues across (riverbank seams, a pond joining a river)
  // is not shore: probe just outside it
  const boxes = list.map((a) => bbox(a.polygon[0]));
  const otherWaterAt = (self: number, x: number, z: number) => {
    for (let k = 0; k < list.length; k++) {
      if (k === self) continue;
      const b = boxes[k];
      if (x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1 && pointInPolygon(list[k].polygon, x, z)) return true;
    }
    return false;
  };

  for (let w = 0; w < list.length; w++) {
    const { polygon } = list[w];
    const level = levels[w];
    const flatY = Number.isFinite(level);
    const y = flatY ? () => level : draped;
    // flat water facets can be large; draped ones follow the ground cells
    const maxLen = flatY ? W / facetsAcross : cell;
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
      facets(flat[a], flat[a + 1], flat[b], flat[b + 1], flat[c], flat[c + 1], y, maxLen, 0, w * 65536 + t, out, calm ? W / 6 : 0);
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
        // pieces of at most a ground cell: draped bands follow the ground, and each piece is
        // checked for being shared with another water polygon
        const steps = Math.ceil(len / cell);
        for (let q = 0; q < steps; q++) {
          const t0 = q / steps, t1 = (q + 1) / steps;
          const sx = ax + dx * t0, sz = az + dz * t0, ex = ax + dx * t1, ez = az + dz * t1;
          const mx = (sx + ex) / 2 - (ix / band) * SEAM_PROBE_M, mz = (sz + ez) / 2 - (iz / band) * SEAM_PROBE_M;
          if (otherWaterAt(w, mx, mz)) continue;
          const px = clampX(ex + ix), pz = clampZ(ez + iz), qx = clampX(sx + ix), qz = clampZ(sz + iz);
          out.quad(sx, by(sx, sz), sz, ex, by(ex, ez), ez, px, by(px, pz), pz, qx, by(qx, qz), qz, DEEP);
        }
      }
    });
  }
}
