/**
 * The Sydney Opera House: the granite podium on Bennelong Point with the Monumental Steps on its
 * south side, and on it the white shells in three sets: the Concert Hall (west, the tallest shell
 * 67 m above the harbour), the Joan Sutherland Theatre (east) and the small Bennelong restaurant
 * (south-west). Each set is a row of pointed shells back to back along its own axis, rising from
 * the steps and opening north to the harbour through glass walls that glow from dusk. Faceted,
 * Contour colours.
 *
 * The plan (podium outline, each set's axis and where its shells cross) from OpenStreetMap (the
 * roof parts, 2026-11); heights from the published dimensions. Model frame (types.ts): origin at
 * the hero point near the middle of the podium, front (local -z) along the building's axis to the
 * north-north-east, toward the point and the harbour.
 */
import { Kit, LANDMARK_COLOURS as C } from '../kit';
import type { Color } from '../../world/palette';
import type { LandmarkModel } from '../types';

type P3 = [number, number, number];

/** The podium's top (m). */
const PODIUM = 8;

const S60 = Math.sin(Math.PI / 3);

/**
 * One shell in its own frame: the back meets the podium at the origin, the mouth faces -z. `L` is
 * how far forward the tip is, `lf` where the mouth's feet stand, `H` the tip's height, `hw` the
 * mouth's half width. The mouth's edge is a pointed (two-centred) arch; the back curves up and
 * over to the tip; the shell's surface bulges out between them. The mouth is glazed (glow).
 */
function shell(k: Kit, L: number, lf: number, H: number, hw: number, glass: boolean): void {
  const NU = 8, NT = 4;
  // the back leans forward from the start and curves over to the tip
  const ridge = (u: number): P3 => [0, H * Math.sin((u * Math.PI) / 2), -L * (0.35 * u + 0.65 * (1 - Math.cos((u * Math.PI) / 2)))];
  const edge = (u: number, side: number): P3 => {
    const th = (u * Math.PI) / 3;
    return [side * hw * (2 * Math.cos(th) - 1), (H * Math.sin(th)) / S60, -lf - (L - lf) * u];
  };
  const inside: P3 = [0, 0.3 * H, -0.55 * L];
  const at = (u: number, t: number, side: number): P3 => {
    const r = ridge(u), e = edge(u, side);
    const p: P3 = [r[0] + (e[0] - r[0]) * t, r[1] + (e[1] - r[1]) * t, r[2] + (e[2] - r[2]) * t];
    // bulge outward from the shell's inside, most at the middle of the cross-section and low down
    const span = Math.hypot(e[0] - r[0], e[1] - r[1], e[2] - r[2]);
    const b = 0.07 * span * Math.sin(Math.PI * t) * (1 - 0.5 * u);
    const d: P3 = [p[0] - inside[0], 0.35 * (p[1] - inside[1]), p[2] - inside[2]];
    const l = Math.hypot(d[0], d[1], d[2]) || 1;
    return [p[0] + (b * d[0]) / l, p[1] + (b * d[1]) / l, p[2] + (b * d[2]) / l];
  };
  for (const side of [-1, 1]) {
    for (let i = 0; i < NU; i++) {
      for (let j = 0; j < NT; j++) {
        const a = at(i / NU, j / NT, side), b = at((i + 1) / NU, j / NT, side);
        const c = at((i + 1) / NU, (j + 1) / NT, side), d = at(i / NU, (j + 1) / NT, side);
        const m: P3 = [(a[0] + c[0]) / 2 - inside[0], (a[1] + c[1]) / 2 - inside[1], (a[2] + c[2]) / 2 - inside[2]];
        // the cream tiles; the lower slopes a shade deeper
        k.quad('plain', j === NT - 1 && i < 3 ? C.chalkShade : C.chalk, a, b, c, d, m);
        // the underside, seen in the mouth (the front half only: the back is closed by the shell behind)
        if (i >= NU / 2 || j >= NT - 1) k.quad('plain', C.chalkShade, a, b, c, d, [-m[0], -m[1], -m[2]]);
      }
    }
    // the mouth: glass hung from the arch and drawn back into the shell, a dark folded wall
    const back: P3 = [0, 0.12 * H, -lf + 0.24 * L];
    for (let i = 0; i < NU; i++) {
      const p = edge(i / NU, side), q = edge((i + 1) / NU, side);
      k.tri(glass ? 'glow' : 'plain', C.iron, back[0], back[1], back[2], p[0], p[1], p[2], q[0], q[1], q[2], 0, 0.1, -1);
    }
    if (side > 0) k.tri(glass ? 'glow' : 'plain', C.iron, -hw, 0, -lf, hw, 0, -lf, back[0], back[1], back[2], 0, 0.1, -1);
  }
}

