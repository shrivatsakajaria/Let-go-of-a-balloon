/**
 * Buildings: real footprints extruded from render_min_height to render_height above the lowest
 * ground under them, chalk walls, flat light tops on tall buildings and muted pitched roofs (ridge
 * along the long side of the oriented bounding box) on low ones. Plus generic gap-fill houses in
 * residential land the map has no buildings for. Pure; runs in a Worker.
 */
import earcut from 'earcut';
import { groundHeightAt, LC, type GroundGrid } from './terrain';
import { lerpHex, TALL_WALLS_M, type RegionStyle } from './palette';
import { MeshBuilder, clipRingHalfPlane, dedupe, hash01, pointInPolygon, ringArea, ringCentroid, rgb, scaleRGB, bbox, type BBox, type Polygon, type RGB } from './geom';
import type { BuildingFeature } from './vector';
import type { Landcover } from './landcover';

/** Buildings under this get a pitched roof. */
export const PITCHED_BELOW_M = 12;
const MAX_RISE_M = 5;

export type Circle = { x: number; z: number; r: number };

/** Oriented bounding box of a ring: centre, unit long axis (u) and short axis (v), half extents. */
export function orientedBox(r: ArrayLike<number>): { cx: number; cz: number; ux: number; uz: number; halfL: number; halfW: number } {
  const hull = convexHull(r);
  let best = { area: Infinity, cx: 0, cz: 0, ux: 1, uz: 0, halfL: 0, halfW: 0 };
  const m = hull.length;
  for (let i = 0; i < m; i += 2) {
    const j = (i + 2) % m;
    let ex = hull[j] - hull[i], ez = hull[j + 1] - hull[i + 1];
    const len = Math.hypot(ex, ez);
    if (len < 1e-9) continue;
    ex /= len; ez /= len;
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (let k = 0; k < m; k += 2) {
      const a = hull[k] * ex + hull[k + 1] * ez, b = -hull[k] * ez + hull[k + 1] * ex;
      if (a < a0) a0 = a;
      if (a > a1) a1 = a;
      if (b < b0) b0 = b;
      if (b > b1) b1 = b;
    }
    const area = (a1 - a0) * (b1 - b0);
    if (area < best.area - 1e-9) {
      const ca = (a0 + a1) / 2, cb = (b0 + b1) / 2;
      const cx = ca * ex - cb * ez, cz = ca * ez + cb * ex;
      const la = (a1 - a0) / 2, lb = (b1 - b0) / 2;
      best = la >= lb
        ? { area, cx, cz, ux: ex, uz: ez, halfL: la, halfW: lb }
        : { area, cx, cz, ux: -ez, uz: ex, halfL: lb, halfW: la };
    }
  }
  const { cx, cz, ux, uz, halfL, halfW } = best;
  return { cx, cz, ux, uz, halfL, halfW };
}

/** Andrew's monotone chain; flat [x, z, ...] counter-clockwise. */
function convexHull(r: ArrayLike<number>): number[] {
  const pts: [number, number][] = [];
  for (let i = 0; i < r.length; i += 2) pts.push([r[i], r[i + 1]]);
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts.flat();
  const cross = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [], upper: [number, number][] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)].flat();
}

/** Insert a vertex wherever an edge crosses the line v(p) = 0. */
function splitAtLine(r: ArrayLike<number>, v: (x: number, z: number) => number): number[] {
  const out: number[] = [];
  const n = r.length;
  for (let i = 0; i < n; i += 2) {
    const j = (i + 2) % n;
    const ax = r[i], az = r[i + 1], bx = r[j], bz = r[j + 1];
    out.push(ax, az);
    const va = v(ax, az), vb = v(bx, bz);
    if ((va > 1e-9 && vb < -1e-9) || (va < -1e-9 && vb > 1e-9)) {
      const t = va / (va - vb);
      out.push(ax + (bx - ax) * t, az + (bz - az) * t);
    }
  }
  return out;
}

