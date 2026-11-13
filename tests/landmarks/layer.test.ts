import { expect, test } from 'vitest';
import * as THREE from 'three';
import cities from '../../data/cities.json';
import { haversineKm, type LatLon } from '../../src/geo/coords';
import { LandmarkLayer } from '../../src/landmarks/layer';
import { modelToLatLon, siteById } from '../../src/landmarks/registry';
import { Kit, LANDMARK_COLOURS } from '../../src/landmarks/kit';
import type { LandmarkModel, LandmarkSite } from '../../src/landmarks/types';
import { lightFor } from '../../src/world/palette';
import { WorldStream, type BuildPool } from '../../src/world/stream';
import { DEFAULT_REGION } from '../../src/world/palette';

const london = (cities as { id: string; launch: LatLon }[]).find((c) => c.id === 'london')!.launch;
const SQUARE = { lat: london.lat, lon: london.lon };
const never: BuildPool = { request: () => new Promise(() => {}) };
/** Until the model modules are in (the first import of each takes a moment). */
const flush = async (layer?: LandmarkLayer, n = 2) => {
  for (let i = 0; i < 200 && (layer ? layer.shown().length < n : i < 5); i++) await new Promise((r) => setTimeout(r, 5));
};

function setup(ground = 12, zoom = 14) {
  const scene = new THREE.Scene();
  const stream = new WorldStream(scene, never, () => DEFAULT_REGION, { vectorUrl: 'x/{z}/{x}/{y}', origin: SQUARE });
  let t = 0;
  const host = { scene, toScene: stream.toScene.bind(stream), groundAt: () => ground, zoomAt: () => zoom, materials: stream.materials };
  const layer = new LandmarkLayer(host, { now: () => t });
  return { scene, stream, layer, host, tick: (ms: number) => (t += ms) };
}

const groups = (scene: THREE.Scene) => scene.children.filter((c) => c.userData.landmark);

test('near Parliament Square the Westminster landmarks load, stand on the ground and face their heading', async () => {
  const { scene, stream, layer, tick } = setup();
  const day = lightFor(30);
  layer.update(SQUARE, Date.UTC(2026, 10, 13, 12), day);
  await flush(layer);
  tick(16);
  layer.update(SQUARE, Date.UTC(2026, 10, 13, 12), day);
  const shown = groups(scene);
  expect(shown.map((g) => g.userData.landmark).sort()).toEqual(['london-elizabeth-tower', 'london-palace-of-westminster']);
  const tower = shown.find((g) => g.userData.landmark === 'london-elizabeth-tower')!;
  const site = siteById('london-elizabeth-tower')!;
  const s = stream.toScene(site.at);
  expect(tower.position.x).toBeCloseTo(s.x, 3);
  expect(tower.position.z).toBeCloseTo(s.z, 3);
  expect(tower.position.y).toBeCloseTo(12, 3);
  expect(tower.rotation.y).toBeCloseTo((-site.headingDeg * Math.PI) / 180, 6);
  // the shared Contour materials: walls with windows, plain stone and roofs, and the dials' glow
  const meshes: THREE.Mesh[] = [];
  for (const g of shown) g.traverse((o) => (o as THREE.Mesh).isMesh && meshes.push(o as THREE.Mesh));
  const walls = meshes.find((m) => m.userData.bucket === 'walls')!;
  const plain = meshes.find((m) => m.userData.bucket === 'plain')!;
  expect(walls.material).toBe(stream.materials.solid.buildings);
  expect(plain.material).toBe(stream.materials.solid.roofs);
  // every mesh reads its fade from a tile slot, fading in from the haze
  const slot = (walls.geometry.getAttribute('aSlot') as THREE.BufferAttribute).getX(0);
  expect(slot).toBeGreaterThan(0);
  expect(stream.materials.slots.get(slot).x).toBeLessThan(1);
  tick(2000);
  layer.update(SQUARE, Date.UTC(2026, 10, 13, 12), day);
  expect(stream.materials.slots.get(slot).x).toBe(1);
  // tops for the camera: the tower is 96 m over its ground
  expect(layer.topAt(site.at, 5)).toBeGreaterThan(12 + 94);
  expect(layer.topAt({ lat: 51.52, lon: -0.12 }, 50)).toBe(-Infinity);
  // Parliament Square itself is open: no landmark over it
  expect(layer.topAt(SQUARE, 3)).toBe(-Infinity);
  layer.dispose();
});

