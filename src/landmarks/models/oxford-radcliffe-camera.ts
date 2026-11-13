/**
 * The Radcliffe Camera (James Gibbs, 1749), Radcliffe Square: a round library about 31 m across and
 * 43 m to its finial. A sixteen-sided rusticated base with arched openings; the main storey ringed by
 * paired columns with tall windows and niches between them, under an entablature and a balustrade
 * with urns; then the buttressed drum, the ribbed lead dome and the lantern. Faceted honey limestone
 * and grey lead, Contour colours. The main storey's windows are in the glow bucket: the reading room
 * lights from dusk.
 *
 * Model frame (types.ts): origin on the ground at the centre of the drum, front (local -z) the
 * north side with its outside stair (OSM way 1259054048).
 */
import { Kit, LANDMARK_COLOURS as C } from '../kit';
import type { LandmarkModel } from '../types';

/** Sixteen sides all the way up. */
const N = 16;
const STEP = 360 / N;
/** Apothem of a 16-gon of circumradius r (the distance to the middle of a face). */
const ap = (r: number) => r * Math.cos(Math.PI / N);
/** Half a face's width. */
const half = (r: number) => r * Math.sin(Math.PI / N);

/** Base storey (rusticated): radius, top. */
const R0 = 15.8;
const Y0 = 8.5;
/** Main storey: radius, foot and top. */
const R1 = 15.0;
const Y1 = 9.1;
const Y2 = 21.5;
/** Balustrade top; the drum's radius and top. */
const Y3 = 24.0;
const RD = 10.0;
const YD = 29.0;
/** The dome: its foot, rise, and where the lantern stands. */
const YDOME = 29.6;
const RISE = 8.6;

/** An opening on the -z face at depth z: a w by h panel with a round (faceted) head. */
function opening(k: Kit, b: 'plain' | 'glow', colour: string, x: number, y: number, w: number, h: number, z: number): void {
  const a = x - w / 2, c = x + w / 2, r = w / 2;
  k.quad(b, colour, [a, y, z], [c, y, z], [c, y + h, z], [a, y + h, z], [0, 0, -1]);
  // the head: a half-octagon
  for (let i = 0; i < 4; i++) {
    const t0 = (Math.PI * i) / 4, t1 = (Math.PI * (i + 1)) / 4;
    k.tri(b, colour, x, y + h, z, x - r * Math.cos(t0), y + h + r * Math.sin(t0), z, x - r * Math.cos(t1), y + h + r * Math.sin(t1), z, 0, 0, -1);
  }
}

/** One bay of the rotunda (the -z face of the current frame); `i` picks windows or niches. */
function bay(k: Kit, i: number): void {
  // base: an arched opening in every face, the larger ones alternating
  // proud of the rustication bands
  const z0 = -ap(R0 + 0.12) - 0.04;
  if (i % 2 === 0) opening(k, 'plain', C.iron, 0, 0.6, 3.0, 4.4, z0);
  else opening(k, 'plain', C.stoneDeep, 0, 1.6, 2.0, 3.4, z0);
  // main storey: a tall window or a niche between paired columns
  const z1 = -ap(R1) - 0.03;
  if (i % 2 === 0) opening(k, 'glow', C.iron, 0, 11.2, 2.4, 6.6, z1);
  else {
    opening(k, 'plain', C.stoneDeep, 0, 12.2, 1.8, 4.6, z1);
    k.box('plain', C.iron, 0, 18.9, z1, 1.6, 1.1, 0.06, { top: false });
  }
  // the paired columns at this face's two corners (each corner gets one from either face)
  const hx = half(R1);
  for (const s of [-1, 1]) {
    k.prism('plain', C.chalk, s * (hx - 0.55), Y1, -ap(R1) - 0.35, 0.42, Y2 - Y1, 6, { top: false });
    k.box('plain', C.chalkShade, s * (hx - 0.55), Y1 - 0.1, -ap(R1) - 0.35, 1.0, 0.5, 1.0, { top: false });
  }
  // an urn on the balustrade over each corner pair
  k.push(0, 0, 0, STEP / 2);
  k.prism('plain', C.chalkShade, 0, Y3, -R1 + 0.2, 0.35, 0.6, 6, { r1: 0.5, top: false });
  k.spire('plain', C.chalkShade, 0, Y3 + 0.6, -R1 + 0.2, 0.5, 0.9, 6);
  k.pop();
}

/** The dome's profile (radius, height), foot to the lantern's ring. */
const DOME: [number, number][] = [0, 18, 36, 54, 72].map((deg) => {
  const t = (deg * Math.PI) / 180;
  return [RD * Math.cos(t), YDOME + RISE * Math.sin(t)];
});