/** Triangulate a polygon (outer + holes) in xz with earcut, emitting with heights from y(x, z). */
function cap(rings: number[][], y: (x: number, z: number) => number, color: RGB, out: MeshBuilder): void {
  if (!rings.length || rings[0].length < 6) return;
  const flat: number[] = [];
  const holes: number[] = [];
  for (let k = 0; k < rings.length; k++) {
    if (rings[k].length < 6) continue;
    if (k > 0) holes.push(flat.length / 2);
    for (const v of rings[k]) flat.push(v);
  }
  const idx = earcut(flat, holes.length ? holes : null, 2);
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 2, b = idx[t + 1] * 2, c = idx[t + 2] * 2;
    out.tri(
      flat[a], y(flat[a], flat[a + 1]), flat[a + 1],
      flat[b], y(flat[b], flat[b + 1]), flat[b + 1],
      flat[c], y(flat[c], flat[c + 1]), flat[c + 1],
      color,
    );
  }
}

export type ExtrudeStyle = { wall: RGB; top: RGB; roof: RGB; pitch: number };

/**
 * Extrude one footprint (outer ring + holes, local metres) from `bottom` to `top`. Pitched: walls
 * rise to the roof line (gable ends included) and the roof goes to `roofs`.
 */
export function extrude(
  poly: Polygon,
  bottom: number,
  top: number,
  pitched: boolean,
  style: ExtrudeStyle,
  walls: MeshBuilder,
  roofs: MeshBuilder,
): void {
  let rings: number[][] = poly.map((r) => dedupe(Array.from(r))).filter((r) => r.length >= 6);
  if (!rings.length) return;
  const outerSign = Math.sign(ringArea(rings[0])) || 1;

  let roofY: (x: number, z: number) => number = () => top;
  let v: ((x: number, z: number) => number) | null = null;
  if (pitched) {
    const box = orientedBox(rings[0]);
    if (box.halfW > 0.5) {
      const rise = Math.min(box.halfW * Math.tan((style.pitch * Math.PI) / 180), 0.45 * (top - bottom), MAX_RISE_M);
      const eave = top - rise;
      const vx = -box.uz, vz = box.ux; // short axis
      const vf = (x: number, z: number) => (x - box.cx) * vx + (z - box.cz) * vz;
      v = vf;
      roofY = (x, z) => eave + rise * Math.max(0, 1 - Math.abs(vf(x, z)) / box.halfW);
      rings = rings.map((r) => splitAtLine(r, vf));
    }
  }

  // walls: outward hint from the ring's winding (interior is left of each edge for an outer CCW ring)
  for (let k = 0; k < rings.length; k++) {
    const r = rings[k];
    const s = k === 0 ? outerSign : -(Math.sign(ringArea(r)) || 1);
    const n = r.length;
    for (let i = 0; i < n; i += 2) {
      const j = (i + 2) % n;
      const ax = r[i], az = r[i + 1], bx = r[j], bz = r[j + 1];
      const dx = bx - ax, dz = bz - az;
      // interior normal is s * (-dz, dx); outward is the opposite
      const ox = s * dz, oz = -s * dx;
      walls.quad(ax, bottom, az, bx, bottom, bz, bx, roofY(bx, bz), bz, ax, roofY(ax, az), az, style.wall, ox, 0, oz);
    }
  }

  if (!v) {
    cap(rings, roofY, style.top, walls);
    return;
  }
  // pitched: triangulate each side of the ridge separately so every roof face is planar
  const vf = v;
  for (const side of [1, -1]) {
    // keep side * v >= 0, i.e. a*x + b*z + c >= 0 with v = (x - cx) * vx + (z - cz) * vz
    const half = rings
      .map((r) => {
        const c0 = vf(0, 0);
        return clipRingHalfPlane(r, side * (vf(1, 0) - c0), side * (vf(0, 1) - c0), side * c0);
      })
      .filter((r, i) => i === 0 || r.length >= 6);
    if (half[0].length >= 6) cap(half, roofY, style.roof, roofs);
  }
}

// ---- the tile's buildings ----

export type BuildingContext = {
  ground: GroundGrid;
  region: RegionStyle;
  hidden: Circle[];
};

