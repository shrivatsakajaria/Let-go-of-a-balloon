import { describe, expect, test, vi } from 'vitest';
import { homeFor, landedFor, onceFor, type Once } from '../../src/app/landingcard';
import type { SavedBalloon } from '../../src/flight/codec';

describe('one card per route', () => {
  test('a second request while the first is being made waits on it (one card world, not two)', async () => {
    const cache = new WeakMap<object, Once<string>>();
    const key = {};
    let release!: (v: string) => void;
    const make = vi.fn(() => new Promise<string | null>((r) => (release = r)));
    const a = onceFor(cache, key, make, () => true, () => true);
    const b = onceFor(cache, key, make, () => true, () => true);
    release('card');
    expect(await a).toBe('card');
    expect(await b).toBe('card');
    expect(make).toHaveBeenCalledOnce();
    // and later requests get the finished card
    expect(await onceFor(cache, key, make, () => true, () => true)).toBe('card');
    expect(make).toHaveBeenCalledOnce();
  });

  test('a card being made by a world that is gone (a disposed 3D flight) is not joined: the new request starts afresh', async () => {
    const cache = new WeakMap<object, Once<string>>();
    const key = {};
    let makerAlive = true;
    const first = vi.fn(() => new Promise<string | null>(() => {})); // never finishes: its world went away
    void onceFor(cache, key, first, () => true, () => makerAlive);
    makerAlive = false;
    const second = vi.fn(async () => 'fresh');
    expect(await onceFor(cache, key, second, () => true, () => true)).toBe('fresh');
    expect(second).toHaveBeenCalledOnce();
  });

  test('a card that was not made (cancelled, failed) or is only a sketch is not kept: the next request tries again', async () => {
    const cache = new WeakMap<object, Once<{ frame: string }>>();
    const key = {};
    const yes = () => true;
    const keep = (v: { frame: string }) => v.frame !== 'sketch';
    const nothing = vi.fn(async () => null);
    expect(await onceFor(cache, key, nothing, keep, yes)).toBe(null);
    const sketch = vi.fn(async () => ({ frame: 'sketch' }));
    expect(await onceFor(cache, key, sketch, keep, yes)).toEqual({ frame: 'sketch' });
    const scene = vi.fn(async () => ({ frame: 'scene' }));
    expect(await onceFor(cache, key, scene, keep, yes)).toEqual({ frame: 'scene' });
    expect(await onceFor(cache, key, scene, keep, yes)).toEqual({ frame: 'scene' });
    expect([nothing.mock.calls.length, sketch.mock.calls.length, scene.mock.calls.length]).toEqual([1, 1, 1]);
  });
});

describe('the start\'s name in the flight', () => {
  const gps: SavedBalloon = { v: 1, name: 'Your location', start: { lat: 53.43, lon: -2.23 }, release: 0, hourly: [], runId: 'r' };
  const near = async () => ({ kind: 'town', name: 'Didsbury', country: 'United Kingdom', distanceKm: 1 });

  test('"your location" only for the visitor\'s own balloon; someone opening a shared GPS link sees the place', async () => {
    expect(await homeFor(gps, true, near)).toBe('your location');
    expect(await homeFor(gps, false, near)).toBe('Didsbury');
    expect(await homeFor({ ...gps, name: 'Manchester' }, false, near)).toBe('Manchester');
    // with nothing known, where it is
    expect(await homeFor(gps, false, async () => null)).toBe('53.4° N 2.2° W');
  });
});

describe('which card a request is for', () => {
  const route = { points: [], hourly: [], release: 0, runId: 'r' };
  const H = 3600e3;
  test('"Expected to" before 72 h, "Landed" after; a replay keeps the state it started with', () => {
    expect(landedFor(route, 71 * H)).toBe(false);
    expect(landedFor(route, 72 * H)).toBe(true);
    // a balloon that lands during its replay: the replay's card (asked for at its start) is the one shown at its end
    expect(landedFor(route, 72 * H + 5000, false)).toBe(false);
  });
});