type ShellSpec = { back: number; tip: number; feet: number; H: number; hw: number; glass?: boolean };

/**
 * A set of shells along an axis: from (x, z) on the podium at its south end, turned by turnDeg
 * (its axis then runs to local -z), each shell placed by distances along the axis. A shell whose
 * tip is south of its back opens south.
 */
function set(k: Kit, x: number, y: number, z: number, turnDeg: number, shells: ShellSpec[]): void {
  k.push(x, y, z, turnDeg);
  for (const s of shells) {
    const north = s.tip > s.back;
    k.push(0, 0, -s.back, north ? 0 : 180);
    shell(k, Math.abs(s.tip - s.back), Math.abs(s.feet - s.back), s.H, s.hw, s.glass ?? true);
    k.pop();
  }
  k.pop();
}

/** A convex slab: walls round a convex polygon (x, z pairs) from y0 to y1, and its top. */
function slab(k: Kit, poly: number[], y0: number, y1: number, wall: Color, top: Color): void {
  const n = poly.length / 2;
  let cx = 0, cz = 0;
  for (let i = 0; i < n; i++) {
    cx += poly[2 * i] / n;
    cz += poly[2 * i + 1] / n;
  }
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ax = poly[2 * i], az = poly[2 * i + 1], bx = poly[2 * j], bz = poly[2 * j + 1];
    const h: P3 = [(ax + bx) / 2 - cx, 0, (az + bz) / 2 - cz];
    k.quad('plain', wall, [ax, y0, az], [bx, y0, bz], [bx, y1, bz], [ax, y1, az], h);
    k.tri('plain', top, cx, y1, cz, ax, y1, az, bx, y1, bz, 0, 1, 0);
  }
}

export const model: LandmarkModel = {
  build() {
    const k = new Kit();
    // the podium: the main block, the two wings round the halls' north ends, and the steps
    slab(k, [-48, -34, 48, -34, 48, 54, -48, 54], -3, PODIUM, C.stone, C.paving);
    slab(k, [-48, -34, -52, -66, -59, -84, -40, -90.5, -20, -93, -6, -95, 2.5, -62, 2.5, -34], -3, PODIUM, C.stone, C.paving);
    slab(k, [7.5, -34, 7.5, -62, 16, -84, 29, -86, 40, -85, 52.5, -79, 54, -71, 48, -34], -3, PODIUM, C.stone, C.paving);
    slab(k, [-48, 54, -18, 54, -18, 74, -48, 74], -3, PODIUM, C.stone, C.paving);
    for (let i = 0; i < 4; i++) k.box('plain', C.stoneDeep, 10, -3, 56.5 + 5 * i, 56, 3 + PODIUM - 2 * (i + 1), 5, { topColour: C.paving });
    // a band of shade under the podium's edge: the broadwalk's overhang
    k.box('plain', C.stoneDeep, 0, PODIUM - 0.6, 10, 97, 0.6, 89, { top: false });
    // the Concert Hall: axis from the steps (-8, 31) to the point (-32.5, -91)
    set(k, -8, PODIUM, 31, -11.3, [
      { back: 42, tip: 4, feet: 15, H: 38, hw: 15 },
      { back: 36, tip: 83, feet: 70, H: 54, hw: 20 },
      { back: 62, tip: 101, feet: 90, H: 42, hw: 17 },
      { back: 84, tip: 119, feet: 109, H: 29, hw: 14 },
    ]);
    // the Joan Sutherland Theatre: axis from (18.75, 12) to (37, -83)
    set(k, 18.75, PODIUM, 12, 10.9, [
      { back: 33, tip: 3, feet: 11, H: 33, hw: 13 },
      { back: 27, tip: 65, feet: 54, H: 48, hw: 18 },
      { back: 48, tip: 79, feet: 70, H: 37, hw: 15 },
      { back: 66, tip: 94, feet: 86, H: 25, hw: 12 },
    ]);
    // the Bennelong restaurant: two small shells back to back
    set(k, -31, PODIUM, 65, 0, [
      { back: 22, tip: 3, feet: 8, H: 15, hw: 9 },
      { back: 18, tip: 41, feet: 34, H: 19, hw: 11 },
    ]);
    return k.group('sydney-opera-house');
  },
};