export function styleFor(region: RegionStyle, seed: number, height = 0): ExtrudeStyle {
  const walls = region.tallWalls && height > TALL_WALLS_M ? region.tallWalls : region.walls;
  const wallHex = walls[Math.floor(hash01(seed, 1) * walls.length)];
  const wall = scaleRGB(rgb(wallHex), 0.97 + 0.04 * hash01(seed, 2));
  return {
    wall,
    top: rgb(lerpHex(wallHex, '#ffffff', 0.3)),
    roof: scaleRGB(rgb(region.roofs[Math.floor(hash01(seed, 3) * region.roofs.length)]), 0.97 + 0.05 * hash01(seed, 4)),
    pitch: region.roofPitch,
  };
}

/** Lowest drawn ground height under a ring's vertices. */
function baseUnder(g: GroundGrid, r: ArrayLike<number>): number {
  let base = Infinity;
  for (let i = 0; i < r.length; i += 2) base = Math.min(base, groundHeightAt(g, r[i], r[i + 1]));
  return base;
}

/**
 * Extrude every building whose centroid is outside the hidden footprints. Returns the bounding boxes
 * of all footprints (hidden ones too: a landmark stands there), for gap-fill coverage.
 */
export function buildBuildings(list: BuildingFeature[], ctx: BuildingContext, walls: MeshBuilder, roofs: MeshBuilder): { built: number; boxes: BBox[] } {
  const boxes: BBox[] = [];
  let built = 0;
  for (const b of list) {
    const outer = b.polygon[0];
    boxes.push(bbox(outer));
    const c = ringCentroid(outer);
    if (ctx.hidden.some((h) => (c.x - h.x) ** 2 + (c.z - h.z) ** 2 <= h.r * h.r)) continue;
    const base = baseUnder(ctx.ground, outer);
    const top = base + b.height;
    const bottom = base + b.minHeight;
    if (top - bottom < 0.5) continue;
    const seed = (Math.round(c.x * 10) * 73856093) ^ (Math.round(c.z * 10) * 19349663);
    extrude(b.polygon, bottom, top, b.height < PITCHED_BELOW_M, styleFor(ctx.region, seed, b.height), walls, roofs);
    built++;
  }
  return { built, boxes };
}

// ---- gap-fill houses ----

export const HOUSE_CAP = 1500;
const M2_PER_HOUSE = 350;

/** A road segment for keeping houses off the road: endpoints and half width. */
export type Segment = { ax: number; az: number; bx: number; bz: number; half: number };

function segDist2(s: Segment, x: number, z: number): number {
  const dx = s.bx - s.ax, dz = s.bz - s.az;
  const l2 = dx * dx + dz * dz;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - s.ax) * dx + (z - s.az) * dz) / l2)) : 0;
  const px = s.ax + dx * t - x, pz = s.az + dz * t - z;
  return px * px + pz * pz;
}

export type GapFillInput = {
  ground: GroundGrid;
  landcover: Landcover;
  region: RegionStyle;
  /** Footprint boxes of the map's buildings (a cell touched by one is covered). */
  boxes: BBox[];
  /** Residential land-use polygons: house centres must fall inside one. */
  residentialAreas: Polygon[];
  /** Road segments bucketed by land-cover cell; and a road bearing per cell (NaN = none). */
  roadCells: Map<number, Segment[]>;
  roadAngle: Float32Array;
  seed: number;
  cap?: number;
};

/**
 * Generic pitched houses in residential cells that have no building at all (2D grid hash), at about
 * one per 350 m2, seeded, aligned to the nearest street where there is one, and capped. Returns how
 * many were placed.
 */
