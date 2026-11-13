import { expect, test } from 'vitest';
import * as THREE from 'three';
import { model } from '../../src/landmarks/models/paris-eiffel-tower';
import { siteById } from '../../src/landmarks/registry';
import { regionStyle } from '../../src/world/palette';

test('the Eiffel Tower: 330 m, legs 125 m apart, inside its footprint radius, no animation (no light show)', () => {
  const site = siteById('paris-eiffel-tower')!;
  const g = model.build(regionStyle(site.at));
  const box = new THREE.Box3().setFromObject(g);
  expect(box.max.y).toBeGreaterThan(325);
  expect(box.max.y).toBeLessThan(335);
  expect(box.max.x - box.min.x).toBeGreaterThan(120);
  expect(box.max.x - box.min.x).toBeLessThan(128);
  // every corner within the footprint radius (as a radius, not per axis)
  for (const x of [box.min.x, box.max.x]) for (const z of [box.min.z, box.max.z]) expect(Math.hypot(x, z)).toBeLessThanOrEqual(site.footprintRadiusM);
  expect(model.animate).toBeUndefined();
});
