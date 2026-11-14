/**
 * Land cover from the vector tile: a per-cell class grid for the ground colours (and a residential
 * mask for gap-fill houses), and tree placement inside woods and parks. Pure; runs in a Worker.
 */
import { LC, groundHeightAt, type GroundGrid, type LandcoverGrid } from './terrain';
import type { TileFrame } from './frame';
import { bbox, hash01, pointInPolygon, polygonArea, type BBox, type Polygon } from './geom';
import type { AreaFeature, Features } from './vector';

const BUILT_UP = new Set(['residential', 'commercial', 'industrial', 'retail', 'railway', 'garages', 'quarry']);
const GREEN = new Set(['pitch', 'playground', 'cemetery', 'park', 'grass', 'recreation_ground', 'village_green']);

function landcoverClass(cls: string): number {
  switch (cls) {
    case 'wood': case 'forest': return LC.wood;
    case 'farmland': return LC.farmland;
    case 'sand': case 'beach': return LC.sand;
    case 'rock': case 'ice': case 'glacier': return LC.rock; // no ice class yet: pale rock
    case 'grass': case 'wetland': case 'scrub': case 'meadow': return LC.grass;
    default: return LC.unknown;
  }
}

/** Local z of each cell row's centre (row 0 = south), evenly spaced in Mercator like the ground. */
function rowCentres(frame: TileFrame, n: number): Float64Array {
  const zc = new Float64Array(n);
  for (let j = 0; j < n; j++) zc[j] = frame.fracToLocal(0, 1 - (j + 0.5) / n).z;
  return zc;
}

/**
 * Scanline-fill a polygon (with holes, even-odd) at cell centres: calls set(cellIndex) for every
 * cell whose centre is inside.
 */
function fillPolygon(poly: Polygon, frame: TileFrame, n: number, zc: Float64Array, set: (cell: number) => void): void {
  const b = bbox(poly[0]);
  const W = frame.widthM;
  const xs: number[] = [];
  for (let j = 0; j < n; j++) {
    const z = zc[j];
    if (z < b.z0 || z > b.z1) continue;
    xs.length = 0;
    for (const r of poly) {
      const m = r.length;
      for (let i = 0, k = m - 2; i < m; k = i, i += 2) {
        const zi = r[i + 1], zk = r[k + 1];
        if (zi > z !== zk > z) xs.push(r[i] + ((r[k] - r[i]) * (z - zi)) / (zk - zi));
      }
    }
    xs.sort((a, c) => a - c);
    for (let q = 0; q + 1 < xs.length; q += 2) {
      const i0 = Math.max(0, Math.ceil((xs[q] / W) * n - 0.5));
      const i1 = Math.min(n - 1, Math.ceil((xs[q + 1] / W) * n - 0.5) - 1);
      for (let i = i0; i <= i1; i++) set(j * n + i);
    }
  }
}

export type Landcover = {
  grid: LandcoverGrid;
  /** 1 where the cell is residential land use (gap-fill houses may go there). */
  residential: Uint8Array;
};

/**
 * Rasterise land use, land cover and water into an n x n class grid (row 0 = south). Later layers
 * win: built-up land use, then natural land cover (city parks are landcover grass/park), then water.
 * The `park` layer (protected areas) is left out: painting it would turn a national park's woods
 * and moors to lawn.
 */
export function rasteriseLandcover(f: Features, frame: TileFrame, n: number): Landcover {
  const classes = new Uint8Array(n * n);
  const residential = new Uint8Array(n * n);
  const zc = rowCentres(frame, n);
  const paint = (a: AreaFeature, cls: number) => fillPolygon(a.polygon, frame, n, zc, (c) => (classes[c] = cls));
  for (const a of f.landuse) {
    if (BUILT_UP.has(a.cls)) paint(a, LC.builtUp);
    else if (GREEN.has(a.cls)) paint(a, LC.grass);
  }
  for (const a of f.landuse) if (a.cls === 'residential') fillPolygon(a.polygon, frame, n, zc, (c) => (residential[c] = 1));
  for (const a of f.landcover) {
    const cls = landcoverClass(a.cls);
    if (cls !== LC.unknown) paint(a, cls);
  }
  for (const a of f.water) paint(a, LC.water);
  return { grid: { size: n, classes }, residential };
}

