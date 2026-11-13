import { expect, test } from 'vitest';
import * as THREE from 'three';
import { model } from '../../src/landmarks/models/rio-de-janeiro-sugarloaf';
import { siteById, modelToLatLon } from '../../src/landmarks/registry';
import { haversineKm } from '../../src/geo/coords';
import { regionStyle, lightFor } from '../../src/world/palette';

const site = siteById('rio-de-janeiro-sugarloaf')!;
const SUMMIT = { lat: -22.94949, lon: -43.15616 };

test('Sugarloaf: the rock rises to the real summit, 396 m above the sea, over the summit itself', () => {
  const g = model.build(regionStyle(site.at));
  const box = new THREE.Box3().setFromObject(g);
  // the model stands on the drawn ground at Station I, 20 m above the sea
  // (the summit station's roof is the top: about 13 m over the rock)
  expect(box.max.y + 20).toBeGreaterThan(400);
  expect(box.max.y + 20).toBeLessThan(415);
  // the summit of the model frame (0, -1304) is the OSM peak
  expect(haversineKm(modelToLatLon(site, -0.4, -1303.9), SUMMIT) * 1000).toBeLessThan(10);
});

test('the four cars glide along their ropes, wait at the stations, and are moved, not replaced', () => {
  const g = model.build(regionStyle(site.at));
  const cars = (g.userData.cars as { cars: THREE.Object3D[] }).cars;
  expect(cars).toHaveLength(4);
  const t0 = Date.UTC(2026, 10, 13, 18);
  const at = (t: number) => {
    model.animate!(g, t, lightFor(10));
    return cars.map((c) => c.position.clone());
  };
  const a = at(t0), b = at(t0 + 20e3), c = at(t0 + 240e3);
  const moved = a.map((p, i) => p.distanceTo(b[i]) + p.distanceTo(c[i]));
  expect(moved.every((d) => d > 1)).toBe(true);
  // the two cars of a line are at mirrored places: their heights add up to the same each time
  for (const s of [a, b, c]) expect(s[0].y + s[1].y).toBeCloseTo(a[0].y + a[1].y, 0);
  // every car keeps between its line's stations
  for (const s of [a, b, c]) {
    for (const p of s) {
      expect(p.y).toBeGreaterThan(0);
      expect(p.y).toBeLessThan(390);
    }
  }
  expect((g.userData.cars as { cars: THREE.Object3D[] }).cars[0]).toBe(cars[0]);
});
