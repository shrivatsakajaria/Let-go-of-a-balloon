import { expect, test } from 'vitest';
import * as THREE from 'three';
import { model } from '../../src/landmarks/models/tokyo-shibuya-crossing';
import { siteById } from '../../src/landmarks/registry';
import { lightFor, regionStyle } from '../../src/world/palette';

const site = siteById('tokyo-shibuya-crossing')!;
type Flow = { mesh: THREE.Mesh; ax: number; az: number; dx: number; dz: number };

test('the Shibuya crossing: the corner buildings with their screens, inside the footprint radius', () => {
  const g = model.build(regionStyle(site.at));
  const box = new THREE.Box3().setFromObject(g);
  // QFRONT is the tallest corner (45.9 m and its roof plant)
  expect(box.max.y).toBeGreaterThan(45);
  expect(box.max.y).toBeLessThan(55);
  // every vertex within the footprint radius, measured as a radius
  g.updateMatrixWorld(true);
  const v = new THREE.Vector3();
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const p = m.geometry.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld);
      expect(Math.hypot(v.x, v.z)).toBeLessThanOrEqual(site.footprintRadiusM);
    }
  });
  expect(g.children.some((m) => m.userData.bucket === 'glow')).toBe(true);
});

test('the crowds wait at the curbs, cross together when the traffic stops, and nothing is allocated', () => {
  const g = model.build(regionStyle(site.at));
  const flows = g.userData.flows as Flow[];
  expect(flows).toHaveLength(10);
  const meshes = flows.map((f) => f.mesh);
  const L = lightFor(20);
  // the cycle starts on a whole multiple of 90 s
  const t0 = Date.UTC(2026, 10, 13, 15, 0, 0);
  model.animate!(g, t0 + 1, L);
  // at the start of the walk everybody is still at their curb
  for (const f of flows) {
    expect(f.mesh.visible).toBe(true);
    expect(Math.hypot(f.mesh.position.x - f.ax, f.mesh.position.z - f.az)).toBeLessThan(0.5);
  }
  // half a minute on, they are over (or nearly)
  model.animate!(g, t0 + 26e3, L);
  for (const f of flows) {
    if (!f.mesh.visible) continue;
    expect(Math.hypot(f.mesh.position.x - (f.ax + f.dx), f.mesh.position.z - (f.az + f.dz))).toBeLessThan(2);
  }
  // then they go into the streets while the cars run
  model.animate!(g, t0 + 45e3, L);
  expect(flows.every((f) => !f.mesh.visible)).toBe(true);
  for (let s = 0; s < 90; s++) model.animate!(g, t0 + s * 1000, L);
  expect((g.userData.flows as Flow[]).map((f) => f.mesh)).toEqual(meshes);
});
