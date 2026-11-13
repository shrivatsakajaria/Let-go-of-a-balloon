/**
 * King John's Castle, Limerick (begun about 1200): a Norman curtain wall of grey limestone on the
 * Shannon, round drum towers at the north-west and south-west corners of the river front and at the
 * north-east, the twin-towered gatehouse on the north side, and the low angled artillery bastion at
 * the south-east corner. Battlemented throughout. Plan from the OpenStreetMap outline (2026-11);
 * heights from photographs (curtain about 11 m, towers 17 to 20 m).
 *
 * Model frame (types.ts): origin on the ground in the middle of the ward, front (local -z) the river
 * front, facing west-south-west across the Shannon; +x is north-north-west, toward Thomond Bridge.
 */
import { Kit, LANDMARK_COLOURS as C } from '../kit';
import type { LandmarkModel } from '../types';
import type { Color } from '../../world/palette';

/** Weathered grey limestone: the Contour rail grey (palette ROADS.rail). */
const LIMESTONE: Color = '#b4aea2';
const D2R = Math.PI / 180;
/** Curtain wall: height to the wall walk, thickness, m. */
const WALL_H = 11;
const WALL_T = 3;

/** The ward's middle, for telling a wall's outer face from its inner. */
const MID = { x: 4, z: 6 };

/** A run of battlemented curtain wall from a to b (model frame), h high. */
function curtain(k: Kit, ax: number, az: number, bx: number, bz: number, h = WALL_H): void {
  const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz);
  const deg = Math.atan2(dz, dx) / D2R;
  const mx = (ax + bx) / 2, mz = (az + bz) / 2;
  // local -z points to (sin, -cos) of the turn: outward if that is away from the middle
  const out = Math.sin(deg * D2R) * (mx - MID.x) - Math.cos(deg * D2R) * (mz - MID.z) > 0 ? -1 : 1;
  k.push(mx, 0, mz, deg);
  k.box('plain', LIMESTONE, 0, -3, 0, len, h + 3, WALL_T, { topColour: C.paving });
  // merlons along the outer edge, and a low parapet on the inner
  const n = Math.max(2, Math.floor(len / 3.2));
  for (let i = 0; i < n; i++) {
    const x = -len / 2 + ((i + 0.5) * len) / n;
    k.box('plain', LIMESTONE, x, h, out * (WALL_T / 2 - 0.35), 1.7, 1.3, 0.7, { topColour: C.chalkShade });
  }
  k.box('plain', LIMESTONE, 0, h, -out * (WALL_T / 2 - 0.25), len, 0.6, 0.5, { topColour: C.chalkShade });
  k.pop();
}

/** A round drum tower at (x, z), radius r, h high: battered foot, string course, merlons, arrow slits facing `faceDeg` (model frame, from -z clockwise). */
function drum(k: Kit, x: number, z: number, r: number, h: number, faceDeg: number): void {
  k.prism('plain', LIMESTONE, x, -3, z, r * 1.12, 7, 16, { r1: r, top: false });
  k.prism('plain', LIMESTONE, x, 4, z, r, h - 4, 16, { topColour: C.paving });
  k.prism('plain', C.chalkShade, x, h - 0.5, z, r + 0.25, 0.5, 16, { top: false });
  const n = 12;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 360 + 15;
    k.push(x + Math.sin(a * D2R) * (r - 0.35), h, z - Math.cos(a * D2R) * (r - 0.35), a);
    k.box('plain', LIMESTONE, 0, 0, 0, 1.6, 1.4, 0.7, { topColour: C.chalkShade });
    k.pop();
  }
  // arrow slits on the three outer faces, at two levels
  for (const da of [-50, 0, 50]) {
    const a = faceDeg + da;
    for (const y of [6, h - 6]) {
      k.push(x + Math.sin(a * D2R) * r, 0, z - Math.cos(a * D2R) * r, a);
      k.box('plain', C.iron, 0, y, -0.2, 0.4, 2.2, 0.3, { top: false });
      k.pop();
    }
  }
}

export const model: LandmarkModel = {
  build() {
    const k = new Kit();
    // ---- the curtain, round the ward: river front, north side to the gatehouse, east, south ----
    curtain(k, -36, -27, 42, -26);
    curtain(k, 42, -26, 42.5, 4);
    curtain(k, 41.5, 17.5, 29, 36);
    curtain(k, 29, 36, 17, 39.5);
    curtain(k, 17, 39.5, -23, 40, 9.5);
    curtain(k, -26, 29, -33, -16, 10);
    curtain(k, -33, -16, -36, -27, 10);

    // ---- the drum towers: NW and SW on the river, NE ----
    drum(k, 42, -26, 7.2, 20, 50);
    drum(k, -36, -27, 7.0, 18, 310);
    drum(k, 29, 36, 6.4, 18, 140);

    // ---- the gatehouse: two D-towers either side of the gate, the gate passage block behind ----
    k.box('plain', LIMESTONE, 35, -3, 11, 12, 19, 10, { topColour: C.paving });
    for (const x of [30, 34, 38]) k.box('plain', LIMESTONE, x, 16, 6.4, 1.6, 1.3, 0.7, { topColour: C.chalkShade });
    drum(k, 42.3, 4.6, 4.9, 17, 90);
    drum(k, 41.6, 17.2, 4.9, 17, 90);
    // the gate: a dark pointed opening in the gatehouse between the towers, facing north (+x)
    k.push(41, 0, 11, 90);
    k.box('plain', C.iron, 0, 0, -0.2, 3.2, 4.4, 0.3, { top: false });
    k.quad('plain', C.iron, [-1.6, 4.4, -0.36], [1.6, 4.4, -0.36], [0.3, 6.1, -0.36], [-0.3, 6.1, -0.36], [0, 0, -1]);
    k.pop();

    // ---- the south-east artillery bastion: low, angled, battered ----
    k.prism('plain', LIMESTONE, -24, -3, 35, 9.0, 4, 4, { r1: 8.2, rot: 45, top: false });
    k.prism('plain', LIMESTONE, -24, 1, 35, 8.2, 8, 4, { r1: 7.8, rot: 45, topColour: C.paving });
    k.prism('plain', C.chalkShade, -24, 9, 35, 8.0, 0.8, 4, { r1: 7.8, rot: 45, topColour: C.paving });
    return k.group('limerick-king-johns-castle');
  },
};
