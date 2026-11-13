import { describe, expect, test } from 'vitest';
import type { Route, RoutePoint } from '../../src/flight/route';
import * as THREE from 'three';
import { cardView, corridorTiles, farCamera, farShot, lookBack, NEAR_START_KM } from '../../src/app/cardshot';
import { lonLatToTile } from '../../src/geo/coords';
import { M_PER_DEG } from '../../src/world/frame';

function route(dLat: number, dLon: number, n = 433): Route {
  const points: RoutePoint[] = Array.from({ length: n }, (_, i) => ({ tSec: i * 600, lat: 53.5 + (dLat * i) / (n - 1), lon: -2.2 + (dLon * i) / (n - 1), altM: 1500, groundM: 0, speedMs: 5, headingDeg: 0 }));
  return { points, hourly: points.filter((_, i) => i % 6 === 0), release: 0, runId: 'x' };
}

describe('the card camera', () => {
  test('a short route turns less, so its start stays in the picture (half the field is about 19 degrees)', () => {
    const v = cardView(route(0.2, 0)); // 22 km north
    const off = Math.abs(((v.viewDeg - 180 + 540) % 360) - 180);
    expect(off).toBeGreaterThan(5);
    expect(off).toBeLessThanOrEqual(14);
  });

  test('looks from the landing back along the route', () => {
    expect(lookBack(route(5, 0))).toBeCloseTo(180, 0); // flew north: look south
    expect(lookBack(route(0, 8))).toBeGreaterThan(268); // flew east: look west
    expect(lookBack(route(0, 8))).toBeLessThan(272);
  });

  test('a balloon that hardly moved still gets a direction', () => {
    expect(Number.isFinite(lookBack(route(0, 0)))).toBe(true);
  });

  test('stands off the line of the route, so the trail runs across the picture rather than straight up behind the balloon', () => {
    const v = cardView(route(5, 0));
    const off = Math.abs(((v.viewDeg - 180 + 540) % 360) - 180);
    expect(off).toBeGreaterThanOrEqual(15);
    expect(off).toBeLessThanOrEqual(40);
    // golden hour, low, and across the view rather than behind the camera (front light turns the clay
    // slopes orange); outside the picture (half the horizontal field is about 19 degrees)
    expect(v.sun.elevationDeg).toBeGreaterThan(3);
    expect(v.sun.elevationDeg).toBeLessThan(12);
    const fromView = Math.abs(((v.sun.azimuthDeg - v.viewDeg + 540) % 360) - 180);
    expect(fromView).toBeGreaterThan(25);
    expect(fromView).toBeLessThan(80);
  });
});

/** Route from a to b, straight, 433 points. */
function between(a: { lat: number; lon: number }, b: { lat: number; lon: number }): Route {
  const points: RoutePoint[] = Array.from({ length: 433 }, (_, i) => ({ tSec: i * 600, lat: a.lat + ((b.lat - a.lat) * i) / 432, lon: a.lon + ((b.lon - a.lon) * i) / 432, altM: 1500, groundM: 0, speedMs: 5, headingDeg: 0 }));
  return { points, hourly: points.filter((_, i) => i % 6 === 0), release: 0, runId: 'x' };
}

/** Where p lands in the card's frame (0..1 across and down), seen by the far camera, on ground at 0 m. */
function onFrame(route: Route, p: { lat: number; lon: number }) {
  const last = route.points[route.points.length - 1];
  const shot = farShot(route);
  const cam = farCamera(shot, 0, 1.08);
  const x = (p.lon - last.lon) * M_PER_DEG * Math.cos((last.lat * Math.PI) / 180);
  const z = -(p.lat - last.lat) * M_PER_DEG;
  const v = new THREE.Vector3(x, 0, z);
  const d = v.distanceTo(cam.position);
  v.project(cam);
  return { x: (v.x + 1) / 2, y: (1 - v.y) / 2, inside: v.z > -1 && v.z < 1, d, shot };
}

describe('the card camera for a long route (both ends in the picture)', () => {
  const MANCHESTER = { lat: 53.4794, lon: -2.2453 };
  const BERGEN = { lat: 60.39, lon: 5.32 };
  const SEA = { lat: 56.4, lon: 3.1 };

  for (const [name, end, km] of [['Manchester to Bergen', BERGEN, 900], ['Manchester to the North Sea', SEA, 470], ['a 60 km hop', { lat: 53.9, lon: -1.6 }, 60]] as const) {
    test(`${name}: the landing low in the picture, the start near the horizon, both in frame and the start inside the haze`, () => {
      const r = between(MANCHESTER, end);
      const land = onFrame(r, end);
      const start = onFrame(r, MANCHESTER);
      expect(land.inside && start.inside).toBe(true);
      expect(land.y).toBeGreaterThan(0.5);
      expect(land.y).toBeLessThan(0.66); // above the fade into ink
      expect(start.y).toBeGreaterThan(0.12);
      expect(start.y).toBeLessThan(0.4);
      expect(start.y).toBeLessThan(land.y - 0.15);
      for (const p of [land, start]) {
        expect(p.x).toBeGreaterThan(0.08);
        expect(p.x).toBeLessThan(0.92);
      }
      expect(start.d).toBeLessThan(start.shot.fogFar);
      expect(land.d).toBeLessThanOrEqual(start.shot.fogNear);
      expect(km).toBeGreaterThan(NEAR_START_KM);
    });
  }

  test('the corridor of coarse land covers both ends and stays within a sensible number of tiles', () => {
    const r = between(MANCHESTER, BERGEN);
    const tiles = corridorTiles(r, farShot(r));
    const key = (p: { lat: number; lon: number }) => {
      const t = lonLatToTile(p.lat, p.lon, 7);
      return `7/${Math.floor(t.x)}/${Math.floor(t.y)}`;
    };
    const keys = tiles.map((t) => `${t.z}/${t.x}/${t.y}`);
    expect(keys).toContain(key(MANCHESTER));
    expect(keys).toContain(key(BERGEN));
    expect(new Set(keys).size).toBe(keys.length);
    expect(tiles.length).toBeLessThanOrEqual(80);
    // the landing first, then the start, then the tiles under the trail, then the rest of the view
    expect(keys[0]).toBe(key(BERGEN));
    expect(keys[1]).toBe(key(MANCHESTER));
    const underTrail = new Set(r.points.map(key));
    const firstOff = keys.findIndex((k) => !underTrail.has(k));
    expect(firstOff).toBeGreaterThan(2);
    expect(keys.slice(firstOff).every((k) => !underTrail.has(k))).toBe(true);
  });
});
