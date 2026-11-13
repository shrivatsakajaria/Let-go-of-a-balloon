import { expect, test } from 'vitest';
import * as THREE from 'three';
import { model } from '../../src/landmarks/models/cork-shandon-bells';
import { countTriangles } from '../../src/landmarks/kit';
import { ukOffsetMs } from '../../src/landmarks/clock';
import { regionStyle, lightFor } from '../../src/world/palette';

const CORK = { lat: 51.90328, lon: -8.47617 };

test('Shandon: about 52 m to the salmon, four lit dials, hands on Irish time (each face a little off)', () => {
  const g = model.build(regionStyle(CORK));
  const box = new THREE.Box3().setFromObject(g);
  expect(box.max.y).toBeGreaterThan(50);
  expect(box.max.y).toBeLessThan(55);
  const glow = g.children.find((m) => m.userData.bucket === 'glow') as THREE.Mesh;
  expect(countTriangles(glow)).toBe(4 * 20);
  // Irish Standard Time in summer, GMT in winter, changing with the UK
  expect(ukOffsetMs(Date.UTC(2026, 0, 15, 12))).toBe(0);
  expect(ukOffsetMs(Date.UTC(2026, 6, 15, 12))).toBe(3600e3);
  expect(ukOffsetMs(Date.UTC(2026, 9, 25, 0, 59))).toBe(3600e3);
  expect(ukOffsetMs(Date.UTC(2026, 9, 25, 1, 0))).toBe(0);
  // 15:45 IST: the west face's minute hand at nine, the hour hand just short of four
  model.animate!(g, Date.UTC(2026, 6, 15, 14, 45), lightFor(30));
  const hands = g.userData.hands as { hour: THREE.Object3D[]; minute: THREE.Object3D[] };
  expect(hands.minute).toHaveLength(4);
  expect(hands.minute[0].rotation.z).toBeCloseTo((3 * Math.PI) / 2, 5);
  expect(hands.hour[0].rotation.z).toBeCloseTo((3.75 / 12) * 2 * Math.PI, 5);
  // the Four-Faced Liar: the faces disagree, by a minute or two at most
  const minutes = hands.minute.map((m) => (m.rotation.z / (2 * Math.PI)) * 60);
  expect(new Set(minutes.map((m) => m.toFixed(2))).size).toBeGreaterThan(1);
  for (const m of minutes) expect(Math.abs(m - 45)).toBeLessThanOrEqual(2);
  // seen from in front of each dial, the minute hand near nine points to the viewer's left
  g.updateMatrixWorld(true);
  for (let i = 0; i < 4; i++) {
    const m = hands.minute[i];
    const centre = m.parent!.getWorldPosition(new THREE.Vector3());
    const out = new THREE.Vector3(centre.x, 0, centre.z).normalize();
    const tip = new THREE.Vector3(0, 1.7, 0).applyMatrix4(m.matrixWorld).sub(centre);
    const left = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), out).negate();
    expect(tip.dot(left)).toBeGreaterThan(1.5);
    expect(m.getWorldPosition(new THREE.Vector3()).sub(centre).dot(out)).toBeGreaterThan(0);
  }
});

test('animate does not allocate: the same objects are turned', () => {
  const g = model.build(regionStyle(CORK));
  const hands = g.userData.hands as { hour: THREE.Object3D[] };
  const before = hands.hour[0];
  for (let t = 0; t < 10; t++) model.animate!(g, Date.UTC(2026, 10, 13, 16) + t * 60e3, lightFor(-2));
  expect(hands.hour[0]).toBe(before);
});
