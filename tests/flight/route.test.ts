import { test, expect } from 'vitest';
import { altitudeAt, cruiseLevel } from '../../src/flight/ascent';
import { computeRoute, positionAt, routeFromHourly, type Route } from '../../src/flight/route';
import { WindField, loadManifest } from '../../src/wind/loader';
import { haversineKm, type LatLon } from '../../src/geo/coords';
import { ISSUED, HOUR, BASE, RUN, addCruise, manifestJson, mockFetch, ghOf, CRUISE_LEVELS, type Files } from '../wind/helpers';

async function makeWind(lats: number[], lons: number[], u: number, v = 0, gh?: (l: number) => number): Promise<WindField> {
  const files: Files = {
    [`${BASE}/manifest.json`]: manifestJson([{ id: RUN, issued: '2026-11-12T18:00:00Z' }]),
    [`${BASE}/climb/${RUN}/tiles.json`]: '[]',
  };
  await addCruise(files, RUN, lats, lons, [0, 1, 2, 3], () => (_h, l) => ({ u, v, gh: (gh ?? ((k) => ghOf(CRUISE_LEVELS, k)))(l) }));
  const m = mockFetch(files);
  return new WindField(await loadManifest(BASE, m.fn, ISSUED + HOUR), m.fn, BASE);
}
const flat = (g: number) => async () => g;
const maxStepKm = (r: Route) => Math.max(...r.points.slice(1).map((p, i) => haversineKm(r.points[i], p)));

test('climb: 300 s after release at sea level the balloon is ~451 m up', () => expect(altitudeAt(300, 0, 1500)).toBeCloseTo(451.5, 0));
test('climb reaches cruise 1500 m from sea level after ~999 s and stays', () => {
  expect(altitudeAt(999, 0, 1500)).toBeCloseTo(1500, 0);
  expect(altitudeAt(5000, 0, 1500)).toBe(1500);
});
test('cruise level over Manchester is 850 hPa', () => expect(cruiseLevel(80, { 850: 1480, 700: 3050, 600: 4250, 500: 5650 })).toBe(850));
test('cruise level over Mexico City (2240 m) is 700 hPa', () => expect(cruiseLevel(2240, { 850: 1480, 700: 3100, 600: 4300, 500: 5800 })).toBe(700));
test('cruise level over La Paz (3640 m) is 500 hPa', () => expect(cruiseLevel(3640, { 850: 1480, 700: 3100, 600: 4200, 500: 5800 })).toBe(500));

test('constant 10 m/s westerly wind (u=+10) for 72 h from (0, 0) moves ~2592 km east', async () => {
  const wind = await makeWind([-10], [0, 20], 10);
  const t0 = performance.now();
  const r = await computeRoute({ lat: 0, lon: 0 }, ISSUED, wind, flat(0));
  const ms = performance.now() - t0;
  console.log(`computeRoute 72 h: ${ms.toFixed(1)} ms`);
  expect(haversineKm(r.hourly[0], r.hourly[72])).toBeCloseTo(2592, -1);
  expect(r.hourly).toHaveLength(73);
  expect(r.points).toHaveLength(433);
  expect(r.runId).toBe(RUN);
  expect(r.release).toBe(ISSUED);
  expect(r.points[0].altM).toBeCloseTo(1.5, 5);
  expect(r.points[2].altM).toBeCloseTo(1500, 5);
  expect(r.points[10].speedMs).toBeCloseTo(10, 5);
  expect(r.points[10].headingDeg).toBeCloseTo(90, 3);
  expect(ms).toBeLessThan(300);
});

test('route crossing 180° stays continuous (no step > 50 km between 10-min points)', async () => {
  const wind = await makeWind([-30], [160, -180, -160, -140], 20);
  const r = await computeRoute({ lat: -20, lon: 178 }, ISSUED, wind, flat(0));
  expect(r.points.some((p, i) => i > 0 && Math.abs(p.lon - r.points[i - 1].lon) > 180)).toBe(true);
  expect(r.points[432].lon).toBeLessThan(0);
  expect(maxStepKm(r)).toBeLessThan(50);
  expect(maxStepKm(r)).toBeGreaterThan(11);
});

