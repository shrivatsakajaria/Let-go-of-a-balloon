import { lerpHex, type Color } from './color';

export type { Color } from './color';
export { parseHex, toHex, lerpHex } from './color';

export type Light = {
  skyTop: Color;
  skyHorizon: Color;
  groundTint: Color;
  sun: Color;
  sunIntensity: number;
  hemiSky: Color;
  hemiGround: Color;
  /** 0 by day, 1 in full night. Exactly 1 at or below -18 deg, exactly 0 at or above 5 deg. */
  night: number;
};

type Key = Light & { el: number };

/**
 * Contour time-of-day keys, by sun elevation. Skies stay calm (blue-grey, no purple) so the
 * balloon's #ff5a12 remains the only saturated thing in the world. Golden hour (0-15 deg) is
 * the hero look: a warm low sun over a pale horizon.
 */
const KEYS: Key[] = [
  { el: -18, skyTop: '#0a1022', skyHorizon: '#18223c', groundTint: '#46526e', sun: '#9fb0d8', sunIntensity: 0.35, hemiSky: '#34446e', hemiGround: '#1e222a', night: 1 },
  { el: -10, skyTop: '#101a36', skyHorizon: '#2a3b60', groundTint: '#55607c', sun: '#93a6d2', sunIntensity: 0.42, hemiSky: '#425382', hemiGround: '#262a32', night: 0.8 },
  { el: -4, skyTop: '#2a3c64', skyHorizon: '#78809a', groundTint: '#8f93a6', sun: '#ff9a5c', sunIntensity: 0.9, hemiSky: '#67779a', hemiGround: '#444048', night: 0.35 },
  { el: 0, skyTop: '#4a5a7e', skyHorizon: '#eea878', groundTint: '#ffd2ae', sun: '#ff9a56', sunIntensity: 1.5, hemiSky: '#8f98b2', hemiGround: '#5e5148', night: 0.12 },
  { el: 5, skyTop: '#5c7aa6', skyHorizon: '#f4c595', groundTint: '#ffe0c4', sun: '#ffb676', sunIntensity: 1.8, hemiSky: '#a8b7d0', hemiGround: '#6d6150', night: 0 },
  { el: 15, skyTop: '#5e90ca', skyHorizon: '#d8e3e6', groundTint: '#fff0e0', sun: '#ffe0b8', sunIntensity: 2.2, hemiSky: '#c4d6e8', hemiGround: '#78805c', night: 0 },
  { el: 40, skyTop: '#5a9edf', skyHorizon: '#d6e8f0', groundTint: '#ffffff', sun: '#fff3df', sunIntensity: 2.6, hemiSky: '#d2e6f8', hemiGround: '#7f8b5c', night: 0 },
];

const smooth = (f: number): number => f * f * (3 - 2 * f);

function strip(k: Key): Light {
  const { el: _el, ...light } = k;
  return light;
}

/** Sky and light for a given sun elevation in degrees; clamps outside the keyed range. */
export function lightFor(elevationDeg: number): Light {
  const first = KEYS[0];
  const last = KEYS[KEYS.length - 1];
  if (elevationDeg <= first.el) return strip(first);
  if (elevationDeg >= last.el) return strip(last);
  let i = 0;
  while (elevationDeg > KEYS[i + 1].el) i++;
  const a = KEYS[i];
  const b = KEYS[i + 1];
  const f = smooth((elevationDeg - a.el) / (b.el - a.el));
  const n = (x: number, y: number) => x + (y - x) * f;
  return {
    skyTop: lerpHex(a.skyTop, b.skyTop, f),
    skyHorizon: lerpHex(a.skyHorizon, b.skyHorizon, f),
    groundTint: lerpHex(a.groundTint, b.groundTint, f),
    sun: lerpHex(a.sun, b.sun, f),
    sunIntensity: n(a.sunIntensity, b.sunIntensity),
    hemiSky: lerpHex(a.hemiSky, b.hemiSky, f),
    hemiGround: lerpHex(a.hemiGround, b.hemiGround, f),
    night: n(a.night, b.night),
  };
}

/** Contour ground and building colours. All stay well below the balloon's saturation. */
export const CONTOUR = {
  /** chalk, then light to deep sage. */
  land: ['#e6d6a2', '#b9cd86', '#a0c078', '#88b06c', '#76a063'] as Color[],
  cliff: '#d4a982' as Color,
  waterDeep: '#2b7fb0' as Color,
  waterShallow: '#8fd3cf' as Color,
  building: ['#f4efe5', '#ebe3d4'] as Color[],
  roof: ['#d9bfa4', '#c9ad92', '#9fa6aa'] as Color[],
};
