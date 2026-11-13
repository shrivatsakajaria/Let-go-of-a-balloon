/**
 * Level of detail: which map tiles the world needs around a camera (spec 12). Full detail near the
 * camera's ground point, simpler ground further out, coarse land to the horizon:
 *
 *   z14 within 1.5 km   everything (buildings with roofs, gap-fill houses, trees, lamps, all roads);
 *                       the only level that casts shadows
 *   z13 to 5 km         flat simplified buildings, streets, rivers (OpenMapTiles has buildings
 *                       only at z13 and z14, so the city must not vanish from 1.5 km up)
 *   z12 to 10 km        ground, water, land use, rivers, motorways and trunk roads
 *   z10 to 40 km        ground, water, land use
 *   z7 to the haze      ground, water, land use
 *
 * z14 and z13 sort buildings, roofs and roads by tile cell (meshjob splitCells) so they are culled a
 * quarter at a time in view and a sixteenth at a time in the shadow pass. Far levels facet their
 * water more coarsely (the haze takes the detail anyway).
 *
 * Levels overlap (each covers its whole disc): a coarse tile stays under the finer ones, so moving
 * on never opens a hole, and the coverage map (coverage.ts) hides it where a finer tile is drawn.
 * Distances weigh where the camera looks: a point behind counts 2.5 times as far as one ahead, so
 * the budget goes to the view. Pure: no three.js.
 */
import { lonLatToTile, tileBounds, wrapLon } from '../geo/coords';
import { M_PER_DEG } from './frame';
import type { Detail } from './meshjob';

export type TileKey = { z: number; x: number; y: number };
export const tileKey = (t: TileKey): string => `${t.z}/${t.x}/${t.y}`;

/** The camera as the stream sees it: position, height above sea level and look direction. */
export type LodCamera = { lat: number; lon: number; altM: number; headingDeg: number };

export type LodLevel = {
  z: number;
  /** Tiles whose nearest point is within this (weighted) distance. */
  radiusM: number;
  /** Ground and land-cover cells per tile side. */
  lcSize: number;
  detail: Detail;
  /** Ground skirts (terrain.ts withSkirts), deep enough to meet the next coarser level. */
  skirtM: number;
  /** Drawn this far below the true ground, so it never pokes through a finer level. */
  dropM: number;
  /** Buildings and trees cast shadows (the shadow box is near the focus anyway). */
  castShadow: boolean;
  /** Buildings, roofs and roads in one mesh per tile quarter, so near tiles are culled finer. */
  split: boolean;
};

const NONE: Detail = { buildings: 'none', roadMinRank: Infinity, waterways: false, trees: false, lamps: false };

/**
 * Triangles per tile, measured in the world page (central Manchester and Westminster, the densest
 * tiles tried): z14 60-90k, z13 15-40k, z12 10-20k, z10 3-8k, z7 8-15k. The ground grid alone is
 * 2 lcSize^2 plus skirts.
 */
export const LOD_LEVELS: LodLevel[] = [
  { z: 14, radiusM: 1500, lcSize: 64, detail: { buildings: 'full', roadMinRank: 0, waterways: true, trees: true, lamps: true }, skirtM: 25, dropM: 0, castShadow: true, split: true },
  { z: 13, radiusM: 5000, lcSize: 48, detail: { buildings: 'lite', roadMinRank: 2, waterways: true, trees: false, lamps: false }, skirtM: 40, dropM: 2, castShadow: false, split: true },
  { z: 12, radiusM: 10000, lcSize: 64, detail: { ...NONE, roadMinRank: 4, waterways: true, waterFacets: 10 }, skirtM: 120, dropM: 6, castShadow: false, split: false },
  { z: 10, radiusM: 40000, lcSize: 48, detail: { ...NONE, waterFacets: 6 }, skirtM: 400, dropM: 25, castShadow: false, split: false },
  { z: 7, radiusM: Infinity, lcSize: 64, detail: { ...NONE, waterFacets: 4 }, skirtM: 800, dropM: 80, castShadow: false, split: false },
];
const COARSEST = LOD_LEVELS[LOD_LEVELS.length - 1].z;

export const levelFor = (z: number): LodLevel => {
  const l = LOD_LEVELS.find((v) => v.z === z);
  if (!l) throw new Error(`no level of detail at z${z}`);
  return l;
};