test('ground rising mid-route moves the balloon to a higher pressure level', async () => {
  const gh = (l: number) => ({ 0: 1500, 1: 2000, 2: 2500, 3: 3100, 4: 4300, 5: 5800 })[l as 0 | 1 | 2 | 3 | 4 | 5]!;
  const wind = await makeWind([-10], [0, 20], 10, 0, gh);
  const ground = async (p: LatLon) => (p.lon > 8 ? 2240 : 80);
  const r = await computeRoute({ lat: 0, lon: 0 }, ISSUED, wind, ground);
  expect(r.points[10].altM).toBeCloseTo(1500, 5);
  expect(r.points[432].altM).toBeCloseTo(3100, 5);
  for (const p of r.points.slice(2)) expect(p.altM).toBeGreaterThanOrEqual(p.groundM + 600);
  expect(Math.max(...r.points.map((p) => p.groundM))).toBe(2240);
});

test('route crossing 86°N keeps flying with no wall (latitude can exceed 85)', async () => {
  const wind = await makeWind([70], [-20, 0, 160, -180], 0, 10);
  const r = await computeRoute({ lat: 84, lon: 0 }, ISSUED, wind, flat(0));
  expect(Math.max(...r.points.map((p) => p.lat))).toBeGreaterThan(85);
  expect(maxStepKm(r)).toBeLessThan(10 * 600 / 1000 * 1.01 + 0.01);
});

test('route rebuilt from 73 link points is drawn no lower than ground + 600 m', async () => {
  const wind = await makeWind([-10], [0, 20], 10);
  const orig = await computeRoute({ lat: 0, lon: 0 }, ISSUED, wind, flat(0));
  const ground = async (p: LatLon) => (p.lon > 10 ? 2000 : 100);
  const r = await routeFromHourly(orig.hourly, ISSUED, ground);
  expect(r.points).toHaveLength(433);
  expect(r.runId).toBe('');
  expect(r.hourly).toHaveLength(73);
  expect(r.points[0].altM).toBeCloseTo(101.5, 5);
  for (const p of r.points.filter((q) => q.tSec >= 600)) expect(p.altM).toBeGreaterThanOrEqual(p.groundM + 600);
  // Catmull-Rom passes through the link points, and stays smooth on a straight line
  expect(haversineKm(r.points[60], orig.hourly[10])).toBeLessThan(0.01);
  expect(haversineKm(r.points[3], orig.points[3])).toBeLessThan(0.5);
});

test('routeFromHourly follows the date line without jumps', async () => {
  const hourly: LatLon[] = Array.from({ length: 73 }, (_, i) => ({ lat: 10, lon: ((178 + i * 0.5 + 180) % 360) - 180 }));
  const r = await routeFromHourly(hourly, ISSUED, flat(0));
  expect(maxStepKm(r)).toBeLessThan(10);
});

test('positionAt halfway between points interpolates', async () => {
  const wind = await makeWind([-10], [0, 20], 10);
  const r = await computeRoute({ lat: 0, lon: 0 }, ISSUED, wind, flat(0));
  const a = r.points[20];
  const b = r.points[21];
  const m = positionAt(r, ISSUED + (20 * 600 + 300) * 1000);
  expect(m.lon).toBeCloseTo((a.lon + b.lon) / 2, 9);
  expect(m.altM).toBeCloseTo((a.altM + b.altM) / 2, 9);
  expect(m.tSec).toBeCloseTo(20 * 600 + 300, 9);
  expect(positionAt(r, ISSUED - 1e6)).toEqual(r.points[0]);
  expect(positionAt(r, ISSUED + 80 * HOUR)).toEqual(r.points[432]);
});

test('positionAt interpolates longitude across the date line and heading the short way', () => {
  const mk = (lon: number, h: number, t: number) => ({ tSec: t, lat: 0, lon, altM: 1500, groundM: 0, speedMs: 5, headingDeg: h });
  const route: Route = { points: [mk(179.9, 350, 0), mk(-179.9, 10, 600)], hourly: [], release: 0, runId: '' };
  const m = positionAt(route, 300 * 1000);
  expect(Math.abs(m.lon)).toBeCloseTo(180, 5);
  expect(m.headingDeg === 0 || m.headingDeg > 359.999 || m.headingDeg < 0.001).toBe(true);
});
