import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { buildCities, parseCsv, type City } from '../../scripts/cities';
import cities from '../../data/cities.json';
import { FEATURED_IDS } from '../../src/ui/featured';

const csv = readFileSync(new URL('../../docs/reference/launch-cities.csv', import.meta.url), 'utf8');

describe('parseCsv', () => {
  test('keeps commas and doubled quotes inside quoted fields', () => {
    expect(parseCsv('a,b,c\n"x, y",2,"say ""hi"""\n')).toEqual([['a', 'b', 'c'], ['x, y', '2', 'say "hi"']]);
  });
  test('handles CRLF and a missing final newline', () => {
    expect(parseCsv('a,b\r\n1,\r\n2,3')).toEqual([['a', 'b'], ['1', ''], ['2', '3']]);
  });
});

describe('cities.json', () => {
  const list = cities as City[];

  test('is what the script builds from the CSV (run npm run cities after editing the CSV)', () => {
    expect(list).toEqual(buildCities(csv));
  });

  test('cities.json has 120 entries, 24 in launch batch', () => {
    expect(list).toHaveLength(120);
    expect(list.filter((c) => c.batch === 'launch')).toHaveLength(24);
    expect(new Set(list.map((c) => c.id)).size).toBe(120);
  });

  test('launch batch comes first', () => {
    expect(list.slice(0, 24).every((c) => c.batch === 'launch')).toBe(true);
  });

  test('fields: quoted labels, split landmarks, rights notes, headingDeg null until confirmed', () => {
    const nyc = list.find((c) => c.city === 'New York')!;
    expect(nyc.launch).toEqual({ lat: 40.689, lon: -74.045, label: 'Liberty Island, beside the Statue of Liberty', headingDeg: null });
    expect(nyc.landmarks).toEqual(['Statue of Liberty', 'Empire State Building', 'One World Trade Center', 'Brooklyn Bridge', 'Chrysler Building']);
    expect(nyc.animated).toBe('Torch flame flickers; Empire State tower lights at dusk');
    expect(nyc.notes).toBeUndefined();
    const paris = list.find((c) => c.city === 'Paris')!;
    expect(paris.notes).toMatch(/^Do not recreate the Eiffel Tower night light show \(protected\); leave out the Louvre Pyramid/);
    expect(paris.tier).toBe(1);
    const london = list.find((c) => c.id === 'london')!;
    expect(london.launch).toMatchObject({ lat: 51.5007, lon: -0.1263, label: 'Parliament Square' });
    for (const c of list) {
      expect(Math.abs(c.launch.lat)).toBeLessThanOrEqual(90);
      expect(Math.abs(c.launch.lon)).toBeLessThanOrEqual(180);
      expect(c.landmarks.every((l) => l.length > 0 && l === l.trim())).toBe(true);
    }
  });

  test('the six featured cities are launch-batch cities', () => {
    expect(FEATURED_IDS).toHaveLength(6);
    for (const id of FEATURED_IDS) expect(list.find((c) => c.id === id)?.batch).toBe('launch');
  });
});
