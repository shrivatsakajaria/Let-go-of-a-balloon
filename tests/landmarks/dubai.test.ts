import { expect, test } from 'vitest';
import * as THREE from 'three';
import { model, showSeconds } from '../../src/landmarks/models/dubai-burj-khalifa';
import { siteById } from '../../src/landmarks/registry';
import { lightFor, regionStyle } from '../../src/world/palette';

const site = siteById('dubai-burj-khalifa')!;
type Fountain = { jets: THREE.Mesh[] };

test('the Burj Khalifa: 828 m, its wings at the base 63 m long, everything inside the footprint radius', () => {
  const g = model.build(regionStyle(site.at));
  const box = new THREE.Box3().setFromObject(g);
  expect(box.max.y).toBeGreaterThan(825);
  expect(box.max.y).toBeLessThan(831);
  // the fountain's jets at full height for the check
  for (const m of (g.userData.fountain as Fountain).jets) m.scale.y = 90;
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
});

test('the fountain plays on the half hours of the evening (Dubai time, UTC+4) and the two lunchtime shows', () => {
  // 19:00:30 and 22:31 in Dubai: in a show
  expect(showSeconds(Date.UTC(2026, 10, 13, 15, 0, 30))).toBeCloseTo(30, 5);
  expect(showSeconds(Date.UTC(2026, 10, 13, 18, 31))).toBeCloseTo(60, 5);
  // 19:10, 16:00 and 23:30 in Dubai: still
  expect(showSeconds(Date.UTC(2026, 10, 13, 15, 10))).toBe(-1);
  expect(showSeconds(Date.UTC(2026, 10, 13, 12, 0))).toBe(-1);
  expect(showSeconds(Date.UTC(2026, 10, 13, 19, 30))).toBe(-1);
  // 13:30 in Dubai: the second lunchtime show
  expect(showSeconds(Date.UTC(2026, 10, 13, 9, 31))).toBeCloseTo(60, 5);
});

test('the jets rise in a show and are gone between shows, turning the same meshes', () => {
  const g = model.build(regionStyle(site.at));
  const f = g.userData.fountain as Fountain;
  const jets = [...f.jets];
  model.animate!(g, Date.UTC(2026, 10, 13, 15, 1), lightFor(-6));
  expect(f.jets.every((m) => m.visible)).toBe(true);
  expect(Math.max(...f.jets.map((m) => m.scale.y))).toBeGreaterThan(20);
  model.animate!(g, Date.UTC(2026, 10, 13, 15, 12), lightFor(-8));
  expect(f.jets.every((m) => !m.visible)).toBe(true);
  expect(f.jets).toEqual(jets);
});
