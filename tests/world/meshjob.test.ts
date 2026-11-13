import { test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { decodeVectorTile, emptyFeatures, type Polygon } from '../../src/world/vector';
import { buildTileMeshes, cellIndex, packMeshes, transferables, type TileMeshes } from '../../src/world/meshjob';
import { DEFAULT_REGION, CONTOUR, parseHex } from '../../src/world/palette';
import { tileFrame } from '../../src/world/frame';
import { groundGrid, groundHeightAt, type MeshBuffers } from '../../src/world/terrain';
import { tileBounds } from '../../src/geo/coords';
import { BALLOON_HEX } from '../../src/config';

// Albert Square, Manchester. Terrain is synthetic (no terrain fixture is committed): a gentle
// plane with a low swell, so draping and bases are exercised without terraces.
const [Z, X, Y] = [14, 8089, 5300];
const frame = tileFrame(Z, X, Y);
const SIZE = 512;
const heights = new Float32Array(SIZE * SIZE);
for (let r = 0; r < SIZE; r++)
  for (let c = 0; c < SIZE; c++) heights[r * SIZE + c] = 38 + 0.05 * c + 0.03 * r + 2 * Math.sin(c / 37) * Math.cos(r / 53);
const flat = new Float32Array(SIZE * SIZE).fill(30);

const buf = readFileSync(new URL('../fixtures/omt_14_8089_5300.pbf', import.meta.url));
const f = decodeVectorTile(buf, Z, X, Y);
const m = buildTileMeshes(f, heights, Z, X, Y, DEFAULT_REGION);

// ---- helpers ----

const meshes = (t: TileMeshes): [string, MeshBuffers][] =>
  (['ground', 'water', 'buildings', 'roofs', 'roads', 'waterways'] as const).map((k) => [k, t[k]]);

function rect(x0: number, z0: number, x1: number, z1: number): Polygon {
  return [Float64Array.from([x0, z0, x1, z0, x1, z1, x0, z1])];
}

/** Even-odd point in polygon over all rings (outer + holes). */
function inside(poly: Polygon, x: number, z: number): boolean {
  let c = false;
  for (const r of poly) {
    for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
      const xi = r[i], zi = r[i + 1], xj = r[j], zj = r[j + 1];
      if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
    }
  }
  return c;
}

function saturation(r: number, g: number, b: number): number {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  const l = (mx + mn) / 2;
  return d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
}

/** Height of the drawn ground mesh at (x, z), by finding the triangle that contains it. */
function groundMeshHeight(g: MeshBuffers, x: number, z: number): number {
  const p = g.position;
  for (let t = 0; t < p.length; t += 9) {
    const ax = p[t], az = p[t + 2], bx = p[t + 3], bz = p[t + 5], cx = p[t + 6], cz = p[t + 8];
    const det = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / det;
    const l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / det;
    const l3 = 1 - l1 - l2;
    if (l1 >= -1e-6 && l2 >= -1e-6 && l3 >= -1e-6) return l1 * p[t + 1] + l2 * p[t + 4] + l3 * p[t + 7];
  }
  throw new Error(`no ground at ${x},${z}`);
}

function vertsIn(b: MeshBuffers, x0: number, z0: number, x1: number, z1: number): number {
  let n = 0;
  for (let i = 0; i < b.position.length; i += 3) {
    const x = b.position[i], z = b.position[i + 2];
    if (x >= Math.min(x0, x1) && x <= Math.max(x0, x1) && z >= Math.min(z0, z1) && z <= Math.max(z0, z1)) n++;
  }
  return n;
}

// ---- the brief's tests ----

test('fixture has buildings with heights', () => expect(f.building.filter((b) => b.height > 20).length).toBeGreaterThan(50));

test('Manchester Town Hall area produces building geometry', () =>
  expect(m.buildings.position.length).toBeGreaterThan(30000));

test('no tree instance falls outside a wood or park polygon', () => {
  // OMT: woods are landcover class wood; city parks are landcover grass/park (the park layer is
  // protected areas and historic sites, not trees)
  const zones = f.landcover.filter((a) => a.cls === 'wood' || a.cls === 'forest' || a.subclass === 'park').map((a) => a.polygon);
  expect(zones.length).toBeGreaterThan(0);
  const n = m.trees.length / 16;
  expect(Number.isInteger(n)).toBe(true);
  expect(n).toBeGreaterThan(20);
  expect(n).toBeLessThanOrEqual(2000);
  for (let i = 0; i < n; i++) {
    const x = m.trees[i * 16 + 12], z = m.trees[i * 16 + 14];
    expect(zones.some((p) => inside(p, x, z))).toBe(true);
    expect(f.building.some((b) => inside([b.polygon[0]], x, z))).toBe(false); // never inside a building
    expect(m.trees[i * 16 + 15]).toBe(1);
  }
});

