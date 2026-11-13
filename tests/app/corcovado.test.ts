import { expect, test } from 'vitest';
import * as THREE from 'three';
import cities from '../../data/cities.json';
import { LandmarkLayer } from '../../src/landmarks/layer';
import { siteById } from '../../src/landmarks/registry';
import { standableGround, startLiftM, type GroundSources } from '../../src/app/standable';
import { Director } from '../../src/camera/director';
import { displayScale } from '../../src/balloon/balloon';
import type { RoutePoint } from '../../src/flight/route';
import type { LatLon } from '../../src/geo/coords';
import { lightFor, DEFAULT_REGION } from '../../src/world/palette';
import { WorldStream, type BuildPool } from '../../src/world/stream';

const rio = (cities as { id: string; launch: LatLon & { headingDeg: number } }[]).find((c) => c.id === 'rio-de-janeiro')!.launch;
const DRAWN = 516; // the drawn ground on Corcovado (the elevation data lost the needle)
const never: BuildPool = { request: () => new Promise(() => {}) };

async function corcovado() {
  const site = siteById('rio-de-janeiro-christ-the-redeemer')!;
  const scene = new THREE.Scene();
  const stream = new WorldStream(scene, never, () => DEFAULT_REGION, { vectorUrl: 'x/{z}/{x}/{y}', origin: rio });
  const layer = new LandmarkLayer({ scene, toScene: stream.toScene.bind(stream), groundAt: () => DRAWN, zoomAt: () => 14, materials: stream.materials }, { sites: [site] });
  layer.update(rio, 0, lightFor(30));
  for (let i = 0; i < 400 && !layer.settledAt(rio); i++) {
    await new Promise((r) => setTimeout(r, 5));
    layer.update(rio, 0, lightFor(30));
  }
  const ground: GroundSources = { groundAt: () => DRAWN, landmarkGroundAt: (p) => layer.groundAt(p) };
  return { stream, layer, ground };
}

test('Corcovado: the launch spot stands on the terrace, and the route starts there', async () => {
  const { layer, ground } = await corcovado();
  expect(layer.settledAt(rio)).toBe(true);
  expect(standableGround(ground, rio)).toBeCloseTo(DRAWN + 172, 0);
  expect(startLiftM(ground, rio)).toBeCloseTo(172, 0);
  layer.dispose();
});

test('Corcovado: the waiting and launch cameras stand at eye height on the terrace, whatever the wind', async () => {
  const { stream, layer, ground } = await corcovado();
  for (let wind = 0; wind < 360; wind += 30) {
    const cam = new THREE.PerspectiveCamera(50, 390 / 844, 0.05, 100000);
    const d = new Director(cam, {
      toScene: (p) => stream.toScene(p),
      groundAt: (p) => standableGround(ground, p),
      buildingTopAt: (p, r) => layer.topAt(p, r),
      balloonRadius: (r) => 0.15 * displayScale(r),
    });
    const feet = standableGround(ground, rio);
    const held = (t: number): RoutePoint => ({ tSec: t, lat: rio.lat, lon: rio.lon, altM: feet + 2.4, groundM: feet, speedMs: 9.5, headingDeg: wind });
    d.setLaunch({ personAt: rio, landmarkHeadingDeg: rio.headingDeg, startUtcMs: 0, waiting: { centerY: 0.2, spanY: 0.8 } });
    for (let i = 1; i <= 300; i++) d.update(held(i * 0.1), 0.1);
    const g = standableGround(ground, stream.fromScene(cam.position.x, cam.position.z));
    expect(cam.position.y - g, `waiting, wind ${wind}`).toBeGreaterThan(0.5);
    expect(cam.position.y - feet, `waiting, wind ${wind}`).toBeLessThan(4);
  }
  layer.dispose();
});

test('Praia Vermelha (Sugarloaf): its model carries no ground, so the drawn ground stays the ground there', async () => {
  const site = siteById('rio-de-janeiro-sugarloaf')!;
  const beach = { lat: -22.9554, lon: -43.1647 };
  const scene = new THREE.Scene();
  const stream = new WorldStream(scene, never, () => DEFAULT_REGION, { vectorUrl: 'x/{z}/{x}/{y}', origin: beach });
  const layer = new LandmarkLayer({ scene, toScene: stream.toScene.bind(stream), groundAt: () => 3, zoomAt: () => 14, materials: stream.materials }, { sites: [site] });
  layer.update(beach, 0, lightFor(30));
  for (let i = 0; i < 400 && !layer.settledAt(beach); i++) {
    await new Promise((r) => setTimeout(r, 5));
    layer.update(beach, 0, lightFor(30));
  }
  expect(layer.settledAt(beach)).toBe(true);
  const ground: GroundSources = { groundAt: () => 3, landmarkGroundAt: (p) => layer.groundAt(p) };
  expect(layer.groundAt(beach)).toBe(-Infinity);
  expect(standableGround(ground, beach)).toBe(3);
  expect(startLiftM(ground, beach)).toBe(0);
  layer.dispose();
});
