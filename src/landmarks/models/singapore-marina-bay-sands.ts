/**
 * Marina Bay Sands: three 55-storey hotel towers, 194 m, on a gentle arc, each two legs side by
 * side (the back leg straight, the bay-side leg sweeping out at its foot), the low lobbies between
 * them, and across their tops the SkyPark: a 340 m deck like a long boat, with its garden, the
 * infinity pool along the bay side and the cantilever reaching about 50 m past the north tower (as
 * OSM draws the deck). The deck's edge lights from dusk. Faceted, Contour colours.
 *
 * The plan (towers, lobbies, the SkyPark and its pool) from OpenStreetMap (2026-11). Model frame
 * (types.ts): origin at the hero point by the middle tower, front (local -z) to the bay, west-north-
 * west; +x along the row to the north tower and the cantilever.
 */
import { Kit, LANDMARK_COLOURS as C } from '../kit';
import type { Color } from '../../world/palette';
import type { LandmarkBucket, LandmarkModel } from '../types';

type P3 = [number, number, number];

/** Contour's shallow water (CONTOUR.waterShallow): the pool. */
const POOL: Color = '#8fd3cf';
/** Contour's sage (CONTOUR.land[3]): the SkyPark's garden. */
const GARDEN: Color = '#88b06c';

/** Tower roofs, under the deck (m). */
const TOP = 191;
/** Each tower: centre (x, z) and its turn along the arc (degrees). */
const TOWERS: [number, number, number][] = [[-129, -8, 10.8], [-12.6, 2.1, 0], [89.9, -9.8, -8.3]];
/** Tower width along the row (m). */
const TW = 56;

/** The SkyPark's plan: stations along x, each its centre z and half width (from OSM). */
const DECK: [number, number, number][] = [
  [-173, -14, 6], [-166, -14, 14], [-150, -14, 19], [-90, -1.8, 19], [-30, 4.2, 19.3], [30, 3.9, 19.7],
  [90, -3.5, 18.5], [135, -12.2, 15.5], [155, -18, 12], [164, -20.5, 7], [168, -21, 2],
];

/**
 * A strip of quads between stations: each station gives two points (front edge, back edge) at a
 * height; `h` the hint for which side is out.
 */
function strip(k: Kit, b: LandmarkBucket, colour: Color, pts: [P3, P3][], h: (a: P3, c: P3) => P3): void {
  for (let i = 0; i + 1 < pts.length; i++) {
    const [a, d] = pts[i], [bb, c] = pts[i + 1];
    k.quad(b, colour, a, bb, c, d, h(a, c));
  }
}

/** One tower in its own frame (centred, front -z): the bay-side leg sweeping out, the straight back leg. */
function tower(k: Kit): void {
  const w = TW / 2;
  // the bay-side leg: its front face curves out toward the foot; [y, front z, back z]
  const leg: [number, number, number][] = [[-3, -25, -8], [25, -18, -3], [60, -12.5, 1], [110, -8.5, 4], [TOP, -6, 6]];
  const frontAt = (y: number) => {
    let i = 0;
    while (i + 2 < leg.length && leg[i + 1][0] < y) i++;
    const [y0, f0] = leg[i], [y1, f1] = leg[i + 1];
    return f0 + ((f1 - f0) * (y - y0)) / (y1 - y0);
  };
  for (let i = 0; i + 1 < leg.length; i++) {
    const [y0, f0, b0] = leg[i], [y1, f1, b1] = leg[i + 1];
    k.quad('walls', C.chalk, [-w, y0, f0], [w, y0, f0], [w, y1, f1], [-w, y1, f1], [0, f1 - f0, -(y1 - y0)]);
    k.quad('plain', C.chalkShade, [w, y0, b0], [-w, y0, b0], [-w, y1, b1], [w, y1, b1], [0, 0, 1]);
    for (const s of [-1, 1]) k.quad('walls', C.chalkShade, [s * w, y0, f0], [s * w, y0, b0], [s * w, y1, b1], [s * w, y1, f1], [s, 0, 0]);
  }
  // the back leg, straight up
  k.box('walls', C.chalkShade, 0, -3, 16, TW, TOP + 3, 16);
  // the glazed slot between the legs, dark, and bands of floors across the bay face
  k.box('plain', C.iron, 0, -3, 6.5, TW - 2, TOP + 2, 3, { top: false });
  for (const y of [45, 95, 145]) k.box('plain', C.slate, 0, y, frontAt(y) - 0.3, TW + 0.4, 1.2, 1.2, { top: false });
}

