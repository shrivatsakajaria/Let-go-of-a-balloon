import { describe, expect, test } from 'vitest';
import type { Route, RoutePoint } from '../../src/flight/route';
import * as THREE from 'three';
import { cardView, corridorTiles, farCamera, farShot, isFarRoute, lookBack, NEAR_START_KM, pumpUntil, viewTiles } from '../../src/app/cardshot';
import { tilesFor, tileKey } from '../../src/world/lod';
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

describe('the card world can be cut short, and draws only what it sees', () => {
  test('waiting for its tiles stops at once when the visitor moves on', async () => {
    let alive = true;
    let steps = 0;
    const t0 = Date.now();
    setTimeout(() => (alive = false), 120);
    const r = await pumpUntil(() => (steps++, false), { maxMs: 20000, everyMs: 20, alive: () => alive });
    expect(r).toBe('cancelled');
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(steps).toBeGreaterThan(1);
  });

  test('an opened gate (the replay has ended) ends the wait at once, whatever the tiles', async () => {
    let open = false;
    setTimeout(() => (open = true), 60);
    const t0 = Date.now();
    expect(await pumpUntil(() => false, { maxMs: 20000, everyMs: 10, alive: () => true, stop: () => open })).toBe('stopped');
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  test('it ends when the tiles are in (twice in a row), or when the time is up', async () => {
    let n = 0;
    expect(await pumpUntil(() => ++n >= 3, { maxMs: 5000, everyMs: 1, alive: () => true })).toBe('ready');
    expect(n).toBe(4);
    expect(await pumpUntil(() => false, { maxMs: 50, everyMs: 5, alive: () => true })).toBe('timeout');
  });

  test('a long route skips the wait for the live world (its card world is its own)', () => {
    const MANCHESTER = { lat: 53.4794, lon: -2.2453 };
    expect(isFarRoute(between(MANCHESTER, { lat: 60.39, lon: 5.32 }))).toBe(true);
    expect(isFarRoute(between(MANCHESTER, { lat: 53.6, lon: -2.1 }))).toBe(false);
  });

  test('tiles the camera cannot see (behind it, below the frame) are not asked for; both ends are', () => {
    const MANCHESTER = { lat: 53.4794, lon: -2.2453 };
    for (const end of [{ lat: 60.39, lon: 5.32 }, { lat: 53.75, lon: -1.9 }]) {
      const r = between(MANCHESTER, end);
      const shot = farShot(r);
      const cam = farCamera(shot, 0);
      const camLL = { lat: shot.landing.lat + cam.position.z / -M_PER_DEG, lon: shot.landing.lon + cam.position.x / (M_PER_DEG * Math.cos((shot.landing.lat * Math.PI) / 180)) };
      const rings = tilesFor({ lat: camLL.lat, lon: camLL.lon, altM: cam.position.y, headingDeg: shot.viewDeg }, 40);
      const all = [...corridorTiles(r, shot), ...rings];
      const seen = viewTiles(all, shot, 0);
      const keys = new Set(seen.map(tileKey));
      expect(seen.length).toBeLessThan(all.length);
      const key = (p: { lat: number; lon: number }, z = 7) => {
        const t = lonLatToTile(p.lat, p.lon, z);
        return `${z}/${Math.floor(t.x)}/${Math.floor(t.y)}`;
      };
      expect(keys.has(key(end))).toBe(true);
      expect(keys.has(key(MANCHESTER))).toBe(true);
      // the camera's own ground point is well below the bottom of the frame: its fine tiles are dropped
      expect(rings.map(tileKey)).toContain(key(camLL, rings.some((t) => t.z === 14) ? 14 : 7));
      if (rings.some((t) => t.z === 14)) expect(keys.has(key(camLL, 14))).toBe(false);
    }
  });
});
