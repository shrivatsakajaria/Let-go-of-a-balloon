import { expect, test } from 'vitest';
import * as THREE from 'three';
import { model } from '../../src/landmarks/models/barcelona-sagrada-familia';
import { siteById } from '../../src/landmarks/registry';
import { lightFor, regionStyle } from '../../src/world/palette';

const site = siteById('barcelona-sagrada-familia')!;

/** The farthest any vertex lies from the model's origin, in plan. */
function reach(g: THREE.Group): number {
  g.updateMatrixWorld(true);
  let r = 0;
  const v = new THREE.Vector3();
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const p = m.geometry.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld);
      r = Math.max(r, Math.hypot(v.x, v.z));
    }
  });
  return r;
}

test('the Sagrada Família: the Tower of Jesus Christ tops out at 172.5 m', () => {
  const g = model.build(regionStyle(site.at));
  const box = new THREE.Box3().setFromObject(g);
  expect(box.max.y).toBeGreaterThan(170);
  expect(box.max.y).toBeLessThan(175);
  // the cross and the Virgin Mary's star light from dusk
  expect(g.children.some((m) => m.userData.bucket === 'glow')).toBe(true);
});

test('the cranes slew without allocating, and stay inside the footprint radius however they turn', () => {
  const g = model.build(regionStyle(site.at));
  const tops = (g.userData.cranes as { tops: THREE.Object3D[] }).tops;
  expect(tops).toHaveLength(2);
  const before = tops.map((t) => t.rotation.y);
  const t0 = Date.UTC(2026, 10, 13, 15);
  model.animate!(g, t0 + 60e3, lightFor(20));
  expect(tops[0].rotation.y).not.toBeCloseTo(before[0], 3);
  expect((g.userData.cranes as { tops: THREE.Object3D[] }).tops[0]).toBe(tops[0]);
  for (let s = 0; s < 400; s += 20) {
    model.animate!(g, t0 + s * 1000, lightFor(20));
    expect(reach(g)).toBeLessThanOrEqual(site.footprintRadiusM);
  }
});

test('the slewing crane tops do not count as tops for the camera (the height grid is built once)', async () => {
  const { heightGrid } = await import('../../src/landmarks/layer');
  const site = siteById('barcelona-sagrada-familia')!;
  const g = model.build(regionStyle(site.at));
  const tops = (g.userData.cranes as { tops: THREE.Object3D[] }).tops;
  for (const t of tops) expect(t.userData.noTops, t.name).toBe(true);
  const grid = heightGrid(g);
  const top = (x: number, z: number) => grid.h[Math.floor((z - grid.minZ) / 6) * grid.nx + Math.floor((x - grid.minX) / 6)];
  // 30 m out along the front crane's jib (its mast at 16, -62, 92 m high), there is no 92 m column
  expect(top(16, -62 - 30) ?? -Infinity).toBeLessThan(80);
});