export const model: LandmarkModel = {
  build() {
    const k = new Kit();
    // the lobbies between the towers
    k.box('walls', C.chalkShade, -70, -3, 0, 54, 21, 46);
    k.box('walls', C.chalkShade, 40, -3, -5, 46, 16, 32);
    for (const [x, z, turn] of TOWERS) {
      k.push(x, 0, z, turn);
      tower(k);
      k.pop();
    }
    // the SkyPark: its underside sweeps up toward the ends like a hull
    const under = (i: number) => {
      const x = DECK[i][0];
      return TOP - 3 + Math.min(6, Math.max(0, (Math.abs(x) - 110) / 10));
    };
    const deckY = TOP + 8;
    const front = DECK.map(([x, zc, hw], i): [P3, P3] => [[x, under(i), zc - hw], [x, deckY, zc - hw]]);
    const back = DECK.map(([x, zc, hw], i): [P3, P3] => [[x, deckY, zc + hw], [x, under(i), zc + hw]]);
    strip(k, 'plain', C.chalk, front, () => [0, 0, -1]);
    strip(k, 'plain', C.chalkShade, back, () => [0, 0, 1]);
    strip(k, 'plain', C.slate, DECK.map(([x, zc, hw], i): [P3, P3] => [[x, under(i), zc + hw], [x, under(i), zc - hw]]), () => [0, -1, 0]);
    strip(k, 'plain', GARDEN, DECK.map(([x, zc, hw]): [P3, P3] => [[x, deckY, zc - hw], [x, deckY, zc + hw]]), () => [0, 1, 0]);
    // the ends
    for (const i of [0, DECK.length - 1]) {
      const [x0, z0, h0] = DECK[i];
      k.quad('plain', C.chalkShade, [x0, under(i), z0 + h0], [x0, under(i), z0 - h0], [x0, deckY, z0 - h0], [x0, deckY, z0 + h0], [Math.sign(x0), 0, 0]);
    }
    // the lit band along both edges of the deck (glow from dusk)
    strip(k, 'glow', C.chalk, DECK.map(([x, zc, hw], i): [P3, P3] => [[x, under(i) + 0.2, zc - hw - 0.15], [x, under(i) + 1.4, zc - hw - 0.15]]), () => [0, 0, -1]);
    strip(k, 'glow', C.chalk, DECK.map(([x, zc, hw], i): [P3, P3] => [[x, under(i) + 1.4, zc + hw + 0.15], [x, under(i) + 0.2, zc + hw + 0.15]]), () => [0, 0, 1]);
    // the infinity pool along the bay side, over the south and middle towers, and its deck
    const pool = DECK.filter(([x]) => x >= -150 && x <= 90);
    strip(k, 'plain', POOL, pool.map(([x, zc, hw]): [P3, P3] => [[x, deckY + 0.3, zc - hw + 0.5], [x, deckY + 0.3, zc - hw + 12]]), () => [0, 1, 0]);
    strip(k, 'plain', C.paving, pool.map(([x, zc, hw]): [P3, P3] => [[x, deckY + 0.3, zc - hw + 12], [x, deckY + 0.3, zc - hw + 16]]), () => [0, 1, 0]);
    // pavilions on the garden, one over each tower
    for (const [x, z] of TOWERS) {
      k.box('plain', C.chalk, x, deckY, z + 8, 26, 4, 10, { topColour: C.slate });
      k.prism('plain', GARDEN, x - 18, deckY, z + 12, 3, 5, 5, { r1: 0 });
      k.prism('plain', GARDEN, x + 18, deckY, z + 12, 3, 5, 5, { r1: 0 });
    }
    return k.group('singapore-marina-bay-sands');
  },
};
