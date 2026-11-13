import { describe, expect, it } from 'vitest';
import { blockBounds, farLandBuffers, gridPlacements, orbitPose, sceneXZ } from '../../src/debug/tilegrid';
import { srgbToLinear, toGeometry, treeGeometry, triangleCount } from '../../src/debug/tilegeom';
import { tileFrame } from '../../src/world/frame';

const ALBERT = { lat: 53.4794, lon: -2.2453 };

describe('gridPlacements', () => {
  const tiles = gridPlacements(ALBERT, 14);

  it('gives the 3 x 3 block around Albert Square, centre tile first', () => {
    expect(tiles).toHaveLength(9);
    expect(tiles[0]).toMatchObject({ x: 8089, y: 5300, ring: 0, scaleX: 1 });
    const keys = new Set(tiles.map((t) => `${t.x}/${t.y}`));
    for (let x = 8088; x <= 8090; x++) for (let y = 5299; y <= 5301; y++) expect(keys.has(`${x}/${y}`)).toBe(true);
    expect(tiles.slice(1).every((t) => t.ring === 1)).toBe(true);
  });

  it('puts Albert Square at the scene origin', () => {
    const c = tiles[0];
    const f = tileFrame(14, c.x, c.y);
    const p = f.toLocal(ALBERT.lat, ALBERT.lon);
    expect(c.offsetX + p.x * c.scaleX).toBeCloseTo(0, 6);
    expect(c.offsetZ + p.z).toBeCloseTo(0, 6);
    expect(sceneXZ(ALBERT, 14, ALBERT)).toEqual({ x: 0, z: 0 });
  });

  it('lays neighbours edge to edge with no gap or overlap', () => {
    const at = (x: number, y: number) => tiles.find((t) => t.x === x && t.y === y)!;
    for (const t of tiles) {
      const f = tileFrame(14, t.x, t.y);
      const east = tiles.find((u) => u.x === t.x + 1 && u.y === t.y);
      if (east) expect(t.offsetX + f.widthM * t.scaleX).toBeCloseTo(east.offsetX, 6);
      const north = tiles.find((u) => u.x === t.x && u.y === t.y - 1);
      if (north) expect(t.offsetZ - f.heightM).toBeCloseTo(north.offsetZ, 6);
    }
    // north is -z, east is +x, about one tile (1.45 km at 53.5 N) apart
    expect(at(8089, 5299).offsetZ - at(8089, 5300).offsetZ).toBeCloseTo(-tileFrame(14, 8089, 5300).heightM, 3);
    expect(at(8090, 5300).offsetX - at(8089, 5300).offsetX).toBeGreaterThan(1440);
    expect(at(8090, 5300).offsetX - at(8089, 5300).offsetX).toBeLessThan(1470);
  });

  it('corrects the small east-west width difference of rows north and south', () => {
    const n = tiles.find((t) => t.y === 5299)!;
    const s = tiles.find((t) => t.y === 5301)!;
    // further north, a degree of longitude is shorter, so the tile's own metres stretch slightly
    expect(n.scaleX).toBeGreaterThan(1);
    expect(s.scaleX).toBeLessThan(1);
    expect(Math.abs(n.scaleX - 1) * tileFrame(14, n.x, n.y).widthM).toBeLessThan(0.6); // about 0.45 m at Manchester
  });

  it('a point maps to the same scene position through any tile frame', () => {
    const p = { lat: 53.4862, lon: -2.2611 }; // north-west, in tile 8089/5299 or 8088/5299
    const viaScene = sceneXZ(ALBERT, 14, p);
    for (const t of tiles) {
      const f = tileFrame(14, t.x, t.y);
      const b = f.bounds;
      if (p.lat < b.south || p.lat > b.north || p.lon < b.west || p.lon > b.east) continue;
      const q = f.toLocal(p.lat, p.lon);
      expect(t.offsetX + q.x * t.scaleX).toBeCloseTo(viaScene.x, 6);
      expect(t.offsetZ + q.z).toBeCloseTo(viaScene.z, 6);
    }
  });
});

describe('orbitPose', () => {
  const o = { periodSec: 100, startDeg: 180, distance: 1000, pitchDeg: 30 };
  it('starts south of the target and turns once per period', () => {
    const a = orbitPose(0, o);
    expect(a.azimuthDeg).toBe(180);
    expect(a.x).toBeCloseTo(0, 6);
    expect(a.z).toBeCloseTo(866.03, 1); // south is +z
    expect(a.y).toBeCloseTo(500, 6);
    expect(orbitPose(100, o).azimuthDeg).toBeCloseTo(180, 6);
    expect(orbitPose(25, o).azimuthDeg).toBeCloseTo(270, 6);
    expect(orbitPose(25, o).x).toBeCloseTo(-866.03, 1); // west is -x
  });
});

