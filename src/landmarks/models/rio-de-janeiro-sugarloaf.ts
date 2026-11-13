/**
 * Sugarloaf Mountain and its cable car: the granite dome of the Pão de Açúcar, 396 m, bare and
 * steep on its flanks with forest on its crown and gentler slopes, and the two spans of the cable
 * car (the bondinho) from Praia Vermelha to Morro da Urca and on to the summit, each with its two
 * glass cars gliding back and forth on their ropes (their windows lit from dusk). Faceted, Contour
 * colours.
 *
 * The map's terrain already has the mountain, but its elevation data rounds the dome down to about
 * 300 m. The rock here is a height field over it, from the elevation data (Mapterhorn, 2026-11):
 * a dome to the real summit height, kept at least 10 m above the drawn ground wherever it shows,
 * and dropping 15 m under it at its edges, so the drawn hill never pokes through and the rock
 * never floats. Morro da Urca is left to the terrain; its stations stand on it at its drawn height.
 * Stations and ropes from OpenStreetMap (2026-11).
 *
 * Model frame (types.ts): origin on the ground at Station I, Praia Vermelha (the drawn ground
 * there is 20 m above the sea), front (local -z) up the line toward the summit, 58 degrees.
 */
import * as THREE from 'three';
import { Kit, LANDMARK_COLOURS as C } from '../kit';
import type { Color } from '../../world/palette';
import type { LandmarkModel } from '../types';

type P3 = [number, number, number];

/** Contour's deep sage (CONTOUR.land[4]): forest. */
const FOREST: Color = '#76a063';
/** Contour's sage (CONTOUR.land[3]): scrub on the gentler rock. */
const SCRUB: Color = '#88b06c';

/** The rock's grid: corner, spacing and size (model frame, m). */
const GX = -250, GZ = -1700, STEP = 25, NX = 24, NZ = 27;
/**
 * Heights (m, model frame) row by row from GZ; values under -1000 are edge nodes 2000 m too low:
 * there the rock drops 15 m below the drawn ground.
 */
const ROCK = [
  -2066, -2066, -2066, -2067, -2067, -2067, -2068, -2068, -2068, -2068, -2069, -2026, -2069, -2022, -2018, -2016, -2014, -2014, -2016, -2015,
  -2016, -2018, -2018, -2024, -2064, -2066, -2066, -2066, -2067, -2067, -2067, -2068, -2068, -2068, -2069, -14, 12, 31, 46, 48,
  43, 35, -2006, -2002, -2001, -2003, -2006, -2012, -2064, -2064, -2065, -2066, -2066, -2067, -2067, -2068, -2068, -13, 26, 61,
  85, 97, 109, 111, 97, 92, 71, -1986, -1980, -1979, -1988, -2007, -2064, -2064, -2064, -2065, -2066, -2067, -2067, -2067,
  14, 66, 95, 119, 145, 158, 162, 161, 146, 136, 115, 82, -1966, -1964, -1969, -2000, -2064, -2064, -2064, -2065,
  -2065, -2065, -24, 37, 82, 121, 159, 178, 194, 200, 207, 204, 194, 178, 150, 120, 78, -1964, -1966, -1999,
  -2060, -2064, -2024, -2064, -2064, -17, 49, 99, 146, 178, 205, 224, 239, 245, 242, 233, 223, 205, 181, 151,
  111, -1957, -1961, -2000, -2011, -2031, -2018, -2020, -2020, 55, 108, 161, 198, 221, 245, 264, 269, 279, 276, 266,
  257, 239, 211, 174, 138, 84, -1977, -2023, -2008, -2011, -2012, -2011, 45, 104, 163, 207, 239, 263, 284, 294,
  300, 303, 299, 290, 276, 255, 233, 196, 157, 107, 44, -2043, -2014, -2009, -2005, 32, 102, 158, 197, 238,
  269, 296, 312, 318, 327, 327, 319, 308, 295, 280, 251, 212, 167, 114, 50, -2036, -2012, -2002, -1992, 86,
  151, 196, 237, 274, 294, 318, 334, 339, 346, 339, 333, 328, 311, 288, 267, 228, 182, 122, 59, -2034,
  -2009, -1997, 69, 135, 190, 231, 272, 297, 320, 334, 347, 353, 354, 358, 350, 340, 325, 299, 267, 234,
  189, 130, 67, -2033, -1999, -1981, 115, 178, 226, 267, 302, 317, 335, 350, 355, 359, 362, 363, 360, 347,
  332, 310, 279, 235, 186, 132, 61, -2036, -1971, 81, 149, 213, 260, 295, 317, 337, 350, 362, 364, 369,
  369, 365, 359, 352, 331, 307, 279, 235, 191, 128, 50, -2034, -1946, 112, 184, 237, 283, 315, 337, 358,
  367, 374, 374, 374, 376, 369, 359, 353, 337, 311, 272, 232, 182, 118, 35, -2034, -1932, 137, 201, 252,
  293, 326, 347, 363, 375, 372, 375, 376, 379, 367, 360, 345, 333, 300, 266, 226, 166, 103, 15, -2035,
  -1920, 144, 211, 266, 302, 330, 353, 371, 374, 375, 376, 375, 378, 373, 365, 343, 326, 297, 259, 211,
  153, 84, -2034, -2036, -1919, 157, 215, 268, 310, 339, 354, 373, 374, 376, 376, 375, 381, 370, 357, 340,
  318, 280, 240, 191, 128, 53, -2038, -2035, -1914, 149, 215, 269, 304, 333, 358, 370, 375, 375, 375, 374,
  378, 366, 356, 332, 307, 268, 222, 164, 101, 13, -2038, -2035, -1920, 145, 212, 262, 301, 333, 346, 359,
  368, 379, 377, 377, 367, 361, 344, 323, 291, 250, 204, 138, 62, -2031, -2035, -2034, -1918, -1900, 188, 240,
  286, 314, 339, 357, 365, 370, 372, 365, 358, 347, 332, 308, 273, 225, 177, 110, 30, -2027, -2035, -2060,
  -1910, -1900, 168, 221, 261, 294, 319, 335, 345, 356, 358, 351, 342, 333, 311, 287, 252, 202, 143, 73,
  -2010, -2024, -2042, -2061, -1899, -1892, -1886, 196, 233, 270, 298, 317, 326, 337, 333, 335, 327, 310, 289, 259,
  219, 161, 99, -1996, -2018, -2033, -2036, -2060, -1892, -1884, -1878, -1873, 203, 236, 261, 289, 297, 304, 303, 305,
  291, 276, 252, 212, 168, 120, 50, -2004, -2026, -2036, -2036, -2075, -1883, -1874, -1868, -1865, 162, 195, 225, 242,
  258, 267, 264, 259, 251, 227, 206, 164, 121, 64, -1982, -2006, -2026, -2035, -2034, -2059, -1872, -1864, -1860, -1859,
  -1862, -1862, 175, 197, 205, 219, 222, 214, 202, 174, 148, 110, -1969, -1977, -1986, -2014, -2031, -2035, -2037, -2058,
  -1867, -1858, -1856, -1855, -1855, -1854, -1854, -1860, -1867, 157, 157, 153, 134, 107, -1950, -1961, -1970, -1977, -1991, -2020,
  -2034, -2035, -2075, -2058, -1865, -1857, -1854, -1851, -1850, -1849, -1854, -1862, -1871, -1883, -1893, -1907, -1924, -1940, -1954, -1963,
  -1970, -1976, -1992, -2026, -2036, -2035, -2035, -2057,
];

