import { describe, expect, test } from 'vitest';
import { compareLine, COMPARE_TOLERANCE, FAMILIAR, familiarKm } from '../../src/ui/cardcompare';

describe('the comparison line', () => {
  test('Manchester to Bergen (894 km, let go in the United Kingdom) is about the length of Britain', () => {
    expect(compareLine(894, 'United Kingdom')).toBe('About the length of Britain');
  });

  test('it is honest: the familiar distance is within the tolerance of the trip, and the right one is chosen', () => {
    expect(familiarKm(FAMILIAR.BY_COUNTRY['United Kingdom'][0])).toBeGreaterThan(960);
    expect(familiarKm(FAMILIAR.BY_COUNTRY['United Kingdom'][0])).toBeLessThan(980);
    expect(compareLine(534, 'United Kingdom')).toBe('About the distance from London to Edinburgh');
    expect(compareLine(36, 'United Kingdom')).toBe('About the width of the English Channel at Dover');
    expect(compareLine(40, 'Norway')).toBe('About a marathon');
    for (const list of [...Object.values(FAMILIAR.BY_COUNTRY), FAMILIAR.ANYWHERE])
      for (const f of list) {
        const km = familiarKm(f);
        const line = compareLine(km * 1.05, 'United Kingdom');
        if (line) expect(Math.abs(km * 1.05 / familiarKm([...FAMILIAR.BY_COUNTRY['United Kingdom'], ...FAMILIAR.ANYWHERE].find((g) => `About ${g.text}` === line)!) - 1)).toBeLessThanOrEqual(COMPARE_TOLERANCE);
      }
  });

  test('left out when nothing is close, when the country has no list and nothing anywhere fits, or with no distance', () => {
    expect(compareLine(2_000, 'United Kingdom')).toBeNull();
    expect(compareLine(700, 'Mongolia')).toBeNull();
    expect(compareLine(700, null)).toBeNull();
    expect(compareLine(0, 'United Kingdom')).toBeNull();
  });

  test('Tokyo to Osaka for a Japanese trip of 400 km; Sydney to Melbourne for an Australian one of 700', () => {
    expect(compareLine(400, 'Japan')).toBe('About the distance from Tokyo to Osaka');
    expect(compareLine(700, 'Australia')).toBe('About the distance from Sydney to Melbourne');
  });
});

describe('never the trip itself', () => {
  const PARIS = { lat: 48.8566, lon: 2.3522 }, BERLIN = { lat: 52.52, lon: 13.405 }, LONDON = { lat: 51.5072, lon: -0.1276 };
  test('Paris to Berlin is not compared with "Paris to Berlin", either way round; the next match is used, or none', () => {
    const km = 878;
    expect(compareLine(km, 'France')).toBe('About the distance from Paris to Berlin');
    expect(compareLine(km, 'France', { start: PARIS, end: BERLIN })).toBeNull();
    expect(compareLine(km, 'Germany', { start: BERLIN, end: PARIS })).toBeNull();
    // starting a few kilometres out of central Paris is still the same trip
    expect(compareLine(km, 'France', { start: { lat: 48.9, lon: 2.25 }, end: { lat: 52.45, lon: 13.3 } })).toBeNull();
  });

  test('London to Edinburgh (534 km) passes over itself to the next familiar distance when one fits', () => {
    const EDINBURGH = { lat: 55.9533, lon: -3.1883 };
    expect(compareLine(534, 'United Kingdom', { start: LONDON, end: EDINBURGH })).toBeNull();
    expect(compareLine(534, 'United Kingdom', { start: LONDON, end: { lat: 50.9, lon: 6.9 } })).toBe('About the distance from London to Edinburgh');
    // Manchester to London (262 km) skips "London to Manchester" and lands on nothing else that close
    expect(compareLine(262, 'United Kingdom', { start: { lat: 53.4794, lon: -2.2453 }, end: LONDON })).toBeNull();
  });
});