test('low building gets a roof, tall one does not', () => {
  const s = emptyFeatures();
  s.building.push({ height: 8, minHeight: 0, polygon: rect(300, -300, 320, -310) }); // 20 x 10 m, long side east-west
  s.building.push({ height: 40, minHeight: 0, polygon: rect(800, -800, 830, -830) });
  const t = buildTileMeshes(s, flat, Z, X, Y, DEFAULT_REGION);
  const roofVerts = t.roofs.position.length / 3;
  expect(roofVerts).toBeGreaterThan(0);
  expect(vertsIn(t.roofs, 299.9, -299.9, 320.1, -310.1)).toBe(roofVerts);
  expect(vertsIn(t.roofs, 790, -790, 840, -840)).toBe(0);
  // the ridge is the highest line, at the full height, and runs along the long (x) side at z = -305
  let top = -Infinity;
  for (let i = 1; i < t.roofs.position.length; i += 3) top = Math.max(top, t.roofs.position[i]);
  expect(top).toBeCloseTo(30 + 8, 3);
  const ridge: number[][] = [];
  for (let i = 0; i < t.roofs.position.length; i += 3)
    if (Math.abs(t.roofs.position[i + 1] - top) < 1e-3) ridge.push([t.roofs.position[i], t.roofs.position[i + 2]]);
  for (const [, z] of ridge) expect(z).toBeCloseTo(-305, 3);
  expect(Math.max(...ridge.map((r) => r[0])) - Math.min(...ridge.map((r) => r[0]))).toBeCloseTo(20, 3);
  // the tall one has a flat top at 30 + 40 m in the building buffer
  let tallTop = 0;
  for (let i = 0; i < t.buildings.position.length; i += 3) if (t.buildings.position[i] > 790) tallTop = Math.max(tallTop, t.buildings.position[i + 1]);
  expect(tallTop).toBeCloseTo(70, 3);
});

test('mesh building for one z14 tile takes < 150 ms in Node', () => {
  buildTileMeshes(f, heights, Z, X, Y, DEFAULT_REGION); // warm
  const runs: number[] = [];
  for (let i = 0; i < 3; i++) {
    const t0 = performance.now();
    buildTileMeshes(f, heights, Z, X, Y, DEFAULT_REGION);
    runs.push(performance.now() - t0);
  }
  runs.sort((a, b) => a - b);
  console.log(`buildTileMeshes on the fixture: ${runs.map((r) => r.toFixed(1)).join(', ')} ms`);
  expect(runs[1]).toBeLessThan(150);
});

// ---- controller rulings ----

test('a building base matches the drawn ground height under it within 0.5 m', () => {
  const s = emptyFeatures();
  const poly = rect(500, -600, 540, -625);
  s.building.push({ height: 30, minHeight: 0, polygon: poly });
  const t = buildTileMeshes(s, heights, Z, X, Y, DEFAULT_REGION);
  let base = Infinity;
  for (let i = 1; i < t.buildings.position.length; i += 3) base = Math.min(base, t.buildings.position[i]);
  const r = poly[0];
  let expected = Infinity;
  for (let i = 0; i < r.length; i += 2) expected = Math.min(expected, groundMeshHeight(t.ground, r[i], r[i + 1]));
  expect(Math.abs(base - expected)).toBeLessThan(0.5);
  // and the footprint corners are not buried more than the slope across it
  let maxG = -Infinity;
  for (let i = 0; i < r.length; i += 2) maxG = Math.max(maxG, groundMeshHeight(t.ground, r[i], r[i + 1]));
  expect(maxG - expected).toBeGreaterThan(0.5); // the test terrain really slopes under the footprint
});

test('water: a deep band along the true shoreline only, never along the tile border', () => {
  const s = emptyFeatures();
  const W = frame.widthM, H = frame.heightM;
  s.water.push({ cls: 'ocean', subclass: '', polygon: rect(0, 0, W / 2, -H) }); // clipped by the tile on three sides
  const t = buildTileMeshes(s, flat, Z, X, Y, DEFAULT_REGION);
  const deep = parseHex(CONTOUR.waterDeep).map((v) => v / 255);
  let band = 0, body = 0, minBandX = Infinity, minBodyX = Infinity;
  for (let i = 0; i < t.water.color.length; i += 3) {
    const isDeep = Math.hypot(t.water.color[i] - deep[0], t.water.color[i + 1] - deep[1], t.water.color[i + 2] - deep[2]) < 0.02;
    const x = t.water.position[i];
    if (isDeep) { band++; minBandX = Math.min(minBandX, x); } else { body++; minBodyX = Math.min(minBodyX, x); }
    expect(t.water.position[i + 1]).toBeGreaterThanOrEqual(0); // sea level
    expect(t.water.position[i + 1]).toBeLessThan(0.5);
  }
  expect(band).toBeGreaterThan(0);
  expect(body).toBeGreaterThan(band);
  expect(minBodyX).toBeCloseTo(0, 3);
  expect(minBandX).toBeGreaterThan(W / 2 - 40); // only near the shoreline at x = W/2
});

test('decoded polygons are clipped to the tile, lines to the tile and its buffer', () => {
  const eps = 1e-6;
  const ok = (x: number, z: number) => x >= -eps && x <= frame.widthM + eps && z <= eps && z >= -frame.heightM - eps;
  for (const a of [...f.water, ...f.landcover, ...f.landuse, ...f.park])
    for (const r of a.polygon) for (let i = 0; i < r.length; i += 2) expect(ok(r[i], r[i + 1])).toBe(true);
  const b = frame.widthM / 64 + 0.1; // OpenFreeMap's buffer: 64 of 4096
  const okb = (x: number, z: number) => x >= -b && x <= frame.widthM + b && z <= b && z >= -frame.heightM - b;
  for (const l of [...f.transportation, ...f.waterway])
    for (let i = 0; i < l.line.length; i += 2) expect(okb(l.line[i], l.line[i + 1])).toBe(true);
});

