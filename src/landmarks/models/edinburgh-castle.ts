/**
 * Edinburgh Castle on its rock: the curtain walls along the cliff tops (with a faceted rock face
 * under them where the map's smoothed ground falls short of the real cliffs), the Half Moon
 * Battery's great curved wall over the Esplanade with the Royal Palace and its flag tower behind,
 * the Gatehouse with its corner turrets, the Portcullis Gate and Argyle Tower, Crown Square (the
 * Great Hall, the Scottish National War Memorial, the Queen Anne Building), St Margaret's Chapel
 * on the summit, and the long New Barracks, the Hospital and the Governor's House to the west.
 * Faceted grey stone and slate, Contour colours.
 *
 * Built in map metres (x east, z south of the origin, the summit by St Margaret's Chapel) inside
 * a turn that undoes the site's heading, so every part sits where OpenStreetMap has it. Heights
 * are from the drawn ground (Mapterhorn, sampled 2026-11): the summit is y 0, Crown Square about
 * y 0, the Esplanade about y -22, the foot of the north cliffs about y -70.
 */
import { Kit, LANDMARK_COLOURS as C } from '../kit';
import type { LandmarkModel } from '../types';
import type { Color } from '../../world/palette';

/** The site's heading (sites/edinburgh.ts): the model is built in map axes inside a turn by -HEADING. */
const HEADING = 84;
const D = 180 / Math.PI;

/**
 * A block standing on the line (e0, s0) to (e1, s1), w wide, walls from y0 to y1, and a pitched
 * roof roofH high along it (none: a flat top). `hip` hips the roof's ends.
 */
function bar(k: Kit, colour: Color, roof: Color, e0: number, s0: number, e1: number, s1: number, w: number, y0: number, y1: number, roofH = 0, o: { hip?: number; bucket?: 'walls' | 'plain' } = {}): void {
  const de = e1 - e0, ds = s1 - s0;
  k.push((e0 + e1) / 2, 0, (s0 + s1) / 2, Math.atan2(de, -ds) * D);
  k.box(o.bucket ?? 'walls', colour, 0, y0, 0, w, y1 - y0, Math.hypot(de, ds), { top: roofH <= 0, topColour: roof });
  if (roofH > 0) k.gable('plain', roof, 0, y1, 0, w + 0.6, Math.hypot(de, ds) + 0.6, roofH, { ends: colour, hip: o.hip });
  k.pop();
}

/**
 * A curtain wall along a polyline of [east, south, top] points, `thick` thick, from `bottom` up.
 * With `rock`, a battered rock face runs down from just under the wall top to `rock.bottom`,
 * `rock.out` metres further out at its foot, on the side away from (cx, cz): the cliff.
 */
function wallLine(k: Kit, colour: Color, pts: number[][], bottom: number, thick: number, rock?: { colour: Color; bottom: number; out: number; cx: number; cz: number }): void {
  for (let i = 0; i + 1 < pts.length; i++) {
    const [e0, s0, t0] = pts[i], [e1, s1, t1] = pts[i + 1];
    const de = e1 - e0, ds = s1 - s0, len = Math.hypot(de, ds);
    k.push((e0 + e1) / 2, 0, (s0 + s1) / 2, Math.atan2(de, -ds) * D);
    const top = (t0 + t1) / 2;
    k.box('plain', colour, 0, bottom, 0, thick, top - bottom, len + thick * 0.8);
    k.pop();
  }
  if (!rock) return;
  // the rock face: a ribbon, each point pushed out along the mean of its segments' outward normals
  const n = pts.length;
  const outN: number[][] = [];
  for (let i = 0; i < n; i++) {
    let nx = 0, nz = 0;
    for (const j of [i - 1, i]) {
      if (j < 0 || j + 1 >= n) continue;
      const de = pts[j + 1][0] - pts[j][0], ds = pts[j + 1][1] - pts[j][1], l = Math.hypot(de, ds) || 1;
      let ax = ds / l, az = -de / l;
      const mx = (pts[j][0] + pts[j + 1][0]) / 2 - rock.cx, mz = (pts[j][1] + pts[j + 1][1]) / 2 - rock.cz;
      if (ax * mx + az * mz < 0) { ax = -ax; az = -az; }
      nx += ax; nz += az;
    }
    const l = Math.hypot(nx, nz) || 1;
    outN.push([nx / l, nz / l]);
  }
  for (let i = 0; i + 1 < n; i++) {
    const a = pts[i], b = pts[i + 1], na = outN[i], nb = outN[i + 1];
    const ta = a[2] - 3, tb = b[2] - 3;
    const mx = (na[0] + nb[0]) / 2, mz = (na[1] + nb[1]) / 2;
    k.quad('plain', rock.colour,
      [b[0] + nb[0] * rock.out, rock.bottom, b[1] + nb[1] * rock.out],
      [a[0] + na[0] * rock.out, rock.bottom, a[1] + na[1] * rock.out],
      [a[0] + na[0] * thick * 0.5, ta, a[1] + na[1] * thick * 0.5],
      [b[0] + nb[0] * thick * 0.5, tb, b[1] + nb[1] * thick * 0.5],
      [mx * (ta - rock.bottom), rock.out, mz * (ta - rock.bottom)]);
  }
}

