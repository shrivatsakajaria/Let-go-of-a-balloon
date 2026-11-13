/**
 * Sugarloaf Mountain and its cable car: the granite dome of the Pão de Açúcar, 396 m, bare and
 * steep on its flanks with forest on its crown and gentler slopes, and the two spans of the cable
 * car (the bondinho) from Praia Vermelha to Morro da Urca and on to the summit, each with its two
 * glass cars gliding back and forth on their ropes (their windows lit from dusk). Faceted, Contour
 * colours.
 *
 * The map's terrain already has the mountain, but its elevation data rounds the dome down to about
 * 300 m. The rock here is a height field over it (25 m grid): a dome to the real summit height,
 * and everywhere in the dome's footprint at least 20 m above the ground the app draws there (the
 * terraced ground of the z14 cell's highest vertex, where the map's 11 m trees stand, and the z13
 * and z12 ground), so neither the hill, its terraces nor its trees poke through at any level of
 * detail. Outside the footprint its edge drops 15 m below the lowest drawn ground, so the rock
 * never floats. Worked out from the Mapterhorn tiles (2026-11) the way terrain.ts draws them.
 * Morro da Urca is left to the terrain; its stations stand on it at its drawn z14 height, their
 * plinths reaching down to the coarser levels' lower ground. Stations and ropes from
 * OpenStreetMap (2026-11).
 *
 * Model frame (types.ts): origin on the ground at Station I, Praia Vermelha (the drawn ground
 * there is 24 m above the sea), front (local -z) up the line toward the summit, 58 degrees.
 */
import * as THREE from 'three';
import { Kit, LANDMARK_COLOURS as C } from '../kit';
import type { Color } from '../../world/palette';
import type { LandmarkModel } from '../types';

type P3 = [number, number, number];

/** Contour's deep sage (CONTOUR.land[4]): forest. */
const FOREST: Color = C.cypress;
/** Contour's sage (CONTOUR.land[3]): scrub on the gentler rock. */
const SCRUB: Color = C.sage;

/** The rock's grid: corner, spacing and size (model frame, m). */
const GX = -275, GZ = -1700, STEP = 25, NX = 25, NZ = 29;
/**
 * Heights (m, model frame) row by row from GZ; values under -1000 are edge nodes 2000 m too low:
 * there the rock drops 15 m below the drawn ground.
 */
