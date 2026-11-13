import { expect, test } from 'vitest';
import { haversineKm } from '../../src/geo/coords';
import { hiddenFootprints, landmarksNear, latLonToModel, modelToLatLon, sitesNear } from '../../src/landmarks/registry';
import type { LandmarkModel, LandmarkSite } from '../../src/landmarks/types';
import * as THREE from 'three';

const site = (id: string, lat: number, lon: number, extra: Partial<LandmarkSite> = {}): LandmarkSite => ({
  id, cityId: 'test', name: id, at: { lat, lon }, headingDeg: 0, footprintRadiusM: 20, ...extra,
});

test('model frame: -z is the heading, +x its right; round trip', () => {
  const s = site('a', 51.5, -0.12, { headingDeg: 90 });
  // 100 m forward (heading east)
  const f = modelToLatLon(s, 0, -100);
  expect(f.lat).toBeCloseTo(51.5, 6);
  expect(haversineKm(s.at, f) * 1000).toBeCloseTo(100, 0);
  expect(f.lon).toBeGreaterThan(-0.12);
  // 50 m to the right of an east heading is south
  expect(modelToLatLon(s, 50, 0).lat).toBeLessThan(51.5);
  const back = latLonToModel(s, modelToLatLon(s, 37, -12));
  expect(back.x).toBeCloseTo(37, 6);
  expect(back.z).toBeCloseTo(-12, 6);
});

test('sites near a point, nearest first; models load lazily by id, once', async () => {
  const sites = [site('far', 51.6, -0.12), site('near', 51.5001, -0.12), site('mid', 51.505, -0.12)];
  expect(sitesNear({ lat: 51.5, lon: -0.12 }, 1, sites).map((s) => s.id)).toEqual(['near', 'mid']);
  let calls = 0;
  const model: LandmarkModel = { build: () => new THREE.Group() };
  const models = { near: async () => (calls++, model), mid: async () => (calls++, model), far: async () => (calls++, model) };
  const got = await landmarksNear({ lat: 51.5, lon: -0.12 }, 1, sites, models);
  expect(got.map((l) => l.id)).toEqual(['near', 'mid']);
  expect(typeof got[0].build).toBe('function');
  expect(got[0].at).toEqual({ lat: 51.5001, lon: -0.12 });
  await landmarksNear({ lat: 51.5, lon: -0.12 }, 1, sites, models);
  expect(calls).toBe(2);
});

test('a site hides its footprint circle, or its own circles for a long building', () => {
  const round = site('r', 51.5, -0.12, { footprintRadiusM: 30 });
  const long = site('l', 51.5, -0.12, { headingDeg: 0, footprintRadiusM: 150, hides: [{ x: 0, z: -100, r: 50 }, { x: 0, z: 100, r: 50 }] });
  const h = hiddenFootprints([round, long]);
  expect(h).toHaveLength(3);
  expect(h[0]).toEqual({ lat: 51.5, lon: -0.12, radiusM: 30 });
  expect(h[1].lat).toBeGreaterThan(51.5); // -z is north at heading 0
  expect(h[2].lat).toBeLessThan(51.5);
  expect(h[1].radiusM).toBe(50);
});
