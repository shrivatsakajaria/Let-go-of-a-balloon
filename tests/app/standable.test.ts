import { expect, test } from 'vitest';
import * as THREE from 'three';
import { standableGround, startLiftM, type GroundSources } from '../../src/app/standable';
import { Director } from '../../src/camera/director';
import { displayScale } from '../../src/balloon/balloon';
import type { RoutePoint } from '../../src/flight/route';
import type { LatLon } from '../../src/geo/coords';

// Flat local frame: 1 deg = 111 km, x east, z = -north, origin at (50, 0).
const K = 111_000;
const toScene = (p: LatLon) => ({ x: p.lon * K, z: -(p.lat - 50) * K });
const DRAWN = 528, TERRACE = 700;
/** A summit terrace 172 m over the drawn ground: 60 m across, round (50, 0). */
const onTerrace = (p: LatLon) => Math.hypot(toScene(p).x, toScene(p).z) < 30;
const corcovado: GroundSources = { groundAt: () => DRAWN, landmarkGroundAt: (p) => (onTerrace(p) ? TERRACE : -Infinity) };
const plain: GroundSources = { groundAt: () => DRAWN, landmarkGroundAt: () => -Infinity };

test("standable ground is the landmark's ground where it is higher than the drawn ground, else the drawn ground", () => {
  expect(standableGround(corcovado, { lat: 50, lon: 0 })).toBe(TERRACE);
  expect(standableGround(corcovado, { lat: 50.01, lon: 0 })).toBe(DRAWN);
  expect(standableGround(plain, { lat: 50, lon: 0 })).toBe(DRAWN);
  // a landmark's ground below the drawn ground does not sink anything
  expect(standableGround({ groundAt: () => 10, landmarkGroundAt: () => 4 }, { lat: 50, lon: 0 })).toBe(10);
});

test('the route start is lifted by the terrace over the drawn ground, and not at all elsewhere', () => {
  expect(startLiftM(corcovado, { lat: 50, lon: 0 })).toBe(TERRACE - DRAWN);
  expect(startLiftM(corcovado, { lat: 50.01, lon: 0 })).toBe(0);
  expect(startLiftM(plain, { lat: 50, lon: 0 })).toBe(0);
});

test('the street camera on a landmark terrace stands on the terrace, not inside the rock', () => {
  const cam = new THREE.PerspectiveCamera(50, 390 / 844, 0.05, 100000);
  const d = new Director(cam, { toScene, groundAt: (p) => standableGround(corcovado, p), balloonRadius: (r) => 0.15 * displayScale(r) });
  const person = { lat: 50, lon: 0 };
  d.setLaunch({ personAt: person, startUtcMs: 0, waiting: { centerY: 0.2, spanY: 0.8 } });
  const held = (t: number): RoutePoint => ({ tSec: t, lat: 50, lon: 0, altM: TERRACE + 2.4, groundM: TERRACE, speedMs: 3, headingDeg: 90 });
  for (let i = 1; i <= 50; i++) d.update(held(i * 0.1), 0.1);
  expect(cam.position.y).toBeGreaterThan(TERRACE + 1);
  expect(cam.position.y).toBeLessThan(TERRACE + 3);
});
