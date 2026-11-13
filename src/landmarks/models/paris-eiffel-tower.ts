/**
 * The Eiffel Tower, 330 m: four curved iron legs on stone piers, 125 m apart at the ground, the
 * great decorative arches between them under the first floor (57.6 m), the legs closing in to the
 * second floor (115.7 m), the tapering shaft to the third floor (276 m), the campanile and the
 * antenna mast. Faceted, the iron in Contour dark iron with gilt fascias; the lattice is read from
 * the leg ribs and cross-bracing. The first and second floor galleries light warm from dusk (a
 * plain glow: no night light show, no sparkle — the rights note in launch-cities.csv).
 *
 * Model frame (types.ts): origin on the ground at the tower's centre; the faces are square to the
 * axes, the front (local -z) toward the Champ de Mars (south-east), +x toward the Seine side's
 * south-west. Sizes from the OpenStreetMap building parts (2026-11).
 */
import { Kit, LANDMARK_COLOURS as C, type Vec3 } from '../kit';
import type { LandmarkModel } from '../types';
import type { Color } from '../../world/palette';

/** The outer half-width of the iron (m) at height y: the legs' outer edges, then the shaft's. */
const OUTER: [number, number][] = [[0, 61.5], [14, 54.5], [28, 48], [42, 42], [57.6, 36.5], [76, 29.5], [96, 23.5], [115.7, 18.4], [140, 13.4], [170, 10], [205, 7.8], [240, 6.3], [276, 5.4]];
/** A leg's width (m) at height y, up to the second floor where the four legs close up. */
const LEG: [number, number][] = [[0, 24], [57.6, 15.5], [115.7, 9.5]];

/** The tower's paint: a calm bronze-brown, the deeper Contour clay roof. */
const IRON: Color = C.bronze;

const F1 = 57.6;
const F2 = 115.7;
const F3 = 276.1;

function lerpTable(t: [number, number][], y: number): number {
  for (let i = 1; i < t.length; i++) {
    if (y <= t[i][0]) {
      const [y0, v0] = t[i - 1], [y1, v1] = t[i];
      return v0 + ((v1 - v0) * (y - y0)) / (y1 - y0);
    }
  }
  return t[t.length - 1][1];
}
const outer = (y: number) => lerpTable(OUTER, y);
const inner = (y: number) => outer(y) - lerpTable(LEG, y);

/**
 * A square tube between heights y0 and y1 whose section at y is [a(y), b(y)] in both x and z
 * (scaled by sx, sz to put it on a corner): its four sides, no caps.
 */
function tube(k: Kit, colour: Color, sx: number, sz: number, y0: number, y1: number, a: (y: number) => number, b: (y: number) => number): void {
  const p = (u: number, v: number, y: number): Vec3 => [sx * u, y, sz * v];
  const a0 = a(y0), a1 = a(y1), b0 = b(y0), b1 = b(y1);
  // outer x side, outer z side, inner x side, inner z side (wound by the facing hint)
  k.quad('plain', colour, p(b0, a0, y0), p(b0, b0, y0), p(b1, b1, y1), p(b1, a1, y1), [sx, 0.25, 0]);
  k.quad('plain', colour, p(a0, b0, y0), p(b0, b0, y0), p(b1, b1, y1), p(a1, b1, y1), [0, 0.25, sz]);
  k.quad('plain', colour, p(a0, a0, y0), p(a0, b0, y0), p(a1, b1, y1), p(a1, a1, y1), [-sx, 0, 0]);
  k.quad('plain', colour, p(a0, a0, y0), p(b0, a0, y0), p(b1, a1, y1), p(a1, a1, y1), [0, 0, -sz]);
}

/** The heights the legs and shaft are cut at (more where they curve). */
const LEG_YS = [0, 10, 20, 30, 40, 50, F1, 70, 85, 100, F2];
const SHAFT_YS = [F2, 128, 140, 155, 170, 187, 205, 240, F3];

/** The decorative arch on one face (the -z face of the current frame), under the first floor. */
function arch(k: Kit): void {
  const spring = 17, apex = 45, X = inner(spring) + 0.5, n = 12, band = 2.8;
  for (let i = 0; i < n; i++) {
    const pts = [i, i + 1].map((j) => {
      const phi = Math.PI - (j * Math.PI) / n;
      const x = X * Math.cos(phi), y = spring + (apex - spring) * Math.sin(phi);
      const z = -outer(y) + 1.5;
      return { x, y, z, nx: Math.cos(phi), ny: Math.sin(phi) };
    });
    const [A, B] = pts;
    const lo = (q: typeof A, dz: number): Vec3 => [q.x, q.y, q.z + dz];
    const hi = (q: typeof A, dz: number): Vec3 => [q.x + q.nx * band * 0.4, q.y + band, q.z + dz];
    k.quad('plain', C.iron, lo(A, 0), lo(B, 0), hi(B, 0), hi(A, 0), [0, 0, -1]);
    k.quad('plain', C.iron, lo(A, 2), hi(A, 2), hi(B, 2), lo(B, 2), [0, 0, 1]);
    k.quad('plain', C.iron, lo(A, 0), lo(A, 2), lo(B, 2), lo(B, 0), [-(A.nx + B.nx), -(A.ny + B.ny), 0]);
    k.quad('plain', C.iron, hi(A, 0), hi(B, 0), hi(B, 2), hi(A, 2), [A.nx + B.nx, A.ny + B.ny, 0]);
  }
}