test('fixture water: band segments never lie on the tile border', () => {
  const deep = parseHex(CONTOUR.waterDeep).map((v) => v / 255);
  const W = frame.widthM, H = frame.heightM;
  let band = 0;
  for (let t = 0; t < m.water.color.length; t += 9) {
    const isDeep = Math.hypot(m.water.color[t] - deep[0], m.water.color[t + 1] - deep[1], m.water.color[t + 2] - deep[2]) < 0.02;
    if (!isDeep) continue;
    band++;
    // no band runs along a tile edge: two band vertices on the same edge are at most a band width apart
    const xs = [0, 3, 6].map((o) => m.water.position[t + o]), zs = [0, 3, 6].map((o) => m.water.position[t + o + 2]);
    for (const onEdge of [(i: number) => Math.abs(xs[i]) < 1e-3, (i: number) => Math.abs(xs[i] - W) < 1e-3,
      (i: number) => Math.abs(zs[i]) < 1e-3, (i: number) => Math.abs(zs[i] + H) < 1e-3]) {
      const on = [0, 1, 2].filter(onEdge);
      for (const a of on) for (const b of on) expect(Math.hypot(xs[a] - xs[b], zs[a] - zs[b])).toBeLessThan(25);
    }
  }
  expect(band).toBeGreaterThan(0);
});

test('a hidden footprint removes the buildings whose centroid is under it', () => {
  const s = emptyFeatures();
  s.building.push({ height: 30, minHeight: 0, polygon: rect(400, -400, 430, -430) });
  s.building.push({ height: 30, minHeight: 0, polygon: rect(900, -900, 930, -930) });
  const c = frame.toLatLon(415, -415);
  const t = buildTileMeshes(s, flat, Z, X, Y, DEFAULT_REGION, { hiddenFootprints: [{ lat: c.lat, lon: c.lon, radiusM: 20 }] });
  expect(vertsIn(t.buildings, 399, -399, 431, -431)).toBe(0);
  expect(vertsIn(t.buildings, 899, -899, 931, -931)).toBeGreaterThan(0);
  // and on the fixture: hiding Manchester Town Hall's block takes geometry away
  const th = frame.toLocal(53.47935, -2.24448);
  const hidden = buildTileMeshes(f, heights, Z, X, Y, DEFAULT_REGION, {
    hiddenFootprints: [{ lat: 53.47935, lon: -2.24448, radiusM: 60 }],
  });
  expect(hidden.buildings.position.length).toBeLessThan(m.buildings.position.length);
  expect(vertsIn(hidden.buildings, th.x - 15, th.z - 15, th.x + 15, th.z + 15)).toBeLessThan(
    vertsIn(m.buildings, th.x - 15, th.z - 15, th.x + 15, th.z + 15) + 1,
  );
});

test('gap fill: houses in residential land with no buildings, about one per 350 m2, z14 only', () => {
  const s = emptyFeatures();
  s.landuse.push({ cls: 'residential', subclass: '', polygon: rect(300, -300, 500, -500) });
  const t = buildTileMeshes(s, flat, Z, X, Y, DEFAULT_REGION);
  const houses = t.stats.gapHouses;
  expect(houses).toBeGreaterThan(40000 / 350 * 0.6);
  expect(houses).toBeLessThan(40000 / 350 * 1.4);
  expect(t.roofs.position.length).toBeGreaterThan(0);
  // every house sits inside the residential area
  expect(vertsIn(t.buildings, 290, -290, 510, -510)).toBe(t.buildings.position.length / 3);
  // a built-up area that already has buildings in every cell gets none
  const full = emptyFeatures();
  full.landuse.push({ cls: 'residential', subclass: '', polygon: rect(300, -300, 500, -500) });
  for (let x = 300; x < 500; x += 10) for (let z = -300; z > -500; z -= 10) full.building.push({ height: 6, minHeight: 0, polygon: rect(x + 2, z - 2, x + 8, z - 8) });
  expect(buildTileMeshes(full, flat, Z, X, Y, DEFAULT_REGION).stats.gapHouses).toBe(0);
  // not below z14
  const fr13 = tileFrame(13, X >> 1, Y >> 1);
  const s13 = emptyFeatures();
  s13.landuse.push({ cls: 'residential', subclass: '', polygon: rect(300, -300, fr13.widthM / 2, -fr13.heightM / 2) });
  expect(buildTileMeshes(s13, flat, 13, X >> 1, Y >> 1, DEFAULT_REGION).stats.gapHouses).toBe(0);
  // capped on a tile that is all residential
  const big = emptyFeatures();
  big.landuse.push({ cls: 'residential', subclass: '', polygon: rect(0, 0, frame.widthM, -frame.heightM) });
  const tb = buildTileMeshes(big, flat, Z, X, Y, DEFAULT_REGION);
  expect(tb.stats.gapHouses).toBe(1500);
});

test('roads and rivers drape 0.3 m above the drawn ground', () => {
  for (const b of [m.roads, m.waterways]) {
    expect(b.position.length).toBeGreaterThan(0);
    let near = 0, all = 0;
    for (let i = 0; i < b.position.length; i += 3 * 31) {
      const x = b.position[i], y = b.position[i + 1], z = b.position[i + 2];
      const above = y - groundMeshHeight(m.ground, x, z);
      expect(above).toBeGreaterThan(0.25); // never under the ground
      all++;
      if (Math.abs(above - 0.3) < 0.05) near++;
    }
    expect(near / all).toBeGreaterThan(0.95); // only roads over docks and lakes ride higher
  }
  // paths are skipped at z13
  const s = emptyFeatures();
  s.transportation.push({ cls: 'path', subclass: '', brunnel: '', line: Float64Array.from([100, -100, 400, -100]) });
  expect(buildTileMeshes(s, flat, 13, X >> 1, Y >> 1, DEFAULT_REGION).roads.position.length).toBe(0);
  expect(buildTileMeshes(s, flat, Z, X, Y, DEFAULT_REGION).roads.position.length).toBeGreaterThan(0);
});

