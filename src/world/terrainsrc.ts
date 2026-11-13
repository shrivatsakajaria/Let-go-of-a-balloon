/**
 * Terrain tile source: Mapterhorn (Terrarium-encoded WebP) via PMTiles range requests, with
 * fallbacks to Mapterhorn's XYZ endpoint and then AWS Terrain Tiles. Runs in a Web Worker.
 */
import { PMTiles } from 'pmtiles';
import {
  ROUTE_GROUND_ZOOM,
  TERRAIN_AWS,
  TERRAIN_AWS_MAX_ZOOM,
  TERRAIN_PLANET_MAX_ZOOM,
  TERRAIN_PLANET_PMTILES,
  TERRAIN_REGIONAL_INDEX,
  TERRAIN_XYZ,
} from '../config';
import { lonLatToTile, wrapLon, type LatLon } from '../geo/coords';
import { decodeTerrarium } from './terrain';

/** Elevation tile in metres, row 0 = north. `size` is 512 (Mapterhorn) or 256 (AWS fallback). */
export type TerrainTile = { heights: Float32Array; size: number };
export type TileLoader = (z: number, x: number, y: number) => Promise<TerrainTile>;
export type TerrainSource = 'pmtiles' | 'regional' | 'xyz' | 'aws';

let lastSource: TerrainSource | null = null;
/** Which source answered most recently (for diagnostics). */
export const lastTerrainSource = (): TerrainSource | null => lastSource;

async function decodeImage(blob: Blob): Promise<TerrainTile> {
  const bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const size = bmp.width;
  const canvas = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('no 2d context');
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  const { data } = ctx.getImageData(0, 0, size, size);
  return { heights: decodeTerrarium(data, size), size };
}

/**
 * Crop the sub-square of a parent tile (pz, px, py) that child tile (z, x, y) covers and bilinearly
 * upsample it back to the parent's size. Pixel centres are respected; edges clamp.
 */
export function overzoomTile(parent: TerrainTile, pz: number, px: number, py: number, z: number, x: number, y: number): TerrainTile {
  const { heights, size } = parent;
  const scale = 2 ** (z - pz);
  const out = new Float32Array(size * size);
  const colU = new Float32Array(size);
  for (let i = 0; i < size; i++) colU[i] = ((x + (i + 0.5) / size) / scale - px) * size - 0.5;
  for (let r = 0; r < size; r++) {
    const v = Math.min(size - 1, Math.max(0, ((y + (r + 0.5) / size) / scale - py) * size - 0.5));
    const y0 = Math.min(size - 2, Math.floor(v));
    const fy = v - y0;
    for (let c = 0; c < size; c++) {
      const u = Math.min(size - 1, Math.max(0, colU[c]));
      const x0 = Math.min(size - 2, Math.floor(u));
      const fx = u - x0;
      const a = heights[y0 * size + x0], b = heights[y0 * size + x0 + 1];
      const cc = heights[(y0 + 1) * size + x0], d = heights[(y0 + 1) * size + x0 + 1];
      out[r * size + c] = (a * (1 - fx) + b * fx) * (1 - fy) + (cc * (1 - fx) + d * fx) * fy;
    }
  }
  return { heights: out, size };
}

// ---- PMTiles (planet + regional) ----

let planet: PMTiles | null = null;
async function pmtilesTile(archive: PMTiles, z: number, x: number, y: number): Promise<TerrainTile | null> {
  const res = await archive.getZxy(z, x, y);
  if (!res) return null;
  return decodeImage(new Blob([res.data], { type: 'image/webp' }));
}

type RegionalItem = { url: string; min_lon: number; min_lat: number; max_lon: number; max_lat: number; min_zoom: number; max_zoom: number };
let regionalIndex: Promise<RegionalItem[]> | null = null;
const regionalArchives = new Map<string, PMTiles>();

function regionalFor(items: RegionalItem[], z: number, lon: number, lat: number): RegionalItem | null {
  let best: RegionalItem | null = null;
  for (const it of items) {
    if (it.max_zoom <= TERRAIN_PLANET_MAX_ZOOM) continue;
    if (lon < it.min_lon || lon > it.max_lon || lat < it.min_lat || lat > it.max_lat) continue;
    if (!best || it.max_zoom > best.max_zoom) best = it;
  }
  return best && z >= best.min_zoom ? best : null;
}

