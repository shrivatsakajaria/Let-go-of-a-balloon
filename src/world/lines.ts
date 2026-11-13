/**
 * Roads and rivers as flat ribbons draped a little above the drawn ground, and street lamps along
 * the smaller streets. Pure; runs in a Worker.
 */
import { cellAt, groundHeightAt, type GroundGrid } from './terrain';
import { CONTOUR, ROADS, lerpHex } from './palette';
import { MeshBuilder, clipTriToTile, hash01, rgb, type RGB } from './geom';
import type { LineFeature } from './vector';
import type { Segment } from './buildings';

/** Ribbons float this far above the ground. */
export const DRAPE_M = 0.3;

type RoadStyle = { half: number; color: RGB; rank: number; small: boolean };

const STYLE: Record<string, RoadStyle> = {};
const def = (classes: string[], width: number, hex: string, rank: number, small = false) => {
  for (const c of classes) STYLE[c] = { half: width / 2, color: rgb(hex), rank, small };
};
def(['motorway'], 14, ROADS.major, 4);
def(['trunk'], 12, ROADS.major, 4);
def(['primary'], 10, ROADS.main, 3);
def(['secondary'], 9, ROADS.main, 3);
def(['tertiary'], 8, ROADS.minor, 2);
def(['minor', 'busway', 'raceway'], 6, ROADS.minor, 2);
def(['service'], 4, ROADS.small, 1, true);
def(['track'], 3, ROADS.small, 1, true);
def(['path'], 2, ROADS.small, 1, true);
def(['rail', 'transit'], 3, ROADS.rail, 0);

/** Pedestrian streets carry the street pattern in city centres: drawn like minor streets. */
const PEDESTRIAN: RoadStyle = { half: 2.5, color: rgb(ROADS.minor), rank: 2, small: false };

const RIVER = rgb(lerpHex(CONTOUR.waterShallow, CONTOUR.waterDeep, 0.5));
const WATERWAY_WIDTH: Record<string, number> = { river: 10, canal: 8, stream: 3 };

/**
 * Points of a polyline for draping: no step longer than `step` metres, and steps split further
 * (down to ~1.5 m) wherever the drawn ground bends away from a straight line by more than 8 cm, so
 * flat ground stays cheap and folds in the ground are followed.
 */
function densify(l: ArrayLike<number>, step: number, h: Surface): number[] {
  const out: number[] = [l[0], l[1]];
  const refine = (ax: number, az: number, ha: number, bx: number, bz: number, hb: number, depth: number) => {
    const mx = (ax + bx) / 2, mz = (az + bz) / 2;
    const hm = h(mx, mz);
    if (depth < 4 && Math.abs(hm - (ha + hb) / 2) > 0.08 && Math.hypot(bx - ax, bz - az) > 3) {
      refine(ax, az, ha, mx, mz, hm, depth + 1);
      refine(mx, mz, hm, bx, bz, hb, depth + 1);
    } else out.push(bx, bz);
  };
  let px = l[0], pz = l[1], ph = h(px, pz);
  for (let i = 2; i < l.length; i += 2) {
    const ax = l[i - 2], az = l[i - 1], bx = l[i], bz = l[i + 1];
    const k = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / step));
    for (let s = 1; s <= k; s++) {
      const x = ax + ((bx - ax) * s) / k, z = az + ((bz - az) * s) / k;
      const hh = h(x, z);
      refine(px, pz, ph, x, z, hh, 0);
      px = x; pz = z; ph = hh;
    }
  }
  return out;
}

/** Height of the surface a ribbon drapes on. */
type Surface = (x: number, z: number) => number;

/**
 * A flat ribbon of half width `half` along points p, each edge vertex draped on the surface. The
 * whole ribbon is built (lines run on into the tile buffer) and each triangle is cut at the tile
 * border (W x H), so a tile draws exactly its part and its neighbour the rest. Points made by the
 * cut take their height from the surface, which neighbouring tiles share along the border.
 */
