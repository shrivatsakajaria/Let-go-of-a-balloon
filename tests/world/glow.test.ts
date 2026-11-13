import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { decodeVectorTile, emptyFeatures, type Polygon } from '../../src/world/vector';
import { tileFrame } from '../../src/world/frame';
import { glowGrid, vertexGlow, placeBoats, BOAT_STRIDE } from '../../src/world/glow';
import { buildTileMeshes, packMeshes, transferables } from '../../src/world/meshjob';
import { DEFAULT_REGION } from '../../src/world/palette';

const [Z, X, Y] = [14, 8089, 5300];
const frame = tileFrame(Z, X, Y);
const W = frame.widthM, H = frame.heightM;
const N = 32;
const rect = (x0: number, z0: number, x1: number, z1: number): Polygon => [Float64Array.from([x0, z0, x1, z0, x1, z1, x0, z1])];

describe('city glow', () => {
  it('is zero where nothing is built', () => {
    const g = glowGrid(emptyFeatures(), frame, N);
    expect(g.length).toBe(N * N);
    expect(Math.max(...g)).toBe(0);
  });

  it('is strongest where buildings and roads are densest, and stays within 0..1', () => {
    const f = emptyFeatures();
    // a dense block of buildings in the south-west quarter (row 0 = south)
    for (let i = 0; i < 20; i++) for (let j = 0; j < 20; j++) {
      const x = 20 + i * 25, z = -20 - j * 25;
      f.building.push({ height: 15, minHeight: 0, polygon: rect(x, z, x + 18, z - 18) });
    }
    for (let k = 0; k < 10; k++) f.transportation.push({ cls: 'primary', subclass: '', brunnel: '', line: Float64Array.from([0, -50 * k, W / 2, -50 * k]) });
    const g = glowGrid(f, frame, N);
    for (const v of g) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    const at = (x: number, z: number) => g[Math.floor((-z / H) * N) * N + Math.floor((x / W) * N)];
    expect(at(250, -250)).toBeGreaterThan(0.5);
    expect(at(W - 100, -H + 100)).toBe(0);
  });

  it('a tile without buildings estimates the cover from land use (far tiles still show their towns)', () => {
    const f = emptyFeatures();
    f.landuse.push({ cls: 'residential', subclass: '', polygon: rect(-10, 10, W + 10, -H - 10) });
    const res = glowGrid(f, frame, N)[N * 16 + 16];
    f.landuse.push({ cls: 'commercial', subclass: '', polygon: rect(-10, 10, W + 10, -H - 10) });
    const town = glowGrid(f, frame, N)[N * 16 + 16];
    expect(res).toBeGreaterThan(0.05);
    expect(res).toBeLessThan(0.6);
    expect(town).toBeGreaterThan(res);
    f.landuse = [{ cls: 'farmland', subclass: '', polygon: rect(-10, 10, W + 10, -H - 10) }];
    expect(glowGrid(f, frame, N)[N * 16 + 16]).toBe(0);
  });

  it('per vertex: sampled from the grid at each vertex position, as bytes', () => {
    const g = new Float32Array(N * N);
    for (let j = 0; j < N / 2; j++) for (let i = 0; i < N / 2; i++) g[j * N + i] = 1; // south-west quarter
    const pos = Float32Array.from([W * 0.1, 0, -H * 0.1, W * 0.9, 0, -H * 0.9, W * 0.25, 5, -H * 0.25]);
    const v = vertexGlow(pos, g, N, W, H);
    expect(v).toBeInstanceOf(Uint8Array);
    expect(v.length).toBe(3);
    expect(v[0]).toBe(255);
    expect(v[1]).toBe(0);
    expect(v[2]).toBe(255);
  });
});

describe('boats', () => {
  const f13 = tileFrame(13, 4044, 2650);
  const W = f13.widthM, H = f13.heightM;
  const sea = () => {
    const f = emptyFeatures();
    f.water.push({ cls: 'ocean', subclass: '', polygon: rect(-10, 10, W + 10, -H - 10) });
    return f;
  };

  it('none without open water', () => {
    expect(placeBoats(emptyFeatures(), [], f13, 13, 1).length).toBe(0);
    const f = emptyFeatures();
    f.water.push({ cls: 'pond', subclass: '', polygon: rect(100, -100, 200, -200) });
    expect(placeBoats(f, [NaN], f13, 13, 1).length).toBe(0);
  });

  it('a few on the open sea, inside it, at its level, the same for the same tile', () => {
    let total = 0;
    for (let seed = 0; seed < 40; seed++) {
      const b = placeBoats(sea(), [0], f13, 13, seed);
      expect(b.length % BOAT_STRIDE).toBe(0);
      const n = b.length / BOAT_STRIDE;
      expect(n).toBeLessThanOrEqual(3);
      total += n;
      for (let i = 0; i < b.length; i += BOAT_STRIDE) {
        expect(b[i]).toBeGreaterThanOrEqual(0);
        expect(b[i]).toBeLessThanOrEqual(W);
        expect(b[i + 2]).toBeLessThanOrEqual(0);
        expect(b[i + 2]).toBeGreaterThanOrEqual(-H);
        expect(b[i + 1]).toBe(0);
        expect(b[i + 4]).toBeGreaterThan(20); // a ship, tens of metres long
        expect(b[i + 4]).toBeLessThan(120);
      }
      expect(placeBoats(sea(), [0], f13, 13, seed)).toEqual(b);
    }
    expect(total).toBeGreaterThan(10); // the odd ship: about one per sea tile
    expect(total).toBeLessThan(120);
  });

  it('not on land inside the sea polygon', () => {
    const f = sea();
    f.water[0].polygon = [rect(-10, 10, W + 10, -H - 10)[0], rect(-5, 5, W + 5, -H - 5)[0]]; // a hole over all of it
    let n = 0;
    for (let seed = 0; seed < 20; seed++) n += placeBoats(f, [0], f13, 13, seed).length;
    expect(n).toBe(0);
  });
});

describe('mesh job carries glow and boats', () => {
  const buf = readFileSync(new URL('../fixtures/omt_14_8089_5300.pbf', import.meta.url));
  const f = decodeVectorTile(buf, Z, X, Y);
  const heights = new Float32Array(64 * 64).fill(40);
  const m = buildTileMeshes(f, heights, Z, X, Y, DEFAULT_REGION, { skirtM: 25, split: true });

  it('ground and roads have one glow byte per vertex, and central Manchester glows', () => {
    expect(m.ground.glow!.length).toBe(m.ground.position.length / 3);
    expect(m.roads.glow!.length).toBe(m.roads.position.length / 3);
    let max = 0;
    for (const v of m.ground.glow!) max = Math.max(max, v);
    expect(max).toBeGreaterThan(150);
    expect(m.boats).toBeInstanceOf(Float32Array);
  });

  it('packing keeps the glow and sends it as a transfer', () => {
    const p = packMeshes(buildTileMeshes(f, heights, Z, X, Y, DEFAULT_REGION, { split: true }));
    expect(p.ground.glow!.length).toBe(p.ground.position.length / 3);
    const t = transferables(p);
    expect(t).toContain(p.ground.glow!.buffer);
    expect(t).toContain(p.boats.buffer);
  });

  it('no glow and no boats when the detail leaves them out', () => {
    const lite = buildTileMeshes(f, heights, Z, X, Y, DEFAULT_REGION, { detail: { boats: false, glow: false } });
    expect(lite.ground.glow).toBeUndefined();
    expect(lite.boats.length).toBe(0);
  });
});