const ROCK = [
  -2075, -2077, -2077, -2077, -2077, -2077, -2077, -2077, -2076, -2076, -2076, -2079, -2079, -2079, -2079, -2065, -2065, -2065, -2065, -2065,
  -2065, -2065, -2079, -2079, -2079, -2075, -2075, -2077, -2077, -2077, -2077, -2077, -2077, -2076, -2076, -2076, -2079, 3, 26, 46,
  43, 44, 39, 26, 46, 46, -2044, -2044, -2079, -2079, -2075, -2075, -2075, -2075, -2077, -2077, -2077, -2076, -2076, -2076,
  -2, 22, 57, 81, 93, 105, 107, 93, 88, 66, 66, 66, -2044, -2044, -2044, -2075, -2075, -2075, -2075, -2075,
  -2077, -2077, -2076, -2076, 13, 62, 91, 116, 141, 154, 159, 158, 142, 132, 111, 86, 66, 66, -2044, -2044,
  -2075, -2075, -2075, -2075, -2075, -2075, -2079, -2076, 33, 78, 117, 155, 174, 190, 196, 203, 200, 190, 174, 146,
  116, 86, 76, -2044, -2044, -2075, -2075, -2075, -2075, -2075, -2079, 5, 45, 96, 142, 174, 201, 220, 235, 241,
  238, 229, 219, 201, 177, 147, 106, 76, 76, -2044, -2075, -2075, -2075, -2075, -2075, -2079, 51, 104, 157, 194,
  217, 241, 260, 265, 275, 272, 262, 254, 235, 207, 170, 134, 96, 66, -2044, -2041, -2075, -2075, -2075, -2075,
  36, 100, 159, 203, 235, 259, 280, 290, 296, 300, 296, 286, 272, 252, 230, 192, 153, 103, 76, -2078,
  -2041, -2036, -2036, -2075, 46, 99, 155, 194, 234, 265, 292, 308, 314, 323, 323, 315, 304, 291, 276, 247,
  208, 163, 110, 56, -2078, -2036, -2036, -2036, 56, 82, 147, 192, 234, 271, 290, 314, 330, 335, 343, 335,
  330, 324, 307, 284, 263, 224, 179, 119, 56, -2076, -2036, -2036, 76, 71, 131, 187, 227, 268, 294, 316,
  330, 343, 349, 350, 354, 346, 337, 321, 295, 264, 230, 185, 126, 56, -2076, -2036, -2036, 76, 126, 174,
  222, 263, 298, 313, 331, 346, 351, 355, 358, 359, 357, 343, 329, 306, 276, 231, 183, 128, 57, -2076,
  -2036, 96, 96, 146, 209, 256, 291, 313, 333, 346, 359, 360, 365, 365, 361, 356, 348, 327, 304, 275,
  231, 187, 124, 56, -2076, -2021, 96, 146, 181, 233, 280, 311, 333, 354, 364, 370, 370, 370, 372, 365,
  355, 349, 333, 307, 268, 228, 178, 114, 31, -2076, -2021, 136, 146, 197, 248, 290, 322, 343, 359, 372,
  369, 371, 372, 375, 364, 356, 341, 329, 296, 262, 222, 162, 99, 16, -2076, -2021, 136, 176, 207, 263,
  298, 326, 350, 367, 370, 371, 372, 371, 374, 369, 362, 340, 322, 293, 256, 208, 149, 80, 36, -2071,
  -2021, 116, 176, 211, 264, 307, 335, 350, 369, 370, 372, 372, 372, 377, 366, 353, 336, 314, 276, 237,
  187, 124, 46, -2071, -2071, -1975, 146, 146, 211, 265, 300, 329, 354, 366, 371, 371, 371, 370, 375, 362,
  352, 328, 303, 264, 218, 160, 97, 46, -2071, -2071, -1975, 126, 146, 208, 258, 297, 329, 342, 356, 364,
  375, 373, 373, 363, 358, 340, 319, 287, 246, 200, 134, 56, -2071, -2071, -2071, -1975, 136, 146, 184, 236,
  282, 310, 335, 353, 362, 366, 368, 361, 354, 343, 328, 304, 269, 221, 173, 106, 26, -2071, -2071, -2071,
  -1975, 136, 142, 164, 217, 257, 290, 315, 331, 341, 353, 355, 347, 338, 329, 308, 283, 248, 198, 139,
  66, 46, -2071, -2071, -2079, -1975, -1975, 146, 148, 192, 229, 266, 294, 313, 322, 333, 329, 331, 323, 306,
  285, 255, 215, 157, 95, 46, -2071, -2071, -2079, -2079, -1975, -1905, 156, 166, 159, 199, 232, 258, 285, 293,
  300, 300, 301, 287, 273, 248, 208, 165, 117, 66, -2045, -2068, -2071, -2079, -2079, -1975, -1905, -1905, 166, 174,
  169, 191, 222, 239, 254, 263, 260, 255, 247, 224, 202, 160, 118, 66, 56, -2045, -2068, -2068, -2071, -2079,
  -1905, -1905, -1905, -1905, 174, 176, 176, 174, 193, 201, 215, 218, 210, 198, 170, 144, 106, 76, 56, -2045,
  -2068, -2068, -2068, -2068, -2068, -1905, -1905, -1905, -1905, -1905, 181, 179, 179, 179, 166, 166, 156, 156, 126, 103,
  96, 76, -2041, -2041, -2068, -2068, -2068, -2068, -2068, -2068, -1905, -1905, -1905, -1905, -1905, -1915, 181, 179, 179, 166,
  156, 156, 136, 126, 106, 86, -2041, -2041, -2041, -2054, -2054, -2068, -2068, -2068, -2068, -1925, -1905, -1905, -1905, -1905,
  -1915, -1915, -1915, -1915, -1915, 156, 136, -2015, -2015, -2015, -2015, -2041, -2041, -2054, -2054, -2054, -2054, -2068, -2068, -2068,
  -1925, -1925, -1925, -1905, -1915, -1915, -1915, -1915, -1915, -1915, -1915, -1995, -1995, -2015, -2015, -2021, -2021, -2054, -2054, -2054,
  -2054, -2054, -2054, -2054, -2068,
];