/** The ropes: [from, to] (m, model frame), the cars' tracks. */
const LINES: [P3, P3][] = [
  [[0, 11, 0], [-275.6, 199, -403.7]],
  [[-249.7, 188, -562.7], [-22, 385, -1259]],
];
/** The stations: x, z, floor height, and the line whose end they hold (turned along it). */
const STATIONS: [number, number, number, number][] = [
  [0, 0, 0, 0],
  [-275.6, -403.7, 190, 0],
  [-249.7, -562.7, 179, 1],
  [-22, -1259, 376, 1],
];
/** Each car's rope: this far either side of the line (m). */
const TRACK = 5;
/** A round trip: wait, cross, wait, cross back (s). */
const WAIT = 60, CROSS = 180, CYCLE = 2 * (WAIT + CROSS);

/** The sag of a rope at p (0..1 along it), m. */
const sag = (len: number, p: number) => 0.035 * len * 4 * p * (1 - p);

function rock(k: Kit): void {
  const h = (i: number, j: number) => {
    const v = ROCK[j * NX + i];
    return v < -1000 ? v + 2000 : v;
  };
  const edge = (i: number, j: number) => ROCK[j * NX + i] < -1000;
  const P = (i: number, j: number): P3 => [GX + i * STEP, h(i, j), GZ + j * STEP];
  const tri = (a: P3, b: P3, c: P3) => {
    // colour by slope: forest where it is gentle, bare granite where it is steep
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const up = Math.abs(ny) / (Math.hypot(nx, ny, nz) || 1);
    const col = up > 0.86 ? FOREST : up > 0.72 ? SCRUB : C.slate;
    k.tri('plain', col, a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2], 0, 1, 0);
  };
  for (let j = 0; j + 1 < NZ; j++) {
    for (let i = 0; i + 1 < NX; i++) {
      if (edge(i, j) && edge(i + 1, j) && edge(i, j + 1) && edge(i + 1, j + 1)) continue;
      const a = P(i, j), b = P(i + 1, j), c = P(i + 1, j + 1), d = P(i, j + 1);
      // split along the shorter diagonal in height, so ridges stay ridges
      if (Math.abs(a[1] - c[1]) < Math.abs(b[1] - d[1])) {
        tri(a, b, c);
        tri(a, c, d);
      } else {
        tri(a, b, d);
        tri(b, c, d);
      }
    }
  }
}