test('the clock faces light from dusk', async () => {
  const { scene, layer, tick } = setup();
  const at = Date.UTC(2026, 10, 13, 12);
  layer.update(SQUARE, at, lightFor(30));
  await flush(layer);
  tick(16);
  layer.update(SQUARE, at, lightFor(30));
  const tower = groups(scene).find((g) => g.userData.landmark === 'london-elizabeth-tower')!;
  let glow: THREE.Mesh | undefined;
  tower.traverse((o) => o.userData.bucket === 'glow' && (glow = o as THREE.Mesh));
  const mat = glow!.material as THREE.MeshStandardMaterial;
  expect(mat.emissiveIntensity).toBe(0);
  layer.update(SQUARE, at, lightFor(-1, false));
  const dusk = mat.emissiveIntensity;
  expect(dusk).toBeGreaterThan(0);
  layer.update(SQUARE, at, lightFor(-14, false));
  expect(mat.emissiveIntensity).toBeGreaterThanOrEqual(dusk);
  layer.dispose();
});

test('landmarks are dropped and freed once the focus is far away, and wait for fine ground', async () => {
  const s = setup(12, 10);
  const day = lightFor(30);
  s.layer.update(SQUARE, 0, day);
  await flush(s.layer);
  s.layer.update(SQUARE, 0, day);
  // the street's own tile is not in yet: kept out of sight
  expect(groups(s.scene).every((g) => !g.visible)).toBe(true);
  const manchester = { lat: 53.4794, lon: -2.2453 };
  expect(haversineKm(SQUARE, manchester)).toBeGreaterThan(100);
  let disposed = 0;
  for (const g of groups(s.scene)) g.traverse((o) => (o as THREE.Mesh).isMesh && (o as THREE.Mesh).geometry.addEventListener('dispose', () => disposed++));
  const free = s.stream.materials.slots.available;
  s.layer.update(manchester, 0, day);
  expect(groups(s.scene)).toHaveLength(0);
  expect(disposed).toBeGreaterThan(0);
  expect(s.stream.materials.slots.available).toBeGreaterThan(free);
  s.layer.dispose();
});

/** A layer with one site at SQUARE, its model built by `build` (or loaded by `models`). */
function oneModel(build: () => THREE.Group, models?: Record<string, () => Promise<LandmarkModel>>, id = 'test-thing') {
  const scene = new THREE.Scene();
  const stream = new WorldStream(scene, never, () => DEFAULT_REGION, { vectorUrl: 'x/{z}/{x}/{y}', origin: SQUARE });
  let t = 0;
  const site: LandmarkSite = { id, cityId: 'test', name: 'Thing', at: SQUARE, headingDeg: 0, footprintRadiusM: 150 };
  const host = { scene, toScene: stream.toScene.bind(stream), groundAt: () => 10, zoomAt: () => 14, materials: stream.materials };
  const layer = new LandmarkLayer(host, { sites: [site], models: models ?? { [id]: async () => ({ build }) }, now: () => t });
  return { scene, layer, site, tick: (ms: number) => (t += ms) };
}

