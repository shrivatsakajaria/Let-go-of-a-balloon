import { test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { decodeVectorTile, emptyFeatures, type Polygon } from '../../src/world/vector';
import { buildTileMeshes, type TileMeshes } from '../../src/world/meshjob';
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
  const zones = [...f.landcover.filter((a) => a.cls === 'wood'), ...f.park].map((a) => a.polygon);
  expect(zones.length).toBeGreaterThan(0);
  const n = m.trees.length / 16;
  expect(Number.isInteger(n)).toBe(true);
  expect(n).toBeGreaterThan(20);
  expect(n).toBeLessThanOrEqual(2000);
  for (let i = 0; i < n; i++) {
    const x = m.trees[i * 16 + 12], z = m.trees[i * 16 + 14];
    expect(zones.some((p) => inside(p, x, z))).toBe(true);
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

test('decoded polygons and lines are clipped to the tile', () => {
  const eps = 1e-6;
  const ok = (x: number, z: number) => x >= -eps && x <= frame.widthM + eps && z <= eps && z >= -frame.heightM - eps;
  for (const a of [...f.water, ...f.landcover, ...f.landuse, ...f.park])
    for (const r of a.polygon) for (let i = 0; i < r.length; i += 2) expect(ok(r[i], r[i + 1])).toBe(true);
  for (const l of [...f.transportation, ...f.waterway])
    for (let i = 0; i < l.line.length; i += 2) expect(ok(l.line[i], l.line[i + 1])).toBe(true);
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
  const g = groundGrid(heights, SIZE, frame, 64);
  for (const b of [m.roads, m.waterways]) {
    expect(b.position.length).toBeGreaterThan(0);
    for (let i = 0; i < b.position.length; i += 3 * 7) {
      const x = b.position[i], y = b.position[i + 1], z = b.position[i + 2];
      expect(Math.abs(y - groundHeightAt(g, x, z) - 0.3)).toBeLessThan(0.05);
    }
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

