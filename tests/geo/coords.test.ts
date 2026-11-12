import { test, expect } from 'vitest';
import {
  haversineKm,
  destination,
  wrapLon,
  lonDelta,
  lonLatToTile,
  tileBounds,
  clampLat,
  bearingDeg,
} from '../../src/geo/coords';
import { EARTH_RADIUS_KM } from '../../src/config';

test('haversine Parliament Square to Champ de Mars ~341 km', () => expect(haversineKm({lat:51.5007,lon:-0.1263},{lat:48.8556,lon:2.2986})).toBeCloseTo(341, -1));
test('destination then haversine round trip', () => { const p = destination({lat:53.48,lon:-2.24}, 45, 100); expect(haversineKm({lat:53.48,lon:-2.24}, p)).toBeCloseTo(100, 3); });
test('wrapLon across date line', () => { expect(wrapLon(181)).toBeCloseTo(-179); expect(lonDelta(179, -179)).toBeCloseTo(2); });
test('tile maths Manchester z14', () => { const t = lonLatToTile(53.4794,-2.2453,14); expect(Math.floor(t.x)).toBe(8089); expect(Math.floor(t.y)).toBe(5300); });
test('clampLat', () => expect(clampLat(89)).toBeCloseTo(85.0511, 4));

// Extra edge cases
test('EARTH_RADIUS_KM is the mean radius', () => expect(EARTH_RADIUS_KM).toBe(6371.0088));
test('wrapLon(-180) stays -180 and wrapLon(180) maps to -180', () => {
  expect(wrapLon(-180)).toBe(-180);
  expect(wrapLon(180)).toBe(-180);
  expect(wrapLon(540)).toBe(-180);
});
test('wrapLon results lie in [-180, 180)', () => {
  for (const v of [-721, -360, -0.5, 0, 179.999, 360, 725.25]) {
    const w = wrapLon(v);
    expect(w).toBeGreaterThanOrEqual(-180);
    expect(w).toBeLessThan(180);
  }
});
test('lonDelta(-179, 179) = -2', () => expect(lonDelta(-179, 179)).toBeCloseTo(-2));
test('lonDelta is shortest signed difference without wrap', () => {
  expect(lonDelta(10, 20)).toBeCloseTo(10);
  expect(lonDelta(20, 10)).toBeCloseTo(-10);
});
test('tileBounds round-trips with lonLatToTile', () => {
  const lat = 53.4794, lon = -2.2453, z = 14;
  const t = lonLatToTile(lat, lon, z);
  const b = tileBounds(z, Math.floor(t.x), Math.floor(t.y));
  expect(b.west).toBeLessThanOrEqual(lon);
  expect(b.east).toBeGreaterThan(lon);
  expect(b.south).toBeLessThanOrEqual(lat);
  expect(b.north).toBeGreaterThan(lat);
  expect(lonLatToTile(b.north, b.west, z).x).toBeCloseTo(Math.floor(t.x), 6);
  expect(lonLatToTile(b.north, b.west, z).y).toBeCloseTo(Math.floor(t.y), 6);
});
test('bearingDeg due east along the equator is 90', () => {
  expect(bearingDeg({lat:0,lon:0},{lat:0,lon:10})).toBeCloseTo(90, 6);
});
test('destination due north moves latitude only', () => {
  const p = destination({lat:10,lon:20}, 0, 111.195);
  expect(p.lon).toBeCloseTo(20, 6);
  expect(p.lat).toBeCloseTo(11, 2);
});