function ribbon(p: number[], half: number, lift: number, color: RGB, surface: Surface, W: number, H: number, out: MeshBuilder): void {
  const n = p.length / 2;
  if (n < 2) return;
  const L: number[] = [], R: number[] = [];
  for (let i = 0; i < n; i++) {
    const x = p[i * 2], z = p[i * 2 + 1];
    // unit left normals of the segments before and after this point
    let nx = 0, nz = 0, cnt = 0, n1x = 0, n1z = 0;
    for (const [a, b] of [[i - 1, i], [i, i + 1]]) {
      if (a < 0 || b >= n) continue;
      const dx = p[b * 2] - p[a * 2], dz = p[b * 2 + 1] - p[a * 2 + 1];
      const len = Math.hypot(dx, dz) || 1;
      n1x = -dz / len; n1z = dx / len;
      nx += n1x; nz += n1z; cnt++;
    }
    const ml = Math.hypot(nx, nz);
    let mx = n1x, mz = n1z, scale = 1;
    if (cnt === 2 && ml > 1e-6) {
      mx = nx / ml; mz = nz / ml;
      scale = Math.min(2, 1 / Math.max(0.5, mx * n1x + mz * n1z)); // mitre, limited at sharp turns
    }
    const ox = mx * half * scale, oz = mz * half * scale;
    L.push(x + ox, z + oz);
    R.push(x - ox, z - oz);
  }
  const y = (x: number, z: number) => surface(x, z) + lift;
  const inside = (x: number, z: number) => x >= 0 && x <= W && z <= 0 && z >= -H;
  const tri = (ax: number, az: number, bx: number, bz: number, cx: number, cz: number) => {
    if (inside(ax, az) && inside(bx, bz) && inside(cx, cz)) {
      out.tri(ax, y(ax, az), az, bx, y(bx, bz), bz, cx, y(cx, cz), cz, color);
      return;
    }
    const q = clipTriToTile(ax, az, bx, bz, cx, cz, W, H);
    for (let k = 2; k + 3 < q.length; k += 2)
      out.tri(q[0], y(q[0], q[1]), q[1], q[k], y(q[k], q[k + 1]), q[k + 1], q[k + 2], y(q[k + 2], q[k + 3]), q[k + 3], color);
  };
  for (let i = 0; i + 1 < n; i++) {
    const a = i * 2, b = a + 2;
    tri(L[a], L[a + 1], R[a], R[a + 1], R[b], R[b + 1]);
    tri(L[a], L[a + 1], R[b], R[b + 1], L[b], L[b + 1]);
  }
}

export type RoadResult = {
  /** Road segments bucketed by land-cover cell (for keeping gap-fill houses off roads). */
  cells: Map<number, Segment[]>;
  /** Street bearing per land-cover cell, radians, NaN where no street is near. */
  angle: Float32Array;
};

/**
 * Road ribbons, width and pale tone by class; paths, service roads and tracks only above z13.
 * Roads never dip under flat water: `waterLevel` (NaN where none) lifts them over docks and lakes.
 * Also buckets road segments and street bearings into the n x n land-cover grid.
 */
