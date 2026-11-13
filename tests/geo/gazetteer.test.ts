import { beforeEach, expect, test, vi } from 'vitest';
import { clearGazetteerCache, nearestPlace, townsNear } from '../../src/geo/gazetteer';
import { stubGazetteer, tileJson } from './helpers';

beforeEach(() => {
  clearGazetteerCache();
  vi.unstubAllGlobals();
});

// ---- the committed tiles
test('a point in the North Sea reads as a named sea', async () => {
  stubGazetteer({}, true);
  expect(await nearestPlace({ lat: 56, lon: 3 })).toMatchObject({ kind: 'sea', name: 'North Sea' });
});

test('Manchester reads as the town', async () => {
  stubGazetteer({}, true);
  expect(await nearestPlace({ lat: 53.483, lon: -2.244 })).toMatchObject({ kind: 'town', name: expect.stringMatching(/^Manchester/), country: 'United Kingdom' });
});

test('Leeds is found with its population', async () => {
  stubGazetteer({}, true);
  const near = await townsNear({ lat: 53.8, lon: -1.55 }, 10);
  expect(near[0]).toMatchObject({ name: 'Leeds' });
  expect(near[0].population).toBeGreaterThan(400_000);
});

test('mid-Atlantic reads as the Atlantic', async () => {
  stubGazetteer({}, true);
  const p = await nearestPlace({ lat: 35, lon: -40 });
  expect(p.kind).toBe('sea');
  expect(p.name).toMatch(/Atlantic/);
});

test('the Lake District is a region on the map', async () => {
  stubGazetteer({}, true);
  expect((await nearestPlace({ lat: 54.45, lon: -3.1 })).region).toBe('Lake District');
});

test('Bergen is a town in Norway', async () => {
  stubGazetteer({}, true);
  expect(await nearestPlace({ lat: 60.39, lon: 5.32 })).toMatchObject({ kind: 'town', name: 'Bergen', country: 'Norway' });
});

// ---- fixtures
test('a point in a sea cell is the sea even with a town close by', async () => {
  // tile 5_16_10 covers lon 0..11.25, lat 48.9..55.8; in a 2 x 2 grid the south-east cell (lat < 52.4, lon > 5.6) is sea
  stubGazetteer({ '5_16_10.json': tileJson({ towns: [['Shoreham', 'Nowhere', 50.2, 7.9, 20000]], names: [['Test Sea', 's']], rows: ['..', '.0'] }) });
  expect(await nearestPlace({ lat: 50, lon: 8 })).toMatchObject({ kind: 'sea', name: 'Test Sea' });
});

test('a land cell takes the nearest town within 60 km, else a region, else open country', async () => {
  stubGazetteer({ '5_16_10.json': tileJson({ towns: [['Near', 'Nowhere', 50, 3, 20000], ['Far', 'Nowhere', 53, 10, 90000]], names: [['Test Range', 'r']], rows: ['0.', '..'] }) });
  expect(await nearestPlace({ lat: 50.05, lon: 3 })).toMatchObject({ kind: 'town', name: 'Near', country: 'Nowhere' });
  // north-west cell is the region, no town within 60 km
  expect(await nearestPlace({ lat: 54, lon: 2 })).toMatchObject({ kind: 'region', name: 'Test Range' });
  // south-west land cell, no town within 60 km
  expect(await nearestPlace({ lat: 51, lon: 1 })).toMatchObject({ kind: 'region', name: 'open countryside', generic: true });
});

test('an unnamed sea cell is open sea', async () => {
  stubGazetteer({ '5_16_10.json': tileJson({ rows: ['~~', '~~'] }) });
  expect(await nearestPlace({ lat: 50, lon: 5 })).toMatchObject({ kind: 'sea', name: 'open sea', generic: true });
});

test('a missing tile (404) is empty and does not throw', async () => {
  const f = stubGazetteer({});
  expect(await nearestPlace({ lat: 10, lon: 10 })).toMatchObject({ kind: 'region', name: 'open countryside' });
  await nearestPlace({ lat: 10.1, lon: 10.1 });
  expect(f.mock.calls.filter(([u]) => String(u).includes('5_16_15'))).toHaveLength(1); // cached
});

test("Pages' HTML fallback and bad JSON count as missing", async () => {
  stubGazetteer({ '5_16_15.json': '<!doctype html><title>Balloon</title>' });
  expect(await nearestPlace({ lat: 10, lon: 10 })).toMatchObject({ name: 'open countryside' });
});

test('a failed request is not remembered', async () => {
  let calls = 0;
  vi.stubGlobal('fetch', async () => {
    if (++calls === 1) throw new TypeError('offline');
    return new Response(tileJson({ rows: ['~~', '~~'] }), { status: 200 });
  });
  expect((await nearestPlace({ lat: 10, lon: 10 })).name).toBe('open countryside');
  expect((await nearestPlace({ lat: 10, lon: 10 })).name).toBe('open sea');
});

test('the date line: a town at 179.95 E is near points on both sides', async () => {
  // tile x 31 (168.75..180) and x 0 (-180..-168.75), row 15 (lat 0..11)
  stubGazetteer({
    '5_31_15.json': tileJson({ towns: [['Eastern', 'Fiji', 0.5, 179.95, 12000]] }),
    '5_0_15.json': tileJson({}),
  });
  expect(await nearestPlace({ lat: 0.5, lon: 179.9 })).toMatchObject({ kind: 'town', name: 'Eastern' });
  expect(await nearestPlace({ lat: 0.5, lon: -179.9 })).toMatchObject({ kind: 'town', name: 'Eastern' });
});

test('towns beyond the 60 km search radius are ignored', async () => {
  stubGazetteer({ '5_16_10.json': tileJson({ towns: [['Distant', 'X', 50, 6.0, 9000]] }) });
  expect((await nearestPlace({ lat: 50, lon: 7.5 })).kind).toBe('region'); // ~107 km away
});

test('the polar rows use the clamped tile row', async () => {
  const f = stubGazetteer({});
  await nearestPlace({ lat: 89.9, lon: 0 });
  await nearestPlace({ lat: -90, lon: 0 });
  const urls = f.mock.calls.map(([u]) => String(u));
  expect(urls.some((u) => u.includes('5_16_0.json'))).toBe(true);
  expect(urls.some((u) => u.includes('5_16_31.json'))).toBe(true);
  expect(urls.every((u) => !/_(-1|32)\.json/.test(u))).toBe(true);
});