// ---- trees ----

export const TREE_CAP = 2000;

/**
 * A city park keeps its trees within this many metres of its outline (the rows along its alleys and
 * streets); its open middle stays clear, as on the Champ de Mars, where a launch looks down the lawns to
 * the Eiffel Tower. Its wooded parts (wood polygons) keep theirs all through.
 */
export const PARK_EDGE_M = 25;
/**
 * Open grass, where no tree stands even inside a park or a wood: OSM landuse=grass lawns, meadows and
 * flowerbeds (OpenMapTiles landcover class grass with these subclasses).
 */
const LAWNS = new Set(['grass', 'grassland', 'meadow', 'flowerbed', 'village_green', 'recreation_ground']);

/** A polygon that holds trees; `edgeM`: only within that distance of its outline (a park). */
export type TreeZone = { polygon: Polygon; edgeM?: number };

/**
 * Polygons that hold trees: landcover class wood (or forest) all through, and city parks, which
 * OpenMapTiles puts in landcover as grass/park, along their edges (PARK_EDGE_M). The `park` layer is
 * protected areas (national parks, nature reserves, historic sites) and holds no trees of its own.
 */
export function treeZones(f: Features): TreeZone[] {
  const out: TreeZone[] = [];
  for (const a of f.landcover) {
    if (a.cls === 'wood' || a.cls === 'forest') out.push({ polygon: a.polygon });
    else if (a.subclass === 'park') out.push({ polygon: a.polygon, edgeM: PARK_EDGE_M });
  }
  return out;
}

/** The open lawns (LAWNS), kept clear of trees. */
export function treeLawns(f: Features): Polygon[] {
  return f.landcover.filter((a) => a.cls === 'grass' && LAWNS.has(a.subclass)).map((a) => a.polygon);
}

/**
 * Distance (m) from (x, z) to the nearest edge of a ring that is a real edge: an edge along the tile's
 * border (where a polygon was clipped to the tile) is none. Infinity if every edge is the tile's.
 */
function edgeDistance(r: ArrayLike<number>, x: number, z: number, W: number, H: number): number {
  const EPS = 0.5;
  const onBorder = (ax: number, az: number, bx: number, bz: number) =>
    (Math.abs(ax) < EPS && Math.abs(bx) < EPS) || (Math.abs(ax - W) < EPS && Math.abs(bx - W) < EPS) ||
    (Math.abs(az) < EPS && Math.abs(bz) < EPS) || (Math.abs(az + H) < EPS && Math.abs(bz + H) < EPS);
  let best = Infinity;
  const n = r.length;
  for (let i = 0, k = n - 2; i < n; k = i, i += 2) {
    const ax = r[k], az = r[k + 1], bx = r[i], bz = r[i + 1];
    if (onBorder(ax, az, bx, bz)) continue;
    const dx = bx - ax, dz = bz - az;
    const L = dx * dx + dz * dz;
    const t = L > 0 ? Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / L)) : 0;
    const d = Math.hypot(x - (ax + t * dx), z - (az + t * dz));
    if (d < best) best = d;
  }
  return best;
}

/**
 * Tree instances (4x4 column-major matrices, three.js order): a jittered grid clipped to the zones (a
 * park's only near its edges), spaced so a tile never needs more than TREE_CAP, with a narrow seeded
 * spread of size and turn. Never inside a `blockers` footprint (buildings) or on a `lawns` polygon.
 * Positions sit on the drawn ground.
 */