export function buildRoads(lines: LineFeature[], g: GroundGrid, z: number, out: MeshBuilder, waterLevel?: Surface): RoadResult {
  const n = g.n;
  const surface: Surface = waterLevel
    ? (x, zz) => {
        const h = groundHeightAt(g, x, zz), w = waterLevel(x, zz);
        return w > h ? w : h; // NaN (no water) compares false
      }
    : (x, zz) => groundHeightAt(g, x, zz);
  const frame = g.frame;
  const step = frame.widthM / n;
  const cells = new Map<number, Segment[]>();
  const angle = new Float32Array(n * n).fill(NaN);
  const angleRank = new Int8Array(n * n).fill(-1);
  for (const l of lines) {
    if (l.cls.endsWith('_construction')) continue;
    const st = l.cls === 'path' && l.subclass === 'pedestrian' ? PEDESTRIAN : STYLE[l.cls];
    if (!st || (st.small && z <= 13)) continue;
    const p = densify(l.line, step, surface);
    ribbon(p, st.half, DRAPE_M + st.rank * 0.008, st.color, surface, frame.widthM, frame.heightM, out);
    for (let i = 2; i < p.length; i += 2) {
      const ax = p[i - 2], az = p[i - 1], bx = p[i], bz = p[i + 1];
      const c = cellAt(g, (ax + bx) / 2, (az + bz) / 2);
      let list = cells.get(c);
      if (!list) cells.set(c, (list = []));
      list.push({ ax, az, bx, bz, half: st.half });
      // streets people live on set the grain of the houses
      const r = l.cls === 'minor' ? 3 : l.cls === 'tertiary' ? 2 : st.small || st.rank === 0 ? 0 : 1;
      if (r > angleRank[c]) {
        angleRank[c] = r;
        angle[c] = Math.atan2(bz - az, bx - ax);
      }
    }
  }
  // spread bearings two cells out so houses near (not on) a street follow it
  for (let pass = 0; pass < 2; pass++) {
    const prev = angle.slice();
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        if (!Number.isNaN(prev[j * n + i])) continue;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ii = i + di, jj = j + dj;
          if (ii >= 0 && jj >= 0 && ii < n && jj < n && !Number.isNaN(prev[jj * n + ii])) {
            angle[j * n + i] = prev[jj * n + ii];
            break;
          }
        }
      }
  }
  return { cells, angle };
}

/** River, canal and stream ribbons in the water colours (streams only from z13). */
export function buildWaterways(lines: LineFeature[], g: GroundGrid, z: number, out: MeshBuilder): void {
  const step = g.frame.widthM / g.n;
  const ground: Surface = (x, zz) => groundHeightAt(g, x, zz);
  for (const l of lines) {
    const w = WATERWAY_WIDTH[l.cls];
    if (!w || (l.cls === 'stream' && z < 13)) continue;
    ribbon(densify(l.line, step, ground), w / 2, DRAPE_M, RIVER, ground, g.frame.widthM, g.frame.heightM, out);
  }
}

export const LAMP_CAP = 800;
const LAMP_SPACING_M = 30;

/**
 * Street-lamp positions [x, y, z, ...] (y = ground) along minor and tertiary streets every ~30 m,
 * alternating sides, z14 and up only. Spacing widens so a tile never needs more than LAMP_CAP.
 */
export function placeLamps(lines: LineFeature[], g: GroundGrid, z: number, seed: number, cap = LAMP_CAP): Float32Array {
  if (z < 14) return new Float32Array(0);
  const streets = lines.filter((l) => l.cls === 'minor' || l.cls === 'tertiary');
  let total = 0;
  for (const l of streets) for (let i = 2; i < l.line.length; i += 2) total += Math.hypot(l.line[i] - l.line[i - 2], l.line[i + 1] - l.line[i - 1]);
  const spacing = Math.max(LAMP_SPACING_M, (total / cap) * 1.02);
  const out: number[] = [];
  let count = 0;
  for (let k = 0; k < streets.length && count < cap; k++) {
    const l = streets[k];
    const half = STYLE[l.cls].half + 1.5;
    let next = spacing * (0.3 + 0.4 * hash01(k, seed)); // distance along the line of the next lamp
    let along = 0;
    let side = hash01(k, seed, 1) < 0.5 ? 1 : -1;
    for (let i = 2; i < l.line.length && count < cap; i += 2) {
      const ax = l.line[i - 2], az = l.line[i - 1], bx = l.line[i], bz = l.line[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 1e-9) continue;
      while (next <= along + len && count < cap) {
        const t = (next - along) / len;
        const x = ax + (bx - ax) * t - ((bz - az) / len) * half * side;
        const zz = az + (bz - az) * t + ((bx - ax) / len) * half * side;
        if (x >= 0 && x <= g.frame.widthM && zz <= 0 && zz >= -g.frame.heightM) {
          out.push(x, groundHeightAt(g, x, zz), zz);
          count++;
        }
        side = -side;
        next += spacing;
      }
      along += len;
    }
  }
  return Float32Array.from(out);
}