/** A regional high-resolution tile for z13+, or null if no archive covers it. */
async function regionalTile(z: number, x: number, y: number): Promise<TerrainTile | null> {
  try {
    regionalIndex ??= fetch(TERRAIN_REGIONAL_INDEX)
      .then((r) => {
        if (!r.ok) throw new Error(`index ${r.status}`);
        return r.json();
      })
      .then((j: { items: RegionalItem[] }) => j.items);
    const items = await regionalIndex;
    const n = 2 ** z;
    const lon = ((x + 0.5) / n) * 360 - 180;
    const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 0.5)) / n))) * 180) / Math.PI;
    const item = regionalFor(items, z, lon, lat);
    if (!item) return null;
    let arc = regionalArchives.get(item.url);
    if (!arc) regionalArchives.set(item.url, (arc = new PMTiles(item.url)));
    const zz = Math.min(z, item.max_zoom);
    const s = z - zz;
    const t = await pmtilesTile(arc, zz, x >> s, y >> s);
    if (!t) return null;
    lastSource = 'regional';
    return s ? overzoomTile(t, zz, x >> s, y >> s, z, x, y) : t;
  } catch {
    regionalIndex = null; // retry the index next time; caller falls back to z12 overzoom
    return null;
  }
}

// ---- URL fallbacks ----

async function urlTile(template: string, z: number, x: number, y: number): Promise<TerrainTile> {
  const url = template.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
  const res = await fetch(url);
  if (!res.ok) throw new Error(`terrain ${res.status} ${url}`);
  return decodeImage(await res.blob());
}

async function fetchTile(z: number, x: number, y: number): Promise<TerrainTile> {
  const maxZ = TERRAIN_PLANET_MAX_ZOOM;
  const n = 2 ** z;
  const xw = ((x % n) + n) % n;
  const s = Math.max(0, z - maxZ);
  // 1. PMTiles (planet for z<=12; regional for z13+ if present; else overzoom z12)
  try {
    if (s > 0) {
      const reg = await regionalTile(z, xw, y);
      if (reg) return reg;
    }
    planet ??= new PMTiles(TERRAIN_PLANET_PMTILES);
    const t = await pmtilesTile(planet, z - s, xw >> s, y >> s);
    if (t) {
      lastSource = 'pmtiles';
      return s ? overzoomTile(t, maxZ, xw >> s, y >> s, z, xw, y) : t;
    }
  } catch {
    /* fall through to the XYZ endpoint */
  }
  // 2. Mapterhorn XYZ
  try {
    const t = await urlTile(TERRAIN_XYZ, z - s, xw >> s, y >> s);
    lastSource = 'xyz';
    return s ? overzoomTile(t, maxZ, xw >> s, y >> s, z, xw, y) : t;
  } catch {
    /* fall through to AWS */
  }
  // 3. AWS Terrain Tiles (256 px, max z15)
  const zz = Math.min(z, TERRAIN_AWS_MAX_ZOOM);
  const a = z - zz;
  const t = await urlTile(TERRAIN_AWS, zz, xw >> a, y >> a);
  lastSource = 'aws';
  return a ? overzoomTile(t, zz, xw >> a, y >> a, z, xw, y) : t;
}

const inflight = new Map<string, Promise<TerrainTile>>();
const MAX_CACHED = 64;

/**
 * Elevation tile (z, x, y) in metres. `size` is 512 for Mapterhorn, 256 for the AWS fallback.
 * (Deviation from a bare Float32Array because the size varies by source.) Decoded tiles and
 * in-flight requests are cached; failures are not.
 */
export function terrainTile(z: number, x: number, y: number): Promise<TerrainTile> {
  const key = `${z}/${x}/${y}`;
  let p = inflight.get(key);
  if (!p) {
    p = fetchTile(z, x, y);
    inflight.set(key, p);
    p.catch(() => inflight.delete(key));
    if (inflight.size > MAX_CACHED) inflight.delete(inflight.keys().next().value as string);
  }
  return p;
}

let seaTile: TerrainTile | null = null;

/**
 * Tile loader for the route ground. Mapterhorn leaves fully submerged tiles out of the planet
 * archive, and the route floors the ground at 0 m, so a tile the archive does not have is open sea
 * (0 m) and needs no further requests. Only an archive error goes to the fallback sources.
 */