test('lamps along minor and tertiary roads, z14 only, capped', () => {
  const n = m.lamps.length / 3;
  expect(Number.isInteger(n)).toBe(true);
  expect(n).toBeGreaterThan(20);
  expect(n).toBeLessThanOrEqual(800);
  const s = emptyFeatures();
  s.transportation.push({ cls: 'minor', subclass: '', brunnel: '', line: Float64Array.from([100, -100, 400, -100]) });
  const t = buildTileMeshes(s, flat, Z, X, Y, DEFAULT_REGION);
  expect(t.lamps.length / 3).toBeGreaterThanOrEqual(9); // ~30 m spacing over 300 m
  expect(t.lamps.length / 3).toBeLessThanOrEqual(11);
  expect(buildTileMeshes(s, flat, 13, X >> 1, Y >> 1, DEFAULT_REGION).lamps.length).toBe(0);
});

test('labels from place and water_name, with lat/lon and local position', () => {
  const man = m.labels.find((l) => l.name === 'Manchester');
  expect(man).toBeDefined();
  expect(man!.kind).toBe('city');
  const b = tileBounds(Z, X, Y);
  for (const l of m.labels) {
    expect(l.lat).toBeGreaterThanOrEqual(b.south);
    expect(l.lat).toBeLessThanOrEqual(b.north);
    const p = frame.toLocal(l.lat, l.lon);
    expect(p.x).toBeCloseTo(l.x, 3);
    expect(p.z).toBeCloseTo(l.z, 3);
  }
  expect(m.labels.some((l) => l.kind === 'lake' || l.kind === 'water')).toBe(true);
});

test('all buffers are finite, whole triangles, with unit normals', () => {
  let bad = 0;
  for (const [, b] of meshes(m)) {
    expect(b.position.length % 9).toBe(0);
    expect(b.normal.length).toBe(b.position.length);
    expect(b.color.length).toBe(b.position.length);
    for (const a of [b.position, b.normal, b.color]) for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) bad++;
    for (let i = 0; i < b.normal.length; i += 3) if (Math.abs(Math.hypot(b.normal[i], b.normal[i + 1], b.normal[i + 2]) - 1) > 1e-4) bad++;
    for (let i = 0; i < b.color.length; i++) if (b.color[i] < 0 || b.color[i] > 1) bad++;
  }
  for (const a of [m.trees, m.lamps]) for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) bad++;
  expect(bad).toBe(0);
});

test('faces point the way their normals say (front faces are counter-clockwise)', () => {
  let bad = 0;
  for (const [, b] of meshes(m)) {
    const p = b.position;
    for (let t = 0; t < p.length; t += 9) {
      const e1 = [p[t + 3] - p[t], p[t + 4] - p[t + 1], p[t + 5] - p[t + 2]];
      const e2 = [p[t + 6] - p[t], p[t + 7] - p[t + 1], p[t + 8] - p[t + 2]];
      const c = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const dot = c[0] * b.normal[t] + c[1] * b.normal[t + 1] + c[2] * b.normal[t + 2];
      if (dot / (Math.hypot(c[0], c[1], c[2]) || 1) < -1e-3) bad++;
    }
  }
  expect(bad).toBe(0);
});

test('every colour used is less saturated than the balloon', () => {
  const [br, bg, bb] = parseHex(BALLOON_HEX).map((v) => v / 255);
  const limit = saturation(br, bg, bb);
  let max = 0;
  for (const [, b] of meshes(m)) for (let i = 0; i < b.color.length; i += 3) max = Math.max(max, saturation(b.color[i], b.color[i + 1], b.color[i + 2]));
  expect(max).toBeLessThan(limit);
  expect(max).toBeLessThan(0.75); // and well clear of it
});

test('deterministic: the same input gives identical buffers', () => {
  const again = buildTileMeshes(f, heights, Z, X, Y, DEFAULT_REGION);
  const before = new Map(meshes(m));
  const same = (a: Float32Array, b: Float32Array) => Buffer.from(a.buffer).equals(Buffer.from(b.buffer));
  for (const [k, b] of meshes(again)) {
    expect(same(b.position, before.get(k)!.position)).toBe(true);
    expect(same(b.color, before.get(k)!.color)).toBe(true);
  }
  expect(same(again.trees, m.trees)).toBe(true);
  expect(same(again.lamps, m.lamps)).toBe(true);
});

test('triangle counts per bucket for the fixture tile', () => {
  const counts = Object.fromEntries(meshes(m).map(([k, b]) => [k, b.position.length / 9]));
  console.log('triangles', JSON.stringify(counts), 'trees', m.trees.length / 16, 'lamps', m.lamps.length / 3, 'labels', m.labels.length, JSON.stringify(m.stats));
  expect(counts.ground).toBe(64 * 64 * 2);
  expect(counts.water).toBeGreaterThan(0);
  expect(counts.roofs).toBeGreaterThan(0);
});


