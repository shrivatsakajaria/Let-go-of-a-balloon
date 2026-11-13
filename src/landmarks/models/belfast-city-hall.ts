/**
 * Belfast City Hall (1906), Portland stone round a quadrangle 95 by 74 m: three-storey ranges under
 * hipped roofs, a domed tower at each corner, the porte-cochere with its pediment on the north
 * front, and over the north range the great copper dome on its colonnaded drum, 53 m to the top of
 * the lantern. Heights from the OpenStreetMap building parts (2026-11). Copper is the Contour pale
 * verdigris (waterShallow), the one cool note; everything else is chalk stone and slate.
 *
 * Model frame (types.ts): origin on the ground at the middle of the quadrangle, front (local -z)
 * north to Donegall Place; +x is east.
 */
import { Kit, LANDMARK_COLOURS as C } from '../kit';
import type { LandmarkModel } from '../types';
import type { Color } from '../../world/palette';

/** The great dome's axis (over the north range), model frame. */
const DOME_Z = -17;

/** A dome of `rings` frustums from radius r at y0 to a point h above, n-sided (a quarter-circle profile). */
function dome(k: Kit, colour: Color, cx: number, y0: number, cz: number, r: number, h: number, n: number, rings: number): void {
  let pr = r, py = y0;
  for (let i = 1; i <= rings; i++) {
    const a = (i / rings) * (Math.PI / 2);
    const nr = r * Math.cos(a), ny = y0 + h * Math.sin(a);
    if (i === rings) k.spire('plain', colour, cx, py, cz, pr, ny - py, n);
    else k.prism('plain', colour, cx, py, cz, pr, ny - py, n, { r1: nr, top: false });
    pr = nr;
    py = ny;
  }
}

/** A range of the quadrangle: walls (windowed) to the cornice at `eaves`, a hipped slate roof. */
function range(k: Kit, cx: number, cz: number, w: number, d: number, eaves: number, roofH: number): void {
  k.box('walls', C.chalk, cx, -3, cz, w, eaves + 3, d, { top: false });
  k.box('plain', C.chalkShade, cx, eaves, cz, w + 0.8, 0.8, d + 0.8);
  if (w >= d) {
    k.push(cx, eaves + 0.8, cz, 90);
    k.gable('plain', C.slate, 0, 0, 0, d, w, roofH, { hip: roofH * 1.2 });
  } else {
    k.push(cx, eaves + 0.8, cz);
    k.gable('plain', C.slate, 0, 0, 0, w, d, roofH, { hip: roofH * 1.2 });
  }
  k.pop();
}

/** A corner tower: a square stone stage, an octagonal colonnaded drum, a copper cupola and lantern. */
function cornerTower(k: Kit, x: number, z: number): void {
  k.box('walls', C.chalk, x, -3, z, 9.4, 21, 9.4, { top: false });
  k.box('plain', C.chalkShade, x, 18, z, 10.2, 0.9, 10.2);
  k.box('plain', C.chalk, x, 18.9, z, 9, 1.1, 9, { topColour: C.paving });
  k.prism('plain', C.chalk, x, 20, z, 3.9, 6, 8, { rot: 22.5 });
  // paired columns round the drum: dark openings between them read as a colonnade
  for (let i = 0; i < 8; i++) {
    k.push(x, 0, z, i * 45 + 22.5);
    k.box('plain', C.stoneDeep, 0, 20.6, -3.62, 1.4, 4.4, 0.2, { top: false });
    k.pop();
  }
  k.prism('plain', C.chalkShade, x, 26, z, 4.3, 0.7, 8, { rot: 22.5 });
  dome(k, C.copper, x, 26.7, z, 3.9, 5.6, 8, 3);
  k.prism('plain', C.chalk, x, 31.6, z, 0.9, 2.0, 6);
  k.spire('plain', C.copper, x, 33.6, z, 1.1, 1.4, 6);
  k.prism('plain', C.gilt, x, 35, z, 0.12, 1.2, 4);
}

