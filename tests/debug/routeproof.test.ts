import { describe, expect, it } from 'vitest';
import { ageText, fitView, mercator, nearestPlace, project, summarise, tilesFor, unwrapLons } from '../../src/debug/proofmath';
import type { Route } from '../../src/flight/route';

const pt = (lat: number, lon: number, speedMs: number) => ({ tSec: 0, lat, lon, altM: 0, groundM: 0, speedMs, headingDeg: 0 });

describe('unwrapLons', () => {
  it('keeps a route continuous across 180', () => {
    expect(unwrapLons([178, 179.5, -179, -177])).toEqual([178, 179.5, 181, 183]);
  });
  it('handles westward crossing', () => {
    const u = unwrapLons([-178, -179.5, 179, 177]);
    expect(u[2]).toBeCloseTo(-181);
    expect(u[3]).toBeCloseTo(-183);
  });
});

describe('projection', () => {
  it('moves smoothly east over the antimeridian', () => {
    const lons = unwrapLons([179, -179]);
    const v = fitView([mercator(10, lons[0]), mercator(10, lons[1])], 400, 300, 20);
    const a = project(v, mercator(10, lons[0]));
    const b = project(v, mercator(10, lons[1]));
    expect(b.x).toBeGreaterThan(a.x);
    expect(b.x - a.x).toBeLessThan(400);
    expect(a.x).toBeGreaterThanOrEqual(19);
    expect(b.x).toBeLessThanOrEqual(381);
  });
  it('puts north above south', () => {
    expect(mercator(60, 0).y).toBeLessThan(mercator(10, 0).y);
  });
});

describe('tilesFor', () => {
  it('stays within 12 tiles and wraps tile x with a shift past 180', () => {
    const a = mercator(10, 175), b = mercator(12, 190);
    const t = tilesFor({ x0: a.x, x1: b.x, y0: Math.min(a.y, b.y), y1: Math.max(a.y, b.y) });
    expect(t.length).toBeLessThanOrEqual(12);
    expect(t.length).toBeGreaterThan(0);
    expect(t.some((x) => x.shift === 1)).toBe(true);
    expect(t.every((x) => x.x >= 0 && x.x < 2 ** x.z)).toBe(true);
  });
});

describe('summarise', () => {
  it('sums great-circle legs and finds top speed', () => {
    const route = { points: [pt(0, 0, 5), pt(0, 1, 20), pt(0, 2, 10)], hourly: [], release: 0, runId: 'x' } as Route;
    const s = summarise(route);
    expect(s.distanceKm).toBeCloseTo(2 * 111.19, 0);
    expect(s.topSpeedKmh).toBeCloseTo(72, 5);
    expect(s.landing).toEqual({ lat: 0, lon: 2 });
  });
  it('measures across the antimeridian the short way', () => {
    const route = { points: [pt(0, 179.5, 1), pt(0, -179.5, 1)], hourly: [], release: 0, runId: 'x' } as Route;
    expect(summarise(route).distanceKm).toBeCloseTo(111.19, 0);
  });
});

describe('nearestPlace', () => {
  const places = [
    { name: 'Far', lat: 10, lon: 10 },
    { name: 'Near', lat: 0.5, lon: 0 },
  ];
  it('picks the nearest within range', () => {
    expect(nearestPlace(places, { lat: 0, lon: 0 })?.name).toBe('Near');
  });
  it('uses a village only when no city or town is in range', () => {
    const v = { name: 'Hamlet', lat: 0.1, lon: 0, cls: 'village' };
    expect(nearestPlace([v], { lat: 0, lon: 0 })?.name).toBe('Hamlet');
    expect(nearestPlace([v, { name: 'Town', lat: 0.5, lon: 0, cls: 'town' }], { lat: 0, lon: 0 })?.name).toBe('Town');
  });
  it('returns null when nothing is within 100 km', () => {
    expect(nearestPlace(places, { lat: 30, lon: 30 })).toBeNull();
  });
});

describe('ageText', () => {
  it('formats', () => {
    expect(ageText(5 * 3.6e6 + 7 * 6e4)).toBe('5 h 7 min old');
    expect(ageText(9 * 6e4)).toBe('9 min old');
  });
});