/** At most this many tiles alive, and this many builds in flight (spec 12 caps). */
export const MAX_TILES = 40;
export const MAX_IN_FLIGHT = 6;

/** Above this height the fine levels fall away (wide replay shots). */
const FINE_ALT_M = 1600;
/** A point behind the camera counts 1 + BEHIND times as far as one ahead. */
const BEHIND = 1.5;
/** Tiles already alive stay until this much further out (no churn at the edges). */
const KEEP_SLACK = 1.3;

/** Where the land has faded fully into the haze, by camera height above sea level. */
export function hazeFarM(altM: number): number {
  return Math.min(150000, Math.max(14000, 14000 + 20 * altM));
}

type Scored = TileKey & { ratio: number };

/**
 * The tiles wanted for `camera`, most wanted first (nearest relative to its level's reach, finer
 * first on ties), at most `budget`. Tiles in `opts.keep` (alive already) are kept a little longer.
 * Over budget, the tiles furthest out for their level go first; the coarsest level goes last.
 */
export function tilesFor(camera: LodCamera, budget = MAX_TILES, opts: { keep?: Set<string> } = {}): TileKey[] {
  const lat = camera.lat;
  const lon = wrapLon(camera.lon);
  const cosLat = Math.max(0.01, Math.cos((lat * Math.PI) / 180));
  const mLon = M_PER_DEG * cosLat;
  const h = (camera.headingDeg * Math.PI) / 180;
  const hx = Math.sin(h), hy = Math.cos(h);
  const lift = Math.max(0, camera.altM - FINE_ALT_M);
  const far = hazeFarM(camera.altM);
  const out: Scored[] = [];

  for (const lvl of LOD_LEVELS) {
    const reach = lvl.z === COARSEST ? far * 1.15 : Math.min(lvl.radiusM, far * 1.05);
    const reachKeep = reach * KEEP_SLACK;
    if (lift >= reachKeep) continue;
    const z = lvl.z, n = 2 ** z;
    const dLat = reachKeep / M_PER_DEG, dLon = Math.min(180, reachKeep / mLon);
    const yA = lonLatToTile(Math.min(85.05, lat + dLat), lon, z).y, yB = lonLatToTile(Math.max(-85.05, lat - dLat), lon, z).y;
    const y0 = Math.max(0, Math.floor(yA)), y1 = Math.min(n - 1, Math.floor(yB));
    // unwrapped x around the camera, so tiles across the date line come out next to each other
    const xc = ((lon + 180) / 360) * n;
    const x0 = Math.floor(xc - (dLon / 360) * n), x1 = Math.min(x0 + n - 1, Math.floor(xc + (dLon / 360) * n));
    for (let y = y0; y <= y1; y++) {
      const b = tileBounds(z, 0, y);
      const sy0 = (b.south - lat) * M_PER_DEG, sy1 = (b.north - lat) * M_PER_DEG;
      const ny = Math.min(sy1, Math.max(sy0, 0));
      for (let xu = x0; xu <= x1; xu++) {
        const west = (xu / n) * 360 - 180, east = ((xu + 1) / n) * 360 - 180;
        const nx = Math.min((east - lon) * mLon, Math.max((west - lon) * mLon, 0));
        const d = Math.hypot(nx, ny);
        const cos = d > 0 ? (nx * hx + ny * hy) / d : 1;
        const weighted = Math.hypot(d * (1 + (BEHIND * (1 - cos)) / 2), lift);
        const x = ((xu % n) + n) % n;
        const key = { z, x, y };
        const limit = opts.keep?.has(tileKey(key)) ? reachKeep : reach;
        if (weighted > limit) continue;
        out.push({ ...key, ratio: weighted / reach });
      }
    }
  }

  const byPriority = (a: Scored, b: Scored) => a.ratio - b.ratio || b.z - a.z;
  out.sort(byPriority);
  // de-duplicate (a tile range wider than the world at the coarsest zoom near the poles)
  const seen = new Set<string>();
  const unique = out.filter((t) => {
    const k = tileKey(t);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  let chosen = unique;
  if (unique.length > budget) {
    const coarse = unique.filter((t) => t.z === COARSEST).slice(0, budget);
    const rest = unique.filter((t) => t.z !== COARSEST).slice(0, budget - coarse.length);
    chosen = [...coarse, ...rest].sort(byPriority);
  }
  return chosen.map(({ z, x, y }) => ({ z, x, y }));
}
