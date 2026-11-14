import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { decodeVectorTile } from '../../src/world/vector';
import { buildTileMeshes } from '../../src/world/meshjob';
import { DEFAULT_REGION } from '../../src/world/palette';
import { levelFor } from '../../src/world/lod';

// z5 15/10: Ireland, Wales, the west of England, the Irish Sea and the Celtic Sea
const PBF = readFileSync(new URL('../fixtures/omt_5_15_10.pbf', import.meta.url));

test('country and sea names come with their English name (the card labels them in English)', () => {
  const f = decodeVectorTile(PBF, 5, 15, 10);
  const countries = f.place.filter((p) => p.cls === 'country');
  expect(countries.length).toBeGreaterThan(0);
  // every country has an English name, and Ireland's is "Ireland" whatever its local name is
  for (const c of countries) expect(c.en).toBeTruthy();
  expect(countries.map((c) => c.en)).toContain('Ireland');
  expect(countries.map((c) => c.en)).toContain('United Kingdom');
});

test('the tile’s labels carry the English name through the mesh job', () => {
  const flat = new Float32Array(16);
  const f = decodeVectorTile(PBF, 5, 15, 10);
  const L = levelFor(5);
  const m = buildTileMeshes(f, flat, 5, 15, 10, DEFAULT_REGION, { lcSize: 8, detail: L.detail });
  expect(m.labels.find((l) => l.kind === 'country' && l.en === 'Ireland')).toBeDefined();
});
