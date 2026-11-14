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
