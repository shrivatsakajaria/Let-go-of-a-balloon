import { expect, test } from 'vitest';
import * as THREE from 'three';
import { Kit, LANDMARK_COLOURS, contourColours, countTriangles, linearColour } from '../../src/landmarks/kit';
import { CONTOUR, DEFAULT_REGION, ROADS, hslOf, regionStyle, toHex } from '../../src/world/palette';

/** Every triangle's stored normal points away from the given centre. */
function outward(g: THREE.BufferGeometry, cx: number, cy: number, cz: number): boolean {
  const p = g.getAttribute('position'), n = g.getAttribute('normal');
  for (let i = 0; i < p.count; i += 3) {
    const mx = (p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3 - cx;
    const my = (p.getY(i) + p.getY(i + 1) + p.getY(i + 2)) / 3 - cy;
    const mz = (p.getZ(i) + p.getZ(i + 1) + p.getZ(i + 2)) / 3 - cz;
    if (mx * n.getX(i) + my * n.getY(i) + mz * n.getZ(i) <= 0) return false;
    // and the winding agrees with the normal (front faces counter-clockwise)
    const a = new THREE.Vector3().fromBufferAttribute(p, i), b = new THREE.Vector3().fromBufferAttribute(p, i + 1), c = new THREE.Vector3().fromBufferAttribute(p, i + 2);
    const w = b.sub(a).cross(c.sub(a));
    if (w.x * n.getX(i) + w.y * n.getY(i) + w.z * n.getZ(i) <= 0) return false;
  }
  return true;
}

test('a box is 10 triangles (no bottom), faces outward, in one bucket', () => {
  const k = new Kit();
  k.box('walls', LANDMARK_COLOURS.stone, 0, 0, 0, 4, 10, 6);
  expect(k.triangles).toBe(10);
  const g = k.group('box');
  expect(g.children.length).toBe(1);
  const m = g.children[0] as THREE.Mesh;
  expect(m.userData.bucket).toBe('walls');
  expect(outward(m.geometry, 0, 5, 0)).toBe(true);
  m.geometry.computeBoundingBox();
  const bb = m.geometry.boundingBox!;
  expect([bb.min.x, bb.max.x, bb.min.y, bb.max.y, bb.min.z, bb.max.z]).toEqual([-2, 2, 0, 10, -3, 3]);
  expect(countTriangles(g)).toBe(10);
});

test('prisms, spires, gables and discs face outward; push/turn moves and turns what follows', () => {
  const k = new Kit();
  k.prism('plain', LANDMARK_COLOURS.stone, 0, 0, 0, 3, 8, 8);
  expect(k.triangles).toBe(8 * 2 + 6);
  const g1 = (k.group('p').children[0] as THREE.Mesh).geometry;
  expect(outward(g1, 0, 4, 0)).toBe(true);

  const s = new Kit();
  s.spire('plain', LANDMARK_COLOURS.slate, 0, 10, 0, 2, 6, 4);
  expect(s.triangles).toBe(4);
  expect(outward((s.group('s').children[0] as THREE.Mesh).geometry, 0, 11, 0)).toBe(true);

  const r = new Kit();
  r.gable('plain', LANDMARK_COLOURS.slate, 0, 10, 0, 8, 20, 4);
  expect(r.triangles).toBe(6);
  expect(outward((r.group('r').children[0] as THREE.Mesh).geometry, 0, 10.5, 0)).toBe(true);

  const d = new Kit();
  d.disc('glow', LANDMARK_COLOURS.chalk, 0, 5, -2, 1, 12, [0, 0, -1]);
  expect(d.triangles).toBe(12);
  const dn = (d.group('d').children[0] as THREE.Mesh).geometry.getAttribute('normal');
  expect([dn.getX(0), dn.getY(0), dn.getZ(0)].map((v) => Math.round(v) + 0)).toEqual([0, 0, -1]);

  // a turned frame: 90 deg clockwise from above (compass), so local -z (front) faces east (+x)
  const t = new Kit();
  t.push(100, 0, 50, 90);
  t.box('walls', LANDMARK_COLOURS.stone, 0, 0, -10, 2, 2, 2);
  t.pop();
  t.box('walls', LANDMARK_COLOURS.stone, 0, 0, 0, 2, 2, 2);
  const tg = (t.group('t').children[0] as THREE.Mesh).geometry;
  tg.computeBoundingBox();
  expect(tg.boundingBox!.max.x).toBeCloseTo(111, 5);
  expect(tg.boundingBox!.min.x).toBeCloseTo(-1, 5);
  expect(outward(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute((tg.getAttribute('position').array as Float32Array).slice(0, 30 * 3), 3)).setAttribute('normal', new THREE.BufferAttribute((tg.getAttribute('normal').array as Float32Array).slice(0, 30 * 3), 3)), 110, 1, 50)).toBe(true);
});

