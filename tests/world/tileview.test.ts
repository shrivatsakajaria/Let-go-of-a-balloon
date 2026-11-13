import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createHaze } from '../../src/world/haze';
import { ContourMaterials, SLOT_COUNT, TileSlots, noCoverage } from '../../src/world/materials';
import { SHADOW_LAYER, TileView } from '../../src/world/tileview';
import { lightFor } from '../../src/world/palette';

const quad = (y: number) => ({
  position: new Float32Array([0, y, 0, 1, y, 0, 0, y, -1, 1, y, 0, 1, y, -1, 0, y, -1]),
  normal: new Float32Array(18).map((_, i) => (i % 3 === 1 ? 1 : 0)),
  color: new Float32Array(18).fill(0.5),
});
const empty = () => ({ position: new Float32Array(0), normal: new Float32Array(0), color: new Float32Array(0) });
const tree = new Float32Array(16 * 2);
for (const k of [0, 16]) for (const d of [0, 5, 10, 15]) tree[k + d] = 1;

describe('TileSlots', () => {
  it('hands out every slot but the always-in one, and takes them back', () => {
    const s = new TileSlots();
    const got = new Set<number>();
    for (let i = 0; i < SLOT_COUNT - 1; i++) got.add(s.alloc(14));
    expect(got.size).toBe(SLOT_COUNT - 1);
    expect(got.has(0)).toBe(false);
    expect(s.alloc(14)).toBe(-1);
    s.release(5);
    s.release(5);
    expect(s.available).toBe(1);
    expect(s.get(5).x).toBe(1);
    expect(s.alloc(13, true)).toBe(5);
    expect(s.get(5).toArray()).toEqual([0, 13, 1, 0]);
  });
});

describe('TileView', () => {
  const mats = new ContourMaterials(createHaze(lightFor(8), new THREE.Vector3(0, 1, 0)), noCoverage(), { groundTint: '#ffffff' });
  const buffers = { ground: quad(0), water: empty(), waterways: empty(), roads: quad(0.3), buildings: quad(5), roofs: empty(), trees: tree };

  it('draws each non-empty bucket on the shared materials, with its slot', () => {
    const v = new TileView(buffers, mats, { zoom: 14, castShadow: true, clip: false });
    const meshes = v.group.children as THREE.Mesh[];
    expect(meshes.map((m) => (m.material as THREE.Material).name)).toEqual([
      'contour-ground-solid', 'contour-roads-solid', 'contour-buildings-solid', 'contour-trees-solid',
    ]);
    expect(meshes[2].castShadow).toBe(true);
    expect(meshes[0].castShadow).toBe(false);
    expect((meshes[3] as THREE.InstancedMesh).count).toBe(2);
    expect(meshes[0].geometry.getAttribute('aSlot').getX(0)).toBe(v.slot);
    v.setClip(true);
    expect((meshes[0].material as THREE.Material).name).toBe('contour-ground-clip');
    v.dispose();
  });

  it('dispose frees its geometries, instance buffers and slot, and leaves the shared materials', () => {
    const free = mats.slots.available;
    const v = new TileView(buffers, mats, { zoom: 13, castShadow: false, clip: true, dither: true });
    expect(mats.slots.available).toBe(free - 1);
    expect(mats.slots.get(v.slot).z).toBe(1);
    const scene = new THREE.Scene();
    scene.add(v.group);
    const disposed: string[] = [];
    v.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.addEventListener('dispose', () => disposed.push(o.type));
      if ((o as THREE.InstancedMesh).isInstancedMesh) o.addEventListener('dispose', () => disposed.push('instances'));
    });
    let matDisposed = false;
    mats.clip.ground.addEventListener('dispose', () => (matDisposed = true));
    v.dispose();
    expect(disposed.sort()).toEqual(['Mesh', 'Mesh', 'Mesh', 'Mesh', 'instances']); // three geometries, the tree cone copy, the instances
    expect(scene.children).toHaveLength(0);
    expect(mats.slots.available).toBe(free);
    expect(matDisposed).toBe(false);
  });

  it('a bucket sorted by cell: one mesh per quarter in view, one shadow-only mesh per cell, all on shared buffers', () => {
    // a 100 m tile: two triangles in cells 0 and 1 (south-west quarter), one in cell 15 (north-east)
    const tri = (x: number, z: number) => [x, 5, z, x + 1, 5, z, x, 5, z - 1];
    const position = new Float32Array([...tri(10, -10), ...tri(30, -10), ...tri(90, -90)]);
    const parts = new Uint32Array(17);
    parts.fill(6, 2);
    parts[1] = 3;
    parts[16] = 9;
    const walls = { position, normal: new Float32Array(27).map((_, i) => (i % 3 === 1 ? 1 : 0)), color: new Float32Array(27).fill(0.5), parts };
    const v = new TileView({ ...buffers, roads: empty(), trees: new Float32Array(0), buildings: walls }, mats, { zoom: 14, castShadow: true, clip: false });
    const walled = (v.group.children as THREE.Mesh[]).filter((m) => (m.material as THREE.Material).name === 'contour-buildings-solid');
    const inView = walled.filter((m) => m.layers.isEnabled(0));
    const shadowOnly = walled.filter((m) => m.layers.isEnabled(SHADOW_LAYER) && !m.layers.isEnabled(0));
    expect(inView).toHaveLength(2);
    expect(shadowOnly).toHaveLength(3);
    expect(walled.every((m) => m.geometry.getAttribute('position') === walled[0].geometry.getAttribute('position'))).toBe(true);
    expect(inView.map((m) => [m.geometry.drawRange.start, m.geometry.drawRange.count])).toEqual([[0, 6], [6, 3]]);
    expect(shadowOnly.map((m) => [m.geometry.drawRange.start, m.geometry.drawRange.count])).toEqual([[0, 3], [3, 3], [6, 3]]);
    expect(inView[0].geometry.boundingSphere!.center.x).toBeCloseTo(20.5, 5);
    expect(inView[1].geometry.boundingSphere!.center.x).toBeCloseTo(90.5, 5);
    expect(shadowOnly[0].geometry.boundingSphere!.radius).toBeLessThan(1);
    // the view meshes do not cast (the cell meshes do), so nothing is drawn twice into the shadow map
    expect(inView.some((m) => m.castShadow)).toBe(false);
    expect(shadowOnly.every((m) => m.castShadow)).toBe(true);
    expect(v.triangles).toBe(2 + 3);
    v.dispose();
    // a tile that casts no shadows gets no shadow-only meshes
    const quiet = new TileView({ ...buffers, roads: empty(), trees: new Float32Array(0), buildings: { ...walls, position: position.slice(), color: walls.color.slice() } }, mats, { zoom: 13, castShadow: false, clip: false });
    expect(quiet.group.children.filter((m) => m.layers.isEnabled(SHADOW_LAYER) && !m.layers.isEnabled(0))).toHaveLength(0);
    quiet.dispose();
  });
});

