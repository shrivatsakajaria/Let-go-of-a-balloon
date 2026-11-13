/**
 * Christ the Redeemer on Corcovado: the 30 m Art Deco figure in pale soapstone, arms outstretched
 * 28 m with the tunic's narrow sleeves draped under the forearms, the long robe with its folds and
 * sash, the head bowed a little; the 8 m pedestal with the chapel's door at the back; the summit's
 * paved terrace with its parapets, and the long platform in front of the statue where the balloon
 * is let go. From dusk the floodlight falls on the front of the robe, the arms and the face (a plain
 * glow on those faces only, so the form still reads); the rest is lit stone. Faceted, Contour colours.
 *
 * The map's elevation data has lost Corcovado's needle: the ground it draws at the statue is
 * 528 m (the real summit is 710 m), with a smoothed hump 140 m to the west-north-west that is
 * higher. So the summit is a rock here, as for Sugarloaf: a height field (25 m grid) rising to the
 * terrace at 700 m, steep to the front and the sides and longer down the ridge behind, everywhere
 * in its footprint at least 20 m above the ground the app draws (the z14 cell's highest vertex,
 * where the trees stand, and the z13 and z12 ground, each against that level's ground at the
 * statue), tapering to 4 m at its rim, and dropping 15 m under the lowest drawn ground outside.
 * Worked out from the Mapterhorn tiles (2026-11) the way terrain.ts draws them.
 *
 * Model frame (types.ts): origin at the statue, on the drawn ground there (528 m at z14), front
 * (local -z) where the statue looks, east over the city and the bay toward Sugarloaf (82 degrees,
 * the line of the summit's front platform in OpenStreetMap, 2026-11).
 */
import { Kit, LANDMARK_COLOURS as C } from '../kit';
import type { Color } from '../../world/palette';
import type { LandmarkModel } from '../types';

type P3 = [number, number, number];

/** Contour's deep sage (CONTOUR.land[4]): forest. */
const FOREST: Color = C.cypress;
/** Contour's sage (CONTOUR.land[3]): scrub on the gentler rock. */
const SCRUB: Color = C.sage;

/** The terrace's level (m, model frame): 700 m above the sea at full detail. */
export const TERRACE_Y = 172;
/** The launch platform in front of the statue: its centre (model frame) and half sizes. */
export const LAUNCH = { x: 0, z: -30, halfW: 8, halfD: 18 };
/** The top of the pedestal, where the figure stands. */
const P = TERRACE_Y + 1.5 + 8;

/** The rock's grid: corner, spacing and size (model frame, m). */
const GX = -225, GZ = -250, STEP = 25, NX = 19, NZ = 25;
/**
 * Heights (m, model frame) row by row from GZ; values under -1000 are edge nodes 2000 m too low:
 * there the rock drops 15 m below the drawn ground.
 */