test('worker: fetches the tile from the template, builds, and lists every buffer for transfer', async () => {
  const { handleBuild } = await import('../../src/world/worker');
  const urls: string[] = [];
  const fakeFetch = (async (u: string) => {
    urls.push(u);
    if (u.includes('/14/8089/5300')) return new Response(buf);
    if (u.includes('/14/1/1')) return new Response(null, { status: 404 });
    return new Response('nope', { status: 500 });
  }) as typeof fetch;
  const req = {
    type: 'build' as const, id: 7, z: Z, x: X, y: Y, region: DEFAULT_REGION,
    vectorUrl: 'https://tiles.example/planet/v1/{z}/{x}/{y}.pbf',
    terrain: { heights, size: SIZE }, hiddenFootprints: [],
  };
  const { reply, transfer } = await handleBuild(req, fakeFetch);
  expect(urls[0]).toBe('https://tiles.example/planet/v1/14/8089/5300.pbf');
  expect(reply.type).toBe('built');
  if (reply.type !== 'built') return;
  expect(reply.id).toBe(7);
  expect(reply.meshes.buildings.position.length).toBe(m.buildings.position.length);
  expect(transfer.length).toBe(6 * 3 + 4); // buckets, trees, lamps, ground grid, building tops
  expect(new Set(transfer).size).toBe(transfer.length);
  // a missing tile (open sea) still gets its ground
  const sea = await handleBuild({ ...req, x: 1, y: 1 }, fakeFetch);
  expect(sea.reply.type).toBe('built');
  if (sea.reply.type === 'built') {
    expect(sea.reply.meshes.ground.position.length).toBe(64 * 64 * 2 * 9);
    expect(sea.reply.meshes.buildings.position.length).toBe(0);
  }
  // a server error is reported, not thrown
  const err = await handleBuild({ ...req, x: 2, y: 2 }, fakeFetch);
  expect(err.reply.type).toBe('error');
});

test('worker: a cancelled build stops at the fetch and is reported, not built', async () => {
  const { handleBuild } = await import('../../src/world/worker');
  const ac = new AbortController();
  let seen: AbortSignal | undefined;
  const fakeFetch = (async (_u: string, init?: RequestInit) => {
    seen = init?.signal ?? undefined;
    ac.abort(); // cancelled while the tile downloads
    return new Response(buf);
  }) as typeof fetch;
  const req = {
    type: 'build' as const, id: 9, z: Z, x: X, y: Y, region: DEFAULT_REGION,
    vectorUrl: 'https://tiles.example/{z}/{x}/{y}.pbf', terrain: { heights, size: SIZE },
  };
  const { reply, transfer } = await handleBuild(req, fakeFetch, ac.signal);
  expect(seen).toBe(ac.signal);
  expect(reply).toMatchObject({ type: 'error', id: 9, message: 'cancelled' });
  expect(transfer).toHaveLength(0);
});

test('levels of detail: lite buildings are flat and fewer, far tiles carry ground, water and land use only', () => {
  const lite = buildTileMeshes(f, heights, Z, X, Y, DEFAULT_REGION, { detail: { buildings: 'lite', roadMinRank: 2, trees: true, lamps: false } });
  expect(lite.roofs.position.length).toBe(0);
  expect(lite.stats.gapHouses).toBe(0);
  expect(lite.stats.buildings).toBeGreaterThan(200);
  expect(lite.stats.buildings).toBeLessThan(m.stats.buildings);
  expect(lite.buildings.position.length).toBeLessThan(m.buildings.position.length);
  expect(lite.roads.position.length).toBeLessThan(m.roads.position.length);
  expect(lite.roads.position.length).toBeGreaterThan(0);
  expect(lite.lamps.length).toBe(0);
  expect(lite.trees.length).toBe(m.trees.length);
  const far = buildTileMeshes(f, heights, Z, X, Y, DEFAULT_REGION, {
    detail: { buildings: 'none', roadMinRank: Infinity, waterways: false, trees: false, lamps: false },
  });
  for (const k of ['buildings', 'roofs', 'roads', 'waterways'] as const) expect(far[k].position.length).toBe(0);
  expect(far.trees.length + far.lamps.length + far.tops.length).toBe(0);
  expect(far.ground.position.length).toBe(m.ground.position.length);
  expect(far.water.position.length).toBe(m.water.position.length);
  // major roads only: motorways to secondaries
  const major = buildTileMeshes(f, heights, Z, X, Y, DEFAULT_REGION, { detail: { roadMinRank: 3 } });
  expect(major.roads.position.length).toBeGreaterThan(0);
  expect(major.roads.position.length).toBeLessThan(lite.roads.position.length);
});

test('skirts hang below every ground edge, facing out, in the edge colour', () => {
  const depth = 25;
  const t = buildTileMeshes(f, heights, Z, X, Y, DEFAULT_REGION, { skirtM: depth });
  const n = 64;
  const base = m.ground.position.length;
  expect(t.ground.position.length).toBe(base + n * 4 * 2 * 9);
  expect(Array.from(t.ground.position.subarray(0, base))).toEqual(Array.from(m.ground.position));
  const W = frame.widthM, H = frame.heightM;
  for (let o = base; o < t.ground.position.length; o += 9) {
    const P = t.ground.position, N = t.ground.normal;
    const xs = [P[o], P[o + 3], P[o + 6]], zs = [P[o + 2], P[o + 5], P[o + 8]];
    const onEdge = (v: number[], e: number) => v.every((q) => Math.abs(q - e) < 0.01);
    const out = onEdge(zs, 0) ? [0, 1] : onEdge(zs, -H) ? [0, -1] : onEdge(xs, 0) ? [-1, 0] : onEdge(xs, W) ? [1, 0] : null;
    expect(out).not.toBeNull();
    expect([N[o], N[o + 2]]).toEqual(out);
    // wound to face outward
    const e1 = [P[o + 3] - P[o], P[o + 4] - P[o + 1], P[o + 5] - P[o + 2]];
    const e2 = [P[o + 6] - P[o], P[o + 7] - P[o + 1], P[o + 8] - P[o + 2]];
    const nx = e1[1] * e2[2] - e1[2] * e2[1], nz = e1[0] * e2[1] - e1[1] * e2[0];
    expect(nx * out![0] + nz * out![1]).toBeGreaterThan(0);
  }
  // the deepest skirt point is `depth` under its edge vertex
  const ys = Array.from(t.ground.position.subarray(base)).filter((_, i) => i % 3 === 1);
  const g = groundGrid(heights, SIZE, frame, n);
  expect(Math.min(...ys)).toBeCloseTo(Math.min(...Array.from(g.terr)) - depth, 3);
});

