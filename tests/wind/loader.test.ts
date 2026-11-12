import { test, expect } from 'vitest';
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

test('newest run older than 24 h throws WindUnavailableError', async () => {
  const m = mockFetch({ [`${BASE}/manifest.json`]: manifestJson([{ id: NEW, issued: '2026-11-12T18:00:00Z' }]) });
  await expect(loadManifest(BASE, m.fn, ISSUED + 25 * HOUR)).rejects.toBeInstanceOf(WindUnavailableError);
});

test('only runs under 24 h old are kept, newest first', async () => {
  const m = mockFetch(twoRuns());
  const man = await loadManifest(BASE, m.fn, ISSUED + 10 * HOUR); // OLD is 16 h old, NEW 10 h
  expect(man.runs.map((r) => r.id)).toEqual([NEW, OLD]);
  const man2 = await loadManifest(BASE, m.fn, ISSUED + 20 * HOUR); // OLD is 26 h old
  expect(man2.runs.map((r) => r.id)).toEqual([NEW]);
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
