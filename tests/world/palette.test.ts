import { test, expect } from 'vitest';
import { lightFor, parseHex } from '../../src/world/palette';

const ELS = [-30, -18, -14, -10, -7, -4, -2, 0, 2, 5, 10, 15, 25, 40, 60];

test('night factor', () => {
  expect(lightFor(-18).night).toBe(1);
  expect(lightFor(30).night).toBe(0);
  expect(lightFor(5).night).toBe(0);
  expect(lightFor(-40).night).toBe(1);
});

test('night is monotonic non-increasing with elevation', () => {
  let prev = 2;
  for (let e = -25; e <= 50; e += 0.5) {
    const n = lightFor(e).night;
    expect(n).toBeLessThanOrEqual(prev + 1e-12);
    prev = n;
  }
});

function hsl(hex: string) {
  const [r, g, b] = parseHex(hex).map((v) => v / 255);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  const l = (mx + mn) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d) {
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s, l };
}

test('no purple in sky or horizon colours', () => {
  for (const e of ELS) {
    const L = lightFor(e);
    for (const c of [L.skyTop, L.skyHorizon, L.hemiSky]) {
      expect(c).toMatch(/^#[0-9a-f]{6}$/);
      const { h, s } = hsl(c);
      const purple = h >= 250 && h <= 320 && s > 0.25;
      expect(purple, `${c} at ${e} deg (h=${h.toFixed(0)}, s=${s.toFixed(2)})`).toBe(false);
    }
  }
});

test('golden hour sun is warm and intensity grows with elevation', () => {
  const g = parseHex(lightFor(8).sun);
  expect(g[0]).toBeGreaterThan(g[2]);
  expect(lightFor(40).sunIntensity).toBeGreaterThan(lightFor(0).sunIntensity);
});