test('the ground grid and building tops come back for ground and rooftop queries', () => {
  const n = 64;
  expect(m.grid.length).toBe((n + 1) * (n + 1));
  const g = groundGrid(heights, SIZE, frame, n);
  // the drawn surface: corner vertex (i, j) of the ground mesh sits at grid[j * (n + 1) + i]
  for (const [i, j] of [[0, 0], [10, 20], [n, n], [33, 5]]) {
    expect(m.grid[j * (n + 1) + i]).toBeCloseTo(groundHeightAt({ ...g, terr: m.grid }, g.X[i], g.Z[j]), 4);
  }
  expect(m.tops.length).toBe((m.stats.buildings + m.stats.gapHouses) * 4);
  let tall = 0;
  for (let k = 0; k < m.tops.length; k += 4) {
    const [x, z, r, top] = m.tops.subarray(k, k + 4);
    expect(x).toBeGreaterThanOrEqual(-r);
    expect(z).toBeLessThanOrEqual(r);
    expect(r).toBeGreaterThan(0.5);
    expect(top).toBeGreaterThan(groundHeightAt({ ...g, terr: m.grid }, Math.min(frame.widthM, Math.max(0, x)), Math.max(-frame.heightM, Math.min(0, z))) - 2);
    if (top - 38 > 60) tall++;
  }
  expect(tall).toBeGreaterThan(5); // Manchester's towers
});

test('worker: reads terrain itself when none is sent, and packs the buckets on request', async () => {
  const { handleBuild } = await import('../../src/world/worker');
  const asked: string[] = [];
  const terrain = async (z: number, x: number, y: number) => {
    asked.push(`${z}/${x}/${y}`);
    return { heights, size: SIZE };
  };
  const req = {
    type: 'build' as const, id: 3, z: Z, x: X, y: Y, region: DEFAULT_REGION,
    vectorUrl: 'https://tiles.example/{z}/{x}/{y}.pbf', pack: true, skirtM: 20,
  };
  const { reply, transfer } = await handleBuild(req, (async () => new Response(buf)) as unknown as typeof fetch, undefined, terrain);
  expect(asked).toEqual([`${Z}/${X}/${Y}`]);
  expect(reply.type).toBe('built');
  if (reply.type !== 'built') return;
  const g = reply.meshes.ground;
  expect(g.normal).toBeInstanceOf(Int8Array);
  expect(g.color).toBeInstanceOf(Uint8Array);
  expect(g.color.length).toBe((g.position.length / 3) * 4);
  expect(new Set(transfer).size).toBe(transfer.length);
});

test('lakes lie flat at their lowest shore height, and the ground under them is lowered so they show', () => {
  const s = emptyFeatures();
  const lake = rect(400, -400, 560, -540);
  s.water.push({ cls: 'lake', subclass: '', polygon: lake });
  const t = buildTileMeshes(s, heights, Z, X, Y, DEFAULT_REGION);
  const g = groundGrid(heights, SIZE, frame, 64); // the ground before lowering
  const r = lake[0];
  let shoreMin = Infinity;
  for (let i = 0; i < r.length; i += 2) shoreMin = Math.min(shoreMin, groundHeightAt(g, r[i], r[i + 1]));
  const ys = new Set<number>();
  for (let i = 1; i < t.water.position.length; i += 3) ys.add(Math.round(t.water.position[i] * 100) / 100);
  expect([...ys].sort()).toEqual([Math.round(shoreMin * 100) / 100, Math.round((shoreMin + 0.05) * 100) / 100].sort());
  // the middle of the lake: ground below the water
  expect(groundMeshHeight(t.ground, 480, -470)).toBeLessThan(shoreMin - 0.5);
  // outside it, the ground is untouched
  expect(groundMeshHeight(t.ground, 200, -200)).toBeCloseTo(groundHeightAt(g, 200, -200), 3);
});

test('the sea lies at 0 m over lowered ground', () => {
  const s = emptyFeatures();
  s.water.push({ cls: 'ocean', subclass: '', polygon: rect(0, 0, frame.widthM, -frame.heightM / 2) });
  const zero = new Float32Array(SIZE * SIZE);
  const t = buildTileMeshes(s, zero, Z, X, Y, DEFAULT_REGION);
  expect(groundMeshHeight(t.ground, frame.widthM / 2, -frame.heightM / 4)).toBeLessThan(-0.5);
  for (let i = 1; i < t.water.position.length; i += 3) expect(t.water.position[i]).toBeLessThan(0.06);
});

test('river polygons follow the ground down the valley, just above it', () => {
  const s = emptyFeatures();
  s.water.push({ cls: 'river', subclass: '', polygon: rect(100, -700, 1300, -730) });
  const t = buildTileMeshes(s, heights, Z, X, Y, DEFAULT_REGION);
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < t.water.position.length; i += 3) {
    const x = t.water.position[i], y = t.water.position[i + 1], z = t.water.position[i + 2];
    const above = y - groundMeshHeight(t.ground, x, z);
    expect(above).toBeGreaterThan(0.1);
    expect(above).toBeLessThan(0.4);
    lo = Math.min(lo, y); hi = Math.max(hi, y);
  }
  expect(hi - lo).toBeGreaterThan(5); // it really descends along the 1.2 km reach
});

