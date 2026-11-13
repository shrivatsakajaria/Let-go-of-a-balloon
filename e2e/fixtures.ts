import { existsSync, readFileSync } from 'node:fs';
import type { BrowserContext } from '@playwright/test';
import { encodeBalloon, type SavedBalloon } from '../src/flight/codec';
import type { LatLon } from '../src/geo/coords';

/**
 * The live world with no live services (spec 12; browser tests never call them):
 *  - winds: the committed real run (tests/fixtures/wind/real), made fresh by stating it was issued 5 hours
 *    ago; the day-one window serves every window (hours past it clamp to its last hour);
 *  - map: OpenFreeMap's TileJSON points at a fixture template; Albert Square's z14 tile is the committed
 *    one, every other tile is empty (open sea);
 *  - terrain: an empty PMTiles archive, so every tile is sea level, and no regional archives;
 *  - the place-name gazetteer is this site's own files.
 * Anything else outside the local server is aborted and listed in `external`.
 */
export type LiveOpts = { windDelayMs?: number; windsDown?: boolean };

const WIND = new URL('../tests/fixtures/wind/real/', import.meta.url);
const PBF = readFileSync(new URL('../tests/fixtures/omt_14_8089_5300.pbf', import.meta.url));
const CORS = { 'Access-Control-Allow-Origin': '*' };
export const ALBERT_SQUARE: LatLon = { lat: 53.4794, lon: -2.2453 };

/** A valid PMTiles v3 archive with no tiles in it (header, an empty root directory, "{}" metadata). */
export function emptyPmtiles(): Buffer {
  const b = Buffer.alloc(130);
  b.write('PMTiles', 0, 'ascii');
  b.writeUInt8(3, 7);
  const u64 = (off: number, v: number) => b.writeBigUInt64LE(BigInt(v), off);
  u64(8, 127); // root directory
  u64(16, 1);
  u64(24, 128); // metadata
  u64(32, 2);
  u64(40, 130); // leaf directories
  u64(48, 0);
  u64(56, 130); // tile data
  u64(64, 0);
  b.writeUInt8(1, 97); // internal compression: none
  b.writeUInt8(1, 98); // tile compression: none
  b.writeUInt8(4, 99); // webp
  b.writeUInt8(0, 100);
  b.writeUInt8(12, 101);
  b.writeInt32LE(-1800000000, 102);
  b.writeInt32LE(-850000000, 106);
  b.writeInt32LE(1800000000, 110);
  b.writeInt32LE(850000000, 114);
  b.writeUInt8(0, 127); // the root directory: 0 entries
  b.write('{}', 128, 'ascii');
  return b;
}

export async function liveWorld(context: BrowserContext, opts: LiveOpts = {}) {
  const external: string[] = [];
  const winds: string[] = [];
  const pm = emptyPmtiles();
  // the page keeps its read-only test hook (window.__live) up to date only when asked
  await context.addInitScript(() => ((window as unknown as { __lgoabTest: boolean }).__lgoabTest = true));
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    if (local && url.pathname.startsWith('/winds/')) {
      winds.push(url.pathname);
      if (opts.windDelayMs) await new Promise((r) => setTimeout(r, opts.windDelayMs));
      if (opts.windsDown) return route.fulfill({ status: 503, body: '' }).catch(() => {});
      if (url.pathname === '/winds/manifest.json') {
        const m = JSON.parse(readFileSync(new URL('manifest.json', WIND), 'utf8'));
        m.runs[0].issued = new Date(Date.now() - 5 * 3600e3).toISOString();
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(m) }).catch(() => {});
      }
      const cruise = url.pathname.match(/^\/winds\/cruise\/(\d+)\/(-?\d+)_(-?\d+)_\d+\.bin\.gz$/);
      if (cruise) {
        const f = new URL(`cruise/${cruise[1]}/${cruise[2]}_${cruise[3]}_0.bin.gz`, WIND);
        if (existsSync(f)) return route.fulfill({ status: 200, contentType: 'application/octet-stream', body: readFileSync(f) }).catch(() => {});
      }
      return route.fulfill({ status: 404, body: 'not found' }).catch(() => {});
    }
    if (local) return route.continue().catch(() => {});
    if (url.hostname === 'tiles.openfreemap.org' && url.pathname === '/planet')
      return route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify({ tiles: ['https://tiles.openfreemap.org/fixture/{z}/{x}/{y}.pbf'] }) });
    if (url.hostname === 'tiles.openfreemap.org' && url.pathname.startsWith('/fixture/')) {
      if (url.pathname === '/fixture/14/8089/5300.pbf') return route.fulfill({ status: 200, contentType: 'application/x-protobuf', headers: CORS, body: PBF });
      return route.fulfill({ status: 204, headers: CORS, body: '' });
    }
    if (url.hostname === 'download.mapterhorn.com' && url.pathname === '/planet.pmtiles') {
      const m = (route.request().headers()['range'] ?? '').match(/bytes=(\d+)-(\d+)/);
      const from = m ? Number(m[1]) : 0;
      const to = Math.min(pm.length - 1, m ? Number(m[2]) : pm.length - 1);
      return route.fulfill({
        status: 206,
        headers: { 'Content-Range': `bytes ${from}-${to}/${pm.length}`, 'Content-Type': 'application/octet-stream', 'Access-Control-Allow-Origin': '*' },
        body: pm.subarray(from, to + 1),
      });
    }
    if (url.hostname === 'download.mapterhorn.com' && url.pathname === '/download_urls.json')
      return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: '{"items":[]}' });
    external.push(url.href);
    return route.abort('blockedbyclient');
  });
  return { external, winds };
}

/** Start the next visit at Albert Square, Manchester (where the fixture map tile is). */
export async function startAtAlbertSquare(context: BrowserContext) {
  await context.addInitScript((c) => {
    try {
      localStorage.setItem('lgoab.lastPlace.v1', c);
    } catch {
      /* ignore */
    }
  }, JSON.stringify({ name: 'Manchester', lat: ALBERT_SQUARE.lat, lon: ALBERT_SQUARE.lon, kind: 'search' }));
}

/** A balloon from Albert Square drifting east at 0.25 degrees an hour, released `hoursAgo` ago. */
export function eastward(hoursAgo: number, name = 'Manchester'): SavedBalloon {
  const release = Math.floor((Date.now() - hoursAgo * 3600e3) / 60000) * 60000;
  const hourly = Array.from({ length: 73 }, (_, i) => ({ lat: ALBERT_SQUARE.lat + 0.01 * i, lon: ALBERT_SQUARE.lon + 0.25 * i }));
  return { v: 1, name, start: { ...ALBERT_SQUARE }, release, hourly, runId: '2026111218' };
}

export async function linkTo(b: SavedBalloon): Promise<string> {
  return `/#b=${await encodeBalloon(b)}`;
}

/** WebGL on the software renderer, as on a machine with no GPU. */
export const SWIFTSHADER = { launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] } };
