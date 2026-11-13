/**
 * The Clifton Suspension Bridge (Brunel, 1864) over the Avon Gorge: a 214 m span between two tall
 * stone towers with round-headed arches for the road, the chains (three a side, drawn as one) in a
 * deep curve from saddle to saddle and back down into the rock behind each tower, the hangers, the
 * deck with its iron side girders, and under the Leigh Woods tower the great red sandstone
 * abutment that climbs out of the gorge side. From dusk the lights strung along the chains glow.
 * Faceted, Contour colours.
 *
 * Model frame (types.ts): origin on the ground of the Clifton approach, on the bridge's axis 130 m
 * from the middle of the span (see sites/bristol.ts); +x along the bridge toward Clifton, front
 * (local -z) up the gorge. The deck runs at road level, half a metre below the origin.
 */
import { Kit, LANDMARK_COLOURS as C, type Vec3 } from '../kit';
import type { LandmarkBucket, LandmarkModel } from '../types';
import type { Color, RegionStyle } from '../../world/palette';

/** Road level on the deck, m. */
const D = -0.5;
/** The towers' centres on the axis (Leigh Woods, Clifton), m. */
const LEIGH = -236.5, CLIFTON = -23.5;
const MID = (LEIGH + CLIFTON) / 2, HALF = (CLIFTON - LEIGH) / 2;
/** Tower height above the road, m. */
const TOWER_H = 26.2;
/** The chains: their top on the saddles, their lowest point at mid-span, their side offset. */
const CHAIN_TOP = D + TOWER_H - 0.4;
const CHAIN_LOW = D + 1.8;
const CHAIN_Z = 6.4;
/** Half the arch's width (the deck passes through it), m. */
const ARCH = 5.2;
/** The side girders' top and side offset. */
const GIRDER_TOP = D + 1.1;
const GIRDER_Z = 5.0;
/** The backstays reach the ground this far behind each tower. */
const BACKSTAY = 40;

/** The main chain's height at x (a parabola, close enough to the real curve). */
const chainY = (x: number) => CHAIN_LOW + (CHAIN_TOP - CHAIN_LOW) * ((x - MID) / HALF) ** 2;

/** A beam of w by h section from a to b: four long faces, no ends. */
function beam(k: Kit, b: LandmarkBucket, colour: Color, a: Vec3, c: Vec3, w: number, h: number): void {
  const d: Vec3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const len = Math.hypot(d[0], d[1], d[2]);
  const n: Vec3 = [d[0] / len, d[1] / len, d[2] / len];
  // u: across, level; v: across, the other way
  let u: Vec3 = [-n[2], 0, n[0]];
  const ul = Math.hypot(u[0], u[2]);
  u = ul < 1e-6 ? [1, 0, 0] : [u[0] / ul, 0, u[2] / ul];
  const v: Vec3 = [u[1] * n[2] - u[2] * n[1], u[2] * n[0] - u[0] * n[2], u[0] * n[1] - u[1] * n[0]];
  const P = (p: Vec3, su: number, sv: number): Vec3 => [p[0] + u[0] * su * w / 2 + v[0] * sv * h / 2, p[1] + u[1] * su * w / 2 + v[1] * sv * h / 2, p[2] + u[2] * su * w / 2 + v[2] * sv * h / 2];
  const sides: [number, number, number, number, Vec3][] = [
    [1, -1, 1, 1, u],
    [-1, 1, -1, -1, [-u[0], -u[1], -u[2]]],
    [1, 1, -1, 1, v],
    [-1, -1, 1, -1, [-v[0], -v[1], -v[2]]],
  ];
  for (const [s0, t0, s1, t1, nn] of sides) k.quad(b, colour, P(a, s0, t0), P(a, s1, t1), P(c, s1, t1), P(c, s0, t0), nn);
}

/** One tower on the road at x = 0 of the current frame: two battered legs, the arch, the cap, the saddles. */
function tower(k: Kit, foot: number, footColour: Color): void {
  // the pier under it, down into the rock
  k.box('plain', footColour, 0, foot, 0, 8, D - 1 - foot, 17.4, { top: false });
  for (const s of [-1, 1]) k.box('plain', C.stone, 0, D - 1, s * (ARCH + 1.3), 6.6, 23.5, 2.6, { taper: 0.9, top: false });
  k.box('plain', C.stone, 0, D + 17, 0, 6.1, 5.5, 2 * ARCH + 4.6, { top: false });
  k.box('plain', C.stone, 0, D + 22.5, 0, 6.4, 2.5, 16);
  k.box('plain', C.chalkShade, 0, D + 25, 0, 7, 1.2, 16.4);
  for (const s of [-1, 1]) k.box('plain', C.iron, 0, D + 25.8, s * CHAIN_Z, 3, 1.2, 1.6);
  // the round-headed arch: spandrels on both faces, and its soffit
  const cy = D + 17 - ARCH, steps = 5;
  const P = (i: number, s: number): [number, number] => [s * ARCH * Math.cos((i / steps) * (Math.PI / 2)), cy + ARCH * Math.sin((i / steps) * (Math.PI / 2))];
  for (const fx of [-3.1, 3.1]) {
    for (const s of [-1, 1]) {
      for (let i = 0; i < steps; i++) {
        const [z0, y0] = P(i, s), [z1, y1] = P(i + 1, s);
        k.tri('plain', C.stone, fx, D + 17, s * ARCH, fx, y0, z0, fx, y1, z1, Math.sign(fx), 0, 0);
      }
    }
  }
  for (const s of [-1, 1]) {
    for (let i = 0; i < steps; i++) {
      const [z0, y0] = P(i, s), [z1, y1] = P(i + 1, s);
      k.quad('plain', C.stoneDeep, [-3.1, y0, z0], [3.1, y0, z0], [3.1, y1, z1], [-3.1, y1, z1], [0, -y0 + cy, -z0]);
    }
  }
}

