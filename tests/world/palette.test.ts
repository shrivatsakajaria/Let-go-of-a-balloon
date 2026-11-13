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

// ---- regional building styles ----
import { regionStyle, DEFAULT_REGION, REGION_BOXES, hslOf, type RegionStyle } from '../../src/world/palette';

const BALLOON = '#ff5a12';
const CENTRES = {
  paris: { lat: 48.8566, lon: 2.3522 },
  london: { lat: 51.5074, lon: -0.1278 },
  barcelona: { lat: 41.3874, lon: 2.1686 },
  newyork: { lat: 40.7128, lon: -74.006 },
  mumbai: { lat: 19.076, lon: 72.8777 },
  dubai: { lat: 25.2048, lon: 55.2708 },
  tokyo: { lat: 35.6762, lon: 139.6503 },
};

test('Paris: cream stone, grey zinc roofs', () => {
  const r = regionStyle(CENTRES.paris);
  expect(r).not.toBe(DEFAULT_REGION);
  for (const c of r.roofs) {
    const { s, l } = hslOf(c);
    expect(s).toBeLessThan(0.15); // zinc is grey
    expect(l).toBeGreaterThan(0.35);
  }
  expect(r.roofPitch).toBeGreaterThanOrEqual(40); // mansard
  for (const c of r.walls) expect(hslOf(c).l).toBeGreaterThan(0.75);
});

test('London: brick walls, slate roofs', () => {
  const r = regionStyle(CENTRES.london);
  expect(r.walls.some((c) => { const { h, l } = hslOf(c); return (h < 40 || h > 340) && l < 0.62; })).toBe(true);
  for (const c of r.roofs) {
    const { s, l } = hslOf(c);
    expect(s).toBeLessThan(0.15);
    expect(l).toBeLessThan(0.5);
  }
});

test('every listed city returns its own distinct style at its centre', () => {
  const seen = new Set<RegionStyle>();
  for (const p of Object.values(CENTRES)) {
    const r = regionStyle(p);
    expect(r).not.toBe(DEFAULT_REGION);
    seen.add(r);
  }
  expect(seen.size).toBe(Object.keys(CENTRES).length);
});

test('New York and Dubai have glass tallWalls; Barcelona is ochre; Tokyo is pale grey', () => {
  for (const k of ['newyork', 'dubai'] as const) {
    const t = regionStyle(CENTRES[k]).tallWalls!;
    expect(t.length).toBeGreaterThan(0);
    for (const c of t) {
      const { h, s } = hslOf(c);
      expect(h).toBeGreaterThan(180);
      expect(h).toBeLessThan(250);
      expect(s).toBeLessThanOrEqual(0.2);
    }
  }
  for (const c of regionStyle(CENTRES.barcelona).walls) {
    const { h } = hslOf(c);
    expect(h).toBeGreaterThan(28);
    expect(h).toBeLessThan(50);
  }
  for (const c of regionStyle(CENTRES.tokyo).walls) expect(hslOf(c).s).toBeLessThan(0.1);
});

test('sea and unlisted places are default; UK and Ireland use brick and slate', () => {
  expect(regionStyle({ lat: 56, lon: 3 })).toBe(DEFAULT_REGION); // North Sea
  expect(regionStyle({ lat: 0, lon: -30 })).toBe(DEFAULT_REGION); // Atlantic
  expect(regionStyle({ lat: 52.2, lon: -1.0 })).toBe(regionStyle(CENTRES.london)); // Midlands: UK-wide style
  expect(regionStyle({ lat: 53.4808, lon: -2.2426 })).toBe(regionStyle(CENTRES.london)); // Manchester
  expect(regionStyle({ lat: 53.35, lon: -6.26 })).toBe(regionStyle(CENTRES.london)); // Dublin
  expect(regionStyle({ lat: 50.73, lon: 1.6 })).toBe(DEFAULT_REGION); // Boulogne, France
  expect(regionStyle({ lat: 52.52, lon: 13.4 })).toBe(DEFAULT_REGION); // Berlin
});

test('just outside a city box falls back to the surrounding region', () => {
  const b = REGION_BOXES.find((x) => x.name === 'paris')!;
  const inside = { lat: (b.south + b.north) / 2, lon: b.west + 0.01 };
  expect(regionStyle(inside)).toBe(regionStyle(CENTRES.paris));
  expect(regionStyle({ lat: inside.lat, lon: b.west - 0.01 })).toBe(DEFAULT_REGION);
  expect(regionStyle({ lat: b.north + 0.01, lon: 2.3 })).toBe(DEFAULT_REGION);
});

test('regional colours: saturation <= 0.35 and never balloon-like', () => {
  const balloonHue = hslOf(BALLOON).h;
  const styles = [...Object.values(CENTRES).map(regionStyle), regionStyle({ lat: 53.4, lon: -2.2 })];
  for (const r of styles) {
    expect(r.roofPitch).toBeGreaterThanOrEqual(0);
    for (const c of [...r.walls, ...r.roofs, ...(r.tallWalls ?? [])]) {
      const { h, s } = hslOf(c);
      expect(s).toBeLessThanOrEqual(0.35);
      const dh = Math.min(Math.abs(h - balloonHue), 360 - Math.abs(h - balloonHue));
      if (dh <= 15) expect(s).toBeLessThanOrEqual(0.2);
    }
  }
});

test('regionStyle is fast', () => {
  const t = performance.now();
  let n = 0;
  for (let i = 0; i < 200000; i++) if (regionStyle({ lat: (i % 180) - 90, lon: ((i * 7) % 360) - 180 }) !== DEFAULT_REGION) n++;
  expect(performance.now() - t).toBeLessThan(2000);
  expect(n).toBeGreaterThanOrEqual(0);
});

// ---- Task 11: light strengths and golden hour ----
import { stageLight, SUN_GAIN, SKY_LIGHT } from '../../src/world/palette';

/** HSV saturation: how far a colour is from grey at its brightness. */
const hsvSat = (hex: string) => {
  const c = parseHex(hex);
  const mx = Math.max(...c), mn = Math.min(...c);
  return mx === 0 ? 0 : (mx - mn) / mx;
};

test('golden hour and twilight sun stay warm but never compete with the balloon', () => {
  for (let e = -8; e <= 20; e += 0.5) {
    const sun = lightFor(e).sun;
    expect(hsvSat(sun), `${sun} at ${e} deg`).toBeLessThanOrEqual(0.55);
  }
  const g = parseHex(lightFor(2).sun);
  expect(g[0]).toBeGreaterThan(g[2] + 40); // still warm
});

test('stage light: the strengths SK approved in the tile proof (sun x2, sky 2.2, sun 15% to white)', () => {
  const L = lightFor(8);
  const s = stageLight(L);
  expect(SUN_GAIN).toBe(2);
  expect(SKY_LIGHT).toBe(2.2);
  expect(s.sunIntensity).toBeCloseTo(L.sunIntensity * 2, 9);
  expect(s.hemiIntensity).toBe(2.2);
  const a = parseHex(L.sun), b = parseHex(s.sunColor);
  for (let i = 0; i < 3; i++) expect(Math.abs(b[i] - (a[i] + (255 - a[i]) * 0.15))).toBeLessThanOrEqual(1);
  expect(s.hemiGround).toBe(L.hemiGround);
});

test('UK slate roofs are lifted so they do not read black at golden hour', () => {
  for (const c of regionStyle({ lat: 53.48, lon: -2.24 }).roofs) expect(hslOf(c).l).toBeGreaterThanOrEqual(0.42);
});
