import { test, expect } from 'vitest';
import {
  decodeTerrarium,
  terraceHeight,
  terraceBlend,
  buildGround,
  LC,
  type LandcoverGrid,
} from '../../src/world/terrain';
import { overzoomTile, makeRouteGround, makeRouteTileLoader, type TerrainTile } from '../../src/world/terrainsrc';
import { CONTOUR, parseHex } from '../../src/world/palette';
import { lonLatToTile } from '../../src/geo/coords';
import { tileFrame } from '../../src/world/frame';
import { BALLOON_HEX, ROUTE_GROUND_ZOOM } from '../../src/config';

function saturation(hex: string): number {
  const [r, g, b] = parseHex(hex).map((v) => v / 255);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  const l = (mx + mn) / 2;
  return d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
}
function allColours(o: unknown): string[] {
  if (typeof o === 'string') return [o];
  if (Array.isArray(o)) return o.flatMap(allColours);
  if (o && typeof o === 'object') return Object.values(o).flatMap(allColours);
  return [];
}

test('terrarium decode of (128,0,0) is 0 m', () =>
  expect(decodeTerrarium(new Uint8ClampedArray([128, 0, 0, 255]), 1)[0]).toBe(0));

test('terrarium decode of a 2x2 sample', () => {
  const rgba = new Uint8ClampedArray([
    128, 0, 0, 255, // 0
    128, 100, 128, 255, // 100.5
    127, 255, 0, 255, // -1
    130, 5, 64, 255, // 2*256+... = 2 * 1 + 5 + 0.25 -> 517.25? computed below
  ]);
  const h = decodeTerrarium(rgba, 2);
  expect(h[0]).toBe(0);
  expect(h[1]).toBeCloseTo(100.5, 6);
  expect(h[2]).toBeCloseTo(-1, 6);
  expect(h[3]).toBeCloseTo(130 * 256 + 5 + 0.25 - 32768, 6);
});

test('terrace leaves flat ground unchanged', () => expect(terraceHeight(37, 0.05)).toBe(37));
test('terrace on steep ground snaps to 10 m steps', () =>
  expect(terraceHeight(37, 0.5) % 10).toBeCloseTo(0, 5));
test('terrace blend is 0 at 0.12 and 1 at 0.3, continuous between', () => {
  expect(terraceBlend(0.12)).toBe(0);
  expect(terraceBlend(0.3)).toBe(1);
  expect(terraceHeight(37, 0.12)).toBe(37);
  expect(terraceHeight(37, 0.3)).toBeCloseTo(40, 6);
  let prev = terraceHeight(37, 0.12);
  for (let s = 0.12; s <= 0.3; s += 0.005) {
    const v = terraceHeight(37, s);
    expect(Math.abs(v - prev)).toBeLessThan(0.7);
    prev = v;
  }
});

const BOUNDS = { west: -2.3, south: 53.4, east: -2.2, north: 53.5 };
function grid(n: number, fill = LC.grass): LandcoverGrid {
  return { size: n, classes: new Uint8Array(n * n).fill(fill) };
}

test('buildGround emits 3 vertices per triangle with shared face normals', () => {
  const size = 16;
  const heights = new Float32Array(size * size);
  for (let i = 0; i < heights.length; i++) heights[i] = 50 + (i % size) * 3 + Math.floor(i / size);
  const m = buildGround(heights, size, BOUNDS, grid(4));
  expect(m.position.length).toBe(4 * 4 * 2 * 3 * 3);
  expect(m.normal.length).toBe(m.position.length);
  expect(m.color.length).toBe(m.position.length);
  for (const arr of [m.position, m.normal, m.color]) for (const v of arr) expect(Number.isFinite(v)).toBe(true);
  for (let t = 0; t < m.normal.length; t += 9) {
    const [a, b, c] = [0, 3, 6].map((o) => [m.normal[t + o], m.normal[t + o + 1], m.normal[t + o + 2]]);
    expect(a).toEqual(b);
    expect(b).toEqual(c);
    expect(Math.hypot(a[0], a[1], a[2])).toBeCloseTo(1, 5);
    expect(a[1]).toBeGreaterThan(0);
  }
  // local metres: starts at the south-west corner (x=0, z=0), z runs to -north
  let maxX = 0, minZ = 0;
  for (let i = 0; i < m.position.length; i += 3) {
    maxX = Math.max(maxX, m.position[i]);
    minZ = Math.min(minZ, m.position[i + 2]);
  }
  expect(maxX).toBeGreaterThan(6000);
  expect(minZ).toBeLessThan(-11000);
});

