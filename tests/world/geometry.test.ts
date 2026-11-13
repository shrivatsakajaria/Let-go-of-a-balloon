import { describe, expect, it } from 'vitest';
import { srgbToLinear, toGeometry, treeGeometry, triangleCount } from '../../src/world/geometry';

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


describe('packed buffers and slots', () => {
  it('uses packed normals and linear colours as they are, and tags every vertex with its slot', async () => {
    const { packBuffers } = await import('../../src/world/meshjob');
    const p = packBuffers({
      position: new Float32Array(9).fill(1),
      normal: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]),
      color: new Float32Array(9).fill(0.5),
    });
    expect(Array.from(p.normal.slice(0, 4))).toEqual([0, 127, 0, 0]);
    expect(p.color[0]).toBe(Math.round(srgbToLinear(0.5) * 255));
    expect(p.color[3]).toBe(255);
    const g = toGeometry(p, 7)!;
    expect(g.getAttribute('normal').itemSize).toBe(4);
    expect(g.getAttribute('normal').normalized).toBe(true);
    expect(g.getAttribute('color').getX(0)).toBeCloseTo(p.color[0] / 255, 6);
    expect(g.getAttribute('aSlot').count).toBe(3);
    expect(g.getAttribute('aSlot').getX(2)).toBe(7);
  });
});

it('packed buffers with worker bounds: the box and sphere come from them, not from the vertices', () => {
  const position = new Float32Array([0, 0, 0, 10, 0, 0, 0, 5, -20]);
  const g = toGeometry({ position, normal: new Int8Array(12), color: new Uint8Array(12), bounds: new Float32Array([-1, -2, -30, 11, 6, 1]) })!;
  expect(g.boundingBox!.min.toArray()).toEqual([-1, -2, -30]);
  expect(g.boundingBox!.max.toArray()).toEqual([11, 6, 1]);
  expect(g.boundingSphere!.center.toArray()).toEqual([5, 2, -14.5]);
});
