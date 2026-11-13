import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createSearcher, parsePlaces, placeLabel, placeLabels, searchPlaces, searchUrl, type Place, type SearchState } from '../../src/ui/search';

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../fixtures/geocoding/${name}.json`, import.meta.url), 'utf8'));

describe('labels', () => {
  test('suggestion label includes region and country', () => {
    const labels = parsePlaces(fixture('windermere')).map(placeLabel);
    expect(labels).toContain('Windermere, England, United Kingdom');
    expect(labels[0]).toBe('Windermere, Florida, United States');
  });

  test('missing parts are left out and repeats are dropped', () => {
    expect(placeLabel({ name: 'Singapore', admin1: undefined, country: 'Singapore', lat: 1.29, lon: 103.85 })).toBe('Singapore');
    expect(placeLabel({ name: 'Monaco', admin1: 'Monaco', country: 'Monaco', lat: 43.7, lon: 7.4 })).toBe('Monaco');
    expect(placeLabel({ name: 'Bergen', country: '', lat: 60.39, lon: 5.32 })).toBe('Bergen');
    expect(placeLabel({ name: 'London', admin1: 'England', country: 'United Kingdom', lat: 51.5, lon: -0.12 })).toBe('London, England, United Kingdom');
  });

  test('two places with the same label are told apart by their district', () => {
    const ps: Place[] = [
      { name: 'Newport', admin1: 'Wales', admin2: 'Newport', country: 'United Kingdom', lat: 51.58, lon: -3 },
      { name: 'Newport', admin1: 'England', admin2: 'Isle of Wight', country: 'United Kingdom', lat: 50.7, lon: -1.29 },
      { name: 'Newport', admin1: 'England', admin2: 'Shropshire', country: 'United Kingdom', lat: 52.77, lon: -2.38 },
    ];
    expect(placeLabels(ps)).toEqual([
      'Newport, Wales, United Kingdom',
      'Newport, Isle of Wight, England, United Kingdom',
      'Newport, Shropshire, England, United Kingdom',
    ]);
  });
});

describe('parsePlaces', () => {
  test('reads results and drops entries without usable coordinates', () => {
    const ps = parsePlaces({ results: [
      { name: 'A', latitude: 1, longitude: 2, country: 'X', admin1: 'Y' },
      { name: 'B', latitude: 'no', longitude: 2, country: 'X' },
      { latitude: 1, longitude: 2 },
      { name: 'C', latitude: 95, longitude: 2 },
    ] });
    expect(ps).toEqual([{ name: 'A', admin1: 'Y', admin2: undefined, country: 'X', lat: 1, lon: 2 }]);
  });
  test('no results key means no places', () => {
    expect(parsePlaces(fixture('none'))).toEqual([]);
    expect(parsePlaces(null)).toEqual([]);
  });
});

describe('searchPlaces', () => {
  afterEach(() => vi.unstubAllGlobals());
  test('calls Open-Meteo with the name, 8 results, English', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(fixture('windermere'))));
    vi.stubGlobal('fetch', fetchMock);
    const ps = await searchPlaces('Winder mere', new AbortController().signal);
    expect(fetchMock).toHaveBeenCalledWith('https://geocoding-api.open-meteo.com/v1/search?name=Winder%20mere&count=8&language=en', expect.anything());
    expect(ps[0].name).toBe('Windermere');
    expect(searchUrl('São Paulo')).toBe('https://geocoding-api.open-meteo.com/v1/search?name=S%C3%A3o%20Paulo&count=8&language=en');
  });
  test('an HTTP error rejects', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 500 })));
    await expect(searchPlaces('x', new AbortController().signal)).rejects.toThrow();
  });
});

describe('createSearcher', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setup(impl: (q: string, s: AbortSignal) => Promise<Place[]>) {
    const states: SearchState[] = [];
    const calls: { q: string; signal: AbortSignal }[] = [];
    const s = createSearcher((q, signal) => { calls.push({ q, signal }); return impl(q, signal); }, (st) => states.push(st));
    return { s, states, calls };
  }

  test('debounces 250 ms and aborts the previous request on each keystroke', async () => {
    let release: (v: Place[]) => void = () => {};
    const { s, states, calls } = setup(() => new Promise((r) => { release = r; }));
    s.input('Wi');
    await vi.advanceTimersByTimeAsync(249);
    expect(calls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toHaveLength(1);
    expect(states.at(-1)).toEqual({ kind: 'searching', q: 'Wi' });
    s.input('Win');
    expect(calls[0].signal.aborted).toBe(true);
    s.input('Wind');
    await vi.advanceTimersByTimeAsync(250);
    expect(calls.map((c) => c.q)).toEqual(['Wi', 'Wind']);
    release([{ name: 'Windermere', admin1: 'England', country: 'United Kingdom', lat: 54.38, lon: -2.9 }]);
    await vi.advanceTimersByTimeAsync(0);
    expect(states.at(-1)).toMatchObject({ kind: 'results', q: 'Wind', places: [{ name: 'Windermere' }] });
  });

  test('no results shows "No places found. Try a nearby town."', async () => {
    const { s, states } = setup(async () => []);
    s.input('Xqzzy');
    await vi.advanceTimersByTimeAsync(250);
    expect(states.at(-1)).toEqual({ kind: 'empty', q: 'Xqzzy', message: 'No places found. Try a nearby town.' });
  });

  test('a failed request says so; an aborted one says nothing', async () => {
    const { s, states } = setup(async (_q, signal) => {
      if (signal.aborted) throw new DOMException('aborted', 'AbortError');
      throw new TypeError('network');
    });
    s.input('Leeds');
    await vi.advanceTimersByTimeAsync(250);
    expect(states.at(-1)).toEqual({ kind: 'error', q: 'Leeds', message: "We can't search right now. Try again in a moment." });
  });

  test('a stale answer never replaces a newer one', async () => {
    const resolvers: ((v: Place[]) => void)[] = [];
    const { s, states } = setup(() => new Promise((r) => resolvers.push(r)));
    s.input('Pa');
    await vi.advanceTimersByTimeAsync(250);
    s.input('Par');
    await vi.advanceTimersByTimeAsync(250);
    resolvers[1]([{ name: 'Paris', country: 'France', lat: 48.85, lon: 2.35 }]);
    resolvers[0]([{ name: 'Pa', country: 'X', lat: 0, lon: 0 }]);
    await vi.advanceTimersByTimeAsync(0);
    expect(states.at(-1)).toMatchObject({ kind: 'results', q: 'Par' });
  });

  test('fewer than two letters clears without a request', async () => {
    const { s, states, calls } = setup(async () => []);
    s.input('L');
    await vi.advanceTimersByTimeAsync(500);
    expect(calls).toHaveLength(0);
    expect(states.at(-1)).toEqual({ kind: 'idle' });
  });
});
