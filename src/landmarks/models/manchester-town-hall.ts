/**
 * Manchester Town Hall (Waterhouse, 1877): the 85 m clock tower in the middle of the Albert Square
 * front (a square shaft with corner buttresses, four dials under gabled hoods that light from dusk,
 * an octagonal belfry ringed by pinnacles and a tall stone spire with a gilt finial), the front
 * range with its row of steep gables, the corner pavilions under steep slate roofs, the Princess
 * Street corner tower, the long ranges down Princess Street and Lloyd Street that close the
 * triangle, the 57 m rear tower, the Great Hall's roof inside, and the stair turrets. Faceted
 * honey stone and slate, Contour colours.
 *
 * Model frame (types.ts): origin on the ground at the clock tower's centre, front (local -z) across
 * Albert Square, +x along the front toward Princess Street. Plan positions follow the OpenStreetMap
 * building parts (2026-11).
 */
import { Kit, LANDMARK_COLOURS as C } from '../kit';
import type { LandmarkModel } from '../types';
import type { Color, RegionStyle } from '../../world/palette';

const D2R = Math.PI / 180;
/** Everything stands on this (below the street, so slopes never show under it). */
const B = -4;
/** Half the clock tower's shaft, m. */
const S = 5.3;
const DIAL_Y = 46;
const DIAL_R = 2.5;

/** A range of building along the line a-b: walls `w` wide to `wall`, a slate roof `ridge` high. */
function wing(k: Kit, ax: number, az: number, bx: number, bz: number, w: number, wall: number, ridge: number, roof: Color): void {
  const dx = bx - ax, dz = bz - az;
  k.push((ax + bx) / 2, 0, (az + bz) / 2, Math.atan2(dx, -dz) / D2R);
  const len = Math.hypot(dx, dz);
  k.box('walls', C.stone, 0, B, 0, w, wall - B, len, { top: false });
  k.box('plain', C.chalkShade, 0, wall - 0.8, 0, w + 0.6, 0.8, len + 0.6, { top: false });
  k.gable('plain', roof, 0, wall, 0, w + 0.4, len + 0.4, ridge, { hip: 2, ends: roof });
  // buttress ribs between the bays, on both street faces
  for (let z = -len / 2 + 4; z < len / 2 - 2; z += 8) for (const x of [-w / 2 - 0.3, w / 2 + 0.3]) k.box('plain', C.stoneDeep, x, B, z, 0.6, wall - 1 - B, 0.8, { top: false });
  k.pop();
}

/** A square pinnacle: a shaft and a spirelet on (x, y, z). */
function pinnacle(k: Kit, x: number, y: number, z: number, r: number, shaft: number, tip: number): void {
  k.prism('plain', C.stone, x, y, z, r, shaft, 4, { rot: 45, top: false });
  k.spire('plain', C.chalkShade, x, y + shaft, z, r, tip, 4, 45);
}

/** A gable on the front range: its stone end flush with the facade at z, a pinnacle on its apex. */
function frontGable(k: Kit, x: number, z: number, roof: Color): void {
  k.box('walls', C.stone, x, 21, z + 2.5, 5.6, 2, 5, { top: false });
  k.gable('plain', roof, x, 23, z + 2.5, 5.6, 5, 6, { ends: C.stone, endsBucket: 'walls' });
  pinnacle(k, x, 28.6, z + 0.2, 0.35, 0.8, 1.6);
}

/** A corner pavilion: a taller block under a steep slate roof with an iron cresting finial. */
function pavilion(k: Kit, cx: number, cz: number, w: number, d: number, roof: Color): void {
  k.box('walls', C.stone, cx, B, cz, w, 26 - B, d, { top: false });
  k.box('plain', C.chalkShade, cx, 25.2, cz, w + 0.8, 0.8, d + 0.8, { top: false });
  k.pyramid('plain', roof, cx, 26, cz, w + 0.4, d + 0.4, 10);
  k.prism('plain', C.iron, cx, 35.5, cz, 0.2, 2.5, 4);
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) pinnacle(k, cx + (sx * w) / 2, 24, cz + (sz * d) / 2, 0.6, 3, 2.4);
}

