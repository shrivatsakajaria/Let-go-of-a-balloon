import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { lightFor } from '../../src/world/palette';
import { FRAME_BUDGET, SunLight, shadowBudget, sunDirection } from '../../src/world/sunlight';
import { SHADOW_LAYER } from '../../src/world/tileview';

/** A flat-ish caster of `tris` triangles, a 20 m box at (x, z). */
function caster(x: number, z: number, tris: number, layer = 0): THREE.Mesh {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(tris * 9), 3));
  g.boundingBox = new THREE.Box3(new THREE.Vector3(-10, 0, -10), new THREE.Vector3(10, 20, 10));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 10, 0), 17.4);
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial());
  m.position.set(x, 0, z);
  m.castShadow = true;
  m.layers.set(layer);
  m.updateMatrixWorld();
  return m;
}

/** A field of casters every 100 m out to 1 km, 1,000 triangles each. */
function city(): THREE.Scene {
  const scene = new THREE.Scene();
  for (let x = -1000; x <= 1000; x += 100) for (let z = -1000; z <= 1000; z += 100) scene.add(caster(x, z, 1000, (x + z) % 200 === 0 ? 0 : SHADOW_LAYER));
  return scene;
}

describe('SunLight shadow budget', () => {
  const box = { radius: 900, mapSize: 1024, snap: 100, upM: 60, downM: 40 };

  it('counts what the shadow pass draws: casters in its box and its layers, visible ones only', () => {
    const s = new SunLight(lightFor(45), sunDirection(60, 200), { ...box, radius: 300 });
    s.place(new THREE.Vector3(0, 0, 0));
    const scene = new THREE.Scene();
    scene.add(caster(0, 0, 500), caster(0, 100, 400, SHADOW_LAYER), caster(3000, 0, 1000));
    const off = caster(50, 50, 7000);
    off.castShadow = false;
    const hidden = new THREE.Group();
    hidden.visible = false;
    hidden.add(caster(0, -50, 9000));
    scene.add(off, hidden);
    expect(s.casters(scene)).toEqual({ triangles: 900, calls: 2 });
  });

  it('keeps the wanted disc when the shadow pass fits the budget', () => {
    const s = new SunLight(lightFor(8), sunDirection(8, 250), box);
    s.place(new THREE.Vector3(0, 0, 0));
    const r = s.fit(city(), { triangles: 1e9, calls: 1e9 });
    expect(r.radius).toBe(900);
    expect(s.radius).toBe(900);
  });

  it('shrinks the disc until the shadow pass fits, never below the smallest disc', () => {
    const scene = city();
    const s = new SunLight(lightFor(8), sunDirection(8, 250), box);
    s.place(new THREE.Vector3(0, 0, 0));
    const full = s.casters(scene);
    const r = s.fit(scene, { triangles: full.triangles / 3, calls: 1e9 });
    expect(r.radius).toBeLessThan(900);
    expect(r.triangles).toBeLessThanOrEqual(full.triangles / 3);
    expect(s.casters(scene)).toEqual({ triangles: r.triangles, calls: r.calls });
    // by draw calls too
    const c = s.fit(scene, { triangles: 1e9, calls: 100 });
    expect(c.calls).toBeLessThanOrEqual(100);
    // an impossible budget: the smallest disc
    const tiny = s.fit(scene, { triangles: 1, calls: 1 });
    expect(tiny.radius).toBe(s.minRadius);
  });

  it('asking for a new disc is a redraw; fitting again to the same disc is not', () => {
    const s = new SunLight(lightFor(8), sunDirection(8, 250), box);
    expect(s.setRadius(900)).toBe(false);
    expect(s.setRadius(700)).toBe(true);
    s.fit(city(), { triangles: 1, calls: 1 });
    expect(s.setRadius(700)).toBe(false);
  });
});

describe('shadowBudget', () => {
  it('gives the shadow pass what the view leaves of the frame, within bounds', () => {
    expect(shadowBudget({ triangles: 400_000, calls: 100 })).toEqual({ triangles: FRAME_BUDGET.triangles - 400_000, calls: FRAME_BUDGET.calls - 100 });
    expect(shadowBudget({ triangles: 0, calls: 0 })).toEqual({ triangles: 250_000, calls: 140 });
    expect(shadowBudget({ triangles: 900_000, calls: 400 })).toEqual({ triangles: 30_000, calls: 16 });
    expect(FRAME_BUDGET.triangles).toBeLessThan(600_000);
    expect(FRAME_BUDGET.calls).toBeLessThan(250);
  });
});