export const model: LandmarkModel = {
  build() {
    const k = new Kit();
    // the rusticated base, its bands, and the cornice under the main storey
    k.prism('plain', C.stone, 0, -3, 0, R0, Y0 + 3, N, { top: false });
    for (const y of [2.6, 5.4]) k.prism('plain', C.stoneDeep, 0, y, 0, R0 + 0.12, 0.3, N, { top: false });
    k.prism('plain', C.chalk, 0, Y0, 0, R0 + 0.3, Y1 - Y0, N, { topColour: C.paving });
    // the main storey, the entablature, the balustrade (and the roof walk behind it)
    k.prism('plain', C.chalkShade, 0, Y1, 0, R1, Y2 - Y1, N, { top: false });
    k.prism('plain', C.chalk, 0, Y2, 0, R1 + 0.9, 1.3, N, { topColour: C.paving });
    k.prism('plain', C.chalkShade, 0, Y2 + 1.3, 0, R1 + 0.5, Y3 - Y2 - 1.3, N, { top: false });
    k.prism('plain', C.chalk, 0, Y3 - 0.25, 0, R1 + 0.6, 0.25, N, { top: false });
    // the north stair
    k.box('plain', C.stoneDeep, 0, -2, -ap(R0) - 1.2, 5.6, 2.8, 2.4, { topColour: C.paving });
    for (let i = 0; i < N; i++) {
      k.push(0, 0, 0, i * STEP);
      bay(k, i);
      k.pop();
    }
    // the drum, its windows and buttresses, its cornice
    k.prism('plain', C.stone, 0, Y2, 0, RD, YD - Y2, N, { top: false });
    k.prism('plain', C.chalk, 0, YD, 0, RD + 0.5, YDOME - YD, N, { topColour: C.slate });
    for (let i = 0; i < N; i += 2) {
      k.push(0, 0, 0, i * STEP);
      opening(k, 'plain', C.iron, 0, 25.0, 1.5, 2.2, -ap(RD) - 0.03);
      k.pop();
      k.push(0, 0, 0, (i + 1) * STEP + STEP / 2);
      k.box('plain', C.chalkShade, 0, Y3 - 0.3, -RD - 0.4, 0.9, YD - Y3, 1.6, { taper: 0.75 });
      k.pop();
    }
    // the ribbed lead dome
    for (let j = 0; j < DOME.length - 1; j++) {
      const [r0, y0] = DOME[j], [r1, y1] = DOME[j + 1];
      k.prism('plain', C.slate, 0, y0, 0, r0, y1 - y0, N, { r1, top: j === DOME.length - 2 });
    }
    for (let i = 0; i < N; i++) {
      k.push(0, 0, 0, i * STEP + STEP / 2);
      for (let j = 0; j < DOME.length - 1; j++) {
        const [r0, y0] = DOME[j], [r1, y1] = DOME[j + 1];
        const a = -r0 - 0.1, b = -r1 - 0.1, w = 0.28;
        k.quad('plain', C.iron, [-w, y0, a], [w, y0, a], [w, y1, b], [-w, y1, b], [0, r0 - r1, -(y1 - y0)]);
      }
      k.pop();
    }
    // the lantern: plinth, eight bays with dark openings, cornice, its small dome and the finial
    const yl = DOME[DOME.length - 1][1];
    k.prism('plain', C.chalk, 0, yl - 0.2, 0, 2.7, 0.6, 8);
    k.prism('plain', C.chalkShade, 0, yl + 0.4, 0, 2.0, 2.9, 8, { top: false });
    for (let i = 0; i < 8; i++) {
      k.push(0, 0, 0, i * 45);
      opening(k, 'plain', C.iron, 0, yl + 0.8, 0.8, 1.5, -2.0 * Math.cos(Math.PI / 8) - 0.02);
      k.pop();
    }
    k.prism('plain', C.chalk, 0, yl + 3.3, 0, 2.35, 0.35, 8);
    k.prism('plain', C.slate, 0, yl + 3.65, 0, 2.0, 0.6, 8, { r1: 1.5, top: false });
    k.spire('plain', C.slate, 0, yl + 4.25, 0, 1.5, 1.1, 8);
    k.prism('plain', C.gilt, 0, yl + 5.2, 0, 0.3, 0.5, 6);
    k.spire('plain', C.gilt, 0, yl + 5.7, 0, 0.15, 0.8, 4);
    return k.group('oxford-radcliffe-camera');
  },
};