test('steep faces take the cliff colour, flat faces the land colour', () => {
  const size = 8;
  const flat = new Float32Array(size * size).fill(20);
  const steep = new Float32Array(size * size);
  for (let i = 0; i < steep.length; i++) steep[i] = (i % size) * 2000;
  const cliff = parseHex(CONTOUR.cliff);
  const near = (c: number[], t: number[]) => c.every((v, i) => Math.abs(v * 255 - t[i]) < 20);
  const f = buildGround(flat, size, BOUNDS, grid(2, LC.grass));
  const s = buildGround(steep, size, BOUNDS, grid(2, LC.grass));
  expect(near([f.color[0], f.color[1], f.color[2]], cliff)).toBe(false);
  expect(near([s.color[0], s.color[1], s.color[2]], cliff)).toBe(true);
});

test('buildGround is deterministic (no Math.random)', () => {
  const h = new Float32Array(64).fill(10);
  const a = buildGround(h, 8, BOUNDS, grid(3));
  const b = buildGround(h, 8, BOUNDS, grid(3));
  expect(Array.from(a.color)).toEqual(Array.from(b.color));
});

test('no ground colour is more saturated than the balloon', () =>
  allColours(CONTOUR).forEach((c) => expect(saturation(c)).toBeLessThan(saturation(BALLOON_HEX))));

test('CONTOUR palette values', () => {
  expect(CONTOUR.land).toEqual(['#e6d6a2', '#b9cd86', '#a0c078', '#88b06c', '#76a063']);
  expect(CONTOUR.cliff).toBe('#d4a982');
  expect(CONTOUR.waterDeep).toBe('#2b7fb0');
  expect(CONTOUR.waterShallow).toBe('#8fd3cf');
  expect(CONTOUR.building).toEqual(['#f4efe5', '#ebe3d4']);
  expect(CONTOUR.roof).toEqual(['#d9bfa4', '#c9ad92', '#9fa6aa']);
});

test('overzoom: a z13 child of a z12 tile samples the parent sub-square bilinearly', () => {
  const size = 8;
  const heights = new Float32Array(size * size);
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) heights[r * size + c] = c;
  const parent: TerrainTile = { heights, size };
  // child (13, 2*px+1, 2*py): east half of the parent. pixel 0 -> parent column size/2 - 0.25
  const child = overzoomTile(parent, 12, 100, 50, 13, 201, 100);
  expect(child.size).toBe(size);
  expect(child.heights[0]).toBeCloseTo(size / 2 - 0.25, 5);
  // west child, last pixel: parent column (size-0.5)/2 - 0.5
  const west = overzoomTile(parent, 12, 100, 50, 13, 200, 100);
  expect(west.heights[size - 1]).toBeCloseTo((size - 0.5) / 2 - 0.5, 5);
});

