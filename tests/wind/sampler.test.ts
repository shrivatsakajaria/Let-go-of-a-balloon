import { test, expect, describe } from 'vitest';
import { WindField, loadManifest } from '../../src/wind/loader';
import { cruiseLevel } from '../../src/wind/sampler';
import { lonDelta } from '../../src/geo/coords';
import {
  ISSUED, HOUR, RUN, BASE, addCruise, addClimb, manifestJson, mockFetch, ghOf, CRUISE_LEVELS, CLIMB_LEVELS,
  type Files,
} from './helpers';

const AROUND = { lat: 53, lon: -2 };
const LATS = [30, 50, 70];
const LONS = [-40, -20, 0];
const SPAN: [number, number] = [ISSUED + 3 * HOUR, ISSUED + 9 * HOUR];

async function field(files: Files, htmlFallback = false): Promise<{ w: WindField; requests: string[] }> {
  files[`${BASE}/manifest.json`] = manifestJson([{ id: RUN, issued: '2026-11-12T18:00:00Z' }]);
  if (!files[`${BASE}/climb/${RUN}/tiles.json`]) files[`${BASE}/climb/${RUN}/tiles.json`] = '[]';
  const m = mockFetch(files, htmlFallback);
  const manifest = await loadManifest(BASE, m.fn, ISSUED + 6 * HOUR);
  return { w: new WindField(manifest, m.fn, BASE), requests: m.requests };
}

const stdCell = (uOf: (h: number, l: number) => number) => () => (h: number, l: number) => ({
  u: uOf(h, l), v: 0, gh: ghOf(CRUISE_LEVELS, l),
});

