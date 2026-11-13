import { describe, expect, test } from 'vitest';
import type { Route, RoutePoint } from '../../src/flight/route';
import { cardView, lookBack } from '../../src/app/cardshot';

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