/** The clock tower (its dials in the glow bucket). */
function clockTower(k: Kit): void {
  // the porch on the square, its gable toward it, the dark entrance arch
  k.box('walls', C.stone, 0, B, -7, 11.5, 18 - B, 4.6, { top: false });
  k.gable('plain', C.stone, 0, 18, -7, 11.5, 4.6, 7, { ends: C.stone, endsBucket: 'walls' });
  k.box('plain', C.iron, 0, 0, -9.35, 4, 6.5, 0.3, { top: false });
  k.quad('plain', C.iron, [-2, 6.5, -9.5], [2, 6.5, -9.5], [0.8, 8.6, -9.5], [-0.8, 8.6, -9.5], [0, 0, -1]);
  // the shaft, its belts and corner buttresses
  k.box('walls', C.stone, 0, B, 0, 2 * S, 55 - B, 2 * S, { top: false });
  for (const y of [23, 37]) k.box('plain', C.chalkShade, 0, y, 0, 2 * S + 0.6, 0.6, 2 * S + 0.6);
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) k.box('plain', C.stoneDeep, sx * S, B, sz * S, 1.7, 53 - B, 1.7, { taper: 0.75 });
  k.box('plain', C.chalkShade, 0, 54.4, 0, 2 * S + 1.4, 1, 2 * S + 1.4);
  for (let i = 0; i < 4; i++) {
    k.push(0, 0, 0, i * 90);
    // a gilt frame, the dial (lights from dusk), the gabled hood over it
    k.box('plain', C.gilt, 0, DIAL_Y - 3.1, -S - 0.15, 6.2, 6.2, 0.3, { top: false });
    k.disc('glow', C.chalk, 0, DIAL_Y, -S - 0.35, DIAL_R, 16, [0, 0, -1]);
    k.push(0, 49.6, -S - 0.4, 90);
    k.gable('plain', C.stone, 0, 0, 0, 1.2, 7.4, 4.2, { ends: C.chalkShade });
    k.pop();
    // tall lancets lower down the shaft
    for (const x of [-2.2, 2.2]) k.box('plain', C.stoneDeep, x, 26, -S - 0.1, 1.1, 9, 0.2, { top: false });
    k.pop();
  }
  // the octagonal belfry with its lancets, the corner pinnacles, the spire and the gilt finial
  k.prism('plain', C.stone, 0, 55.4, 0, 4.9, 11.1, 8, { top: false });
  for (let i = 0; i < 4; i++) {
    k.push(0, 0, 0, i * 90);
    k.box('plain', C.iron, 0, 57.5, -4.6, 1.6, 6, 0.3, { top: false });
    k.pop();
  }
  k.prism('plain', C.chalkShade, 0, 66.2, 0, 5.3, 0.8, 8, { top: false });
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) pinnacle(k, sx * (S - 0.2), 55.4, sz * (S - 0.2), 0.9, 3.6, 4);
  k.spire('plain', C.stone, 0, 67, 0, 4.7, 17.5, 8);
  k.prism('plain', C.gilt, 0, 83.6, 0, 0.7, 1.3, 6);
  k.spire('plain', C.gilt, 0, 84.9, 0, 0.7, 0.5, 6);
  k.prism('plain', C.gilt, 0, 85.4, 0, 0.12, 1.3, 4);
}

