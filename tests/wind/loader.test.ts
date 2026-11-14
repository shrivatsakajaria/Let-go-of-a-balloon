import { describe, test, expect, vi, afterEach } from 'vitest';
import { WindField, WindUnavailableError, loadManifest } from '../../src/wind/loader';
import { ISSUED, HOUR, BASE, addCruise, manifestJson, mockFetch, ghOf, CRUISE_LEVELS, type Files } from './helpers';

const AROUND = { lat: 53, lon: -2 };
const LATS = [30, 50, 70];
const LONS = [-40, -20, 0];
const OLD = '2026111212';
const NEW = '2026111218';
const cell = (u: number) => () => (_h: number, l: number) => ({ u, v: 0, gh: ghOf(CRUISE_LEVELS, l) });

const twoRuns = () => ({
  [`${BASE}/manifest.json`]: manifestJson([
    { id: NEW, issued: '2026-11-12T18:00:00Z' },
    { id: OLD, issued: '2026-11-12T12:00:00Z' },
  ]),
  [`${BASE}/climb/${OLD}/tiles.json`]: '[]',
  [`${BASE}/climb/${NEW}/tiles.json`]: '[]',
});

test('a run that cannot cover the whole 72 h flight is dropped: a f096 run 25 h old', async () => {
  const m = mockFetch({ [`${BASE}/manifest.json`]: manifestJson([{ id: NEW, issued: '2026-11-12T18:00:00Z' }]) });
  await expect(loadManifest(BASE, m.fn, ISSUED + 25 * HOUR)).rejects.toBeInstanceOf(WindUnavailableError);
});

test('f096 runs: only runs that still cover the flight (under ~24 h old) are kept, newest first', async () => {
  const m = mockFetch(twoRuns());
  const man = await loadManifest(BASE, m.fn, ISSUED + 10 * HOUR); // OLD is 16 h old, NEW 10 h
  expect(man.runs.map((r) => r.id)).toEqual([NEW, OLD]);
  const man2 = await loadManifest(BASE, m.fn, ISSUED + 20 * HOUR); // OLD is 26 h old
  expect(man2.runs.map((r) => r.id)).toEqual([NEW]);
});

describe('f120 runs (R59): a run is usable up to 48 h old, while it covers the whole flight', () => {
  const f120 = (runs: { id: string; issued: string; lastHour?: number }[]) =>
    mockFetch({ [`${BASE}/manifest.json`]: manifestJson(runs.map((r) => ({ lastHour: 120, ...r }))) });

  test('a f120 run 40 h old is kept (it covers 40 + 72 = 112 h)', async () => {
    const m = f120([{ id: NEW, issued: '2026-11-12T18:00:00Z' }]);
    const man = await loadManifest(BASE, m.fn, ISSUED + 40 * HOUR);
    expect(man.runs.map((r) => r.id)).toEqual([NEW]);
  });

  test('a f120 run 47 h old is kept; at 48 h it is not (its winds end before the landing)', async () => {
    const m = f120([{ id: NEW, issued: '2026-11-12T18:00:00Z' }]);
    expect((await loadManifest(BASE, m.fn, ISSUED + 47 * HOUR)).runs).toHaveLength(1);
    await expect(loadManifest(BASE, m.fn, ISSUED + 48 * HOUR)).rejects.toBeInstanceOf(WindUnavailableError);
  });

  test('a run is never used past 48 h, even if it had more hours', async () => {
    const m = f120([{ id: NEW, issued: '2026-11-12T18:00:00Z', lastHour: 168 }]);
    expect((await loadManifest(BASE, m.fn, ISSUED + 47 * HOUR)).runs).toHaveLength(1);
    await expect(loadManifest(BASE, m.fn, ISSUED + 49 * HOUR)).rejects.toThrow(/48 h/);
  });

  test('mixed manifest (after the switch to f120): an old f096 run that no longer covers is dropped', async () => {
    const m = f120([
      { id: NEW, issued: '2026-11-12T18:00:00Z' },
      { id: OLD, issued: '2026-11-12T12:00:00Z', lastHour: 96 },
    ]);
    // OLD is 30 h old: under 48 h, but its winds end at 96 h, before the landing at 30 + 72 = 102 h
    const man = await loadManifest(BASE, m.fn, ISSUED + 24 * HOUR);
    expect(man.runs.map((r) => r.id)).toEqual([NEW]);
  });

  test('a newer run that does not reach the landing is skipped for an older one that does', async () => {
    const m = f120([
      { id: NEW, issued: '2026-11-12T18:00:00Z', lastHour: 72 },
      { id: OLD, issued: '2026-11-12T12:00:00Z' },
    ]);
    const man = await loadManifest(BASE, m.fn, ISSUED + 2 * HOUR);
    expect(man.runs.map((r) => r.id)).toEqual([OLD]);
  });

  test('a 40 h old run: the flight reads cruise windows 1 to 4 and samples the landing hour', async () => {
    const files: Files = {
      [`${BASE}/manifest.json`]: manifestJson([{ id: NEW, issued: '2026-11-12T18:00:00Z', lastHour: 120 }]),
      [`${BASE}/climb/${NEW}/tiles.json`]: '[]',
    };
    await addCruise(files, NEW, LATS, LONS, [1, 2, 3, 4], cell(9));
    const m = mockFetch(files);
    const now = ISSUED + 40 * HOUR;
    const w = new WindField(await loadManifest(BASE, m.fn, now), m.fn, BASE);
    await w.prepare(AROUND, [now, now + 72 * HOUR], { radius: 0 });
    const tiles = m.requests.filter((r) => r.endsWith('.bin.gz')).map((r) => r.replace(/.*_(\d)\.bin\.gz$/, '$1'));
    expect(tiles.sort()).toEqual(['1', '2', '3', '4']);
    expect(w.sample(AROUND, 1500, now + 72 * HOUR).u).toBeCloseTo(9, 5);
    expect(w.has(AROUND, now + 72 * HOUR)).toBe(true);
  });
});

