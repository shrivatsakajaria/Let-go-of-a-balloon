/// <reference types="node" />
import { test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { WindField, loadManifest } from '../../src/wind/loader';

// Real tiles and manifest from the live preview, saved in tests/fixtures/wind/real/.
const dir = new URL('../fixtures/wind/real/', import.meta.url);
const read = (p: string): Uint8Array | null => {
  try {
    return new Uint8Array(readFileSync(new URL(p, dir)));
  } catch {
    return null;
  }
};
const fetchReal = async (url: string): Promise<Response> => {
  const path = url.replace('/winds/', '');
  const f = read(path);
  return f ? new Response(f as BodyInit, { status: 200 }) : new Response('nf', { status: 404 });
};

test('real data: Manchester winds are plausible', async () => {
  const issued = Date.parse('2026-11-12T18:00:00Z');
  const manifest = await loadManifest('/winds', fetchReal, issued + 10 * 3.6e6);
  expect(manifest.runs[0].id).toBe('2026111218');
  const w = new WindField(manifest, fetchReal, '/winds');
  const manchester = { lat: 53.48, lon: -2.24 };
  const t = issued + 6 * 3.6e6;
  await w.prepare(manchester, [t, t + 3.6e6]);
  const s = w.sample(manchester, 1500, t);
  expect(Math.abs(s.u)).toBeLessThan(60);
  expect(Math.abs(s.v)).toBeLessThan(60);
  expect(Number.isFinite(s.u) && Number.isFinite(s.v)).toBe(true);
  const c = w.cruiseLevelHeight(manchester, t, 100);
  expect(c.levelHpa).toBe(850);
  expect(c.heightM).toBeGreaterThan(1000);
  expect(c.heightM).toBeLessThan(1700);
});