export function makeRouteTileLoader(
  planetTile: (z: number, x: number, y: number) => Promise<TerrainTile | null>,
  fallback: TileLoader,
): TileLoader {
  return async (z, x, y) => {
    let t: TerrainTile | null;
    try {
      t = await planetTile(z, x, y);
    } catch {
      return fallback(z, x, y);
    }
    return t ?? (seaTile ??= { heights: new Float32Array(512 * 512), size: 512 });
  };
}

async function planetTile(z: number, x: number, y: number): Promise<TerrainTile | null> {
  planet ??= new PMTiles(TERRAIN_PLANET_PMTILES);
  const t = await pmtilesTile(planet, z, x, y);
  if (t) lastSource = 'pmtiles';
  return t;
}

/** Route ground: async height, plus `peek` that answers synchronously once the tiles are loaded. */
export type RouteGroundFn = ((p: LatLon) => Promise<number>) & { peek: (p: LatLon) => number | undefined };

/**
 * Build a ground-height function for the route: the highest of the 3 x 3 pixels around the point,
 * at zoom ROUTE_GROUND_ZOOM, floored at 0 so the sea counts as 0 m. Tiles are cached and in-flight
 * fetches deduped; the window may straddle tile edges. `peek` gives the same answer without waiting
 * when every tile it needs has loaded, else undefined. `load` is injectable for tests.
 */
export function makeRouteGround(load: TileLoader): RouteGroundFn {
  const cache = new Map<string, Promise<TerrainTile>>();
  const ready = new Map<string, TerrainTile>();
  const get = (z: number, x: number, y: number) => {
    const k = `${z}/${x}/${y}`;
    let p = cache.get(k);
    if (!p) {
      p = load(z, x, y);
      cache.set(k, p);
      p.then(
        (t) => void ready.set(k, t),
        () => void cache.delete(k),
      );
    }
    return p;
  };
  const z = ROUTE_GROUND_ZOOM;
  const n = 2 ** z;
  const centreOf = (p: LatLon) => {
    const t = lonLatToTile(p.lat, wrapLon(p.lon), z); // latitude is clamped to the Mercator limit inside
    const tx = Math.min(n - 1, Math.floor(t.x));
    const ty = Math.min(n - 1, Math.max(0, Math.floor(t.y)));
    return { t, tx, ty };
  };
  /** The 3 x 3 window's maximum, or the x, y of the first tile it needs that `tileAt` lacks. */
  const windowMax = (
    c: ReturnType<typeof centreOf>,
    centre: TerrainTile,
    tileAt: (x: number, y: number) => TerrainTile | undefined,
  ): number | { need: [number, number] } => {
    const { t, tx, ty } = c;
    const size = centre.size;
    const gx = Math.floor(t.x * size), gy = Math.floor(Math.min(t.y, n - 1e-9) * size);
    let best = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const px = gx + dx, py = gy + dy;
        const ttx = ((Math.floor(px / size) % n) + n) % n;
        const tty = Math.min(n - 1, Math.max(0, Math.floor(py / size)));
        const tile = ttx === tx && tty === ty ? centre : tileAt(ttx, tty);
        if (!tile) return { need: [ttx, tty] };
        const lx = ((px % size) + size) % size;
        const ly = py < 0 ? 0 : py >= n * size ? size - 1 : ((py % size) + size) % size;
        const h = tile.heights[Math.floor((ly * tile.size) / size) * tile.size + Math.floor((lx * tile.size) / size)];
        if (h > best) best = h;
      }
    }
    return best;
  };
  const peekTile = (x: number, y: number) => ready.get(`${z}/${x}/${y}`);
  const ground = async (p: LatLon): Promise<number> => {
    const c = centreOf(p);
    const centre = await get(z, c.tx, c.ty);
    for (;;) {
      const r = windowMax(c, centre, peekTile);
      if (typeof r === 'number') return r;
      await get(z, r.need[0], r.need[1]);
    }
  };
  const peek = (p: LatLon): number | undefined => {
    const c = centreOf(p);
    const centre = peekTile(c.tx, c.ty);
    if (!centre) return undefined;
    const r = windowMax(c, centre, peekTile);
    return typeof r === 'number' ? r : undefined;
  };
  return Object.assign(ground, { peek });
}

/** Real route ground function: Mapterhorn planet tiles at ROUTE_GROUND_ZOOM, cached. */
export const routeGround: RouteGroundFn = makeRouteGround(makeRouteTileLoader(planetTile, terrainTile));