const ROCK = [
  -2076, -2076, -2036, -2036, -2036, -2036, -2144, -2144, -2144, -2144, -2206, -2206, -2214, -2256, -2256, -2256, -2256, -2306, -2306, -2076,
  -2076, -2033, -2026, -2026, -2026, -2144, -2144, -2144, -2144, -2206, -2214, -2214, -2256, -2256, -2256, -2263, -2306, -2306, -2076, -2076,
  -2033, -2026, -2026, -2026, -2144, -2144, -2144, -2206, -2206, -2214, -2214, -2256, -2256, -2256, -2263, -2306, -2306, -2076, -2076, -2043,
  -2026, -2026, -2144, 50, 44, 29, 31, -63, -80, -98, -2256, -2256, -2263, -2263, -2306, -2306, -2076, -2076, -2026, -2026,
  88, 95, 65, 63, 56, 54, -14, -26, -47, -77, -106, -2263, -2263, -2306, -2306, -2076, -2043, -2026, 76, 97,
  103, 68, 64, 64, 41, 35, 18, -4, -31, -64, -109, -2256, -2306, -2306, -2076, -2043, -2026, 78, 100, 96,
  67, 64, 76, 79, 77, 62, 37, 9, -31, -75, -2276, -2306, -2306, -2076, -2043, 60, 87, 99, 91, 69,
  94, 111, 117, 112, 97, 71, 37, 0, -49, -100, -2276, -2276, -2076, -2043, 64, 85, 97, 86, 96, 120,
  141, 148, 141, 126, 99, 59, 20, -24, -79, -2276, -2276, -2076, -2043, 71, 84, 101, 88, 110, 140, 159,
  166, 162, 141, 112, 75, 31, -15, -63, -2276, -2276, -2076, -2043, 73, 87, 96, 85, 118, 145, 166, 170,
  166, 150, 117, 80, 40, -9, -62, -2274, -2274, -2076, -2043, 74, 93, 99, 88, 118, 146, 165, 170, 168,
  147, 114, 82, 40, -13, -64, -2274, -2274, -2043, -2026, 80, 100, 106, 100, 108, 137, 157, 163, 159, 137,
  112, 76, 33, -15, -66, -2246, -2263, -2043, -2026, 86, 103, 113, 125, 100, 125, 146, 152, 148, 130, 97,
  64, 23, -22, -74, -2246, -2263, -2043, -2026, 86, 110, 114, 122, 127, 123, 130, 134, 132, 112, 86, 55,
  10, -33, -83, -2246, -2263, -2043, -2026, 91, 115, 123, 126, 129, 136, 135, 124, 125, 92, 71, 44, -2,
  -48, -98, -2253, -2263, -2033, -2026, 93, 116, 126, 132, 138, 144, 146, 140, 124, 85, 54, 42, -21, -64,
  -116, -2253, -2263, -2033, -2026, -2026, 112, 125, 134, 135, 141, 144, 137, 126, 96, 43, -3, -41, -82, -2253,
  -2253, -2263, -2026, -2026, -2026, 110, 124, 131, 133, 138, 145, 125, 97, 96, 44, -22, -49, -102, -2246, -2246,
  -2253, -2006, -2006, -2026, -1976, 118, 124, 129, 137, 138, 114, 94, 94, 33, -39, -43, -2246, -2246, -2246, -2266,
  -2006, -2006, -2006, -1986, 113, 116, 127, 128, 132, 107, 83, 82, 20, -42, -113, -2246, -2246, -2246, -2266, -2013,
  -2013, -2006, -1986, -1986, 109, 114, 124, 123, 94, 63, 16, 4, -47, -2226, -2226, -2246, -2246, -2266, -2013, -2006,
  -2006, -1993, -1986, -1986, 107, 108, 112, 81, 54, 5, 2, -2164, -2226, -2226, -2226, -2233, -2246, -2016, -2016, -2016,
  -1993, -1986, -1986, -2006, -2006, 96, 65, 41, -2156, -2156, -2156, -2226, -2226, -2226, -2233, -2246, -2016, -2016, -2016, -2016,
  -2016, -2016, -2026, -2026, -2114, -2114, -2116, -2156, -2156, -2156, -2226, -2226, -2226, -2226, -2246,
];