export const model: LandmarkModel = {
  build(_style: RegionStyle) {
    const k = new Kit();
    // the Leigh Woods abutment: red sandstone out of the gorge side, its tall blind arches
    k.box('plain', C.clay, LEIGH - 1, -48, 0, 28, 47.5 + D, 19, { taper: 0.86, topColour: C.paving });
    for (const s of [-1, 1]) {
      for (const dx of [-7, 0, 7]) k.box('plain', C.stoneDeep, LEIGH - 1 + dx, -38, s * 9.0, 4, 30, 0.6, { top: false });
    }
    for (const dz of [-5, 0, 5]) k.box('plain', C.stoneDeep, LEIGH + 12.6, -38, dz, 0.6, 30, 3.4, { top: false });
    // the towers
    k.push(LEIGH, 0, 0);
    tower(k, -6, C.clay);
    k.pop();
    k.push(CLIFTON, 0, 0);
    tower(k, -30, C.stone);
    k.pop();
    // the deck: road, iron side girders with a handrail, through both arches and onto the approaches
    k.box('plain', C.iron, (LEIGH + CLIFTON) / 2, D - 1.6, 0, CLIFTON - LEIGH + 26, 1.6, 2 * GIRDER_Z, { topColour: C.paving });
    for (const s of [-1, 1]) {
      k.box('plain', C.iron, MID, D - 2.4, s * GIRDER_Z, 2 * HALF - 7, GIRDER_TOP - D + 2.4, 0.35);
      k.box('plain', C.chalkShade, MID, GIRDER_TOP, s * GIRDER_Z, 2 * HALF - 7, 0.15, 0.4, { top: true });
    }
    // the chains, the backstays into the rock, the hangers, and the lights along the chains
    const SEG = 24;
    for (const s of [-1, 1]) {
      const z = s * CHAIN_Z;
      for (let i = 0; i < SEG; i++) {
        const x0 = LEIGH + ((CLIFTON - LEIGH) * i) / SEG, x1 = LEIGH + ((CLIFTON - LEIGH) * (i + 1)) / SEG;
        beam(k, 'plain', C.iron, [x0, chainY(x0), z], [x1, chainY(x1), z], 0.6, 1.3);
      }
      beam(k, 'plain', C.iron, [CLIFTON, CHAIN_TOP, z], [CLIFTON + BACKSTAY, D - 2, z], 0.6, 1.3);
      beam(k, 'plain', C.iron, [LEIGH, CHAIN_TOP, z], [LEIGH - BACKSTAY, D - 2, z], 0.6, 1.3);
      for (let x = LEIGH + 5.5; x < CLIFTON - 5; x += 4.4) {
        beam(k, 'plain', C.iron, [x, chainY(x) - 0.4, z], [x, GIRDER_TOP, s * (GIRDER_Z + 0.1)], 0.12, 0.12);
      }
      for (let x = LEIGH + 4; x < CLIFTON - 3; x += 8.2) k.box('glow', C.chalk, x, chainY(x) + 0.6, z, 0.5, 0.5, 0.5);
      for (const [x0, x1] of [[CLIFTON, CLIFTON + BACKSTAY], [LEIGH, LEIGH - BACKSTAY]]) {
        for (let t = 0.2; t < 0.9; t += 0.25) {
          const x = x0 + (x1 - x0) * t;
          k.box('glow', C.chalk, x, CHAIN_TOP + (D - 2 - CHAIN_TOP) * t + 0.6, z, 0.5, 0.5, 0.5);
        }
      }
    }
    // the approaches' road beyond the towers
    k.box('plain', C.paving, CLIFTON + 18, D - 1.6, 0, 22, 1.5, 10);
    k.box('plain', C.paving, LEIGH - 20, D - 1.6, 0, 22, 1.5, 10);
    return k.group('bristol-clifton-suspension-bridge');
  },
};