/** A station: a pale hall on a stone plinth, its roof slate, turned along its line. */
function station(k: Kit, x: number, z: number, floor: number, turnDeg: number, big: boolean): void {
  k.push(x, floor, z, turnDeg);
  const w = big ? 20 : 16, d = big ? 34 : 24;
  k.box('plain', C.stoneDeep, 0, -26, 6, w + 4, 26, d + 4, { topColour: C.paving });
  k.box('walls', C.chalk, 0, 0, 6, w, 9, d, { top: false });
  k.box('plain', C.slate, 0, 9, 6, w + 1.5, 1, d + 1.5);
  // the open end where the cars come in, and the rope sheaves' housing on the roof
  k.box('plain', C.iron, 0, 1, 6 - d / 2 - 0.1, w - 4, 7, 0.4, { top: false });
  k.box('plain', C.chalkShade, 0, 10, 10, w * 0.6, 3, d * 0.4);
  k.pop();
}

/** A car: a rounded glass cabin with a pale frame, hung from its carriage; origin at the rope. */
function car(): THREE.Group {
  const k = new Kit();
  k.box('plain', C.iron, 0, -3.2, 0, 0.5, 3.2, 0.5, { top: false });
  k.box('plain', C.chalkShade, 0, -0.6, 0, 1.2, 0.6, 3.2);
  k.disc('plain', C.chalkShade, 0, -7.6, 0, 2.6, 8, [0, -1, 0]);
  k.prism('plain', C.chalk, 0, -7.6, 0, 2.6, 1.2, 8, { r1: 2.9 });
  k.prism('glow', C.slate, 0, -6.4, 0, 2.9, 2.2, 8, { top: false });
  k.prism('plain', C.chalk, 0, -4.2, 0, 2.9, 1.0, 8, { r1: 2.2 });
  return k.group('rio-de-janeiro-sugarloaf-car');
}

type Cars = { cars: THREE.Object3D[] };

const turnOf = ([a, b]: [P3, P3]) => (Math.atan2(b[0] - a[0], -(b[2] - a[2])) * 180) / Math.PI;

/** Where car `c` of line `l` is at time t (s), into out. */
function carAt(l: number, c: number, t: number, out: THREE.Vector3): void {
  const [a, b] = LINES[l];
  // the second line runs a third of a cycle behind the first; the two cars cross at the middle
  let s = (((t + l * (CYCLE / 3)) % CYCLE) + CYCLE) % CYCLE;
  let p: number;
  if (s < WAIT) p = 0;
  else if ((s -= WAIT) < CROSS) p = s / CROSS;
  else if ((s -= CROSS) < WAIT) p = 1;
  else p = 1 - (s - WAIT) / CROSS;
  p = p * p * (3 - 2 * p);
  if (c === 1) p = 1 - p;
  const dx = b[0] - a[0], dz = b[2] - a[2], len = Math.hypot(dx, b[1] - a[1], dz);
  const side = (c === 0 ? TRACK : -TRACK) / (Math.hypot(dx, dz) || 1);
  out.set(a[0] + dx * p - dz * side, a[1] + (b[1] - a[1]) * p - sag(len, p), a[2] + dz * p + dx * side);
}

export const model: LandmarkModel = {
  build() {
    const k = new Kit();
    rock(k);
    STATIONS.forEach(([x, z, floor, l], i) => station(k, x, z, floor, turnOf(LINES[l]) + (i % 2 ? 180 : 0), i === 0));
    // the ropes: two tracks a line, each a thin ribbon seen from both sides
    for (const [a, b] of LINES) {
      const dx = b[0] - a[0], dz = b[2] - a[2], len = Math.hypot(dx, b[1] - a[1], dz), n = Math.hypot(dx, dz);
      for (const s of [TRACK, -TRACK]) {
        const ox = (-dz / n) * s, oz = (dx / n) * s;
        for (let i = 0; i < 8; i++) {
          const p = i / 8, q = (i + 1) / 8;
          const P = (t: number, dy: number): P3 => [a[0] + dx * t + ox, a[1] + (b[1] - a[1]) * t - sag(len, t) + dy, a[2] + dz * t + oz];
          for (const hint of [1, -1]) k.quad('plain', C.iron, P(p, -0.35), P(q, -0.35), P(q, 0.35), P(p, 0.35), [(-dz / n) * hint, 0, (dx / n) * hint]);
        }
      }
    }
    const g = k.group('rio-de-janeiro-sugarloaf');
    const cars: Cars = { cars: [] };
    const v = new THREE.Vector3();
    for (let l = 0; l < LINES.length; l++) {
      for (let c = 0; c < 2; c++) {
        const m = car();
        m.rotation.y = (-turnOf(LINES[l]) * Math.PI) / 180;
        carAt(l, c, 0, v);
        m.position.copy(v);
        g.add(m);
        cars.cars.push(m);
      }
    }
    g.userData.cars = cars;
    return g;
  },

  /** The cars cross every four minutes, waiting a minute at each end. */
  animate(group, utcMs) {
    const c = group.userData.cars as Cars | undefined;
    if (!c) return;
    for (let i = 0; i < c.cars.length; i++) carAt(i >> 1, i & 1, utcMs / 1000, c.cars[i].position);
  },
};