describe('toGeometry', () => {
  const buffers = (tris: number) => ({
    position: new Float32Array(tris * 9).map((_, i) => i),
    normal: new Float32Array(tris * 9).fill(0.5),
    color: new Float32Array(tris * 9).fill(0.5),
  });

  it('keeps every triangle and vertex', () => {
    const g = toGeometry(buffers(4))!;
    expect(g.getAttribute('position').count).toBe(12);
    expect(g.getAttribute('normal').count).toBe(12);
    expect(g.getAttribute('color').count).toBe(12);
    expect(g.index).toBeNull();
    expect(triangleCount(g)).toBe(4);
  });

  it('converts sRGB vertex colours to linear', () => {
    const g = toGeometry(buffers(1))!;
    expect(g.getAttribute('color').getX(0)).toBeCloseTo(0.214, 3);
    expect(srgbToLinear(0)).toBe(0);
    expect(srgbToLinear(1)).toBeCloseTo(1, 9);
  });

  it('returns null for an empty bucket', () => {
    expect(toGeometry({ position: new Float32Array(0), normal: new Float32Array(0), color: new Float32Array(0) })).toBeNull();
  });

  it('rejects mismatched buffers', () => {
    expect(() => toGeometry({ position: new Float32Array(9), normal: new Float32Array(6), color: new Float32Array(9) })).toThrow();
  });
});

describe('treeGeometry', () => {
  it('is a flat-shaded cone standing on the ground', () => {
    const g = treeGeometry(11, 3.4, 7);
    expect(g.index).toBeNull();
    expect(triangleCount(g)).toBe(7);
    g.computeBoundingBox();
    expect(g.boundingBox!.min.y).toBeCloseTo(0, 6);
    expect(g.boundingBox!.max.y).toBeCloseTo(11, 6);
  });
});

describe('blockBounds and farLandBuffers', () => {
  const tiles = gridPlacements(ALBERT, 14);
  const b = blockBounds(tiles);

  it('bounds the block around the origin, about three tiles each way', () => {
    expect(b.minX).toBeLessThan(0);
    expect(b.maxX).toBeGreaterThan(0);
    expect(b.minZ).toBeLessThan(0);
    expect(b.maxZ).toBeGreaterThan(0);
    expect(b.maxX - b.minX).toBeGreaterThan(4300);
    expect(b.maxX - b.minX).toBeLessThan(4450);
    expect(b.maxZ - b.minZ).toBeGreaterThan(4300);
  });

  it('meets the block edge just below the ground, sinks under the block and reaches the horizon', () => {
    const ground = (x: number, z: number) => 40 + x * 0.002 + z * 0.001;
    const m = farLandBuffers(b, ground, [[0.5, 0.6, 0.4]], { drop: 1.5, below: 30 });
    const n = m.position.length / 3;
    expect(n % 3).toBe(0);
    expect(m.normal.length).toBe(m.position.length);
    expect(m.color.length).toBe(m.position.length);
    let reach = 0, onEdge = 0;
    const lowest = 40 + b.minX * 0.002 + b.minZ * 0.001 - 1.5;
    for (let i = 0; i < n; i++) {
      const x = m.position[i * 3], y = m.position[i * 3 + 1], z = m.position[i * 3 + 2];
      reach = Math.max(reach, Math.abs(x), Math.abs(z));
      const e = 0.01; // positions are float32
      const inside = x > b.minX + e && x < b.maxX - e && z > b.minZ + e && z < b.maxZ - e;
      const within = x > b.minX - e && x < b.maxX + e && z > b.minZ - e && z < b.maxZ + e;
      if (inside) expect(y).toBeCloseTo(lowest - 30, 3);
      else if (within) {
        expect(y).toBeCloseTo(ground(x, z) - 1.5, 1);
        onEdge++;
      }
    }
    expect(onEdge).toBeGreaterThan(0);
    expect(reach).toBeGreaterThan(15000);
    for (let i = 1; i < m.normal.length; i += 3) expect(m.normal[i]).toBeGreaterThan(0.5); // faces point up (the short drop under the block edge is steepest)
  });
});