/** The ropes: [from, to] (m, model frame), the cars' tracks. */
const LINES: [P3, P3][] = [
  [[0, 19.5, 0], [-275.6, 195, -403.7]],
  [[-249.7, 186, -562.7], [-22, 382, -1259]],
];
/**
 * The stations: x, z, floor height (the highest drawn z14 ground under them), plinth depth (down to
 * the lowest drawn ground at any level), and the line whose end they hold (turned along it).
 */
const STATIONS: [number, number, number, number, number][] = [
  [0, 0, 8.5, 18.5, 0],
  [-275.6, -403.7, 186, 47, 0],
  [-249.7, -562.7, 177, 39, 1],
  [-22, -1259, 373, 23, 1],
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
function station(k: Kit, x: number, z: number, floor: number, plinth: number, turnDeg: number, big: boolean): void {
  k.push(x, floor, z, turnDeg);
  const w = big ? 20 : 16, d = big ? 34 : 24;
  k.box('plain', C.stoneDeep, 0, -plinth, 6, w + 4, plinth, d + 4, { topColour: C.paving });
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
  const g = k.group('rio-de-janeiro-sugarloaf-car');
  // the cars move: they are not tops for the camera (types.ts noTops)
  for (const m of g.children) m.userData.noTops = true;
  return g;
}

type Cars = { cars: THREE.Object3D[] };

const turnOf = ([a, b]: [P3, P3]) => (Math.atan2(b[0] - a[0], -(b[2] - a[2])) * 180) / Math.PI;

/** Where car `c` of line `l` is at time t (s), into out. */
function carAt(l: number, c: number, t: number, out: THREE.Vector3): void {
  // indexed, not destructured: no iterator in the frame loop
  const line = LINES[l], a = line[0], b = line[1];
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
    STATIONS.forEach(([x, z, floor, plinth, l], i) => station(k, x, z, floor, plinth, turnOf(LINES[l]) + (i % 2 ? 180 : 0), i === 0));
    // the ropes: two tracks a line, each a thin ribbon seen from both sides; their own mesh, left
    // out of the camera's tops (types.ts noTops)
    const kr = new Kit();
    for (const [a, b] of LINES) {
      const dx = b[0] - a[0], dz = b[2] - a[2], len = Math.hypot(dx, b[1] - a[1], dz), n = Math.hypot(dx, dz);
      for (const s of [TRACK, -TRACK]) {
        const ox = (-dz / n) * s, oz = (dx / n) * s;
        for (let i = 0; i < 8; i++) {
          const p = i / 8, q = (i + 1) / 8;
          const P = (t: number, dy: number): P3 => [a[0] + dx * t + ox, a[1] + (b[1] - a[1]) * t - sag(len, t) + dy, a[2] + dz * t + oz];
          for (const hint of [1, -1]) kr.quad('plain', C.iron, P(p, -0.35), P(q, -0.35), P(q, 0.35), P(p, 0.35), [(-dz / n) * hint, 0, (dx / n) * hint]);
        }
      }
    }
    const g = k.group('rio-de-janeiro-sugarloaf');
    const ropes = kr.mesh('plain', 'rio-de-janeiro-sugarloaf-ropes')!;
    ropes.userData.noTops = true;
    g.add(ropes);
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
