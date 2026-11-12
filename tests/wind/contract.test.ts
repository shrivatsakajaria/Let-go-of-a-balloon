import { test, expect } from 'vitest';
import { tileOrigin, tileKey } from '../../src/wind/sampler';

// Mirrors pipeline/build_tiles.py tile_names: range(-90, 90, deg) x range(-180, 180, deg).
function pipelineNames(deg: number): Set<string> {
  const s = new Set<string>();
  for (let la = -90; la < 90; la += deg) for (let lo = -180; lo < 180; lo += deg) s.add(`${la}_${lo}`);
  return s;
}
const name = (lat: number, lon: number, deg: number, latMax: number): string => {
  const o = tileOrigin({ lat, lon }, deg, latMax);
  return tileKey(o.lat0, o.lon0);
};

test('real tile names: Manchester', () => {
  expect(name(53.48, -2.24, 20, 70)).toBe('50_-20');
  expect(name(53.48, -2.24, 5, 85)).toBe('50_-5');
  expect(name(0, 179.9, 20, 70)).toBe('-10_160');
  expect(name(0, -179.9, 5, 85)).toBe('0_-180');
  expect(name(90, 0, 20, 70)).toBe('70_0');
  expect(name(-90, 0, 20, 70)).toBe('-90_0');
});

test('every requested tile name exists on the pipeline grid', () => {
  const cr = pipelineNames(20);
  const cl = pipelineNames(5);
  for (let lat = -90; lat <= 90; lat += 3.7) {
    for (let lon = -180; lon < 180; lon += 7.3) {
      expect(cr.has(name(lat, lon, 20, 70))).toBe(true);
      expect(cl.has(name(lat, lon, 5, 85))).toBe(true);
    }
  }
});