test('manifest served as HTML (Pages fallback) is unavailable', async () => {
  const m = mockFetch({}, true);
  await expect(loadManifest(BASE, m.fn, ISSUED)).rejects.toBeInstanceOf(WindUnavailableError);
});

test('newest run 404 falls back to previous run', async () => {
  const files: Files = twoRuns();
  await addCruise(files, OLD, LATS, LONS, [0], cell(7));
  const m = mockFetch(files);
  const w = new WindField(await loadManifest(BASE, m.fn, ISSUED + 10 * HOUR), m.fn, BASE);
  expect(w.runId).toBe(NEW);
  await w.prepare(AROUND, [ISSUED + 6 * HOUR, ISSUED + 9 * HOUR]);
  expect(w.runId).toBe(OLD);
  expect(w.runIssuedMs).toBe(Date.parse('2026-11-12T12:00:00Z'));
  expect(w.sample(AROUND, 1500, ISSUED + 6 * HOUR).u).toBeCloseTo(7, 5);
});

test('has() says whether the winds at a place and time are in, and loads nothing', async () => {
  const files: Files = twoRuns();
  await addCruise(files, NEW, LATS, LONS, [0], cell(7));
  const m = mockFetch(files);
  const w = new WindField(await loadManifest(BASE, m.fn, ISSUED + 10 * HOUR), m.fn, BASE);
  const asked = m.requests.length;
  expect(w.has(AROUND, ISSUED + 6 * HOUR)).toBe(false);
  expect(m.requests.length).toBe(asked);
  await w.prepare(AROUND, [ISSUED + 6 * HOUR, ISSUED + 9 * HOUR]);
  expect(w.has(AROUND, ISSUED + 6 * HOUR)).toBe(true);
  expect(w.has({ lat: -60, lon: 100 }, ISSUED + 6 * HOUR)).toBe(false);
  expect(w.runId).toBe(NEW);
});

test('newest run tiles served as HTML (Pages fallback) are treated as missing', async () => {
  const files: Files = twoRuns();
  await addCruise(files, OLD, LATS, LONS, [0], cell(7));
  const m = mockFetch(files, true);
  const w = new WindField(await loadManifest(BASE, m.fn, ISSUED + 10 * HOUR), m.fn, BASE);
  await w.prepare(AROUND, [ISSUED + 6 * HOUR, ISSUED + 9 * HOUR]);
  expect(w.runId).toBe(OLD);
});

test('no usable run -> WindUnavailableError', async () => {
  const m = mockFetch(twoRuns());
  const w = new WindField(await loadManifest(BASE, m.fn, ISSUED + 10 * HOUR), m.fn, BASE);
  await expect(w.prepare(AROUND, [ISSUED + 6 * HOUR, ISSUED + 9 * HOUR])).rejects.toBeInstanceOf(WindUnavailableError);
});

