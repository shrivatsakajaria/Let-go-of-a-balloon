import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { DEFAULT_START, LAST_PLACE_KEY, fromLine, luminance, readLastPlace, shadeBoost, skyFor, writeLastPlace } from '../../src/ui/start';
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
