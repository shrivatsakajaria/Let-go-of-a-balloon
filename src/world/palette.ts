import { lerpHex, type Color } from './color';

export type { Color } from './color';
export { parseHex, toHex, lerpHex, hslOf } from './color';

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
 * the hero look: a warm low sun over a pale horizon. The sun's colour stays below 0.55 HSV
 * saturation at every elevation (warm apricot, never the balloon's orange).
 */
const KEYS: Key[] = [
  { el: -18, skyTop: '#0a1022', skyHorizon: '#18223c', groundTint: '#7480a6', sun: '#9fb0d8', sunIntensity: 0.35, hemiSky: '#46598c', hemiGround: '#252a35', night: 1 },
  { el: -10, skyTop: '#101a36', skyHorizon: '#2a3b60', groundTint: '#68738f', sun: '#93a6d2', sunIntensity: 0.42, hemiSky: '#4a5c8c', hemiGround: '#2a2f39', night: 0.8 },
  { el: -4, skyTop: '#2a3c64', skyHorizon: '#78809a', groundTint: '#8f93a6', sun: '#d6ab8c', sunIntensity: 0.9, hemiSky: '#67779a', hemiGround: '#444048', night: 0.35 },
  { el: 0, skyTop: '#4a5a7e', skyHorizon: '#e8b392', groundTint: '#f2d6c0', sun: '#f6b688', sunIntensity: 1.5, hemiSky: '#8f98b2', hemiGround: '#5e5148', night: 0.12 },
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

/**
 * The light strengths SK approved in the tile proof (Task 9). Under three.js physical light units
 * the palette's values render too dark, so the sun runs at SUN_GAIN times the palette intensity,
 * 15% toward white (clay roofs and grass stay calm), and the skylight at SKY_LIGHT takes 35% of the
 * warm horizon (at golden hour most of the sky is not the zenith). Every 3D page lights the world
 * through this, so the tile proof and the app match.
 */
export const SUN_GAIN = 2.0;
export const SKY_LIGHT = 2.2;

export type StageLight = { sunColor: Color; sunIntensity: number; hemiSky: Color; hemiGround: Color; hemiIntensity: number };

export function stageLight(L: Light): StageLight {
  return {
    sunColor: lerpHex(L.sun, '#ffffff', 0.15),
    sunIntensity: L.sunIntensity * SUN_GAIN,
    hemiSky: lerpHex(L.hemiSky, L.skyHorizon, 0.35),
    hemiGround: L.hemiGround,
    hemiIntensity: SKY_LIGHT,
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

/** Contour roads (pale chalk and stone, by class) and rail. Calm, never saturated. */
export const ROADS = {
  major: '#f1ece0' as Color, // motorway, trunk
  main: '#ece5d6' as Color, // primary, secondary
  minor: '#e3dac8' as Color, // tertiary, minor
  small: '#d6cdb9' as Color, // service, track, path
  rail: '#b4aea2' as Color,
};

/**
 * Regional building character: wall and roof colours, and roof pitch in degrees.
 * `tallWalls` (glass towers) replace `walls` on buildings taller than TALL_WALLS_M. Paris's
 * mansard character is carried by its steep roofPitch.
 */
export type RegionStyle = { walls: Color[]; roofs: Color[]; roofPitch: number; tallWalls?: Color[]; mansard?: boolean };

/** Buildings above this height (m) take a region's tallWalls, where it has them. */
export const TALL_WALLS_M = 40;

export const DEFAULT_REGION: RegionStyle = { walls: CONTOUR.building, roofs: CONTOUR.roof, roofPitch: 32 };

/*
 * Regional palettes. Every colour keeps HSL saturation <= 0.35, and anything near the balloon's
 * hue (~18 deg) stays <= 0.2, so #ff5a12 is the only saturated thing in the world. Brick and
 * brownstone are therefore muted reddish-browns; ochre and sand sit on hue 30-40.
 */
const PARIS: RegionStyle = {
  walls: ['#e9e3d6', '#e4dccb', '#ece7dc'], // cream limestone
  roofs: ['#9a9fa2', '#8e9498', '#a7abad'], // grey zinc
  roofPitch: 45, // mansard
};
const UK: RegionStyle = {
  walls: ['#a58b80', '#9b8478', '#b09a8c', '#a39a8e'], // muted brick, stock brick
  // slate, lifted from #575d63/#4d535a/#656b70: those read nearly black on big low roofs facing
  // away from a golden-hour sun (Task 10 report)
  roofs: ['#6f767c', '#666d74', '#787e84'],
  roofPitch: 35,
};
const BARCELONA: RegionStyle = {
  walls: ['#c1ab86', '#baa278', '#c9b797'], // ochre
  roofs: ['#ab997c', '#a28c6d', '#b5a58c'], // terracotta, muted
  roofPitch: 18,
};
const NEW_YORK: RegionStyle = {
  walls: ['#9a8378', '#a58c80', '#8d7a70', '#b0a396'], // brownstone
  roofs: ['#7f8488', '#6f7478'],
  roofPitch: 0, // flat roofs
  tallWalls: ['#aebbc4', '#9fadb8', '#bcc7ce'], // glass
};
const MUMBAI: RegionStyle = {
  walls: ['#cdbca2', '#c4b092', '#d4c5af'], // warm plaster
  roofs: ['#b0a28d', '#a3937b'],
  roofPitch: 12,
};
const DUBAI: RegionStyle = {
  walls: ['#d1c3a9', '#d8cdb6', '#c9ba9c'], // sand
  roofs: ['#ccc3b3', '#c4baa6'],
  roofPitch: 0,
  tallWalls: ['#abbbc4', '#b7c5cc'], // glass
};
const TOKYO: RegionStyle = {
  walls: ['#d2d2cf', '#c7c8c8', '#dcdcd8'], // pale grey
  roofs: ['#7a7f84', '#8b9094', '#6e7378'],
  roofPitch: 14, // dense low-rise
};

export type RegionBox = { name: string; south: number; north: number; west: number; east: number; style: RegionStyle };

/**
 * Bounding boxes in degrees, checked in order (cities before the UK-wide fallback; London sits
 * inside the UK box and shares its style). Generous enough for each metro area.
 * Anywhere uncovered, including all open sea, is DEFAULT_REGION.
 */
export const REGION_BOXES: RegionBox[] = [
  { name: 'paris', south: 48.7, north: 49.0, west: 2.1, east: 2.6, style: PARIS },
  { name: 'london', south: 51.28, north: 51.7, west: -0.55, east: 0.3, style: UK },
  { name: 'barcelona', south: 41.3, north: 41.5, west: 2.0, east: 2.3, style: BARCELONA },
  { name: 'newyork', south: 40.45, north: 40.95, west: -74.3, east: -73.7, style: NEW_YORK },
  { name: 'mumbai', south: 18.85, north: 19.35, west: 72.75, east: 73.05, style: MUMBAI },
  { name: 'dubai', south: 24.8, north: 25.4, west: 54.9, east: 55.6, style: DUBAI },
  { name: 'tokyo', south: 35.45, north: 35.95, west: 139.4, east: 140.0, style: TOKYO },
  // Great Britain, split so the Channel coast of France (lat < 51.1, lon > 1.0) stays out.
  { name: 'gb-south', south: 49.9, north: 51.1, west: -6.0, east: 1.0, style: UK },
  { name: 'gb', south: 51.1, north: 60.9, west: -8.2, east: 1.8, style: UK },
  { name: 'ireland', south: 51.3, north: 55.5, west: -10.7, east: -5.9, style: UK },
];

/** Regional building style for a point: city boxes first, then UK/Ireland, else Contour default. */
export function regionStyle(p: { lat: number; lon: number }): RegionStyle {
  for (const b of REGION_BOXES) {
    if (p.lat >= b.south && p.lat <= b.north && p.lon >= b.west && p.lon <= b.east) return b.style;
  }
  return DEFAULT_REGION;
}