export function gapFill(inp: GapFillInput, walls: MeshBuilder, roofs: MeshBuilder): number {
  const { ground, landcover, region } = inp;
  const capN = inp.cap ?? HOUSE_CAP;
  const n = landcover.grid.size;
  const { X, Z } = ground;
  const frame = ground.frame;
  // which cells hold a building
  const covered = new Uint8Array(n * n);
  for (const b of inp.boxes) {
    const p0 = frame.localToFrac(b.x0, b.z1), p1 = frame.localToFrac(b.x1, b.z0); // north-west, south-east
    const i0 = Math.max(0, Math.floor(p0.fx * n)), i1 = Math.min(n - 1, Math.floor(p1.fx * n));
    const j0 = Math.max(0, Math.floor((1 - p1.fy) * n)), j1 = Math.min(n - 1, Math.floor((1 - p0.fy) * n));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) covered[j * n + i] = 1;
  }
  const cells: number[] = [];
  let expected = 0;
  for (let c = 0; c < n * n; c++) {
    if (!landcover.residential[c] || covered[c] || landcover.grid.classes[c] !== LC.builtUp) continue;
    cells.push(c);
    const i = c % n, j = (c - i) / n;
    expected += ((X[i + 1] - X[i]) * (Z[j] - Z[j + 1])) / M2_PER_HOUSE;
  }
  if (!cells.length) return 0;
  // thin evenly (not by position) when the tile would exceed the cap
  const density = Math.min(1, (capN * 1.05) / expected);
  cells.sort((a, b) => hash01(a, inp.seed) - hash01(b, inp.seed));
  const areaBoxes = inp.residentialAreas.map((p) => bbox(p[0]));

  let placed = 0;
  for (const c of cells) {
    if (placed >= capN) break;
    const i = c % n, j = (c - i) / n;
    const cw = X[i + 1] - X[i], ch = Z[j] - Z[j + 1];
    const want = ((cw * ch) / M2_PER_HOUSE) * density;
    const count = Math.floor(want) + (hash01(c, inp.seed, 1) < want - Math.floor(want) ? 1 : 0);
    if (!count) continue;
    const sx = Math.ceil(Math.sqrt((count * cw) / ch)), sy = Math.ceil(count / sx);
    let angle = inp.roadAngle[c];
    if (Number.isNaN(angle)) angle = hash01(inp.seed, 2) * Math.PI; // no street near: one tile-wide grain
    for (let k = 0; k < count && placed < capN; k++) {
      const a = k % sx, b = Math.floor(k / sx);
      const h = (q: number) => hash01(c * 16 + k, inp.seed, q);
      const x = X[i] + ((a + 0.3 + 0.4 * h(3)) / sx) * cw;
      const z = Z[j + 1] + ((b + 0.3 + 0.4 * h(4)) / sy) * ch;
      // inside residential land, and clear of roads
      let inArea = false;
      for (let q = 0; q < areaBoxes.length && !inArea; q++) {
        const bb = areaBoxes[q];
        if (x >= bb.x0 && x <= bb.x1 && z >= bb.z0 && z <= bb.z1) inArea = pointInPolygon(inp.residentialAreas[q], x, z);
      }
      if (!inArea) continue;
      const len = 8 + 3 * h(5), wid = 6 + 1.5 * h(6);
      const clear = Math.hypot(len, wid) / 2 + 1;
      let onRoad = false;
      for (let dj = -1; dj <= 1 && !onRoad; dj++)
        for (let di = -1; di <= 1 && !onRoad; di++) {
          const ii = i + di, jj = j + dj;
          if (ii < 0 || jj < 0 || ii >= n || jj >= n) continue;
          for (const s of inp.roadCells.get(jj * n + ii) ?? []) if (segDist2(s, x, z) < (s.half + clear) ** 2) { onRoad = true; break; }
        }
      if (onRoad) continue;
      const turn = angle + (h(7) - 0.5) * 0.12; // long side along the street
      const ux = Math.cos(turn), uz = Math.sin(turn);
      const hl = len / 2, hw = wid / 2;
      const ring = Float64Array.from([
        x - ux * hl + uz * hw, z - uz * hl - ux * hw,
        x + ux * hl + uz * hw, z + uz * hl - ux * hw,
        x + ux * hl - uz * hw, z + uz * hl + ux * hw,
        x - ux * hl - uz * hw, z - uz * hl + ux * hw,
      ]);
      const base = baseUnder(ground, ring);
      const height = 6 + 2 * h(9);
      extrude([ring], base, base + height, true, styleFor(region, c * 16 + k + inp.seed), walls, roofs);
      placed++;
    }
  }
  return placed;
}