test('roads crossing flat water stay above its surface (bridges over docks and lakes)', () => {
  const s = emptyFeatures();
  s.water.push({ cls: 'lake', subclass: '', polygon: rect(400, -400, 700, -700) });
  s.transportation.push({ cls: 'primary', subclass: '', brunnel: 'bridge', line: Float64Array.from([300, -550, 800, -550]) });
  const t = buildTileMeshes(s, heights, Z, X, Y, DEFAULT_REGION);
  let level = Infinity;
  for (let i = 1; i < t.water.position.length; i += 3) level = Math.min(level, t.water.position[i]);
  for (let i = 0; i < t.roads.position.length; i += 3) {
    const x = t.roads.position[i];
    if (x > 420 && x < 680) expect(t.roads.position[i + 1]).toBeGreaterThan(level + 0.25);
  }
});

test('trees: none on the protected-area (park layer) polygon, some in the city parks', () => {
  const historic = f.park.filter((a) => a.cls === 'historic').map((a) => a.polygon);
  expect(historic.length).toBeGreaterThan(0); // Mamucium Roman fort
  const parks = f.landcover.filter((a) => a.subclass === 'park').map((a) => a.polygon);
  expect(parks.length).toBeGreaterThan(0);
  let inHistoric = 0, inParks = 0;
  for (let i = 0; i < m.trees.length; i += 16) {
    const x = m.trees[i + 12], z = m.trees[i + 14];
    if (historic.some((p) => inside(p, x, z)) && !f.landcover.some((a) => (a.cls === 'wood' || a.subclass === 'park') && inside(a.polygon, x, z))) inHistoric++;
    if (parks.some((p) => inside(p, x, z))) inParks++;
  }
  expect(inHistoric).toBe(0);
  expect(inParks).toBeGreaterThan(10);
  // a park-layer polygon alone (a national park over moorland) gets no trees
  const s = emptyFeatures();
  s.park.push({ cls: 'national_park', subclass: '', polygon: rect(0, 0, frame.widthM, -frame.heightM) });
  expect(buildTileMeshes(s, flat, Z, X, Y, DEFAULT_REGION).trees.length).toBe(0);
});

test('water: no deep band on an edge shared by two water polygons, band on the outer shore', () => {
  const s = emptyFeatures();
  s.water.push({ cls: 'lake', subclass: '', polygon: rect(400, -400, 600, -600) });
  s.water.push({ cls: 'lake', subclass: '', polygon: rect(600, -400, 800, -600) });
  const t = buildTileMeshes(s, flat, Z, X, Y, DEFAULT_REGION);
  const deep = parseHex(CONTOUR.waterDeep).map((v) => v / 255);
  let nearShared = 0, nearOuter = 0;
  for (let i = 0; i < t.water.color.length; i += 9) { // per triangle, by centroid
    if (Math.hypot(t.water.color[i] - deep[0], t.water.color[i + 1] - deep[1], t.water.color[i + 2] - deep[2]) >= 0.02) continue;
    const p = t.water.position;
    const x = (p[i] + p[i + 3] + p[i + 6]) / 3, z = (p[i + 2] + p[i + 5] + p[i + 8]) / 3;
    if (z < -420 && z > -580) {
      if (Math.abs(x - 600) < 15) nearShared++;
      if (Math.abs(x - 400) < 15 || Math.abs(x - 800) < 15) nearOuter++;
    }
  }
  expect(nearShared).toBe(0);
  expect(nearOuter).toBeGreaterThan(0);
});

test('a road crossing the tile border at 45 degrees: each tile draws exactly its half, no notch', () => {
  const triArea = (p: Float32Array) => {
    let a = 0;
    for (let t = 0; t < p.length; t += 9)
      a += Math.abs((p[t + 3] - p[t]) * (p[t + 8] - p[t + 2]) - (p[t + 5] - p[t + 2]) * (p[t + 6] - p[t])) / 2;
    return a;
  };
  const W = frame.widthM;
  const road = (dx: number) => {
    const s = emptyFeatures();
    s.transportation.push({ cls: 'primary', subclass: '', brunnel: '', line: Float64Array.from([W - 150 - dx, -500, W + 150 - dx, -800]) });
    return s;
  };
  const a = buildTileMeshes(road(0), flat, Z, X, Y, DEFAULT_REGION).roads;
  const b = buildTileMeshes(road(W), flat, Z, X + 1, Y, DEFAULT_REGION).roads;
  for (let i = 0; i < a.position.length; i += 3) expect(a.position[i]).toBeLessThanOrEqual(W + 1e-3);
  for (let i = 0; i < b.position.length; i += 3) expect(b.position[i]).toBeGreaterThanOrEqual(-1e-3);
  const full = 10 * 300 * Math.SQRT2; // primary: 10 m wide, square ends
  expect(triArea(a.position)).toBeCloseTo(full / 2, 0);
  expect(triArea(b.position)).toBeCloseTo(full / 2, 0);
  // every point of the true ribbon next to the border is covered by the tile it lies in
  const covered = (p: Float32Array, x: number, z: number) => {
    for (let t = 0; t < p.length; t += 9) {
      const ax = p[t], az = p[t + 2], bx = p[t + 3], bz = p[t + 5], cx = p[t + 6], cz = p[t + 8];
      const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d, l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d;
      if (l1 >= -1e-6 && l2 >= -1e-6 && 1 - l1 - l2 >= -1e-6) return true;
    }
    return false;
  };
  // centreline crosses x = W at z = -650; across the ribbon (perpendicular (1,1)/sqrt2), +-4.9 m
  for (let k = -4.9; k <= 4.9; k += 0.7) {
    for (const along of [-2, -0.3, 0.3, 2]) {
      const x = W + (k + along) / Math.SQRT2, z = -650 + (k - along) / Math.SQRT2;
      if (x < W) expect(covered(a.position, x, z)).toBe(true);
      else expect(covered(b.position, x - W, z)).toBe(true);
    }
  }
});