test('thin overhead parts marked userData.noTops (ropes, chains) do not count as tops for the camera', async () => {
  const { layer, site, tick } = oneModel(() => {
    const k = new Kit();
    k.box('walls', LANDMARK_COLOURS.stone, 0, 0, 0, 10, 30, 10);
    const g = k.group('test-thing');
    // ropes from a mast 100 m west, high over the ground, down to the tower: one along x, one across
    const r = new Kit();
    r.quad('plain', LANDMARK_COLOURS.iron, [-100, 80, -0.3], [0, 30, -0.3], [0, 30, 0.3], [-100, 80, 0.3], [0, 1, 0]);
    r.quad('plain', LANDMARK_COLOURS.iron, [-100, 80, 40], [0, 30, -40], [0, 30.5, -40], [-100, 80.5, 40], [0, 1, 0]);
    const rope = r.mesh('plain', 'rope')!;
    rope.userData.noTops = true;
    g.add(rope);
    return g;
  });
  const day = lightFor(30);
  layer.update(SQUARE, 0, day);
  await flush(layer, 1);
  tick(16);
  layer.update(SQUARE, 0, day);
  // the tower counts: 30 m over its ground (10)
  expect(layer.topAt(site.at, 3)).toBeCloseTo(40, 3);
  // under the ropes, 50 m west of it, there is nothing for the camera to keep out of
  expect(layer.topAt(modelToLatLon(site, -50, 10), 3)).toBe(-Infinity);
  layer.dispose();
});

test('a model that fails to import (offline) is tried again after 5 s, 20 s, then every 60 s, without the focus moving', async () => {
  let calls = 0;
  const build = () => {
    const k = new Kit();
    k.box('walls', LANDMARK_COLOURS.stone, 0, 0, 0, 10, 30, 10);
    return k.group('test-retry');
  };
  const models = {
    'test-retry': async (): Promise<LandmarkModel> => {
      calls++;
      if (calls <= 3) throw new Error('offline');
      return { build };
    },
  };
  const warn = console.warn;
  console.warn = () => {};
  try {
    const { layer, tick } = oneModel(build, models, 'test-retry');
    const day = lightFor(30);
    const step = async (ms: number) => {
      tick(ms);
      layer.update(SQUARE, 0, day);
      await flush();
    };
    await step(0);
    expect(calls).toBe(1);
    await step(4900);
    expect(calls).toBe(1);
    await step(200); // 5.1 s
    expect(calls).toBe(2);
    await step(19000);
    expect(calls).toBe(2);
    await step(1200); // 20 s after the second
    expect(calls).toBe(3);
    await step(59000);
    expect(calls).toBe(3);
    await step(1200); // 60 s after the third
    expect(calls).toBe(4);
    await step(16);
    expect(layer.shown()).toEqual(['test-retry']);
    layer.dispose();
  } finally {
    console.warn = warn;
  }
});

test("a landmark's own ground (meshes marked userData.ground: a terrace, a rock) is standable; its statue is not", async () => {
  const { layer, site, tick } = oneModel(() => {
    // a 40 m x 60 m terrace 30 m up (ground), a 25 m statue on it (not ground)
    const kg = new Kit();
    kg.box('plain', LANDMARK_COLOURS.stone, 0, -5, 0, 40, 35, 60);
    const k = new Kit();
    k.box('walls', LANDMARK_COLOURS.chalk, 0, 30, 10, 4, 25, 4);
    const g = k.group('test-terrace');
    const ground = kg.mesh('plain', 'test-terrace-ground')!;
    ground.userData.ground = true;
    g.add(ground);
    return g;
  }, undefined, 'test-terrace');
  const day = lightFor(30);
  // before the model is in, nothing is known to stand on, and the start is not settled
  expect(layer.groundAt(site.at)).toBe(-Infinity);
  layer.update(SQUARE, 0, day);
  expect(layer.settledAt(site.at)).toBe(false);
  await flush(layer, 1);
  tick(16);
  layer.update(SQUARE, 0, day);
  expect(layer.settledAt(site.at)).toBe(true);
  // the terrace: its top over the site's ground (10)
  expect(layer.groundAt(modelToLatLon(site, 5, -20))).toBeCloseTo(40, 3);
  // where the statue stands, still the terrace (the statue is a top, not ground)
  expect(layer.groundAt(modelToLatLon(site, 0, 10))).toBeCloseTo(40, 3);
  expect(layer.topAt(modelToLatLon(site, 0, 10), 1)).toBeCloseTo(65, 3);
  // off the terrace: none
  expect(layer.groundAt(modelToLatLon(site, 40, 0))).toBe(-Infinity);
  // far from any landmark the start is settled at once
  expect(layer.settledAt({ lat: 52, lon: -1 })).toBe(true);
  layer.dispose();
});