describe('sampler', () => {
  test('uniform 10 m/s westerly samples as u=10 anywhere in tile', async () => {
    const files: Files = {};
    await addCruise(files, RUN, LATS, LONS, [0], stdCell(() => 10));
    const { w } = await field(files);
    await w.prepare(AROUND, SPAN);
    const t = ISSUED + 6 * HOUR;
    expect(w.sample({ lat: 53, lon: -2 }, 1500, t).u).toBeCloseTo(10, 1);
    expect(w.sample({ lat: 51.3, lon: -19.4 }, 1500, t).u).toBeCloseTo(10, 1);
    expect(w.sample({ lat: 53, lon: -2 }, 1500, t).v).toBeCloseTo(0, 5);
  });

  test('vertical interpolation between 850 (gh 1500, u 10) and 700 (gh 3000, u 20) at 2250 m gives 15', async () => {
    const files: Files = {};
    const levels = [850, 700];
    await addCruise(files, RUN, LATS, LONS, [0], () => (_h, l) => ({ u: l === 0 ? 10 : 20, v: 0, gh: l === 0 ? 1500 : 3000 }), levels);
    const { w } = await field(files);
    await w.prepare(AROUND, SPAN);
    expect(w.sample(AROUND, 2250, ISSUED + 6 * HOUR).u).toBeCloseTo(15, 5);
  });

  test('time interpolation halfway between 0 h (u 10) and 3 h (u 16) gives 13', async () => {
    const files: Files = {};
    await addCruise(files, RUN, LATS, LONS, [0], stdCell((h) => 10 + 2 * h));
    const { w } = await field(files);
    await w.prepare(AROUND, [ISSUED, ISSUED + 6 * HOUR]);
    expect(w.sample(AROUND, 1500, ISSUED + 1.5 * HOUR).u).toBeCloseTo(13, 5);
  });

  test('sampling at lon 179.9 and -179.9 reads neighbouring tiles without a jump', async () => {
    const files: Files = {};
    // u rises 1 m/s per degree of longitude straight through the antimeridian.
    const cellFor = (_lat0: number, lon0: number) => (_h: number, l: number, _i: number, j: number) => ({
      u: 20 + lonDelta(180, lon0 + j), v: 0, gh: ghOf(CRUISE_LEVELS, l),
    });
    await addCruise(files, RUN, [-30, -10, 10], [140, 160, -180], [0], cellFor);
    const { w } = await field(files);
    await w.prepare({ lat: 5, lon: 179.9 }, SPAN);
    const t = ISSUED + 6 * HOUR;
    const east = w.sample({ lat: 5, lon: 179.9 }, 1500, t).u;
    const west = w.sample({ lat: 5, lon: -179.9 }, 1500, t).u;
    expect(east).toBeCloseTo(19.9, 5);
    expect(west).toBeCloseTo(20.1, 5);
  });

  test('below lowest level uses lowest level; above highest uses highest', async () => {
    const files: Files = {};
    await addCruise(files, RUN, LATS, LONS, [0], stdCell((_h, l) => 10 + 5 * l));
    const { w } = await field(files);
    await w.prepare(AROUND, SPAN);
    const t = ISSUED + 6 * HOUR;
    expect(w.sample(AROUND, 100, t).u).toBeCloseTo(10, 5); // 850 hPa
    expect(w.sample(AROUND, 9000, t).u).toBeCloseTo(35, 5); // 500 hPa
  });

  test('a level with gh <= 0 is ignored', async () => {
    const files: Files = {};
    const levels = [850, 700];
    await addCruise(files, RUN, LATS, LONS, [0], () => (_h, l) => ({ u: l === 0 ? 50 : 20, v: 0, gh: l === 0 ? 0 : 3000 }), levels);
    const { w } = await field(files);
    await w.prepare(AROUND, SPAN);
    expect(w.sample(AROUND, 1000, ISSUED + 6 * HOUR).u).toBeCloseTo(20, 5);
  });

  test('climb tile is used below the 850 hPa height, cruise above it', async () => {
    const files: Files = {};
    await addCruise(files, RUN, LATS, LONS, [0, 1], stdCell(() => 10));
    await addClimb(files, RUN, [[50, -5]], () => (_h, l) => ({ u: 6, v: 0, gh: ghOf(CLIMB_LEVELS, l) }));
    const { w } = await field(files);
    await w.prepare(AROUND, [SPAN[0], ISSUED + 31 * HOUR]);
    const t = ISSUED + 6 * HOUR;
    expect(w.sample(AROUND, 1000, t).u).toBeCloseTo(3, 5); // raw 6 at scale 0.5
    expect(w.sample(AROUND, 2000, t).u).toBeCloseTo(10, 5);
    expect(w.sample(AROUND, 1000, ISSUED + 30 * HOUR).u).toBeCloseTo(10, 5); // beyond climb hours
  });

  test('climb tile missing (not listed) -> cruise used and never requested', async () => {
    const files: Files = {};
    await addCruise(files, RUN, LATS, LONS, [0], stdCell(() => 10));
    await addClimb(files, RUN, [[50, -5]], () => (_h, l) => ({ u: 6, v: 0, gh: ghOf(CLIMB_LEVELS, l) }), []);
    const { w, requests } = await field(files);
    await w.prepare(AROUND, SPAN);
    expect(w.sample(AROUND, 1000, ISSUED + 6 * HOUR).u).toBeCloseTo(10, 5);
    expect(requests.some((r) => r.includes('/climb/') && r.endsWith('.bin.gz'))).toBe(false);
  });

  test('climb tile listed but served as an HTML fallback -> cruise used', async () => {
    const files: Files = {};
    await addCruise(files, RUN, LATS, LONS, [0], stdCell(() => 10));
    files[`${BASE}/climb/${RUN}/tiles.json`] = '["50_-5"]';
    const { w } = await field(files, true);
    await w.prepare(AROUND, SPAN);
    expect(w.sample(AROUND, 1000, ISSUED + 6 * HOUR).u).toBeCloseTo(10, 5);
  });

  test('climb tile with every level below ground falls back to cruise', async () => {
    const files: Files = {};
    await addCruise(files, RUN, LATS, LONS, [0], stdCell(() => 10));
    await addClimb(files, RUN, [[50, -5]], () => () => ({ u: 99, v: 0, gh: 0 }));
    const { w } = await field(files);
    await w.prepare(AROUND, SPAN);
    expect(w.sample(AROUND, 1000, ISSUED + 6 * HOUR).u).toBeCloseTo(10, 5);
  });

  test('cruise window boundary hour (24 h) samples identically from window 0 and window 1', async () => {
    const files: Files = {};
    await addCruise(files, RUN, LATS, LONS, [0, 1], stdCell((h) => 10 + h / 3));
    const a = (await field({ ...files })).w;
    const b = (await field({ ...files })).w;
    await a.prepare(AROUND, [ISSUED, ISSUED + 23 * HOUR]); // window 0 only
    await b.prepare(AROUND, [ISSUED + 24 * HOUR, ISSUED + 30 * HOUR]); // window 1 only
    const t = ISSUED + 24 * HOUR;
    expect(a.sample(AROUND, 1500, t).u).toBeCloseTo(18, 5);
    expect(b.sample(AROUND, 1500, t).u).toBeCloseTo(18, 5);
    expect(b.sample(AROUND, 1500, ISSUED + 25.5 * HOUR).u).toBeCloseTo(18 + 0.5, 5);
  });

  test('sample throws TileNotReadyError for an unprepared tile', async () => {
    const files: Files = {};
    await addCruise(files, RUN, LATS, LONS, [0], stdCell(() => 10));
    const { w } = await field(files);
    await w.prepare(AROUND, SPAN);
    expect(() => w.sample({ lat: -50, lon: 100 }, 1500, ISSUED + 6 * HOUR)).toThrow(/not prepared/);
  });
});

describe('cruiseLevel', () => {
  const H = { 850: 1500, 700: 3000, 600: 4200, 500: 5600 };
  test('850 when it clears the ground by 600 m', () => {
    expect(cruiseLevel(900, H)).toBe(850);
    expect(cruiseLevel(901, H)).toBe(700);
  });
  test('otherwise the lowest of 700, 600, 500 that clears', () => {
    expect(cruiseLevel(2400, H)).toBe(700);
    expect(cruiseLevel(2401, H)).toBe(600);
    expect(cruiseLevel(3601, H)).toBe(500);
  });
  test('500 when nothing clears', () => {
    expect(cruiseLevel(9000, H)).toBe(500);
  });
});

test('cruiseLevelHeight reads level heights at the point and applies the rule', async () => {
  const files: Files = {};
  await addCruise(files, RUN, LATS, LONS, [0], stdCell(() => 10));
  const { w } = await field(files);
  await w.prepare(AROUND, SPAN);
  const t = ISSUED + 6 * HOUR;
  expect(w.cruiseLevelHeight(AROUND, t, 500)).toEqual({ levelHpa: 850, heightM: 1500 });
  expect(w.cruiseLevelHeight(AROUND, t, 1500)).toEqual({ levelHpa: 700, heightM: 3000 });
});
