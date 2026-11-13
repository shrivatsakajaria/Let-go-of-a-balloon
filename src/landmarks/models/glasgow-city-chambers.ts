/**
 * Glasgow City Chambers (William Young, 1888): a four-storey honey sandstone quadrangle round a
 * courtyard, with a domed pavilion at each corner, the front's frontispiece (the triple-arched
 * entrance, columns and the great sculpted pediment) and, behind it, the 69 m tower: a square
 * shaft, a columned belfry stage, an octagonal drum and a lead dome with its lantern.
 * Faceted pale stone and slate, Contour colours.
 *
 * Model frame (types.ts): origin on the ground in the middle of the quadrangle, the front
 * (George Square, bearing 281 deg) toward -z. Sizes from OpenStreetMap: 73 m along the front,
 * 75 m deep; corner domes 30 m, the tower 69 m.
 */
import { Kit, LANDMARK_COLOURS as C } from '../kit';
import type { LandmarkModel } from '../types';

/** Half the front's length and half the depth, m. */
const HX = 36.5;
const HZ = 37.5;
/** Ranges: depth, eaves (top of the balustrade) height. */
const RANGE = 15;
const EAVES = 22;
/** The tower's centre: 15 m behind the front. */
const TZ = -22.5;

/** A corner pavilion of side s at (x, z): stone to h, then a square lead dome with a lantern. */
function pavilion(k: Kit, x: number, z: number, s: number, h: number): void {
  k.box('walls', C.stone, x, -4, z, s, h + 4, s, { top: false });
  k.box('plain', C.chalk, x, h, z, s + 0.8, 0.9, s + 0.8, { topColour: C.paving });
  // the dome: square frustums swelling then closing (an ogee in four facets)
  const r = (s / 2) * Math.SQRT2 * 0.9;
  const y0 = h + 0.9;
  k.prism('plain', C.slate, x, y0, z, r, 1.6, 4, { r1: r * 0.92, rot: 45, top: false });
  k.prism('plain', C.slate, x, y0 + 1.6, z, r * 0.92, 2.2, 4, { r1: r * 0.55, rot: 45, top: false });
  k.prism('plain', C.slate, x, y0 + 3.8, z, r * 0.55, 1.4, 4, { r1: r * 0.12, rot: 45 });
  k.prism('plain', C.chalkShade, x, y0 + 5.2, z, 0.8, 1.8, 6);
  k.spire('plain', C.gilt, x, y0 + 7, z, 0.9, 1.6, 6);
}

export const model: LandmarkModel = {
  build() {
    const k = new Kit();

    // ---- the four ranges round the courtyard, their balustrades and hipped slate roofs ----
    const ranges: [number, number, number, number][] = [
      [0, -HZ + RANGE / 2, 2 * HX, RANGE], // front
      [0, HZ - RANGE / 2, 2 * HX, RANGE], // back
      [-HX + RANGE / 2, 0, RANGE, 2 * HZ - 2 * RANGE], // left (south)
      [HX - RANGE / 2, 0, RANGE, 2 * HZ - 2 * RANGE], // right (north)
    ];
    for (const [x, z, w, d] of ranges) {
      k.box('walls', C.stone, x, -4, z, w, EAVES + 4, d, { top: false });
      k.box('plain', C.chalk, x, EAVES - 1.6, z, w + 0.8, 1.6, d + 0.8, { top: false });
      // the roof's ridge runs along the range: turn the kit's gable (ridge along z) for the front and back
      k.push(x, EAVES - 1.2, z, w > d ? 90 : 0);
      k.gable('plain', C.slate, 0, 0, 0, Math.min(w, d) - 1, Math.max(w, d) - 1, 4.5, { hip: 4 });
      k.pop();
    }

    // a cornice band between the ground floor and the piano nobile
    k.box('plain', C.chalkShade, 0, 7.5, -HZ, 2 * HX + 0.6, 0.7, 0.8, { top: false });

    // ---- the corner pavilions ----
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) pavilion(k, sx * (HX - 6), sz * (HZ - 6), 13, 26);

    // ---- the frontispiece: triple arches, columns, the pediment ----
    const FZ = -HZ - 2.5;
    k.box('walls', C.stone, 0, -4, FZ + 1.25, 20, 31, 2.5, { top: false, topColour: C.chalk });
    k.box('plain', C.chalk, 0, 26.6, FZ + 1.25, 21, 0.9, 3.1);
    k.push(0, 27.5, FZ + 1.4);
    k.gable('plain', C.chalk, 0, 0, 0, 21, 3.2, 5.6, { ends: C.chalk });
    k.pop();
    for (const x of [-5.4, 0, 5.4]) {
      k.box('plain', C.iron, x, 0, FZ - 0.05, 3.4, 5.2, 0.2, { top: false });
      k.push(x, 5.2, FZ - 0.05, 0);
      k.quad('plain', C.iron, [-1.7, 0, -0.1], [1.7, 0, -0.1], [0.9, 1.3, -0.1], [-0.9, 1.3, -0.1], [0, 0, -1]);
      k.pop();
    }
    for (const x of [-8.6, -3, 3, 8.6]) k.prism('plain', C.chalk, x, 8.2, FZ - 0.6, 0.65, 17, 8, { top: false });
    // the colonnades of the upper floors along the front, between frontispiece and pavilions
    for (const sx of [-1, 1]) for (const x of [12.5, 16, 19.5, 23]) k.prism('plain', C.chalk, sx * x, 8.2, -HZ - 0.45, 0.5, 11.6, 6, { top: false });
    for (const sx of [-1, 1]) k.box('plain', C.chalkShade, sx * 17.75, 19.8, -HZ - 0.3, 12, 0.7, 1.4);
    k.box('plain', C.chalkShade, 0, 7.5, FZ - 0.4, 20.6, 0.8, 2.2);

    // ---- the tower: shaft, cornice, columned belfry, octagonal drum, dome, lantern ----
    k.box('walls', C.stone, 0, EAVES - 2, TZ, 12, 21, 12, { top: false });
    k.box('plain', C.chalk, 0, 41, TZ, 13.4, 1.2, 13.4, { topColour: C.paving });
    k.box('plain', C.stoneDeep, 0, 42.2, TZ, 8.6, 10, 8.6, { top: false });
    for (let i = 0; i < 4; i++) {
      k.push(0, 0, TZ, i * 90);
      for (const o of [-3, 0, 3]) k.prism('plain', C.chalk, o, 42.2, -4.9, 0.45, 10, 6, { top: false });
      k.pop();
    }
    k.box('plain', C.chalk, 0, 52.2, TZ, 11.4, 1.1, 11.4, { topColour: C.paving });
    k.prism('plain', C.stone, 0, 53.3, TZ, 4.3, 4.4, 8, { top: false });
    k.prism('plain', C.chalk, 0, 57.7, TZ, 4.7, 0.6, 8, { top: false });
    k.prism('plain', C.slate, 0, 58.3, TZ, 4.5, 2.4, 8, { r1: 3.6, top: false });
    k.prism('plain', C.slate, 0, 60.7, TZ, 3.6, 1.8, 8, { r1: 1.5, top: false });
    k.prism('plain', C.chalkShade, 0, 62.5, TZ, 1.2, 3, 8, { r1: 1.0 });
    k.prism('plain', C.slate, 0, 65.5, TZ, 1.3, 1.2, 8, { r1: 0.3 });
    k.spire('plain', C.gilt, 0, 66.7, TZ, 0.35, 2.3, 4);

    return k.group('glasgow-city-chambers');
  },
};
