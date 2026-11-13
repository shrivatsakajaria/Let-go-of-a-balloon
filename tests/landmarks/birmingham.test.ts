import { expect, test } from 'vitest';
import * as THREE from 'three';
import { model } from '../../src/landmarks/models/birmingham-library-of-birmingham';
import { LANDMARK_COLOURS, countTriangles, linearColour } from '../../src/landmarks/kit';
import { regionStyle } from '../../src/world/palette';

const BIRMINGHAM = { lat: 52.4797, lon: -1.9085 };

/** The colours (as '#rrggbb' keys of LANDMARK_COLOURS) of the triangles lying in the plane z = zf between heights y0 and y1. */
function coloursOnFront(g: THREE.Group, zf: number, y0: number, y1: number): Set<string> {
  const names = Object.entries(LANDMARK_COLOURS).map(([n, hex]) => [n, linearColour(hex)] as const);
  const out = new Set<string>();
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const p = m.geometry.getAttribute('position'), c = m.geometry.getAttribute('color');
    for (let i = 0; i < p.count; i += 3) {
      let onPlane = true;
      for (let k = 0; k < 3; k++) if (Math.abs(p.getZ(i + k) - zf) > 0.01 || p.getY(i + k) < y0 || p.getY(i + k) > y1) onPlane = false;
      if (!onPlane) continue;
      const hit = names.find(([, l]) => Math.hypot(l[0] - c.getX(i), l[1] - c.getY(i), l[2] - c.getZ(i)) < 1e-4);
      out.add(hit ? hit[0] : '?');
    }
  });
  return out;
}

test('the gold box reads gold in shade: a light sand body under gilt rings, within the triangle budget', () => {
  const g = model.build(regionStyle(BIRMINGHAM));
  // the gold box's front face (z = 5.5 - 47 / 2) and its rings 0.12 m in front of it
  expect([...coloursOnFront(g, -18, 28.9, 44.1)]).toEqual(['sand']);
  expect([...coloursOnFront(g, -18.12, 28.9, 44.1)]).toEqual(['gilt']);
  expect(countTriangles(g)).toBeLessThan(4000);
});