export function placeTrees(
  treeZones: TreeZone[],
  ground: GroundGrid,
  seed: number,
  spacingM: number,
  cap = TREE_CAP,
  blockers: Polygon[] = [],
  lawns: Polygon[] = [],
): Float32Array {
  if (!treeZones.length) return new Float32Array(0);
  const frame = ground.frame;
  const zones = treeZones.map((t) => t.polygon);
  const boxes: BBox[] = zones.map((p) => bbox(p[0]));
  const lawnBoxes: BBox[] = lawns.map((p) => bbox(p[0]));
  const onLawn = (x: number, z: number) => {
    for (let k = 0; k < lawns.length; k++) {
      const b = lawnBoxes[k];
      if (x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1 && pointInPolygon(lawns[k], x, z)) return true;
    }
    return false;
  };
  const blockBoxes: BBox[] = blockers.map((p) => bbox(p[0]));
  const blocked = (x: number, z: number) => {
    for (let k = 0; k < blockers.length; k++) {
      const b = blockBoxes[k];
      if (x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1 && pointInPolygon([blockers[k][0]], x, z)) return true;
    }
    return false;
  };
  // a park's trees fill only its edge band: its share of the area is about the band along its outline
  let area = 0;
  for (const t of treeZones) {
    const a = polygonArea(t.polygon);
    area += t.edgeM === undefined ? a : Math.min(a, ringLength(t.polygon[0]) * t.edgeM);
  }
  const step = Math.max(spacingM, Math.sqrt(area / cap) * 1.05);
  let ux = Infinity, uz = Infinity, vx = -Infinity, vz = -Infinity;
  for (const b of boxes) {
    ux = Math.min(ux, b.x0); uz = Math.min(uz, b.z0); vx = Math.max(vx, b.x1); vz = Math.max(vz, b.z1);
  }
  ux = Math.max(0, ux); vx = Math.min(frame.widthM, vx); uz = Math.max(-frame.heightM, uz); vz = Math.min(0, vz);
  const out: number[] = [];
  let count = 0;
  const gi0 = Math.floor(ux / step), gi1 = Math.ceil(vx / step), gj0 = Math.floor(uz / step), gj1 = Math.ceil(vz / step);
  for (let gj = gj0; gj <= gj1 && count < cap; gj++) {
    for (let gi = gi0; gi <= gi1 && count < cap; gi++) {
      const x = (gi + 0.15 + 0.7 * hash01(gi, gj, seed)) * step;
      const z = (gj + 0.15 + 0.7 * hash01(gi, gj, seed + 1)) * step;
      let hit = false;
      for (let k = 0; k < zones.length && !hit; k++) {
        const b = boxes[k];
        if (x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1 && pointInPolygon(zones[k], x, z)) {
          const e = treeZones[k].edgeM;
          hit = e === undefined || edgeDistance(zones[k][0], x, z, frame.widthM, frame.heightM) <= e;
        }
      }
      if (!hit || blocked(x, z) || onLawn(x, z)) continue;
      const y = groundHeightAt(ground, x, z);
      const turn = hash01(gi, gj, seed + 2) * Math.PI * 2;
      const s = 0.85 + 0.3 * hash01(gi, gj, seed + 3);
      const sy = s * (0.9 + 0.2 * hash01(gi, gj, seed + 4));
      const c = Math.cos(turn) * s, sn = Math.sin(turn) * s;
      out.push(c, 0, -sn, 0, 0, sy, 0, 0, sn, 0, c, 0, x, y, z, 1);
      count++;
    }
  }
  return Float32Array.from(out);
}

function ringLength(r: ArrayLike<number>): number {
  let L = 0;
  for (let i = 0, k = r.length - 2; i < r.length; k = i, i += 2) L += Math.hypot(r[i] - r[k], r[i + 1] - r[k + 1]);
  return L;
}

/** Per-cell water level (n x n, row 0 = south; NaN where no flat water), the lowest where bodies overlap. */
export function rasteriseLevels(polys: Polygon[], levels: number[], frame: TileFrame, n: number): Float32Array {
  const out = new Float32Array(n * n).fill(NaN);
  const zc = rowCentres(frame, n);
  polys.forEach((p, k) => {
    const l = levels[k];
    if (Number.isFinite(l)) fillPolygon(p, frame, n, zc, (c) => { if (!(out[c] <= l)) out[c] = l; });
  });
  return out;
}
