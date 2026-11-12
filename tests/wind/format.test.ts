/// <reference types="node" />
import { test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { TILE_HEADER, decodeTile, windIndex, headerBytes } from '../../src/wind/format';

// tests/fixtures/wind/tiny.bin is written by pipeline/tests/test_fixture.py with the Python
// encoder: 2 hours x 2 levels x 3 lat x 4 lon, raw u = k, v = -k where k = h*24 + l*12 + i*4 + j,
// gh = 1000*(l+1) + 100*h + i*4 + j, except the very last cell, gh = -2889.
function tinyBuffer(): ArrayBuffer {
  const file = readFileSync(new URL('../fixtures/wind/tiny.bin', import.meta.url));
  // Copy into a fresh ArrayBuffer (Node Buffers can be views into a larger pool).
  return new Uint8Array(file).buffer;
}

test('fixture is the expected size', () => {
  expect(tinyBuffer().byteLength).toBe(227);
  expect(headerBytes(2, 2)).toBe(TILE_HEADER.FIXED_BYTES + 8);
});

test('decodes the header written by the Python encoder', () => {
  const t = decodeTile(tinyBuffer());
  expect(t.version).toBe(1);
  expect([t.nHours, t.nLevels, t.nLat, t.nLon]).toEqual([2, 2, 3, 4]);
  expect([t.lat0, t.lon0, t.res, t.scale]).toEqual([-10, 170, 0.25, 0.5]);
  expect(t.levels).toEqual([850, 500]);
  expect(t.hours).toEqual([3, 6]);
  expect(t.u).toBeInstanceOf(Int8Array);
  expect(t.gh).toBeInstanceOf(Int16Array);
  expect(t.u.length).toBe(2 * 2 * 3 * 4);
});

test('values are laid out [hour][level][lat][lon]', () => {
  const t = decodeTile(tinyBuffer());
  expect(windIndex(t, 0, 0, 0, 0)).toBe(0);
  expect(windIndex(t, 1, 1, 2, 3)).toBe(47);
  expect(t.u[windIndex(t, 0, 0, 0, 1)]).toBe(1);
  expect(t.u[windIndex(t, 0, 0, 1, 0)]).toBe(4);
  expect(t.u[windIndex(t, 1, 0, 2, 1)]).toBe(33);
  expect(t.v[windIndex(t, 1, 0, 2, 1)]).toBe(-33);
  expect(t.u[windIndex(t, 0, 1, 0, 0)] * t.scale).toBe(6); // 12 units at 0.5 m/s
  expect(t.gh[windIndex(t, 0, 1, 1, 2)]).toBe(2006);
  expect(t.gh[windIndex(t, 1, 0, 0, 0)]).toBe(1100);
  expect(t.gh[windIndex(t, 1, 1, 2, 3)]).toBe(-2889);
});

test('rejects a buffer that is not a tile', () => {
  const html = new TextEncoder().encode('<!doctype html><html></html>');
  expect(() => decodeTile(html.buffer)).toThrow();
  expect(() => decodeTile(tinyBuffer().slice(0, 100))).toThrow();
});
