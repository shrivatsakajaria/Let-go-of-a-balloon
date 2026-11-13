/**
 * Place names from the static gazetteer tiles (public/gazetteer/, built by scripts/gazetteer.ts;
 * GeoNames towns, Natural Earth sea and region names). Each zoom-5 tile holds its towns and a
 * coarse grid saying which cells are sea or a named region. Tiles are fetched once and kept.
 */
import { GAZETTEER_BASE, GAZETTEER_ZOOM as Z, NEAREST_TOWN_KM } from '../config';
import { haversineKm, lonLatToTile, type LatLon } from './coords';

export type Town = { name: string; country: string; lat: number; lon: number; population: number };
export type Place = {
  name: string;
  kind: 'town' | 'sea' | 'region';
  country?: string;
  /** Towns: how far away it is. */
  distanceKm?: number;
  /** A town or sea that sits in a named region (the Alps, the Lake District): the region's name. */
  region?: string;
  /** Not a real name: "open sea" or "open countryside". */
  generic?: boolean;
};

type Tile = { towns: Town[]; names: [string, 's' | 'r'][]; grid: Uint16Array | null; side: number };
const EMPTY: Tile = { towns: [], names: [], grid: null, side: 0 };

const SIDE = 2 ** Z;
const tiles = new Map<string, Promise<Tile>>();

export function clearGazetteerCache(): void {
  tiles.clear();
}

function decode(raw: unknown): Tile {
  const j = raw as { c?: string[]; t?: [string, number, number, number, number][]; n?: [string, 's' | 'r'][]; g?: number[] };
  if (!j || !Array.isArray(j.t) || !Array.isArray(j.c)) throw new Error('not a gazetteer tile');
  const towns = j.t.map(([name, ci, lat, lon, population]) => ({ name, country: j.c![ci], lat, lon, population }));
  let grid: Uint16Array | null = null;
  let side = 0;
  if (Array.isArray(j.g)) {
    let total = 0;
    for (let k = 1; k < j.g.length; k += 2) total += j.g[k];
    side = Math.round(Math.sqrt(total));
    grid = new Uint16Array(total);
    let at = 0;
    for (let k = 0; k < j.g.length; k += 2) {
      grid.fill(j.g[k], at, at + j.g[k + 1]);
      at += j.g[k + 1];
    }
  }
  return { towns, names: j.n ?? [], grid, side };
}

/** The one place gazetteer files are requested. A 404, an HTML fallback page or bad JSON is an empty tile. */
async function fetchTile(x: number, y: number): Promise<Tile> {
  const res = await fetch(`${GAZETTEER_BASE}/${Z}_${x}_${y}.json`);
  if (!res.ok) return EMPTY;
  try {
    return decode(JSON.parse(await res.text()));
  } catch {
    return EMPTY;
  }
}

function loadTile(x: number, y: number): Promise<Tile> {
  const key = `${x}_${y}`;
  let t = tiles.get(key);
  if (!t) {
    t = fetchTile(x, y).catch(() => {
      tiles.delete(key); // offline for a moment: try again next time
      return EMPTY;
    });
    tiles.set(key, t);
  }
  return t;
}

function locate(p: LatLon): { x: number; y: number; fx: number; fy: number } {
  const t = lonLatToTile(p.lat, p.lon, Z); // clamps latitude to the Mercator range and wraps longitude
  const x = Math.min(SIDE - 1, Math.floor(t.x));
  const y = Math.max(0, Math.min(SIDE - 1, Math.floor(t.y)));
  return { x, y, fx: t.x - x, fy: Math.max(0, Math.min(1, t.y - y)) };
}

/** Tiles within radiusKm of p: its own, plus a neighbour only when p is close enough to that edge. */
async function tilesAround(p: LatLon, radiusKm: number): Promise<Tile[]> {
  const { x, y, fx, fy } = locate(p);
  const tileKm = (40075.017 * Math.cos((Math.min(85, Math.abs(p.lat)) * Math.PI) / 180)) / SIDE;
  const m = radiusKm / tileKm;
  const dxs = [0, ...(fx < m ? [-1] : []), ...(fx > 1 - m ? [1] : [])];
  const dys = [0, ...(fy < m ? [-1] : []), ...(fy > 1 - m ? [1] : [])];
  const jobs: Promise<Tile>[] = [];
  for (const dy of dys) {
    if (y + dy < 0 || y + dy >= SIDE) continue;
    for (const dx of dxs) jobs.push(loadTile((x + dx + SIDE) % SIDE, y + dy));
  }
  return Promise.all(jobs);
}

/** Towns within radiusKm of p, nearest first. */
export async function townsNear(p: LatLon, radiusKm: number): Promise<(Town & { distanceKm: number })[]> {
  const out: (Town & { distanceKm: number })[] = [];
  for (const tile of await tilesAround(p, radiusKm)) {
    for (const town of tile.towns) {
      const distanceKm = haversineKm(p, town);
      if (distanceKm <= radiusKm) out.push({ ...town, distanceKm });
    }
  }
  return out.sort((a, b) => a.distanceKm - b.distanceKm);
}

/** Whether p is sea (open or named), from the coarse grid of its tile; land where the tile has none. */
export async function seaAt(p: LatLon): Promise<boolean> {
  const { x, y, fx, fy } = locate(p);
  const own = await loadTile(x, y);
  if (!own.grid) return false;
  const c = Math.min(own.side - 1, Math.floor(fx * own.side));
  const r = Math.min(own.side - 1, Math.floor(fy * own.side));
  const cell = own.grid[r * own.side + c];
  return cell === 1 || (cell >= 2 && own.names[cell - 2]?.[1] === 's');
}

/**
 * What is under p: a sea (named, or "open sea"), else the nearest town within NEAREST_TOWN_KM,
 * else a named region, else "open countryside". A town carries the region it sits in, if any.
 */
export async function nearestPlace(p: LatLon): Promise<Place> {
  const { x, y, fx, fy } = locate(p);
  const own = await loadTile(x, y);
  let cell = 0;
  if (own.grid) {
    const c = Math.min(own.side - 1, Math.floor(fx * own.side));
    const r = Math.min(own.side - 1, Math.floor(fy * own.side));
    cell = own.grid[r * own.side + c];
  }
  const named = cell >= 2 ? own.names[cell - 2] : undefined;
  if (cell === 1) return { kind: 'sea', name: 'open sea', generic: true };
  if (named?.[1] === 's') return { kind: 'sea', name: named[0] };

  const region = named?.[0];
  const [town] = await townsNear(p, NEAREST_TOWN_KM);
  if (town) return { kind: 'town', name: town.name, country: town.country, distanceKm: town.distanceKm, ...(region ? { region } : {}) };
  if (region) return { kind: 'region', name: region };
  return { kind: 'region', name: 'open countryside', generic: true };
}