describe('TileView: lamps, boats and failures (Task 11)', () => {
  const mats = new ContourMaterials(createHaze(lightFor(8), new THREE.Vector3(0, 1, 0)), noCoverage(), { groundTint: '#ffffff' });
  const lamps = Float32Array.from([10, 30, -10, 20, 31, -20, 30, 32, -30]);
  const boats = Float32Array.from([100, 0, -100, 0.5, 60]);
  const withAll = { ground: quad(0), water: empty(), waterways: empty(), roads: empty(), buildings: empty(), roofs: empty(), trees: new Float32Array(0), lamps, boats };

  it('street lamps are one point each on the shared lamp material, shown only at night', () => {
    const v = new TileView(withAll, mats, { zoom: 14, castShadow: false, clip: false });
    const pts = v.group.children.find((o) => (o as THREE.Points).isPoints) as THREE.Points;
    expect(pts).toBeDefined();
    expect(pts.material).toBe(mats.lamps);
    expect(pts.geometry.getAttribute('position').count).toBe(3);
    expect(pts.geometry.getAttribute('aSlot').getX(0)).toBe(v.slot);
    expect(pts.visible).toBe(false);
    v.setNight(0.6);
    expect(pts.visible).toBe(true);
    v.setNight(0);
    expect(pts.visible).toBe(false);
    v.dispose();
  });

  it('boats are instanced hulls on the shared boat material, placed, turned and sized', () => {
    const v = new TileView(withAll, mats, { zoom: 13, castShadow: false, clip: true });
    const b = v.group.children.find((o) => (o as THREE.Mesh).material === mats.clip.boats) as THREE.InstancedMesh;
    expect(b.isInstancedMesh).toBe(true);
    expect(b.count).toBe(1);
    const m = new THREE.Matrix4();
    b.getMatrixAt(0, m);
    const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    m.decompose(p, q, s);
    expect(p.toArray()).toEqual([100, 0, -100]);
    expect(s.x).toBeCloseTo(60, 4);
    expect(b.castShadow).toBe(false);
    expect(v.triangles).toBeGreaterThan(2);
    v.dispose();
  });

  it('a failure while building gives the slot back and leaves nothing behind', () => {
    const free = mats.slots.available;
    const bad = { ...withAll, roads: { position: new Float32Array(9), normal: new Float32Array(3), color: new Float32Array(9) } };
    expect(() => new TileView(bad, mats, { zoom: 14, castShadow: true, clip: false })).toThrow();
    expect(mats.slots.available).toBe(free);
  });

  it('carries the glow of ground and roads as aGlow', () => {
    const g = { ...quad(0), glow: new Uint8Array(6).fill(200) };
    const v = new TileView({ ...withAll, ground: g }, mats, { zoom: 14, castShadow: false, clip: false });
    const ground = v.group.children[0] as THREE.Mesh;
    expect(ground.geometry.getAttribute('aGlow').getX(0)).toBeCloseTo(200 / 255, 6);
    v.dispose();
  });
});
