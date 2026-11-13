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
  y: number, maxLen: number, depth: number, seed: number, out: MeshBuilder,
): void {
  const ab = Math.hypot(bx - ax, bz - az), bc = Math.hypot(cx - bx, cz - bz), ca = Math.hypot(ax - cx, az - cz);
  const m = Math.max(ab, bc, ca);
  if (m <= maxLen || depth >= 10) {
    out.tri(ax, y, az, bx, y, bz, cx, y, cz, facetColour(seed));
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

/** Water bodies and their shoreline bands for one tile. */
export function buildWater(list: AreaFeature[], g: GroundGrid, out: MeshBuilder): void {
  const W = g.frame.widthM, H = g.frame.heightM;
  const eps = 0.01;
  const onBorder = (ax: number, az: number, bx: number, bz: number) =>
    (Math.abs(ax) < eps && Math.abs(bx) < eps) ||
    (Math.abs(ax - W) < eps && Math.abs(bx - W) < eps) ||
    (Math.abs(az) < eps && Math.abs(bz) < eps) ||
    (Math.abs(az + H) < eps && Math.abs(bz + H) < eps);
  const band = bandWidth(W);
  const maxLen = W / 20;

  for (let w = 0; w < list.length; w++) {
    const { cls, polygon } = list[w];
    // level: the sea at 0 m; inland water at the lowest ground on its true shore
    let level = 0;
    if (cls !== 'ocean') {
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
      level = Number.isFinite(lo) ? lo : any;
    }

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
      facets(flat[a], flat[a + 1], flat[b], flat[b + 1], flat[c], flat[c + 1], level, maxLen, 0, w * 65536 + t, out);
    }

    // deep band along the true shore, inset into the water
    const outerSign = Math.sign(ringArea(polygon[0])) || 1;
    polygon.forEach((r, k) => {
      const s = k === 0 ? outerSign : -(Math.sign(ringArea(r)) || 1);
      const n = r.length;
      const y = level + BAND_LIFT_M;
      for (let i = 0; i < n; i += 2) {
        const j = (i + 2) % n;
        const ax = r[i], az = r[i + 1], bx = r[j], bz = r[j + 1];
        if (onBorder(ax, az, bx, bz)) continue;
        const dx = bx - ax, dz = bz - az;
        const len = Math.hypot(dx, dz);
        if (len < 1e-6) continue;
        const ix = (-dz / len) * s * band, iz = (dx / len) * s * band; // into the water
        const cx = (v: number) => Math.min(W, Math.max(0, v)), cz = (v: number) => Math.min(0, Math.max(-H, v));
        out.quad(ax, y, az, bx, y, bz, cx(bx + ix), y, cz(bz + iz), cx(ax + ix), y, cz(az + iz), DEEP);
      }
    });
  }
}
