import { expect, test } from 'vitest';
import * as THREE from 'three';
import { model } from '../../src/landmarks/models/cardiff-castle';
import { regionStyle, lightFor } from '../../src/world/palette';

const CARDIFF = { lat: 51.48233, lon: -3.18117 };

test('the Clock Tower keeps UK time on its four dials', () => {
  const g = model.build(regionStyle(CARDIFF));
  const hands = g.userData.hands as { hour: THREE.Object3D[]; minute: THREE.Object3D[] };
  expect(hands.minute).toHaveLength(4);
  expect(hands.hour).toHaveLength(4);
  // 15:45 BST: the minute hand at nine, the hour hand just short of four
  model.animate!(g, Date.UTC(2026, 6, 15, 14, 45), lightFor(30));
  for (let i = 0; i < 4; i++) {
    expect(hands.minute[i].rotation.z).toBeCloseTo((3 * Math.PI) / 2, 5);
    expect(hands.hour[i].rotation.z).toBeCloseTo((3.75 / 12) * 2 * Math.PI, 5);
  }
  // each pair on its dial, the four dials round the tower's axis; seen from in front of each dial,
  // the minute hand at nine points to the viewer's left
  g.updateMatrixWorld(true);
  const centres = hands.minute.map((m) => m.parent!.getWorldPosition(new THREE.Vector3()));
  const axis = centres.reduce((a, c) => a.add(c), new THREE.Vector3()).multiplyScalar(1 / 4);
  for (let i = 0; i < 4; i++) {
    const m = hands.minute[i], centre = centres[i];
    expect(centre.y).toBeCloseTo(24.6, 1);
    const out = new THREE.Vector3(centre.x - axis.x, 0, centre.z - axis.z);
    expect(out.length()).toBeGreaterThan(5);
    expect(out.length()).toBeLessThan(6.5);
    out.normalize();
    const tip = new THREE.Vector3(0, 2, 0).applyMatrix4(m.matrixWorld).sub(centre);
    const left = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), out).negate();
    expect(tip.dot(left)).toBeGreaterThan(1.5);
    // in front of the dial, not inside the tower
    expect(m.getWorldPosition(new THREE.Vector3()).sub(centre).dot(out)).toBeGreaterThan(0);
  }
  // animate turns the same objects (no allocation)
  const before = hands.hour[0];
  model.animate!(g, Date.UTC(2026, 0, 15, 9, 0), lightFor(30));
  expect(hands.hour[0]).toBe(before);
  expect(hands.minute[0].rotation.z).toBeCloseTo(0, 5);
  expect(hands.hour[0].rotation.z).toBeCloseTo((9 / 12) * 2 * Math.PI, 5);
});
