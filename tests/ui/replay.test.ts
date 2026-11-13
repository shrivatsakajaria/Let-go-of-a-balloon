import { beforeEach, expect, test, vi } from 'vitest';
import { clearGazetteerCache } from '../../src/geo/gazetteer';
import { replayNames } from '../../src/ui/replay';
import type { Route, RoutePoint } from '../../src/flight/route';
import { stubGazetteer } from '../geo/helpers';
import { MAX_NAMES } from '../../src/ui/replaymath';

beforeEach(() => {
  clearGazetteerCache();
  vi.unstubAllGlobals();
});

/** A straight 72 hours from Manchester over Leeds and the North Sea to Bergen. */
function manchesterToBergen(): Route {
  const a = { lat: 53.48, lon: -2.24 }, b = { lat: 60.39, lon: 5.32 };
  const points: RoutePoint[] = Array.from({ length: 433 }, (_, i) => {
    const f = i / 432;
    return { tSec: i * 600, lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f, altM: 1500, groundM: 0, speedMs: 4, headingDeg: 40 };
  });
  return { points, hourly: [], release: 0, runId: 'x' };
}

test('the names on the way: real gazetteer, the biggest crossed, never the start or the landing, at most five', async () => {
  stubGazetteer({}, true);
  const names = await replayNames(manchesterToBergen(), { home: 'Manchester', landing: 'Bergen' });
  const list = names.map((n) => n.name);
  expect(list.length).toBeGreaterThan(0);
  expect(list.length).toBeLessThanOrEqual(MAX_NAMES);
  expect(list).toContain('the North Sea');
  expect(list).not.toContain('Manchester');
  expect(list).not.toContain('Bergen');
  // in the order they are crossed
  for (let i = 1; i < names.length; i++) expect(names[i].frac).toBeGreaterThan(names[i - 1].frac);
});

test('no gazetteer (offline): no names, and no error', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
  expect(await replayNames(manchesterToBergen(), { home: 'Manchester', landing: 'Bergen' })).toEqual([]);
});
