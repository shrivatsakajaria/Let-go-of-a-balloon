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
 * Polygons that hold trees: landcover class wood (or forest) and city parks, which OpenMapTiles
 * puts in landcover as grass/park. The `park` layer is protected areas (national parks, nature
 * reserves, historic sites) and holds no trees of its own.
 */
export function treeZones(f: Features): Polygon[] {
  return f.landcover.filter((a) => a.cls === 'wood' || a.cls === 'forest' || a.subclass === 'park').map((a) => a.polygon);
}

/**
 * Tree instances (4x4 column-major matrices, three.js order): a jittered grid clipped to the zones,
 * spaced so a tile never needs more than TREE_CAP, with a narrow seeded spread of size and turn.
 * Never inside a `blockers` footprint (buildings). Positions sit on the drawn ground.
 */
export function placeTrees(
  zones: Polygon[],
  ground: GroundGrid,
  seed: number,
  spacingM: number,
  cap = TREE_CAP,
  blockers: Polygon[] = [],
): Float32Array {
  if (!zones.length) return new Float32Array(0);
  const frame = ground.frame;
  const boxes: BBox[] = zones.map((p) => bbox(p[0]));
  const blockBoxes: BBox[] = blockers.map((p) => bbox(p[0]));
  const blocked = (x: number, z: number) => {
    for (let k = 0; k < blockers.length; k++) {
      const b = blockBoxes[k];
      if (x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1 && pointInPolygon([blockers[k][0]], x, z)) return true;
    }
    return false;
  };
  let area = 0;
  for (const p of zones) area += polygonArea(p);
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
        if (x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1) hit = pointInPolygon(zones[k], x, z);
      }
      if (!hit || blocked(x, z)) continue;
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
