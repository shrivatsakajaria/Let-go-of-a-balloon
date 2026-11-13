import { expect, test } from 'vitest';
import * as THREE from 'three';
import cities from '../../data/cities.json';
import { haversineKm, type LatLon } from '../../src/geo/coords';
import { LandmarkLayer } from '../../src/landmarks/layer';
import { siteById } from '../../src/landmarks/registry';
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
  tower.traverse((o) => (o as THREE.Mesh).isMesh && meshes.push(o as THREE.Mesh));
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