function rock(k: Kit): void {
  const h = (i: number, j: number) => {
    const v = ROCK[j * NX + i];
    return v < -1000 ? v + 2000 : v;
  };
  const edge = (i: number, j: number) => ROCK[j * NX + i] < -1000;
  const at = (i: number, j: number): P3 => [GX + i * STEP, h(i, j), GZ + j * STEP];
  const tri = (a: P3, b: P3, c: P3) => {
    // forest where it is gentle, bare granite where it is steep
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const up = Math.abs(ny) / (Math.hypot(nx, ny, nz) || 1);
    k.tri('plain', up > 0.86 ? FOREST : up > 0.72 ? SCRUB : C.slate, a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2], 0, 1, 0);
  };
  for (let j = 0; j + 1 < NZ; j++) {
    for (let i = 0; i + 1 < NX; i++) {
      if (edge(i, j) && edge(i + 1, j) && edge(i, j + 1) && edge(i + 1, j + 1)) continue;
      const a = at(i, j), b = at(i + 1, j), c = at(i + 1, j + 1), d = at(i, j + 1);
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

/**
 * The summit terrace: the round upper terrace and the long launch platform with their retaining walls
 * (into `ground`), and the parapets (into `k`).
 */
function terrace(ground: Kit, k: Kit): void {
  const y = TERRACE_Y, wall = 34;
  ground.prism('plain', C.stone, 0, y - wall, 0, 18, wall, 12, { topColour: C.paving });
  const { x, z, halfW, halfD } = LAUNCH;
  ground.box('plain', C.stone, x, y - wall, z, 2 * halfW, wall, 2 * halfD, { topColour: C.paving });
  // parapets along the platform and round its front
  for (const s of [-1, 1]) k.box('plain', C.chalkShade, x + s * (halfW - 0.3), y, z, 0.6, 1.1, 2 * halfD);
  k.box('plain', C.chalkShade, x, y, z - halfD + 0.3, 2 * halfW, 1.1, 0.6);
  // the parapet round the upper terrace, open to the platform
  for (let i = 0; i < 12; i++) {
    const a = ((i + 0.5) / 12) * 360;
    if (a > 150 && a < 210) continue;
    k.push(0, y, 0, a + 180);
    k.box('plain', C.chalkShade, 0, 0, -17.3, 9.3, 1.1, 0.6);
    k.pop();
  }
}

/** The pedestal and its chapel: a stepped base and a plain block with a cornice, the door behind. */
function pedestal(k: Kit): void {
  const y = TERRACE_Y;
  k.prism('plain', C.chalkShade, 0, y, 0, 11, 0.75, 8, { rot: 22.5 });
  k.prism('plain', C.chalkShade, 0, y + 0.75, 0, 9.5, 0.75, 8, { rot: 22.5 });
  k.box('plain', C.chalk, 0, y + 1.5, 0, 9.5, 7.2, 9.5, { top: false });
  // a band of shallow panels round the block, as on the real pedestal
  k.box('plain', C.chalkShade, 0, y + 6.2, 0, 9.9, 0.5, 9.9, { top: false });
  k.box('plain', C.chalkShade, 0, y + 8.7, 0, 10.4, 0.8, 10.4);
  // the chapel's door at the back, under a little arch
  k.box('plain', C.iron, 0, y + 1.5, 4.8, 2.4, 3.2, 0.2, { top: false });
  k.push(0, y + 4.7, 4.85);
  k.tri('plain', C.iron, -1.2, 0, 0, 1.2, 0, 0, 0, 0.9, 0, 0, 0, 1);
  k.pop();
}

/**
 * Quads between rings of points (closed loops of the same length), lit away from their centres.
 * With `lit`, the faces turned to the front (-z) go in the glow bucket: the floodlit side.
 */
function loft(k: Kit, colour: Color, rings: P3[][], cap = true, lit = false): void {
  const mid = (r: P3[]): P3 => {
    const s: P3 = [0, 0, 0];
    for (const p of r) for (let i = 0; i < 3; i++) s[i] += p[i] / r.length;
    return s;
  };
  const cs = rings.map(mid);
  for (let r = 0; r + 1 < rings.length; r++) {
    const A = rings[r], B = rings[r + 1];
    const m: P3 = [(cs[r][0] + cs[r + 1][0]) / 2, (cs[r][1] + cs[r + 1][1]) / 2, (cs[r][2] + cs[r + 1][2]) / 2];
    for (let i = 0; i < A.length; i++) {
      const j = (i + 1) % A.length;
      const q: P3 = [(A[i][0] + B[j][0]) / 2 - m[0], (A[i][1] + B[j][1]) / 2 - m[1], (A[i][2] + B[j][2]) / 2 - m[2]];
      const front = lit && q[2] < -0.6 * Math.hypot(q[0], q[1], q[2]);
      k.quad(front ? 'glow' : 'plain', colour, A[i], A[j], B[j], B[i], q);
    }
  }
  if (!cap) return;
  const last = rings[rings.length - 1], c = cs[cs.length - 1];
  for (let i = 0; i < last.length; i++) {
    const a = last[i], b = last[(i + 1) % last.length];
    k.tri('plain', colour, c[0], c[1], c[2], a[0], a[1], a[2], b[0], b[1], b[2], 0, 1, 0);
  }
}

/** An upright ellipse of n points round (cx, y, cz). */
function ring(cx: number, y: number, cz: number, rx: number, rz: number, n = 10): P3[] {
  const out: P3[] = [];
  for (let i = 0; i < n; i++) {
    const a = ((i + 0.5) / n) * 2 * Math.PI;
    out.push([cx + rx * Math.sin(a), y, cz - rz * Math.cos(a)]);
  }
  return out;
}

/** The figure, in soapstone: robe, sash, folds, the arms and their hanging sleeves, the head. */
function figure(k: Kit): void {
  const S = C.chalk, SH = C.chalkShade;
  // the robe, from its hem to the shoulders: a long column a little wider at the foot
  const robe: [number, number, number][] = [
    [0, 3.3, 2.7], [5, 3.0, 2.4], [11, 2.8, 2.2], [15, 2.8, 2.2], [19.5, 3.2, 2.3], [23, 3.6, 2.2], [24.4, 3.4, 2.0], [25.2, 1.7, 1.5],
  ];
  // (the front of the robe and the face are the floodlit faces at night; the rest is lit stone)
  loft(k, S, robe.map(([y, rx, rz]) => ring(0, P + y, 0, rx, rz)), false, true);
  // the sash at the waist
  loft(k, SH, [ring(0, P + 14.3, 0, 2.95, 2.35), ring(0, P + 15.4, 0, 2.95, 2.35)], false);
  // folds down the front and the back of the robe (stone: shadowed stripes on the lit front)
  for (const [x, z] of [[-1.2, -2.45], [0.9, -2.45], [-0.9, 2.35], [1.1, 2.35]] as [number, number][]) {
    k.box('plain', SH, x, P, z, 0.55, 13.5, 0.5, { taper: 0.7 });
  }
  // the neck and the head, bowed a little forward
  loft(k, S, [ring(0, P + 25.2, -0.2, 0.75, 0.75, 8), ring(0, P + 26.0, -0.35, 1.05, 1.2, 8), ring(0, P + 27.6, -0.5, 1.15, 1.3, 8), ring(0, P + 28.9, -0.45, 0.95, 1.05, 8), ring(0, P + 29.6, -0.35, 0.45, 0.5, 8)], true, true);
  // the hair falling to the shoulders behind
  k.box('plain', SH, 0, P + 24.4, 0.55, 2.3, 3.6, 1.4, { taper: 0.8 });
  for (const s of [-1, 1]) {
    // the arm, straight out: a beam from the shoulder to the hand, 14 m from the axis
    loft(k, S, [
      [[s * 2.8, P + 22.6, -0.85], [s * 2.8, P + 22.6, 0.85], [s * 2.8, P + 24.7, 0.85], [s * 2.8, P + 24.7, -0.85]],
      [[s * 12.6, P + 23.1, -0.6], [s * 12.6, P + 23.1, 0.6], [s * 12.6, P + 24.5, 0.6], [s * 12.6, P + 24.5, -0.6]],
    ].map((r) => (s > 0 ? r : [...r].reverse()) as P3[]), false, true);
    // the hand, open
    k.box('glow', S, s * 13.3, P + 22.9, 0, 1.5, 1.7, 0.9);
    // the sleeve: a narrow drape under the forearm, at most 2.6 m deep, ending well short of the
    // body so the sky shows between arm and robe. Stations: distance out, depth below the arm.
    const t = 0.5;
    const under = (x: number) => P + 22.6 + ((x - 2.8) / 9.8) * 0.5;
    const drape: [number, number][] = [[4.6, 0], [5.6, 1.4], [7.6, 2.4], [9.8, 2.6], [11.5, 1.9], [12.0, 0]];
    const pt = (x: number, d: number, z: number): P3 => [s * x, under(x) - d + 0.05, z];
    for (let i = 0; i + 1 < drape.length; i++) {
      const [x0, d0] = drape[i], [x1, d1] = drape[i + 1];
      for (const side of [-1, 1]) {
        k.quad(side < 0 ? 'glow' : 'plain', S, pt(x0, 0, side * t), pt(x1, 0, side * t), pt(x1, d1, side * t), pt(x0, d0, side * t), [0, 0, side]);
      }
      // its lower edge, in shade
      if (d0 + d1 > 0) k.quad('plain', SH, pt(x0, d0, -t), pt(x1, d1, -t), pt(x1, d1, t), pt(x0, d0, t), [0, -1, 0]);
    }
  }
}

export const model: LandmarkModel = {
  build() {
    // the rock and the terrace are the summit the map has lost: their own mesh, marked as ground
    // (types.ts), so the person, the street camera and the climb stand on them
    const kg = new Kit();
    const k = new Kit();
    rock(kg);
    terrace(kg, k);
    pedestal(k);
    figure(k);
    const g = k.group('rio-de-janeiro-christ-the-redeemer');
    const ground = kg.mesh('plain', 'rio-de-janeiro-christ-the-redeemer-ground')!;
    ground.userData.ground = true;
    g.add(ground);
    return g;
  },
};
