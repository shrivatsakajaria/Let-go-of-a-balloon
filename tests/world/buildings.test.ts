import { test, expect } from 'vitest';
import { styleFor } from '../../src/world/buildings';
import { regionStyle, DEFAULT_REGION, parseHex } from '../../src/world/palette';

const NY = regionStyle({ lat: 40.7128, lon: -74.006 });
const near = (rgb: ArrayLike<number>, hexes: string[]) =>
  hexes.some((h) => parseHex(h).every((v, i) => Math.abs(v / 255 - rgb[i]) < 0.06));

test('tall buildings take glass tallWalls; low ones take regional walls', () => {
  for (let seed = 1; seed < 40; seed++) {
    expect(near(styleFor(NY, seed, 120).wall, NY.tallWalls!)).toBe(true);
    expect(near(styleFor(NY, seed, 15).wall, NY.walls)).toBe(true);
  }
});

test('regions without tallWalls ignore height', () => {
  for (let seed = 1; seed < 20; seed++) expect(near(styleFor(DEFAULT_REGION, seed, 200).wall, DEFAULT_REGION.walls)).toBe(true);
});