/** Cross-bracing on a leg's two outer sides: a darker X in each storey, standing just proud. */
function bracing(k: Kit, sx: number, sz: number): void {
  for (let i = 0; i + 1 < LEG_YS.length; i++) {
    const y0 = LEG_YS[i], y1 = LEG_YS[i + 1];
    if (y0 >= F1 - 1 && y0 < F1 + 1) continue;
    for (const side of [0, 1]) {
      const pt = (along: number, y: number, t: number): Vec3 => {
        const o = outer(y) + 0.35, inn = inner(y);
        const u = inn + (o - 0.35 - inn) * along;
        return side === 0 ? [sx * o, y, sz * (u + t)] : [sx * (u + t), y, sz * o];
      };
      const h: Vec3 = side === 0 ? [sx, 0.2, 0] : [0, 0.2, sz];
      const w = 0.9;
      k.quad('plain', C.iron, pt(0.06, y0, 0), pt(0.06, y0, w), pt(0.94, y1, w), pt(0.94, y1, 0), h);
      k.quad('plain', C.iron, pt(0.94, y0, -w), pt(0.94, y0, 0), pt(0.06, y1, 0), pt(0.06, y1, -w), h);
    }
  }
}

export const model: LandmarkModel = {
  build() {
    const k = new Kit();
    // the paved square under the tower, and a stone pier under each leg
    k.box('plain', C.stoneDeep, 0, -4, 0, 123, 4.15, 123, { topColour: C.paving });
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      k.box('plain', C.stone, sx * 49.5, -3, sz * 49.5, 24, 7, 24, { topColour: C.stoneDeep });
      // the leg: from its pier to the second floor
      for (let i = 0; i + 1 < LEG_YS.length; i++) tube(k, IRON, sx, sz, LEG_YS[i], LEG_YS[i + 1], inner, outer);
      bracing(k, sx, sz);
    }
    // the shaft, second to third floor
    for (let i = 0; i + 1 < SHAFT_YS.length; i++) {
      const y0 = SHAFT_YS[i], y1 = SHAFT_YS[i + 1];
      tube(k, IRON, 1, 1, y0, y1, (y) => -outer(y), outer);
    }
    // the shaft's lattice: an X up each face, storey by storey
    for (let f = 0; f < 4; f++) {
      k.push(0, 0, 0, f * 90);
      for (let i = 0; i + 1 < SHAFT_YS.length; i++) {
        const y0 = SHAFT_YS[i], y1 = SHAFT_YS[i + 1];
        const o0 = outer(y0) + 0.3, o1 = outer(y1) + 0.3, w = 0.8;
        k.quad('plain', C.iron, [-o0 * 0.9, y0, -o0], [-o0 * 0.9 + w, y0, -o0], [o1 * 0.9, y1, -o1], [o1 * 0.9 - w, y1, -o1], [0, 0.1, -1]);
        k.quad('plain', C.iron, [o0 * 0.9 - w, y0, -o0], [o0 * 0.9, y0, -o0], [-o1 * 0.9 + w, y1, -o1], [-o1 * 0.9, y1, -o1], [0, 0.1, -1]);
      }
      arch(k);
      k.pop();
    }
    // first floor: the girder fascia, the galleries (lit from dusk), the balustrade
    k.box('plain', C.iron, 0, F1 - 2.6, 0, 75.4, 3.2, 75.4, { bottom: true });
    k.box('plain', C.gilt, 0, F1 - 2.2, 0, 76, 1.2, 76, { top: false });
    for (let f = 0; f < 4; f++) {
      k.push(0, 0, 0, f * 90);
      k.box('glow', C.chalkShade, 0, F1 + 0.6, -33.5, 44, 5.4, 7, { top: false });
      k.box('plain', C.iron, 0, F1 + 6, -33.5, 46, 0.8, 8);
      k.pop();
    }
    // second floor
    k.box('plain', C.iron, 0, F2 - 2.4, 0, 38, 3, 38, { bottom: true });
    k.box('glow', C.chalkShade, 0, F2 + 0.6, 0, 34, 4, 34, { top: false });
    k.box('plain', C.iron, 0, F2 + 4.6, 0, 36, 0.8, 36);
    // third floor, the campanile and the mast
    k.box('plain', C.iron, 0, F3 - 1.5, 0, 17, 2, 17, { bottom: true });
    k.box('glow', C.chalkShade, 0, F3 + 0.5, 0, 13, 4.5, 13, { top: false });
    k.box('plain', C.iron, 0, F3 + 5, 0, 15, 0.8, 15);
    k.prism('plain', C.iron, 0, F3 + 5.8, 0, 5.2, 12, 8, { r1: 3.6 });
    k.prism('plain', C.gilt, 0, F3 + 17.8, 0, 3.6, 4, 8, { r1: 2.2 });
    k.spire('plain', C.iron, 0, F3 + 21.8, 0, 2.2, 3, 8);
    k.prism('plain', C.slate, 0, 300, 0, 1.4, 24, 6, { r1: 0.6 });
    k.prism('plain', C.slate, 0, 324, 0, 0.5, 6, 4, { r1: 0.15 });
    return k.group('paris-eiffel-tower');
  },
};