test('after the first successful prepare the run is pinned and a missing tile throws', async () => {
  const files: Files = twoRuns();
  await addCruise(files, NEW, LATS, LONS, [0], cell(10));
  await addCruise(files, OLD, [-70, -50, -30], LONS, [0], cell(7)); // would serve a far-away place
  const m = mockFetch(files);
  const w = new WindField(await loadManifest(BASE, m.fn, ISSUED + 10 * HOUR), m.fn, BASE);
  const span: [number, number] = [ISSUED + 6 * HOUR, ISSUED + 9 * HOUR];
  await w.prepare(AROUND, span);
  await expect(w.prepare({ lat: -40, lon: -20 }, span)).rejects.toBeInstanceOf(WindUnavailableError);
  expect(w.runId).toBe(NEW);
});

test('in-flight requests are deduplicated', async () => {
  const files: Files = twoRuns();
  await addCruise(files, NEW, LATS, LONS, [0], cell(10));
  const m = mockFetch(files);
  const w = new WindField(await loadManifest(BASE, m.fn, ISSUED + 10 * HOUR), m.fn, BASE);
  const span: [number, number] = [ISSUED + 6 * HOUR, ISSUED + 9 * HOUR];
  await Promise.all([w.prepare(AROUND, span), w.prepare(AROUND, span)]);
  const tiles = m.requests.filter((r) => r.endsWith('.bin.gz'));
  expect(new Set(tiles).size).toBe(tiles.length);
  expect(tiles.length).toBe(9);
});

test('a transient network failure is not cached: the next prepare retries', async () => {
  const files: Files = twoRuns();
  await addCruise(files, NEW, LATS, LONS, [0], cell(10));
  const m = mockFetch(files);
  let failNext = true;
  const flaky = async (url: string): Promise<Response> => {
    if (failNext && url.includes('/cruise/')) {
      failNext = false;
      throw new TypeError('network down');
    }
    return m.fn(url);
  };
  const w = new WindField(await loadManifest(BASE, m.fn, ISSUED + 10 * HOUR), flaky, BASE);
  const span: [number, number] = [ISSUED + 6 * HOUR, ISSUED + 9 * HOUR];
  await expect(w.prepare(AROUND, span)).rejects.toBeInstanceOf(WindUnavailableError);
  (w as unknown as { runIdx: number }).runIdx = 0; // the failed first prepare advanced to the next run; retry on the original
  await w.prepare(AROUND, span);
  expect(w.sample(AROUND, 1500, ISSUED + 6 * HOUR).u).toBeCloseTo(10, 5);
});

test('prepare with radius 0 requests only the tile under the point, one per window', async () => {
  const files: Files = twoRuns();
  await addCruise(files, NEW, LATS, LONS, [0], cell(10));
  const m = mockFetch(files);
  const w = new WindField(await loadManifest(BASE, m.fn, ISSUED + 10 * HOUR), m.fn, BASE);
  await w.prepare(AROUND, [ISSUED + 6 * HOUR, ISSUED + 9 * HOUR], { radius: 0 });
  const tiles = m.requests.filter((r) => r.endsWith('.bin.gz'));
  expect(tiles).toHaveLength(1);
  expect(w.sample(AROUND, 1500, ISSUED + 6 * HOUR).u).toBeCloseTo(10, 5);
});

// Browsers throw "Illegal invocation" when fetch is called with a `this` other than the window.
afterEach(() => vi.unstubAllGlobals());
function pickyFetch() {
  const calls: string[] = [];
  vi.stubGlobal('fetch', function (this: unknown, url: string) {
    if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation');
    calls.push(String(url));
    const body = url.endsWith('/manifest.json') ? manifestJson([{ id: NEW, issued: '2026-11-12T18:00:00Z' }]) : 'nope';
    return Promise.resolve(new Response(body, { status: url.endsWith('/manifest.json') ? 200 : 404 }));
  });
  return calls;
}

test('the default fetch is called without a borrowed this (loadManifest and WindField)', async () => {
  const calls = pickyFetch();
  const manifest = await loadManifest(BASE, undefined, ISSUED + HOUR);
  const field = new WindField(manifest, undefined, BASE);
  const t0 = Date.parse('2026-11-12T18:00:00Z');
  await field.prepare(AROUND, [t0, t0 + 6 * HOUR]).catch(() => undefined);
  expect(calls.length).toBeGreaterThan(1);
  expect(calls.some((u) => u.includes('/cruise/'))).toBe(true);
});
