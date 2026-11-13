import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { toOpenSpace } from '../../src/flight/startspot';
import { haversineKm, type LatLon } from '../../src/geo/coords';
import { pointInPolygon, ringCentroid } from '../../src/world/geom';
import { decodeVectorTile, emptyFeatures, fetchVectorTile, type Features, type Polygon } from '../../src/world/vector';
import { tileFrame } from '../../src/world/frame';

const frame = tileFrame(14, 8089, 5300); // central Manchester
const m = (p: LatLon, q: LatLon) => haversineKm(p, q) * 1000;
const square = (cx: number, cz: number, half: number): Polygon => [
  Float64Array.from([cx - half, cz - half, cx + half, cz - half, cx + half, cz + half, cx - half, cz + half]),
];
const insideAny = (f: Features, p: LatLon) => {
  const { x, z } = frame.toLocal(p.lat, p.lon);
  return f.building.some((b) => pointInPolygon(b.polygon, x, z));
};

describe('toOpenSpace', () => {
  const C = { x: 1200, z: -1200 };
  const centre = frame.toLatLon(C.x, C.z);

  test('a point outside every building is returned unchanged', () => {
    const f = emptyFeatures();
    f.building.push({ height: 10, minHeight: 0, polygon: square(C.x + 100, C.z, 10) });
    expect(toOpenSpace(centre, f, frame)).toEqual(centre);
  });

  test('a searched start inside a building moves to open space', () => {
    const f = emptyFeatures();
    f.building.push({ height: 20, minHeight: 0, polygon: square(C.x, C.z, 20) });
    const out = toOpenSpace(centre, f, frame);
    expect(insideAny(f, out)).toBe(false);
    // the nearest way out of a 40 m block from its middle is about 20 m
    expect(m(out, centre)).toBeGreaterThan(19);
    expect(m(out, centre)).toBeLessThan(30);
  });

  test('prefers a park or a street over a back yard when both are close', () => {
    const f = emptyFeatures();
    f.building.push({ height: 20, minHeight: 0, polygon: square(C.x, C.z, 20) });
    // a park beyond the east wall, a little further than the other walls
    f.park.push({ cls: 'park', subclass: '', polygon: [Float64Array.from([C.x + 21, C.z - 60, C.x + 80, C.z - 60, C.x + 80, C.z + 60, C.x + 21, C.z + 60])] });
    const out = toOpenSpace(centre, f, frame);
    const l = frame.toLocal(out.lat, out.lon);
    expect(l.x).toBeGreaterThan(C.x + 21);
    expect(m(out, centre)).toBeLessThan(40);
  });

  test('a street counts as open space', () => {
    const f = emptyFeatures();
    f.building.push({ height: 20, minHeight: 0, polygon: square(C.x, C.z, 20) });
    f.transportation.push({ cls: 'primary', subclass: '', brunnel: '', line: Float64Array.from([C.x - 200, C.z + 26, C.x + 200, C.z + 26]) });
    const out = toOpenSpace(centre, f, frame);
    const l = frame.toLocal(out.lat, out.lon);
    expect(Math.abs(l.z - (C.z + 26))).toBeLessThan(8);
  });

  test('nothing open within 150 m leaves the point where it was', () => {
    const f = emptyFeatures();
    f.building.push({ height: 20, minHeight: 0, polygon: square(C.x, C.z, 400) });
    expect(toOpenSpace(centre, f, frame)).toEqual(centre);
  });

  test('a hole in a building (a courtyard) is open space', () => {
    const f = emptyFeatures();
    const outer = square(C.x, C.z, 60)[0];
    const hole = Float64Array.from([C.x - 30, C.z - 30, C.x - 30, C.z + 30, C.x + 30, C.z + 30, C.x + 30, C.z - 30]);
    f.building.push({ height: 20, minHeight: 0, polygon: [outer, hole] });
    const p = frame.toLatLon(C.x + 40, C.z); // in the wing east of the courtyard
    const out = toOpenSpace(p, f, frame);
    expect(insideAny(f, out)).toBe(false);
    expect(m(out, p)).toBeLessThan(15);
  });

  test('real Manchester tile: a point inside a big building moves out, within 150 m', () => {
    const f = decodeVectorTile(readFileSync(new URL('../fixtures/omt_14_8089_5300.pbf', import.meta.url)), 14, 8089, 5300);
    const big = f.building
      .map((b) => ({ b, c: ringCentroid(b.polygon[0]) }))
      .filter(({ b, c }) => pointInPolygon(b.polygon, c.x, c.z))
      .sort((a, z) => Math.abs(z.b.polygon[0].length) - Math.abs(a.b.polygon[0].length))[0];
    const p = frame.toLatLon(big.c.x, big.c.z);
    expect(insideAny(f, p)).toBe(true);
    const out = toOpenSpace(p, f, frame);
    expect(insideAny(f, out)).toBe(false);
    expect(m(out, p)).toBeLessThanOrEqual(150);
  });
});

describe('fetchVectorTile (the one place vector tiles are requested)', () => {
  afterEach(() => vi.unstubAllGlobals());

  test('requests the filled template URL and returns the bytes', async () => {
    const seen: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      seen.push(url);
      return new Response(new Uint8Array([1, 2, 3]));
    });
    const bytes = await fetchVectorTile('https://t.example/{z}/{x}/{y}.pbf', 14, 8, 9);
    expect(seen).toEqual(['https://t.example/14/8/9.pbf']);
    expect([...bytes!]).toEqual([1, 2, 3]);
  });

  test('gives null for a missing tile', async () => {
    vi.stubGlobal('fetch', async () => new Response('', { status: 404 }));
    expect(await fetchVectorTile('https://t.example/{z}/{x}/{y}', 14, 8, 9)).toBeNull();
  });
});
