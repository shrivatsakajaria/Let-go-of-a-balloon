import { expect, test } from 'vitest';
import * as THREE from 'three';
import { model as tower } from '../../src/landmarks/models/london-elizabeth-tower';
import { model as palace } from '../../src/landmarks/models/london-palace-of-westminster';
import { countTriangles } from '../../src/landmarks/kit';
import { ukOffsetMs } from '../../src/landmarks/clock';
import { regionStyle, lightFor } from '../../src/world/palette';

const LONDON = { lat: 51.5007, lon: -0.1246 };

test('the Elizabeth Tower: 96 m, four lit dials, and hands on London time', () => {
  const g = tower.build(regionStyle(LONDON));
  const box = new THREE.Box3().setFromObject(g);
  expect(box.max.y).toBeGreaterThan(94);
  expect(box.max.y).toBeLessThan(98);
  const glow = g.children.find((m) => m.userData.bucket === 'glow') as THREE.Mesh;
  expect(countTriangles(glow)).toBe(4 * 24);
  // UK time: GMT in winter, BST in summer, the change at 01:00 UTC on the last Sundays of March and October
  expect(ukOffsetMs(Date.UTC(2026, 0, 15, 12))).toBe(0);
  expect(ukOffsetMs(Date.UTC(2026, 6, 15, 12))).toBe(3600e3);
  expect(ukOffsetMs(Date.UTC(2026, 2, 29, 0, 59))).toBe(0);
  expect(ukOffsetMs(Date.UTC(2026, 2, 29, 1, 0))).toBe(3600e3);
  expect(ukOffsetMs(Date.UTC(2026, 9, 25, 0, 59))).toBe(3600e3);
  expect(ukOffsetMs(Date.UTC(2026, 9, 25, 1, 0))).toBe(0);
  // 15:45 BST on a summer afternoon: the minute hand at nine, the hour hand just short of four
  tower.animate!(g, Date.UTC(2026, 6, 15, 14, 45), lightFor(30));
  const hands = g.userData.hands as { hour: THREE.Object3D[]; minute: THREE.Object3D[] };
  expect(hands.minute).toHaveLength(4);
  expect(hands.minute[0].rotation.z).toBeCloseTo((3 * Math.PI) / 2, 5);
  expect(hands.hour[2].rotation.z).toBeCloseTo((3.75 / 12) * 2 * Math.PI, 5);
  // seen from in front of each dial, the minute hand at nine points to the viewer's left
  g.updateMatrixWorld(true);
  for (let i = 0; i < 4; i++) {
    const m = hands.minute[i];
    const pivot = m.parent!;
    const centre = pivot.getWorldPosition(new THREE.Vector3());
    // out of the dial: away from the tower's axis
    const out = new THREE.Vector3(centre.x, 0, centre.z).normalize();
    expect(centre.y).toBeCloseTo(57.5, 3);
    const tip = new THREE.Vector3(0, 3, 0).applyMatrix4(m.matrixWorld).sub(centre);
    // the viewer's left, facing the dial (looking along -out), is out x up
    const left = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), out).negate();
    expect(tip.dot(left)).toBeGreaterThan(2.5);
    expect(m.getWorldPosition(new THREE.Vector3()).sub(centre).dot(out)).toBeGreaterThan(0);
  }
});

test('animate does not allocate: the same objects are turned', () => {
  const g = tower.build(regionStyle(LONDON));
  const hands = g.userData.hands as { hour: THREE.Object3D[] };
  const before = hands.hour[0];
  for (let t = 0; t < 10; t++) tower.animate!(g, Date.UTC(2026, 10, 13, 16) + t * 60e3, lightFor(-2));
  expect(hands.hour[0]).toBe(before);
});

test('the Palace: Victoria Tower 98 m at the south end, the Central Tower, a long river front', () => {
  const g = palace.build(regionStyle(LONDON));
  const box = new THREE.Box3().setFromObject(g);
  expect(box.max.y).toBeGreaterThan(95);
  expect(box.max.y).toBeLessThan(100);
  expect(box.min.z).toBeLessThan(-125);
  expect(box.max.z).toBeGreaterThan(140);
  expect(box.max.x).toBeGreaterThan(75);
  expect(countTriangles(g)).toBeLessThan(4000);
});
