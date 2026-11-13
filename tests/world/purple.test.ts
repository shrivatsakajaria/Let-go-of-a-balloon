import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CONTOUR, ROADS, REGION_BOXES, lightFor, lerpHex, parseHex, stageLight, TWILIGHT_TOP_DEG } from '../../src/world/palette';
import { hazeColor } from '../../src/world/haze';
import { keyLight, Sky, type Moon } from '../../src/world/sky';
import { srgbToLinear } from '../../src/world/color';
import { GLOW_LIGHT, WINDOW_LIGHT } from '../../src/world/materials';
import { TREE_COLOURS } from '../../src/world/tileview';

/**
 * Violet, as SK wants it (fix round 1): the evening twilight may turn the towns a calm violet-grey
 * ("of course it's gonna turn purple"); deep night (sun below about -12 deg) is ink blue with cool
 * blue-grey towns, never violet; dawn is cooler and paler than dusk, cool grey-blue, not mauve.
 * Violet here: hue 250 to 330 deg with HSV saturation over 0.08.
 */
const hueSat = (r: number, g: number, b: number) => {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (d === 0 || mx === 0) return { h: 0, s: 0, v: mx };
  let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return { h, s: d / mx, v: mx };
};
const violet = (rgb: number[]) => {
  const { h, s, v } = hueSat(rgb[0], rgb[1], rgb[2]);
  return v >= 8 / 255 && s > 0.08 && h >= 250 && h <= 330;
};
const hex01 = (hex: string) => parseHex(hex).map((v) => v / 255);
const toSrgb = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
const lin = (hex: string) => parseHex(hex).map((v) => srgbToLinear(v / 255));
const RISING = [undefined, true, false] as const;
const range = (a: number, b: number, step = 0.5) => {
  const out: number[] = [];
  for (let e = a; e <= b + 1e-9; e += step) out.push(e);
  return out;
};
const NIGHT = range(-30, -12);

const walls = [...CONTOUR.building, ...REGION_BOXES.flatMap((b) => [...b.style.walls, ...(b.style.tallWalls ?? [])])];
const roofs = [...CONTOUR.roof, ...REGION_BOXES.flatMap((b) => b.style.roofs)];
const ground = [...CONTOUR.land, CONTOUR.cliff, lerpHex(CONTOUR.land[0], CONTOUR.building[1], 0.5)];
const water = [CONTOUR.waterDeep, CONTOUR.waterShallow];
const other = [...Object.values(ROADS), ...TREE_COLOURS];
/** Shares of skylight, ground light and key light a surface can get. */
const MIXES = [[1, 0, 0], [0.5, 0.5, 0], [0, 1, 0], [0.7, 0.3, 0.3], [0.7, 0.3, 1], [0, 0.6, 0.5], [0.3, 0.7, 1]];

/** What the light of (el, rising) makes of each Contour colour (a lit Lambert surface, display sRGB), night lights added. */
function litSamples(el: number, rising: boolean | undefined, moon: Moon | null): { what: string; rgb: number[] }[] {
  const L = lightFor(el, rising);
  const st = stageLight(L);
  const key = keyLight({ elevationDeg: el, azimuthDeg: 240 }, moon, L);
  const sky = lin(st.hemiSky).map((v) => v * st.hemiIntensity);
  const gnd = lin(st.hemiGround).map((v) => v * st.hemiIntensity);
  const k = lin(key.color).map((v) => v * key.intensity);
  const tint = lin(L.groundTint);
  const sets: [string, string[], boolean, readonly number[], number][] = [
    ['wall', walls, false, WINDOW_LIGHT, 2.0 * 0.23],
    ['roof', roofs, false, WINDOW_LIGHT, 0],
    ['ground', ground, true, GLOW_LIGHT, 0.3],
    ['road', other, false, GLOW_LIGHT, 0.6],
    ['water', water, false, GLOW_LIGHT, 0],
  ];
  const out: { what: string; rgb: number[] }[] = [];
  for (const [what, list, tinted, em, emMax] of sets)
    for (const hex of list) {
      const alb = lin(hex).map((v, i) => (tinted ? v * tint[i] : v));
      for (const [a, b, c] of MIXES)
        for (const e of [0, 0.1, 0.3, 0.6, 1]) {
          const o = alb.map((v, i) => (v * (sky[i] * a + gnd[i] * b + k[i] * c)) / Math.PI + em[i] * e * emMax * L.night);
          out.push({ what: `${what} ${hex} el ${el} ${rising} mix ${a},${b},${c} lights ${e}`, rgb: o.map((v) => toSrgb(Math.min(1, v * 1.08))) });
        }
    }
  return out;
}

