import { describe, expect, test, vi } from 'vitest';
import { homeFor, onceFor } from '../../src/app/landingcard';
import type { SavedBalloon } from '../../src/flight/codec';

describe('one card per route', () => {
  test('a second request while the first is being made waits on it (one card world, not two)', async () => {
    const cache = new WeakMap<object, Promise<string | null>>();
    const key = {};
    let release!: (v: string) => void;
    const make = vi.fn(() => new Promise<string | null>((r) => (release = r)));
    const a = onceFor(cache, key, make, () => true);
    const b = onceFor(cache, key, make, () => true);
    release('card');
    expect(await a).toBe('card');
    expect(await b).toBe('card');
    expect(make).toHaveBeenCalledOnce();
    // and later requests get the finished card
    expect(await onceFor(cache, key, make, () => true)).toBe('card');
    expect(make).toHaveBeenCalledOnce();
  });

  test('a card that was not made (cancelled, failed) or is only a sketch is not kept: the next request tries again', async () => {
    const cache = new WeakMap<object, Promise<{ frame: string } | null>>();
    const key = {};
    const nothing = vi.fn(async () => null);
    expect(await onceFor(cache, key, nothing, () => true)).toBe(null);
    const sketch = vi.fn(async () => ({ frame: 'sketch' }));
    expect(await onceFor(cache, key, sketch, (v) => v.frame !== 'sketch')).toEqual({ frame: 'sketch' });
    const scene = vi.fn(async () => ({ frame: 'scene' }));
    expect(await onceFor(cache, key, scene, (v) => v.frame !== 'sketch')).toEqual({ frame: 'scene' });
    expect(await onceFor(cache, key, scene, (v) => v.frame !== 'sketch')).toEqual({ frame: 'scene' });
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