/** A round turret on (e, s) from y0 to y1 with a pointed cap. */
function turret(k: Kit, wall: Color, cap: Color, e: number, s: number, r: number, y0: number, y1: number, capH: number): void {
  k.prism('plain', wall, e, y0, s, r, y1 - y0, 6, { top: false });
  k.spire('plain', cap, e, y1, s, r * 1.15, capH, 6);
}

export const model: LandmarkModel = {
  build(style) {
    const k = new Kit();
    // the castle's dark sandstone: the region's grey stone where it has one
    const GREY = style.walls[3] ?? C.stoneDeep;
    const ROCK = C.clay;
    k.push(0, 0, 0, -HEADING);

    // ---- curtain walls on the cliff tops, the rock under them ----
    const centre = { cx: -10, cz: 10 };
    // north (Argyle and Mills Mount batteries) and the Western Defences
    wallLine(k, GREY, [
      [51, -21, -12], [45, -28, -13], [36, -36, -14], [24, -44, -15], [20, -57, -17], [8, -54, -17], [-1, -61, -18], [-13, -53, -17],
      [-19, -50, -16], [-31, -59, -16], [-53, -68, -19], [-71, -73, -21], [-94, -84, -24], [-115, -63, -26], [-128, -25, -27],
      [-121, -9, -27], [-112, 8, -26], [-109, 19, -25],
    ], -40, 2.6, { colour: ROCK, bottom: -70, out: 12, ...centre });
    // south, under the New Barracks and Crown Square, to the Palace
    wallLine(k, GREY, [
      [-109, 19, -25], [-73, 57, -18], [-67, 69, -20], [-52, 79, -20], [-31, 85, -17], [-13, 75, -10], [1, 77, -8], [17, 87, -8],
      [33, 86, -6], [58, 84, -5], [77, 82, -5], [80, 78, -4], [81, 62, -3],
    ], -40, 2.6, { colour: ROCK, bottom: -66, out: 12, ...centre });
    // the forewall from the Half Moon Battery past the Portcullis Gate to the Argyle Battery
    wallLine(k, GREY, [[75, 14, -9], [80, 5, -12], [88, -8, -15], [65, -17, -14], [51, -21, -12]], -34, 2.4);

    // ---- the Half Moon Battery: a tall curved wall, its platform level with the Palace's foot ----
    const HM = [[81, 62], [79, 56], [89, 54], [94, 48], [96, 42], [95, 36], [92, 29], [88, 24], [81, 19], [75, 14]];
    const HM_TOP = 1;
    wallLine(k, C.stoneDeep, HM.map(([e, s]) => [e, s, HM_TOP]), -42, 3.2);
    // its parapet, a shade paler, and the platform behind it
    wallLine(k, C.stone, HM.slice(1).map(([e, s]) => [e, s, HM_TOP + 1.3]), HM_TOP, 1.2);
    for (let i = 1; i + 1 < HM.length; i++) {
      const [ae, as] = HM[i], [be, bs] = HM[i + 1];
      k.tri('plain', C.paving, 74, HM_TOP + 0.05, 38, ae, HM_TOP + 0.05, as, be, HM_TOP + 0.05, bs, 0, 1, 0);
    }

    // ---- the Gatehouse (1888): a crenellated front on the Esplanade with corbelled corner turrets ----
    bar(k, C.stone, C.stoneDeep, 106.5, 2.5, 111.5, 35, 11, -32, -10);
    bar(k, C.stone, C.stoneDeep, 109.2, 12, 110.7, 24, 13, -32, -6.5);
    // the gate arch (dark), and its battlements
    k.box('plain', C.iron, 116.2, -23, 18, 0.6, 7, 4.2, { top: false });
    k.push(116.4, -16, 18, 90);
    k.gable('plain', C.iron, 0, 0, 0, 4.2, 0.4, 2.1);
    k.pop();
    for (const s of [13.5, 16.5, 19.5, 22.5]) k.box('plain', C.stone, 116.3, -6.5, s, 1.1, 1.2, 1.2);
    for (const s of [4.5, 8.5, 28, 32]) k.box('plain', C.stone, 115.4, -10, s, 1.1, 1.2, 1.2);
    for (const [e, s] of [[116.5, 3], [117.5, 34.5], [102.5, 2], [107.5, 35.5]]) turret(k, C.stone, C.slate, e, s, 1.7, -15, -7.5, 4);

    // ---- the Portcullis Gate and Argyle Tower, on the way up ----
    bar(k, C.stone, C.slate, 38, -14, 48, -25, 9, -30, -2, 4.5);
    turret(k, C.stone, C.slate, 50.5, -21.5, 1.5, -6, 0, 3);

    // ---- the Royal Palace, its flag tower over the battery, turrets and chimneys ----
    bar(k, C.stone, C.slate, 69, 44, 69.5, 83, 20, -26, 12, 5.5);
    k.box('walls', C.stone, 68.5, -8, 48.5, 9.5, 29.5, 9.5, { topColour: C.paving });
    k.box('plain', C.stone, 68.5, 21.5, 48.5, 10.4, 1.3, 10.4, { top: false });
    turret(k, C.stone, C.slate, 65.5, 45.5, 2.2, 21.5, 25.5, 4.5);
    k.prism('plain', C.iron, 70.5, 21.5, 50.5, 0.18, 12, 4);
    for (const [e, s] of [[78.5, 44.5], [80.5, 62.5], [79.5, 82]]) turret(k, C.stone, C.slate, e, s, 1.5, 8, 14, 3);
    for (const [e, s] of [[62, 62], [76, 71], [63, 79]]) k.box('plain', C.stoneDeep, e, 12, s, 1.6, 7.5, 2.4);

    // ---- Crown Square: the Great Hall, the War Memorial, the Queen Anne Building ----
    bar(k, C.stone, C.slate, 32, 77, 58, 77.5, 13, -18, 9, 6.5);
    bar(k, C.stone, C.slate, 25, 38, 61, 36, 15, -8, 11, 5.5);
    bar(k, C.stone, C.slate, 42, 19, 42, 31, 10, -10, 12, 4.5, { hip: 3 });
    k.box('walls', C.stone, 43, -1, 44.5, 7, 17, 4);
    k.gable('plain', C.slate, 43, 16, 44.5, 7.4, 4.4, 4.5, { ends: C.stone });
    bar(k, C.stone, C.slate, 20, 47, 24, 85, 17, -12, 8, 4);

    // ---- St Margaret's Chapel on the summit ----
    bar(k, C.chalkShade, C.slate, 16, -0.8, 25, -1.2, 6.5, -3, 4.5, 3, { hip: 1.5, bucket: 'plain' });

    // ---- to the west: the New Barracks, the Governor's House, the Hospital, the War Museum ----
    bar(k, C.stoneDeep, C.slate, -68, 21, -28, 71, 20, -48, -1, 4, { hip: 3 });
    bar(k, C.stone, C.slate, -51, -8, -36, 20, 12, -32, -1, 5);
    turret(k, C.stone, C.slate, -34, 20.5, 1.6, -5, 2, 3.5);
    bar(k, C.stoneDeep, C.slate, -99, -38, -63, -43, 11, -42, -3, 5);
    bar(k, C.stoneDeep, C.slate, -95, -5, -59, -2, 13, -38, -5, 5);
    bar(k, C.stoneDeep, C.slate, -55, -30, -30, -44, 10, -26, -10, 3);

    k.pop();
    return k.group('edinburgh-castle');
  },
};