function fixture(px: number, py: number) {
  const size = 8;
  const heights = new Float32Array(size * size).fill(5);
  heights[(py - 1) * size + (px + 1)] = 321; // inside the 3x3 window
  heights[(py + 2) * size + px] = 999; // outside it
  return { heights, size };
}
function pixelOf(lat: number, lon: number, size: number) {
  const t = lonLatToTile(lat, lon, ROUTE_GROUND_ZOOM);
  return { x: Math.floor(t.x), y: Math.floor(t.y), px: Math.floor((t.x % 1) * size), py: Math.floor((t.y % 1) * size) };
}
/** A point inside the route-ground tile containing (50, 10.5), at fraction (fx, fy) of the tile. */
function inTile(fx: number, fy: number) {
  const n = 2 ** ROUTE_GROUND_ZOOM;
  const t = lonLatToTile(50, 10.5, ROUTE_GROUND_ZOOM);
  const x = Math.floor(t.x) + fx, y = Math.floor(t.y) + fy;
  return { lat: (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI, lon: (x / n) * 360 - 180 };
}

test('routeGround returns the max of the 3x3 window', async () => {
  const p = inTile(3.5 / 8, 2.5 / 8);
  const { px, py } = pixelOf(p.lat, p.lon, 8);
  expect(px).toBeGreaterThan(0); expect(px).toBeLessThan(6);
  expect(py).toBeGreaterThan(0); expect(py).toBeLessThan(5);
  const rg = makeRouteGround(async () => fixture(px, py));
  expect(await rg(p)).toBe(321);
});

test('routeGround counts the sea as 0 m', async () => {
  const rg = makeRouteGround(async () => ({ heights: new Float32Array(64).fill(-40), size: 8 }));
  expect(await rg({ lat: 0, lon: -30 })).toBe(0);
});

test('routeGround caches tiles and handles poles', async () => {
  let calls = 0;
  const rg = makeRouteGround(async () => {
    calls++;
    return { heights: new Float32Array(64).fill(7), size: 8 };
  });
  await rg(inTile(0.4, 0.4));
  await rg(inTile(0.41, 0.41));
  expect(calls).toBe(1);
  expect(await rg({ lat: 89, lon: 0 })).toBe(7);
  expect(await rg({ lat: -90, lon: 180 })).toBe(7);
});

test('routeGround.peek answers only once every tile of the 3x3 window is loaded, with the same value', async () => {
  const p = inTile(3.5 / 8, 2.5 / 8);
  const { px, py } = pixelOf(p.lat, p.lon, 8);
  const rg = makeRouteGround(async () => fixture(px, py));
  expect(rg.peek(p)).toBeUndefined();
  expect(await rg(p)).toBe(321);
  expect(rg.peek(p)).toBe(321);
  // A point on the tile's west edge also needs the western neighbour, which is not loaded yet.
  const edge = { lat: p.lat, lon: inTile(0, 0).lon + 1e-6 };
  expect(rg.peek(edge)).toBeUndefined();
  const v = await rg(edge);
  expect(rg.peek(edge)).toBe(v);
});

test('routeGround.peek stays unknown after a failed load', async () => {
  const rg = makeRouteGround(async () => {
    throw new Error('offline');
  });
  await expect(rg({ lat: 10, lon: 10 })).rejects.toThrow('offline');
  expect(rg.peek({ lat: 10, lon: 10 })).toBeUndefined();
});

test('route tiles: a tile the planet archive leaves out is open sea (0 m), without asking the fallbacks', async () => {
  let fallbacks = 0;
  const land: TerrainTile = { heights: new Float32Array(16).fill(12), size: 4 };
  const load = makeRouteTileLoader(
    async (_z, x) => (x === 1 ? land : null),
    async () => {
      fallbacks++;
      return land;
    },
  );
  expect(await load(7, 1, 1)).toBe(land);
  const sea = await load(7, 2, 1);
  expect(sea.size).toBe(512);
  expect(Math.max(...sea.heights.subarray(0, 1024))).toBe(0);
  expect(fallbacks).toBe(0);
});

test('route tiles: a planet archive error uses the fallback sources', async () => {
  const land: TerrainTile = { heights: new Float32Array(16).fill(12), size: 4 };
  const load = makeRouteTileLoader(
    async () => {
      throw new Error('range requests blocked');
    },
    async () => land,
  );
  expect(await load(7, 1, 1)).toBe(land);
});

// ---- ground vertices sit on pixel edges, so neighbouring tiles meet ----

/** Heights per vertex of the ground mesh, keyed by the vertex's tile fraction along an edge. */
function edgeHeights(m: { position: Float32Array }, onEdge: (x: number, z: number) => boolean, key: (x: number, z: number) => number) {
  const out = new Map<string, number>();
  for (let i = 0; i < m.position.length; i += 3) {
    const x = m.position[i], y = m.position[i + 1], z = m.position[i + 2];
    if (onEdge(x, z)) out.set(key(x, z).toFixed(6), y);
  }
  return [...out.entries()].sort((a, b) => Number(a[0]) - Number(b[0]));
}

test('buildGround maps vertices to pixel edges (u = i/n * size - 0.5), not pixel centres', () => {
  const size = 4;
  const heights = new Float32Array(size * size);
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) heights[r * size + c] = 10 * c;
  const frame = tileFrame(14, 8089, 5300);
  const m = buildGround(heights, size, frame, grid(4));
  const row = edgeHeights(m, (_x, z) => Math.abs(z) < 1e-6, (x) => x / frame.widthM);
  // vertex i sits at the edge between pixel i-1 and i: 10*(i - 0.5); outer edges extrapolate
  expect(row.map(([, y]) => y)).toEqual([-5, 5, 15, 25, 35]);
});

test('two neighbouring tiles share identical edge heights (east-west and north-south)', () => {
  const size = 16;
  const [z, x0, y0] = [14, 8089, 5300];
  const tile = (tx: number, ty: number) => {
    const h = new Float32Array(size * size);
    for (let r = 0; r < size; r++)
      for (let c = 0; c < size; c++) h[r * size + c] = 2 * (tx * size + c) - (ty * size + r) - 250000; // gentle global plane
    return buildGround(h, size, tileFrame(z, tx, ty), grid(8));
  };
  const a = tileFrame(z, x0, y0), c = tileFrame(z, x0, y0 + 1);
  const A = tile(x0, y0), B = tile(x0 + 1, y0), C = tile(x0, y0 + 1);
  const aEast = edgeHeights(A, (x) => Math.abs(x - a.widthM) < 1e-3, (_x, zz) => zz);
  const bWest = edgeHeights(B, (x) => Math.abs(x) < 1e-6, (_x, zz) => zz);
  expect(aEast.length).toBe(9);
  expect(bWest).toEqual(aEast);
  const aSouth = edgeHeights(A, (_x, zz) => Math.abs(zz) < 1e-6, (x) => x / a.widthM);
  const cNorth = edgeHeights(C, (_x, zz) => Math.abs(zz + c.heightM) < 1e-3, (x) => x / c.widthM);
  expect(aSouth.length).toBe(9);
  expect(cNorth.map((e) => e[1])).toEqual(aSouth.map((e) => e[1]));
});
