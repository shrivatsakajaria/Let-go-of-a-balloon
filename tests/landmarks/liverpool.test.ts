import { expect, test } from 'vitest';
import * as THREE from 'three';
import { model } from '../../src/landmarks/models/liverpool-royal-liver-building';
import { regionStyle, lightFor } from '../../src/world/palette';

const LIVERPOOL = { lat: 53.40585, lon: -2.99584 };
type Wings = { left: THREE.Object3D[]; right: THREE.Object3D[] };
type Hands = { hour: THREE.Object3D[]; minute: THREE.Object3D[] };

test('the Royal Liver Building: 98 m towers with birds on top, a lit dial on every face', () => {
  const g = model.build(regionStyle(LIVERPOOL));
  const box = new THREE.Box3().setFromObject(g);
  // the birds' heads and raised wings reach about 104 m
  expect(box.max.y).toBeGreaterThan(102);
  expect(box.max.y).toBeLessThan(106);
  // one tower toward the river (-z), one toward the city
  expect(box.min.z).toBeLessThan(-50);
  expect(box.max.z).toBeGreaterThan(44);
  const glow = g.children.find((m) => m.userData.bucket === 'glow') as THREE.Mesh;
  expect(glow.geometry.getAttribute('position').count / 3).toBe(8 * 20);
});

test('the Liver birds stretch their wings now and then; the hands keep UK time', () => {
  const g = model.build(regionStyle(LIVERPOOL));
  const wings = g.userData.wings as Wings;
  const hands = g.userData.hands as Hands;
  expect(wings.right).toHaveLength(2);
  expect(hands.minute).toHaveLength(8);
  const L = lightFor(30);
  // a 23 s cycle: the river bird beats its wings in the first 2.4 s, the city bird 9 s earlier in its cycle
  const t0 = Math.ceil(Date.UTC(2026, 6, 15, 14, 45) / 23000) * 23000;
  model.animate!(g, t0 + 600, L);
  expect(wings.right[0].rotation.z).toBeGreaterThan(0.3);
  expect(wings.left[0].rotation.z).toBeLessThan(-0.3);
  expect(wings.right[1].rotation.z).toBe(0);
  model.animate!(g, t0 + 5000, L);
  expect(wings.right[0].rotation.z).toBe(0);
  model.animate!(g, t0 + 14600, L);
  expect(wings.right[1].rotation.z).toBeGreaterThan(0.3);
  // the same objects are turned (animate does not allocate)
  const before = wings.right[0];
  for (let t = 0; t < 40; t++) model.animate!(g, t0 + t * 100, L);
  expect(wings.right[0]).toBe(before);
  // 15:45 BST: the minute hand at nine, the hour hand just short of four, on every dial
  model.animate!(g, Date.UTC(2026, 6, 15, 14, 45), L);
  for (let i = 0; i < 8; i++) {
    expect(hands.minute[i].rotation.z).toBeCloseTo((3 * Math.PI) / 2, 5);
    expect(hands.hour[i].rotation.z).toBeCloseTo((3.75 / 12) * 2 * Math.PI, 5);
  }
  // in winter, GMT
  model.animate!(g, Date.UTC(2026, 0, 15, 15, 0), L);
  expect(hands.hour[0].rotation.z).toBeCloseTo((3 / 12) * 2 * Math.PI, 5);
  // the hands stand just in front of their dials, out from the tower's axis
  g.updateMatrixWorld(true);
  for (let i = 0; i < 8; i++) {
    const pivot = hands.minute[i].parent!;
    const c = pivot.getWorldPosition(new THREE.Vector3());
    const towerZ = c.z < 0 ? -36 : 36;
    expect(Math.hypot(c.x, c.z - towerZ)).toBeCloseTo(6.12, 2);
    expect(hands.minute[i].getWorldPosition(new THREE.Vector3()).sub(c).dot(new THREE.Vector3(c.x, 0, c.z - towerZ))).toBeGreaterThan(0);
  }
});
