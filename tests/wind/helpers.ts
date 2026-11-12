/// <reference types="node" />
// Test helpers: synthetic wind tiles in the Python writer's layout, and an in-memory fetch.

export interface TileSpec {
  lat0: number;
  lon0: number;
  res: number;
  scale: number;
  nLat: number;
  nLon: number;
  levels: number[];
  hours: number[];
  /** Returns raw u, v (units of scale) and gh (m) for a cell. */
  cell: (hour: number, level: number, i: number, j: number) => { u: number; v: number; gh: number };
}

export function encodeTile(s: TileSpec): Uint8Array {
  const nL = s.levels.length;
  const nH = s.hours.length;
  const n = s.nLat * s.nLon;
  const head = 27 + 2 * (nL + nH);
  const buf = new ArrayBuffer(head + nH * nL * 4 * n);
  const dv = new DataView(buf);
  'WIND'.split('').forEach((c, k) => dv.setUint8(k, c.charCodeAt(0)));
  dv.setUint8(4, 1);
  dv.setUint8(5, nL);
  dv.setUint8(6, nH);
  dv.setUint16(7, s.nLat, true);
  dv.setUint16(9, s.nLon, true);
  dv.setFloat32(11, s.lat0, true);
  dv.setFloat32(15, s.lon0, true);
  dv.setFloat32(19, s.res, true);
  dv.setFloat32(23, s.scale, true);
  s.levels.forEach((l, k) => dv.setInt16(27 + 2 * k, l, true));
  s.hours.forEach((h, k) => dv.setInt16(27 + 2 * (nL + k), h, true));
  let off = head;
  for (const h of s.hours) {
    for (let l = 0; l < nL; l++) {
      for (const field of ['u', 'v'] as const) {
        for (let i = 0; i < s.nLat; i++) {
          for (let j = 0; j < s.nLon; j++) dv.setInt8(off++, s.cell(h, l, i, j)[field]);
        }
      }
      for (let i = 0; i < s.nLat; i++) {
        for (let j = 0; j < s.nLon; j++) {
          dv.setInt16(off, s.cell(h, l, i, j).gh, true);
          off += 2;
        }
      }
    }
  }
  return new Uint8Array(buf);
}

export async function gzip(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Response(data as BodyInit).body!.pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Cell function with a constant value per (hour, level): ignores position. */
export function uniform(
  f: (hour: number, level: number) => { u: number; v?: number; gh: number },
): TileSpec['cell'] {
  return (h, l) => {
    const r = f(h, l);
    return { u: r.u, v: r.v ?? 0, gh: r.gh };
  };
}

export type Files = Record<string, Uint8Array | string>;

export interface MockFetch {
  fn: (url: string) => Promise<Response>;
  requests: string[];
}

/**
 * In-memory fetch. Missing paths answer 404, or, with htmlFallback, 200 with an HTML page (as
 * Cloudflare Pages does).
 */
export function mockFetch(files: Files, htmlFallback = false): MockFetch {
  const requests: string[] = [];
  const fn = async (url: string): Promise<Response> => {
    requests.push(url);
    const f = files[url];
    if (f === undefined) {
      return htmlFallback
        ? new Response('<!doctype html><title>app</title>', { status: 200 })
        : new Response('not found', { status: 404 });
    }
    return new Response(f as BodyInit, { status: 200 });
  };
  return { fn, requests };
}

export function manifestJson(
  runs: { id: string; issued: string }[],
): string {
  return JSON.stringify({
    runs: runs.map((r) => ({
      ...r,
      hours: Array.from({ length: 33 }, (_, k) => 3 * k),
      climb: { tileDeg: 5, res: 0.25, hours: [3, 6, 9, 12, 15, 18, 21, 24], scale: 0.5 },
      cruise: { tileDeg: 20, res: 1.0, windowHours: 24, scale: 1.0 },
    })),
  });
}

export const CRUISE_LEVELS = [850, 800, 750, 700, 600, 500];
export const CLIMB_LEVELS = [1000, 975, 950, 925, 900, 850];

/** A 21x21 cruise tile with the given hours, using a per-(hour, level) cell function. */
export function cruiseSpec(lat0: number, lon0: number, hours: number[], cell: TileSpec['cell'], levels = CRUISE_LEVELS): TileSpec {
  return { lat0, lon0, res: 1, scale: 1, nLat: 21, nLon: 21, levels, hours, cell };
}
export function climbSpec(lat0: number, lon0: number, hours: number[], cell: TileSpec['cell'], levels = CLIMB_LEVELS): TileSpec {
  return { lat0, lon0, res: 0.25, scale: 0.5, nLat: 21, nLon: 21, levels, hours, cell };
}
export const WINDOW_HOURS = (w: number): number[] => Array.from({ length: 9 }, (_, k) => 24 * w + 3 * k);

/** Heights (m) for the standard levels, used when a test does not care about vertical structure. */
export const STD_GH: Record<number, number> = {
  1000: 100, 975: 330, 950: 540, 925: 760, 900: 990, 850: 1500, 800: 2000, 750: 2500, 700: 3000, 600: 4200, 500: 5600,
};

export const RUN = '2026111218';
export const ISSUED = Date.parse('2026-11-12T18:00:00Z');
export const HOUR = 3.6e6;
export const BASE = '/winds';

export type CellFor = (lat0: number, lon0: number) => TileSpec['cell'];

/** Add gzipped cruise tiles for every (lat0, lon0, window) combination to files. */
export async function addCruise(
  files: Files,
  run: string,
  lats: number[],
  lons: number[],
  windows: number[],
  cellFor: CellFor,
  levels = CRUISE_LEVELS,
): Promise<void> {
  for (const lat0 of lats) {
    for (const lon0 of lons) {
      for (const w of windows) {
        files[`${BASE}/cruise/${run}/${lat0}_${lon0}_${w}.bin.gz`] = await gzip(
          encodeTile(cruiseSpec(lat0, lon0, WINDOW_HOURS(w), cellFor(lat0, lon0), levels)),
        );
      }
    }
  }
}

/** Add climb tiles and a tiles.json listing `listed` (default: the tiles added). */
export async function addClimb(
  files: Files,
  run: string,
  tiles: [number, number][],
  cellFor: CellFor,
  listed?: string[],
  levels = CLIMB_LEVELS,
): Promise<void> {
  for (const [lat0, lon0] of tiles) {
    files[`${BASE}/climb/${run}/${lat0}_${lon0}.bin.gz`] = await gzip(
      encodeTile(climbSpec(lat0, lon0, [3, 6, 9, 12, 15, 18, 21, 24], cellFor(lat0, lon0), levels)),
    );
  }
  files[`${BASE}/climb/${run}/tiles.json`] = JSON.stringify(listed ?? tiles.map(([a, b]) => `${a}_${b}`));
}

/** Standard-atmosphere heights per level index of `levels`. */
export const ghOf = (levels: number[], l: number): number => STD_GH[levels[l]];