test('decoded roads and rivers run on into the tile buffer, so ribbons can be cut at the border', () => {
  const W = frame.widthM;
  let beyond = 0;
  for (const l of [...f.transportation, ...f.waterway])
    for (let i = 0; i < l.line.length; i += 2) if (l.line[i] < -1 || l.line[i] > W + 1 || l.line[i + 1] > 1 || l.line[i + 1] < -frame.heightM - 1) beyond++;
  expect(beyond).toBeGreaterThan(0);
  // and every ribbon vertex is inside the tile
  for (const b of [m.roads, m.waterways])
    for (let i = 0; i < b.position.length; i += 3) {
      expect(b.position[i]).toBeGreaterThanOrEqual(-1e-3);
      expect(b.position[i]).toBeLessThanOrEqual(W + 1e-3);
    }
});

test('simplifyRing drops vertices within the tolerance and keeps the corners', async () => {
  const { simplifyRing } = await import('../../src/world/geom');
  // a 20 m square with points along its sides and a 0.5 m bump on one
  const r = [0, 0, 10, 0.5, 20, 0, 20, 10, 20, 20, 10, 20, 0, 20, 0, 10];
  expect(simplifyRing(r, 1)).toEqual([0, 0, 20, 0, 20, 20, 0, 20]);
  expect(simplifyRing(r, 0.2).length).toBe(10); // the bump stays
  expect(simplifyRing([0, 0, 1, 0, 0, 1], 5)).toEqual([0, 0, 1, 0, 0, 1]); // a triangle is left alone
});

test('split: buildings, roofs and roads sorted by tile cell, quarters together, the same triangles in another order', () => {
  const s = buildTileMeshes(f, heights, Z, X, Y, DEFAULT_REGION, { split: true });
  const key = (b: MeshBuffers, t: number) => Array.from(b.position.subarray(t * 9, t * 9 + 9), (v) => v.toFixed(3)).join(',') + Array.from(b.color.subarray(t * 9, t * 9 + 9), (v) => v.toFixed(3)).join(',');
  for (const k of ['buildings', 'roofs', 'roads'] as const) {
    const a = m[k], b = s[k] as MeshBuffers & { parts?: Uint32Array };
    expect(b.parts).toBeDefined();
    const parts = b.parts!;
    expect(parts).toHaveLength(17);
    expect(parts[0]).toBe(0);
    expect(parts[16]).toBe(b.position.length / 3);
    const tris = a.position.length / 9;
    expect(b.position.length).toBe(a.position.length);
    const want = new Map<string, number>();
    for (let t = 0; t < tris; t++) want.set(key(a, t), (want.get(key(a, t)) ?? 0) + 1);
    for (let t = 0; t < tris; t++) {
      const kk = key(b, t);
      expect(want.get(kk)).toBeGreaterThan(0);
      want.set(kk, want.get(kk)! - 1);
      // each triangle's centre lies in its cell, and its quarter is parts[4q] .. parts[4q + 4]
      const v = t * 3;
      const k = parts.findIndex((p, i) => i < 16 && v >= p && v < parts[i + 1]);
      const o = t * 9;
      const cx = (b.position[o] + b.position[o + 3] + b.position[o + 6]) / 3, cz = (b.position[o + 2] + b.position[o + 5] + b.position[o + 8]) / 3;
      expect(k).toBe(cellIndex(cx, cz, frame.widthM, frame.heightM));
      expect(k >> 2).toBe((cx > frame.widthM / 2 ? 1 : 0) + (cz < -frame.heightM / 2 ? 2 : 0));
    }
    for (let q = 0; q < 4; q++) expect(parts[4 * q + 4] - parts[4 * q]).toBeGreaterThan(0); // the Town Hall tile has buildings everywhere
  }
  // cells: 4 x 4, quarters SW SE NW NE, the same order inside
  const W = frame.widthM, H = frame.heightM;
  expect(cellIndex(1, -1, W, H)).toBe(0);
  expect(cellIndex(W * 0.3, -1, W, H)).toBe(1);
  expect(cellIndex(1, -H * 0.3, W, H)).toBe(2);
  expect(cellIndex(W * 0.6, -1, W, H)).toBe(4);
  expect(cellIndex(1, -H * 0.6, W, H)).toBe(8);
  expect(cellIndex(W - 1, -H + 1, W, H)).toBe(15);
  expect(cellIndex(-50, 50, W, H)).toBe(0); // outside the tile: the nearest cell
  expect(s.ground.position).toEqual(m.ground.position);
  expect((s.ground as { parts?: Uint32Array }).parts).toBeUndefined();
  // packing keeps the quarters, and they travel with the transfer
  const p = packMeshes(s);
  expect(p.buildings.parts).toBe((s.buildings as { parts?: Uint32Array }).parts);
  expect(transferables(p)).toContain(p.buildings.parts!.buffer);
});