describe('deep night is not violet', () => {
  it('its keys and ground tints are not violet', () => {
    for (const el of NIGHT)
      for (const rising of RISING) {
        const L = lightFor(el, rising);
        for (const c of [L.skyTop, L.skyHorizon, L.hemiSky, L.hemiGround, L.sun, L.groundTint]) expect(violet(hex01(c)), `${c} at ${el} ${rising}`).toBe(false);
      }
  });

  it('nor what its light makes of the towns, the land and the water, with the warm windows and glow added', () => {
    const bad: string[] = [];
    for (const el of NIGHT)
      for (const rising of RISING)
        for (const moon of [null, { elevationDeg: 40, azimuthDeg: 120, illumination: 1 }])
          for (const s of litSamples(el, rising, moon)) if (violet(s.rgb)) bad.push(`${s.what}: ${s.rgb.map((v) => Math.round(v * 255))}`);
    if (bad.length) console.log([...new Set(bad.map((b) => b.split(' mix')[0].split(' ').slice(2).join(' ')))].join(' | '));
    expect(bad.slice(0, 8), `${bad.length} violet samples at night`).toEqual([]);
  });

  it('nor its sky, at any height, toward or away from the sun', () => {
    const sky = new Sky(new THREE.Scene());
    for (const el of NIGHT)
      for (const rising of RISING) {
        sky.apply({ elevationDeg: el, azimuthDeg: 240 }, null, rising);
        for (let y = -0.4; y <= 1.0001; y += 0.05)
          for (const az of [0, 60, 180]) {
            const a = ((240 + az) * Math.PI) / 180, r = Math.sqrt(1 - Math.min(1, y * y));
            const c = hazeColor(sky.haze, { x: Math.sin(a) * r, y, z: -Math.cos(a) * r });
            expect(violet(c), `el ${el} y ${y.toFixed(2)}`).toBe(false);
          }
      }
  });
});

describe('twilight', () => {
  it('dawn is cool grey-blue and pale, not mauve: its sky has no violet anywhere', () => {
    const sky = new Sky(new THREE.Scene());
    const bad: string[] = [];
    for (const el of range(-18, TWILIGHT_TOP_DEG)) {
      sky.apply({ elevationDeg: el, azimuthDeg: 120 }, null, true);
      for (let y = -0.4; y <= 1.0001; y += 0.02)
        for (const az of [0, 20, 60, 120, 180]) {
          const a = ((120 + az) * Math.PI) / 180, r = Math.sqrt(1 - Math.min(1, y * y));
          const c = hazeColor(sky.haze, { x: Math.sin(a) * r, y, z: -Math.cos(a) * r });
          if (violet(c)) bad.push(`el ${el} y ${y.toFixed(2)} az+${az}: ${c.map((v) => Math.round(v * 255))}`);
        }
    }
    expect(bad.slice(0, 5), `${bad.length} violet dawn sky samples`).toEqual([]);
  });

  it('dusk may turn the towns a calm violet-grey (intended), never a candy one', () => {
    const towns = litSamples(-4, false, null).filter((s) => s.what.startsWith('ground ' + lerpHex(CONTOUR.land[0], CONTOUR.building[1], 0.5)) && s.what.includes('lights 0:') === false);
    const shade = towns.find((s) => s.what.includes('mix 0.7,0.3,0.3 lights 0'))!;
    const hs = hueSat(shade.rgb[0], shade.rgb[1], shade.rgb[2]);
    expect(hs.h).toBeGreaterThanOrEqual(250);
    expect(hs.h).toBeLessThanOrEqual(330);
    // where dusk is violet, it is a calm violet-grey
    for (const el of range(-10, 0))
      for (const s of litSamples(el, false, null)) if (violet(s.rgb)) expect(hueSat(s.rgb[0], s.rgb[1], s.rgb[2]).s, s.what).toBeLessThan(0.35);
  });
});

describe('dawn and dusk', () => {
  const hsl = (hex: string) => {
    const [r, g, b] = parseHex(hex).map((v) => v / 255);
    return { warm: r - b, light: (Math.max(r, g, b) + Math.min(r, g, b)) / 2 };
  };

  it('dawn is cooler and paler than dusk in the twilight', () => {
    for (const el of [-6, -4, -2, 0, 1]) {
      const dawn = lightFor(el, true), dusk = lightFor(el, false);
      expect(hsl(dawn.skyHorizon).warm, `horizon at ${el}`).toBeLessThan(hsl(dusk.skyHorizon).warm);
      expect(hsl(dawn.skyHorizon).light, `horizon at ${el}`).toBeGreaterThanOrEqual(hsl(dusk.skyHorizon).light - 0.01);
      expect(hsl(dawn.sun).warm, `sun at ${el}`).toBeLessThan(hsl(dusk.sun).warm);
    }
  });

  it('both meet the shared keys at and above TWILIGHT_TOP_DEG (golden hour unchanged) and in deep night', () => {
    for (const el of [TWILIGHT_TOP_DEG, 4, 8, 15, 40, -18, -30]) {
      expect(lightFor(el, true)).toEqual(lightFor(el));
      expect(lightFor(el, false)).toEqual(lightFor(el));
    }
    // and change smoothly into them
    for (const r of [true, false]) {
      const a = parseHex(lightFor(TWILIGHT_TOP_DEG - 0.05, r).skyHorizon), b = parseHex(lightFor(TWILIGHT_TOP_DEG).skyHorizon);
      for (let i = 0; i < 3; i++) expect(Math.abs(a[i] - b[i])).toBeLessThanOrEqual(2);
    }
  });

  it('strengths and night follow the elevation alone', () => {
    for (const el of [-12, -5, -1, 2]) {
      expect(lightFor(el, true).night).toBe(lightFor(el).night);
      expect(lightFor(el, false).sunIntensity).toBe(lightFor(el).sunIntensity);
    }
  });

  it('the sky knows a morning from an evening', () => {
    const sky = new Sky(new THREE.Scene());
    const M = { lat: 53.4794, lon: -2.2453 };
    sky.update(Date.UTC(2026, 10, 13, 7, 35), M);
    expect(sky.rising).toBe(true);
    expect(sky.current).toEqual(lightFor(sky.sun.elevationDeg, true));
    sky.update(Date.UTC(2026, 10, 13, 16, 40), M);
    expect(sky.rising).toBe(false);
  });
});
