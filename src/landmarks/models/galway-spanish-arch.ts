/**
 * The Spanish Arch, Galway: the 1584 extension of the town wall at the mouth of the Corrib, pierced
 * in the 18th century by two round arches, the Spanish Arch itself (the way through to the Parade)
 * and the Caoch or blind arch beside it. A thick block of grey rubble limestone about 7 m high with
 * a grassed walk on top behind a low parapet, the thinner town wall running on north-east from it.
 * Proportions from the OpenStreetMap outline (2026-11) and photographs.
 *
 * Model frame (types.ts): origin on the ground at the middle of the wall, front (local -z) south-east
 * onto the Spanish Parade; +x is south-west, toward the river.
 */
import { Kit, LANDMARK_COLOURS as C, type Vec3 } from '../kit';
import type { LandmarkModel } from '../types';
import type { Color } from '../../world/palette';

/** Facets in each half-round arch. */
const SEG = 8;

/** A round arch: centre x, width, springing height; `blind` its depth if it does not go through. */
type Arch = { x: number; w: number; spring: number; blind?: number };

/** The arch's edge, left to right, at height y0 + spring + r sin. */
function arc(a: Arch): [number, number][] {
  const r = a.w / 2;
  return Array.from({ length: SEG + 1 }, (_, i) => {
    const t = Math.PI - (i * Math.PI) / SEG;
    return [a.x + r * Math.cos(t), a.spring + r * Math.sin(t)];
  });
}

/**
 * One face of a wall from x0 to x1, y0 to top, in the plane z facing n (-1 front, +1 back), with
 * openings for the arches that reach it.
 */
function face(k: Kit, colour: Color, x0: number, x1: number, y0: number, top: number, z: number, n: number, arches: Arch[]): void {
  const N: Vec3 = [0, 0, n];
  let x = x0;
  for (const a of arches) {
    const l = a.x - a.w / 2, r = a.x + a.w / 2;
    k.quad('plain', colour, [x, y0, z], [l, y0, z], [l, top, z], [x, top, z], N);
    // the opening starts at the street; below it the wall goes on into the ground
    k.quad('plain', colour, [l, y0, z], [r, y0, z], [r, 0, z], [l, 0, z], N);
    const p = arc(a);
    for (let i = 0; i < SEG; i++) k.quad('plain', colour, [p[i][0], p[i][1], z], [p[i + 1][0], p[i + 1][1], z], [p[i + 1][0], top, z], [p[i][0], top, z], N);
    x = r;
  }
  k.quad('plain', colour, [x, y0, z], [x1, y0, z], [x1, top, z], [x, top, z], N);
}

/** The inside of an arch from the plane zf to zb: its jambs and soffit, and (blind) the back. */
function reveal(k: Kit, colour: Color, a: Arch, y0: number, zf: number, zb: number): void {
  const l = a.x - a.w / 2, r = a.x + a.w / 2;
  k.quad('plain', colour, [l, y0, zf], [l, y0, zb], [l, a.spring, zb], [l, a.spring, zf], [1, 0, 0]);
  k.quad('plain', colour, [r, y0, zb], [r, y0, zf], [r, a.spring, zf], [r, a.spring, zb], [-1, 0, 0]);
  const p = arc(a);
  for (let i = 0; i < SEG; i++) {
    const t = Math.PI - ((i + 0.5) * Math.PI) / SEG;
    k.quad('plain', colour, [p[i][0], p[i][1], zf], [p[i + 1][0], p[i + 1][1], zf], [p[i + 1][0], p[i + 1][1], zb], [p[i][0], p[i][1], zb], [-Math.cos(t), -Math.sin(t), 0]);
  }
  if (a.blind) {
    k.quad('plain', colour, [l, y0, zb], [r, y0, zb], [r, a.spring, zb], [l, a.spring, zb], [0, 0, -1]);
    for (let i = 0; i < SEG; i++) k.tri('plain', colour, a.x, a.spring, zb, p[i][0], p[i][1], zb, p[i + 1][0], p[i + 1][1], zb, 0, 0, -1);
  }
}

/** A dressed-stone ring round an arch, standing a little proud of the face at z (front). */
function ring(k: Kit, colour: Color, a: Arch, z: number, width: number): void {
  const r0 = a.w / 2, r1 = r0 + width;
  for (let i = 0; i < SEG; i++) {
    const t0 = Math.PI - (i * Math.PI) / SEG, t1 = Math.PI - ((i + 1) * Math.PI) / SEG;
    const P = (r: number, t: number): Vec3 => [a.x + r * Math.cos(t), a.spring + r * Math.sin(t), z];
    k.quad('plain', colour, P(r0, t0), P(r1, t0), P(r1, t1), P(r0, t1), [0, 0, -1]);
  }
}

export const model: LandmarkModel = {
  build() {
    const k = new Kit();
    // grey limestone rubble with paler dressed stone round the arches and on the coping
    const wall = C.limestone, dressed = C.chalkShade;
    const Y0 = -3, TOP = 6.6;
    // the bastion block, x 3..18, 6 m thick, with its two arches
    const X0 = 3, X1 = 18, ZF = -3, ZB = 3;
    const spanish: Arch = { x: 7, w: 4.2, spring: 2.9 };
    const caoch: Arch = { x: 13.2, w: 3.4, spring: 2.5, blind: 1.0 };
    face(k, wall, X0, X1, Y0, TOP, ZF, -1, [spanish, caoch]);
    face(k, wall, X0, X1, Y0, TOP, ZB, 1, [spanish]);
    reveal(k, C.iron, spanish, 0, ZF, ZB);
    reveal(k, C.iron, caoch, 0, ZF, ZF + caoch.blind!);
    for (const a of [spanish, caoch]) ring(k, dressed, a, ZF - 0.12, 0.55);
    k.quad('plain', wall, [X1, Y0, ZF], [X1, Y0, ZB], [X1, TOP, ZB], [X1, TOP, ZF], [1, 0, 0]);
    k.quad('plain', wall, [X0, Y0, ZB], [X0, Y0, ZF], [X0, TOP, ZF], [X0, TOP, ZB], [-1, 0, 0]);
    // the walk on top: grass between low parapets, a coping all round
    k.quad('plain', C.grass, [X0, TOP, ZF], [X1, TOP, ZF], [X1, TOP, ZB], [X0, TOP, ZB], [0, 1, 0]);
    k.box('plain', wall, (X0 + X1) / 2, TOP, ZF + 0.3, X1 - X0, 0.9, 0.6, { topColour: dressed });
    k.box('plain', wall, (X0 + X1) / 2, TOP, ZB - 0.3, X1 - X0, 0.9, 0.6, { topColour: dressed });
    k.box('plain', wall, X1 - 0.3, TOP, 0, 0.6, 0.9, ZB - ZF - 1.2, { topColour: dressed });
    // a string course along the front under the parapet, and a few small square openings
    k.box('plain', dressed, (X0 + X1) / 2, TOP - 0.35, ZF - 0.08, X1 - X0, 0.35, 0.2, { top: false });
    for (const x of [4.6, 10.2, 16.4]) k.box('plain', C.iron, x, 4.6, ZF - 0.04, 0.6, 0.7, 0.1, { top: false });

    // the town wall running on north-east, thinner and lower, with its coping
    k.box('plain', wall, -7.5, Y0, 0, 21, 8.4, 1.6, { top: false });
    k.box('plain', dressed, -7.5, 5.4, 0, 21.2, 0.35, 1.9);
    return k.group('galway-spanish-arch');
  },
};