export const model: LandmarkModel = {
  build() {
    const k = new Kit();
    // ---- the quadrangle: north range (the front), east and west ranges, south range ----
    range(k, 0, -26, 74, 17, 18, 4.5);
    range(k, -41.5, 0, 11, 52, 16, 3.5);
    range(k, 41.5, 0, 11, 52, 16, 3.5);
    range(k, 0, 31, 74, 10, 15, 3.2);
    // the quadrangle's paved courtyard
    k.box('plain', C.paving, 0, -3, 4.25, 72, 3.15, 43.5);
    // ---- the four corner towers ----
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) cornerTower(k, sx * 41.5, sz * 30.5);

    // ---- the porte-cochere: a projecting block, columns, pediment, two little domed turrets ----
    k.box('walls', C.chalk, 0, -3, -36, 20, 20.5, 11, { top: false });
    k.box('plain', C.chalkShade, 0, 17.5, -36, 20.8, 0.8, 11.8);
    k.push(0, 18.3, -36);
    k.gable('plain', C.slate, 0, 0, 0, 20.8, 11.8, 4.6, { ends: C.chalk });
    k.pop();
    // the carriage arch and the columns before it
    k.box('plain', C.iron, 0, 0, -41.6, 7, 6.5, 0.2, { top: false });
    k.box('plain', C.stoneDeep, 0, 0, -41.5, 13, 1.2, 1.4);
    for (const x of [-6.3, -4.2, 4.2, 6.3]) {
      k.prism('plain', C.chalk, x, 1.2, -42.1, 0.55, 14, 8);
      k.box('plain', C.chalkShade, x, 15.2, -42.1, 1.4, 0.7, 1.4);
    }
    k.box('plain', C.chalk, 0, 15.9, -42.1, 14, 1.6, 1.6);
    for (const x of [-8.6, 8.6]) {
      k.prism('plain', C.chalk, x, 18.3, -40.4, 1.5, 3.4, 8, { rot: 22.5 });
      dome(k, C.copper, x, 21.7, -40.4, 1.5, 2.2, 8, 2);
      k.prism('plain', C.gilt, x, 23.9, -40.4, 0.1, 0.9, 4);
    }

    // ---- the great dome: square base, colonnaded drum, attic, dome, lantern, finial ----
    k.box('walls', C.chalk, 0, -3, DOME_Z, 17.4, 25.4, 17.4, { top: false });
    k.box('plain', C.chalkShade, 0, 22.4, DOME_Z, 18.4, 0.8, 18.4, { topColour: C.paving });
    k.prism('plain', C.chalkShade, 0, 23.2, DOME_Z, 8.9, 1.2, 16);
    k.prism('walls', C.chalk, 0, 24.4, DOME_Z, 8.0, 6.8, 16, { top: false });
    // the drum's ring of columns, standing proud of the windowed wall
    for (let i = 0; i < 16; i++) {
      const a = ((i + 0.5) / 16) * 2 * Math.PI;
      k.prism('plain', C.chalk, Math.sin(a) * 8.55, 24.4, DOME_Z - Math.cos(a) * 8.55, 0.42, 6.4, 6);
    }
    k.prism('plain', C.chalkShade, 0, 30.8, DOME_Z, 9.1, 1.0, 16);
    k.prism('plain', C.chalk, 0, 31.8, DOME_Z, 7.8, 1.6, 16, { top: false });
    dome(k, C.copper, 0, 33.4, DOME_Z, 7.6, 10.2, 16, 5);
    // the lantern: a colonnaded drum (lit from dusk), its own copper cap, the finial
    k.prism('plain', C.chalkShade, 0, 42.6, DOME_Z, 2.3, 0.6, 8, { rot: 22.5 });
    k.prism('glow', C.chalk, 0, 43.2, DOME_Z, 1.75, 3.6, 8, { rot: 22.5, top: false });
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * 2 * Math.PI;
      k.prism('plain', C.chalk, Math.sin(a) * 1.95, 43.2, DOME_Z - Math.cos(a) * 1.95, 0.25, 3.6, 4);
    }
    k.prism('plain', C.chalkShade, 0, 46.8, DOME_Z, 2.3, 0.5, 8, { rot: 22.5 });
    dome(k, C.copper, 0, 47.3, DOME_Z, 2.1, 2.6, 8, 2);
    k.prism('plain', C.gilt, 0, 49.9, DOME_Z, 0.35, 0.5, 6, { r1: 0.35 });
    k.spire('plain', C.gilt, 0, 50.4, DOME_Z, 0.3, 2.6, 4);
    return k.group('belfast-city-hall');
  },
};
