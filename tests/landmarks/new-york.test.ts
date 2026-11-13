import { expect, test } from 'vitest';
import * as THREE from 'three';
import { model } from '../../src/landmarks/models/new-york-statue-of-liberty';
import { regionStyle, lightFor } from '../../src/world/palette';

const LIBERTY = { lat: 40.689253, lon: -74.044532 };

test('the Statue of Liberty: 93 m to the torch, raised on her right (+x), the flame in the glow bucket', () => {
  const g = model.build(regionStyle(LIBERTY));
  const box = new THREE.Box3().setFromObject(g);
  expect(box.max.y).toBeGreaterThan(92);
  expect(box.max.y).toBeLessThan(94.5);
  const flame = (g.userData.flame as { mesh: THREE.Mesh }).mesh;
  expect(flame.userData.bucket).toBe('glow');
  expect(flame.position.x).toBeGreaterThan(4);
  expect(flame.position.y).toBeGreaterThan(88);
});

test('the flame stands still by day and flickers once lit, turning the same mesh', () => {
  const g = model.build(regionStyle(LIBERTY));
  const flame = (g.userData.flame as { mesh: THREE.Mesh }).mesh;
  const t0 = Date.UTC(2026, 10, 13, 16);
  const day = new Set<number>();
  for (let i = 0; i < 20; i++) {
    model.animate!(g, t0 + i * 37, lightFor(30));
    day.add(flame.scale.y);
  }
  expect([...day]).toEqual([1]);
  const night: number[] = [];
  for (let i = 0; i < 20; i++) {
    model.animate!(g, t0 + i * 37, lightFor(-12));
    night.push(flame.scale.y);
    expect(Math.abs(flame.scale.y - 1)).toBeLessThan(0.11);
  }
  expect(Math.max(...night) - Math.min(...night)).toBeGreaterThan(0.02);
  expect((g.userData.flame as { mesh: THREE.Mesh }).mesh).toBe(flame);
});
