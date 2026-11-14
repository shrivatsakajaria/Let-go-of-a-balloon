import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { DEFAULT_START, LAST_PLACE_KEY, fromLine, luminance, mineNames, mineNeedsNaming, readLastPlace, shadeBoost, skyFor, writeLastPlace } from '../../src/ui/start';
import { featuredCities } from '../../src/ui/featured';

class MemStorage {
  m = new Map<string, string>();
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
}

beforeEach(() => vi.stubGlobal('localStorage', new MemStorage()));
afterEach(() => vi.unstubAllGlobals());

describe('last place', () => {
  test('first time: Parliament Square, London', () => {
    expect(readLastPlace()).toEqual({ name: 'London', lat: 51.5007, lon: -0.1263, kind: 'default', cityId: 'london' });
  });

  test('round-trips under lgoab.lastPlace.v1, exact coordinates kept', () => {
    const gps = { name: 'Your location', lat: 54.598765432, lon: -5.928765432, kind: 'gps' as const };
    writeLastPlace(gps);
    expect(JSON.parse(localStorage.getItem(LAST_PLACE_KEY)!)).toEqual(gps);
    expect(readLastPlace()).toEqual(gps);
  });

  test('junk, bad numbers or an unknown kind fall back to London', () => {
    for (const raw of ['{', 'null', '[]', '{"name":"X","lat":95,"lon":0,"kind":"search"}', '{"name":"X","lat":1,"lon":2,"kind":"teleport"}', '{"name":"","lat":1,"lon":2,"kind":"search"}']) {
      localStorage.setItem(LAST_PLACE_KEY, raw);
      expect(readLastPlace()).toEqual(DEFAULT_START);
    }
  });

  test('storage that throws is survived both ways', () => {
    const boom = () => { throw new Error('denied'); };
    vi.stubGlobal('localStorage', { getItem: boom, setItem: boom });
    expect(readLastPlace()).toEqual(DEFAULT_START);
    expect(() => writeLastPlace(DEFAULT_START)).not.toThrow();
  });
});

describe('copy and shading', () => {
  test('the line above Let go', () => {
    expect(fromLine(DEFAULT_START)).toBe('From London');
    expect(fromLine({ name: 'Your location', lat: 0, lon: 0, kind: 'gps' })).toBe('From your location');
    expect(fromLine({ name: 'Windermere', lat: 54.38, lon: -2.9, kind: 'search' })).toBe('From Windermere');
  });

  test('bright scenes darken the shading by up to 0.15, dark ones not at all', () => {
    expect(shadeBoost(luminance('#0a1022'))).toBe(0);
    expect(shadeBoost(luminance('#f4f6f8'))).toBeCloseTo(0.15, 5);
    expect(shadeBoost(luminance('#e6d6a2'))).toBeCloseTo(0.15, 5);
    const mid = shadeBoost(0.4);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(0.15);
    expect(shadeBoost(Number.NaN)).toBe(0.15);
  });

  test('the placeholder sky follows the real sun at the start place', () => {
    const london = DEFAULT_START;
    const night = skyFor(london, Date.UTC(2026, 10, 13, 2, 0));
    const noon = skyFor(london, Date.UTC(2026, 5, 21, 12, 0));
    expect(luminance(night.top)).toBeLessThan(0.02);
    expect(luminance(noon.horizon)).toBeGreaterThan(0.5);
  });
});

describe('featured cities', () => {
  test('six, with their named launch spots', () => {
    const fc = featuredCities();
    expect(fc.map((c) => c.name)).toEqual(['Paris', 'New York', 'Tokyo', 'Sydney', 'Rio de Janeiro', 'Cappadocia']);
    expect(fc[0]).toEqual({ id: 'paris', name: 'Paris', lat: 48.8556, lon: 2.2986, spot: 'Champ de Mars' });
  });
});

describe('"Your balloons" names', () => {
  test('balloons let go from "Your location" go by their place, and two with one name by when they were let go', () => {
    const items = [
      { name: 'Manchester', place: null, letGo: '09:10' },
      { name: 'Your location', place: 'Bristol', letGo: '14:05' },
      { name: 'Your location', place: 'Bristol', letGo: '16:40' },
      { name: 'Your location', place: 'Leeds', letGo: '11:00' },
    ];
    expect(mineNames(items)).toEqual(['Manchester', 'Bristol · let go 14:05', 'Bristol · let go 16:40', 'Leeds']);
  });
  test('a searched start that shares a name with a located one: both say when they were let go', () => {
    expect(mineNames([{ name: 'Bristol', place: null, letGo: '08:00' }, { name: 'Your location', place: 'Bristol', letGo: '14:05' }])).toEqual([
      'Bristol · let go 08:00',
      'Bristol · let go 14:05',
    ]);
  });
  test('two balloons let go from the same searched town are told apart too', () => {
    const two = [{ name: 'Manchester', place: null, letGo: '09:10' }, { name: 'Manchester', place: null, letGo: '17:42' }];
    expect(mineNames(two)).toEqual(['Manchester · let go 09:10', 'Manchester · let go 17:42']);
    expect(mineNeedsNaming(['Manchester', 'Manchester'])).toBe(true);
    expect(mineNeedsNaming(['Manchester', 'Leeds'])).toBe(false);
    expect(mineNeedsNaming(['Manchester', 'Your location'])).toBe(true);
  });
  test('until the place is known the name stays as it was', () => {
    expect(mineNames([{ name: 'Your location', place: null, letGo: '14:05' }])).toEqual(['Your location']);
  });
});
