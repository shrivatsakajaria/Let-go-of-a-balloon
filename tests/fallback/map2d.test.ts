import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { decodeCoast, fitView, mercX, mercY, pickZoom, tilesFor, toPx, unwrapLons, type MapView } from '../../src/fallback/map2d';

const SIZE = { w: 390, h: 844 };
const BAND = { left: 16, right: 374, top: 140, bottom: 520 };

test('Web Mercator: the prime meridian and the equator are the middle of the world', () => {
  expect(mercX(0)).toBe(0.5);
  expect(mercY(0)).toBeCloseTo(0.5, 12);
  expect(mercX(-180)).toBe(0);
  // the tile maths limit: nothing runs off the top of the map near the pole
  expect(mercY(89.9)).toBeCloseTo(0, 5);
  expect(mercY(-89.9)).toBeCloseTo(1, 5);
});

test('longitudes are unwrapped across the date line, so the route never jumps across the map', () => {
  expect(unwrapLons([178, 179.5, -179.5, -178])).toEqual([178, 179.5, 180.5, 182]);
  expect(unwrapLons([-178, -179.5, 179.5])).toEqual([-178, -179.5, -180.5]);
  expect(unwrapLons([])).toEqual([]);
});

test('the view fits the whole route into the free band, centred', () => {
  const pts = [{ lat: 53.48, lon: -2.25 }, { lat: 56, lon: 3 }, { lat: 60.39, lon: 5.32 }];
  const v = fitView(pts, BAND);
  for (const p of pts) {
    const q = toPx(v, mercX(p.lon), mercY(p.lat));
    expect(q.x).toBeGreaterThanOrEqual(BAND.left);
    expect(q.x).toBeLessThanOrEqual(BAND.right);
    expect(q.y).toBeGreaterThanOrEqual(BAND.top);
    expect(q.y).toBeLessThanOrEqual(BAND.bottom);
  }
  expect(v.ox).toBe((BAND.left + BAND.right) / 2);
  expect(v.oy).toBe((BAND.top + BAND.bottom) / 2);
});

test('a route that hardly moved is not zoomed to street level', () => {
  const v = fitView([{ lat: 51.5, lon: -0.12 }, { lat: 51.5001, lon: -0.1201 }], BAND);
  // at least about 150 km of land across the band
  const kmAcross = ((BAND.right - BAND.left) / v.scale) * 40075 * Math.cos((51.5 * Math.PI) / 180);
  expect(kmAcross).toBeGreaterThan(150);
});

test('a route over the date line fits as one piece', () => {
  const pts = [{ lat: -17.7, lon: 178.4 }, { lat: -17, lon: -175 }];
  const xs = unwrapLons(pts.map((p) => p.lon)).map(mercX);
  const v = fitView(pts, BAND);
  const a = toPx(v, xs[0], mercY(pts[0].lat));
  const b = toPx(v, xs[1], mercY(pts[1].lat));
  expect(b.x).toBeGreaterThan(a.x);
  expect(b.x - a.x).toBeLessThan(BAND.right - BAND.left + 1);
});

test('tiles cover the whole screen, wrapped into range across the date line', () => {
  const v: MapView = { cx: mercX(180), cy: mercY(0), scale: 2 ** 5 * 200, ox: 195, oy: 422 };
  const tiles = tilesFor(v, SIZE, 5);
  // the screen straddles x = 32 (the date line at z5): tiles 31 and 0 both appear, 0 drawn east of 31
  const xs = new Set(tiles.map((t) => t.x));
  expect(xs.has(31)).toBe(true);
  expect(xs.has(0)).toBe(true);
  const t0 = tiles.find((t) => t.x === 0)!;
  const t31 = tiles.find((t) => t.x === 31)!;
  expect(t0.tx).toBe(32);
  expect(t31.tx).toBe(31);
  for (const t of tiles) expect(t.y).toBeGreaterThanOrEqual(0);
  // every screen corner is inside some tile
  for (const [px, py] of [[0, 0], [SIZE.w, 0], [0, SIZE.h], [SIZE.w, SIZE.h]]) {
    const x = v.cx + (px - v.ox) / v.scale;
    const y = v.cy + (py - v.oy) / v.scale;
    expect(tiles.some((t) => x >= t.tx / 32 && x <= (t.tx + 1) / 32 && y >= t.y / 32 && y <= (t.y + 1) / 32)).toBe(true);
  }
});

test('the coastline zoom is z5 for a regional route and drops for a long one, to keep the download small', () => {
  const near = fitView([{ lat: 53.48, lon: -2.25 }, { lat: 54.2, lon: 3 }], BAND);
  expect(pickZoom(near, SIZE)).toBe(5);
  expect(tilesFor(near, SIZE, 5).length).toBeLessThanOrEqual(12);
  const far = fitView([{ lat: 40.7, lon: -74 }, { lat: 52, lon: -10 }], BAND);
  const z = pickZoom(far, SIZE);
  expect(z).toBeLessThan(5);
  expect(tilesFor(far, SIZE, z).length).toBeLessThanOrEqual(12);
});

test('decodes the sea and lakes of a real z5 tile (Britain and Ireland) in tile units', () => {
  const bytes = new Uint8Array(readFileSync(new URL('../fixtures/omt_5_15_10.pbf', import.meta.url)));
  const c = decodeCoast(bytes);
  expect(c.water.length).toBeGreaterThan(0);
  const all = c.water.flat(2);
  expect(all.length).toBeGreaterThan(1000);
  // coordinates are in tile units (0..1, with a small buffer past the edges)
  expect(Math.min(...all)).toBeGreaterThan(-0.2);
  expect(Math.max(...all)).toBeLessThan(1.2);
  // the national borders are lines, not polygons
  expect(c.borders.every((l) => l.length >= 4 && l.length % 2 === 0)).toBe(true);
});

test('an empty tile (all land) decodes to no water', () => {
  expect(decodeCoast(new Uint8Array(0))).toEqual({ water: [], borders: [] });
});