test('a prism can be closed below (an overhang, a cornice: no sky through it from under)', () => {
  const k = new Kit();
  k.prism('plain', LANDMARK_COLOURS.stone, 0, 5, 0, 3, 2, 8, { bottom: true, r1: 2 });
  expect(k.triangles).toBe(8 * 2 + 6 + 6);
  const g = (k.group('p').children[0] as THREE.Mesh).geometry;
  expect(outward(g, 0, 6, 0)).toBe(true);
  // the bottom faces down, at y0, as wide as the base
  const p = g.getAttribute('position'), n = g.getAttribute('normal');
  let down = 0, maxR = 0;
  for (let i = 0; i < p.count; i++) {
    if (n.getY(i) < -0.99) {
      down++;
      expect(p.getY(i)).toBeCloseTo(5, 6);
      maxR = Math.max(maxR, Math.hypot(p.getX(i), p.getZ(i)));
    }
  }
  expect(down).toBe(6 * 3);
  expect(maxR).toBeCloseTo(3, 6);
});

test('landmark colours: limestone (the rail grey), copper (the pale sea-green) and a fixed red stone', () => {
  expect(LANDMARK_COLOURS.limestone).toBe(ROADS.rail);
  expect(LANDMARK_COLOURS.copper).toBe(CONTOUR.waterShallow);
  // the UK and Ireland's muted brick, whatever the region a model stands in
  expect(LANDMARK_COLOURS.redStone).toBe(regionStyle({ lat: 51.9033, lon: -8.4762 }).walls[0]);
  expect(contourColours(DEFAULT_REGION)).toContain(LANDMARK_COLOURS.redStone);
});

test('colours are stored linear, and every Contour colour is calm (the balloon stays the only saturated thing)', () => {
  const k = new Kit();
  k.box('walls', '#ffffff', 0, 0, 0, 1, 1, 1);
  k.box('plain', LANDMARK_COLOURS.chalk, 0, 0, 0, 1, 1, 1);
  const g = k.group('c');
  const c = (g.children[1] as THREE.Mesh).geometry.getAttribute('color');
  const lin = linearColour(LANDMARK_COLOURS.chalk);
  expect(c.getX(0)).toBeCloseTo(lin[0], 5);
  expect(lin[0]).toBeLessThan(parseInt(LANDMARK_COLOURS.chalk.slice(1, 3), 16) / 255);
  // (the coast blue and the sand are the most saturated of them, at 0.61 and 0.58; the balloon is 1)
  for (const hex of contourColours(DEFAULT_REGION)) expect(hslOf(hex).s, hex).toBeLessThanOrEqual(0.62);
  for (const hex of Object.values(LANDMARK_COLOURS)) expect(contourColours(DEFAULT_REGION)).toContain(hex);
  expect(contourColours(DEFAULT_REGION)).toContain(toHex([0xf4, 0xef, 0xe5]));
  // the kit keeps a list of the colours it was given, for the models' Contour-only check
  expect([...k.colours].sort()).toEqual(['#ffffff', LANDMARK_COLOURS.chalk].sort());
});