export const model: LandmarkModel = {
  build(style: RegionStyle) {
    const k = new Kit();
    const roof = style.roofs[0], roof2 = style.roofs[style.roofs.length > 1 ? 1 : 0];

    // the Albert Square front: the long range, its gables, the corner pavilions
    k.box('walls', C.stone, -1.5, B, 0.5, 67, 23 - B, 13, { top: false });
    k.box('plain', C.chalkShade, -1.5, 22.2, 0.5, 67.6, 0.8, 13.6, { top: false });
    k.push(-1.5, 23, 0.5, 90);
    k.gable('plain', roof, 0, 0, 0, 13.4, 67.4, 7, { ends: roof });
    k.pop();
    k.box('plain', C.chalkShade, -1.5, 9, -6.2, 67, 0.5, 0.4, { top: false });
    // the ground-floor arcade, and buttress ribs between the bays up to the gables
    k.box('plain', C.stoneDeep, -1.5, B, -6.15, 67, 7.5 - B, 0.3, { top: false });
    for (const x of [-34, -26.3, -18.7, -11, 9, 16.7, 24.3, 31.5]) k.box('plain', C.stoneDeep, x, B, -6.4, 0.8, 26 - B, 0.8, { taper: 0.8 });
    for (const x of [-30, -22.5, -15, 13, 20.5, 28]) frontGable(k, x, -6, roof);
    pavilion(k, -41.5, 2, 13, 16, roof);
    pavilion(k, 38, 3, 12, 16, roof);

    // the Princess Street corner tower
    k.push(35, 0, 16, -23.4);
    k.box('walls', C.stone, 0, B, 0, 7, 34 - B, 7, { top: false });
    k.box('plain', C.chalkShade, 0, 33.4, 0, 7.8, 0.8, 7.8, { top: false });
    k.pyramid('plain', roof2, 0, 34.2, 0, 7.4, 7.4, 13);
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) pinnacle(k, sx * 3.7, 32, sz * 3.7, 0.5, 2.6, 2);
    k.pop();

    // the ranges down Princess Street and Lloyd Street, and the range across the back
    wing(k, 31, 14, 3, 80, 10, 22, 7, roof);
    wing(k, -38.5, 9, -22, 80, 9.5, 22, 7, roof2);
    wing(k, -27, 86, 5, 97, 10, 22, 7, roof);

    // the rear tower (57 m) at the back corner, a steep slate pyramid on it
    k.push(-11.5, 0, 92, 19.5);
    k.box('walls', C.stone, 0, B, 0, 8.6, 37 - B, 8.6, { top: false });
    k.box('plain', C.chalkShade, 0, 36.4, 0, 9.4, 0.8, 9.4, { top: false });
    k.pyramid('plain', roof2, 0, 37.2, 0, 9, 9, 19.5);
    k.prism('plain', C.iron, 0, 56.4, 0, 0.15, 2, 4);
    k.pop();

    // inside the triangle: low ranges under flat roofs round the courtyards, and the Great Hall
    k.box('walls', C.stone, -2, B, 13, 60, 19 - B, 12, { topColour: C.slate });
    k.box('walls', C.stone, -6, B, 34, 44, 19 - B, 30, { topColour: C.slate });
    k.box('walls', C.stone, -6, B, 64, 30, 19 - B, 30, { topColour: C.slate });
    k.box('walls', C.stone, -6.5, B, 34, 17, 20 - B, 32, { top: false });
    k.gable('plain', roof2, -6.5, 20, 34, 17.6, 32.6, 12, { ends: C.stone, endsBucket: 'walls' });
    k.prism('plain', C.iron, -6.5, 32, 34, 1.2, 1.6, 6);
    k.spire('plain', C.iron, -6.5, 33.6, 34, 1.2, 3, 6);

    // octagonal stair turrets
    for (const [x, z] of [[-26, 14.5], [19.5, 14.5], [-10, 81.5]]) {
      k.prism('plain', C.stone, x, B, z, 3.6, 28 - B, 8, { top: false });
      k.spire('plain', roof2, x, 28, z, 3.8, 6, 8);
    }

    clockTower(k);
    return k.group('manchester-town-hall');
  },
};
