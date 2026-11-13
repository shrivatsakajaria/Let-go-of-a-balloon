/**
 * Shandon Bells: the steeple of St Anne's Church, Shandon (1722-26, the top added 1749), about 52 m
 * to the weathervane. A three-stage square tower of two stones, red sandstone rubble on the north
 * and west and white limestone ashlar on the south and east (National Inventory of Architectural
 * Heritage 20512027): the colours of Cork. On top of it the "pepper pot": three diminishing
 * limestone stages, the lowest the belfry of the eight bells, with urns at the corners, a small
 * dome, a gilt ball and the gilt salmon weathervane. The four 4.3 m clock faces (1847) are on the
 * top stage of the tower; they light from dusk, and their hands keep Irish time, each face a little
 * off the others, as the "Four-Faced Liar" famously is. The bells are inside the louvres: not drawn.
 * The nave and chancel run east behind the tower (OSM outline), plain rubble under slate.
 *
 * Model frame (types.ts): origin on the ground at the tower's centre, front (local -z) west to
 * Church Street; +x is north, +z east (the church).
 */
import * as THREE from 'three';
import { Kit, LANDMARK_COLOURS as C, type Vec3 } from '../kit';
import type { LandmarkModel } from '../types';
import type { Color } from '../../world/palette';

/** Clock dial: radius, centre height, and distance of its plane from the tower's axis, m. */
const DIAL_R = 2.15;
const DIAL_Y = 32.2;
const DIAL_Z = -(4.15 + 0.3);
/** Each face's error, minutes: the Four-Faced Liar's faces never quite agree. */
const LIAR_MIN = [0, 1.5, -1, 0.5];

type Hands = { hour: THREE.Object3D[]; minute: THREE.Object3D[]; hourKey: number; offsetMs: number };

/** Last Sunday of a month (0-based), 01:00 UTC: when Irish clocks change. */
function changeUtc(year: number, month: number): number {
  const last = new Date(Date.UTC(year, month + 1, 0));
  return last.getTime() - last.getUTCDay() * 864e5 + 3600e3;
}

/** Ireland's offset from UTC: Irish Standard Time (UTC+1) from the last Sunday of March to the last of October. */
export function irelandOffsetMs(utcMs: number): number {
  const y = new Date(utcMs).getUTCFullYear();
  return utcMs >= changeUtc(y, 2) && utcMs < changeUtc(y, 9) ? 3600e3 : 0;
}

/**
 * A square stage `half` from the axis, y0 to y0 + h, each side its own colour, in the order west
 * (front, -z), north (+x), east (+z), south (-x); `taper` narrows the top.
 */
function stage(k: Kit, cols: Color[], y0: number, h: number, half: number, o: { taper?: number; top?: Color } = {}): void {
  const a = half, t = half * (o.taper ?? 1), y1 = y0 + h;
  const n: Vec3[] = [[0, 0, -1], [1, 0, 0], [0, 0, 1], [-1, 0, 0]];
  const lo: Vec3[] = [[-a, y0, -a], [a, y0, -a], [a, y0, a], [-a, y0, a]];
  const hi: Vec3[] = [[-t, y1, -t], [t, y1, -t], [t, y1, t], [-t, y1, t]];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    k.quad('plain', cols[i], lo[i], lo[j], hi[j], hi[i], n[i]);
  }
  if (o.top) k.quad('plain', o.top, hi[0], hi[1], hi[2], hi[3], [0, 1, 0]);
}

/** A round-headed opening (dark), w wide, from y0 to the springing at y1, on the -z face at z. */
function arched(k: Kit, colour: Color, x: number, y0: number, y1: number, z: number, w: number): void {
  const r = w / 2;
  k.box('plain', colour, x, y0, z, w, y1 - y0, 0.3, { top: false });
  k.push(x, y1, z - 0.15);
  const a = [0, 0.38, 0.71, 0.92, 1].map((s) => s * Math.PI / 2);
  for (let i = 0; i < 4; i++) {
    const c0 = Math.cos(a[i]) * r, s0 = Math.sin(a[i]) * r, c1 = Math.cos(a[i + 1]) * r, s1 = Math.sin(a[i + 1]) * r;
    k.tri('plain', colour, 0, 0, 0, c0, s0, 0, c1, s1, 0, 0, 0, -1);
    k.tri('plain', colour, 0, 0, 0, -c1, s1, 0, -c0, s0, 0, 0, 0, -1);
  }
  k.pop();
}

/** An urn on a pedestal at (x, y, z). */
function urn(k: Kit, x: number, y: number, z: number, s: number): void {
  k.box('plain', C.chalkShade, x, y, z, 0.7 * s, 0.5 * s, 0.7 * s);
  k.prism('plain', C.chalk, x, y + 0.5 * s, z, 0.4 * s, 0.6 * s, 6, { r1: 0.28 * s });
  k.spire('plain', C.chalk, x, y + 1.1 * s, z, 0.28 * s, 0.6 * s, 6);
}

/** One hand, pointing up (+y) from its pivot, in the dial's plane, facing -z. */
function hand(length: number, width: number): Kit {
  const k = new Kit();
  const w = width / 2;
  k.quad('plain', C.gilt, [-w, -0.35, 0], [w, -0.35, 0], [w * 0.5, length, 0], [-w * 0.5, length, 0], [0, 0, -1]);
  k.tri('plain', C.gilt, -w * 0.5, length, 0, w * 0.5, length, 0, 0, length + 0.25, 0, 0, 0, -1);
  return k;
}

export const model: LandmarkModel = {
  build(style) {
    const k = new Kit();
    const red = style.walls[0];
    const white = C.chalk;
    // west, north, east, south
    const tower = [red, red, white, white];
    const lime = [white, white, white, white];

    // ---- the church behind (east): nave, chancel, the north porch; slate roofs ----
    k.box('plain', C.stone, 0, -3, 16.5, 14, 13, 24);
    k.gable('plain', C.slate, 0, 10, 16.5, 14.6, 24.4, 5.2, { ends: C.stone });
    k.box('plain', C.stone, -0.5, -3, 30.5, 9, 11, 4);
    k.gable('plain', C.slate, -0.5, 8, 30.5, 9.4, 4.2, 3.6, { ends: C.stone, hip: 2 });
    k.box('plain', C.stoneDeep, 9.5, -3, 16.5, 5, 9, 10);
    k.push(9.5, 6, 16.5, 90);
    k.gable('plain', C.slate, 0, 0, 0, 10.4, 5.4, 2.4, { ends: C.stoneDeep });
    k.pop();
    // tall round-headed nave windows, north and south
    for (const z of [9, 15, 21, 27]) {
      for (const side of [-1, 1]) {
        k.push(side * 7, 0, z, side * 90);
        arched(k, C.iron, 0, 3, 7.4, -0.05, 1.6);
        k.pop();
      }
    }

    // ---- the tower: three stages of two stones, string courses of limestone ----
    stage(k, tower, -3, 18.6, 4.6, { taper: 0.99 });
    k.box('plain', C.chalkShade, 0, 15.4, 0, 9.5, 0.6, 9.5);
    stage(k, tower, 16, 11, 4.4);
    k.box('plain', C.chalkShade, 0, 26.8, 0, 9.1, 0.6, 9.1);
    stage(k, tower, 27.4, 9.1, 4.15);
    // cornice and balustrade round the top of the tower
    k.box('plain', C.chalkShade, 0, 36.3, 0, 9.0, 0.7, 9.0);
    k.box('plain', C.chalk, 0, 37, 0, 8.4, 1.0, 8.4, { topColour: C.paving });
    for (let i = 0; i < 4; i++) {
      k.push(0, 0, 0, i * 90);
      // limestone quoins up the corners (each stone shows on two faces)
      k.box('plain', C.chalkShade, -4.3, -3, -4.3, 0.7, 18.4, 0.7, { top: false });
      if (i === 0) {
        // the west door in its limestone surround
        k.box('plain', C.chalk, 0, 0, -4.7, 3.6, 5.4, 0.3, { top: false });
        arched(k, C.iron, 0, 0, 3.6, -4.9, 2.2);
      } else arched(k, C.iron, 0, 5, 8.5, -4.75, 1.4);
      // a round-headed window in the second stage
      arched(k, C.iron, 0, 19.5, 22.6, -4.55, 1.5);
      // the clock: limestone surround, gilt chapter ring, dark dial that lights from dusk
      k.box('plain', C.chalk, 0, DIAL_Y - 2.7, -4.25, 5.4, 5.4, 0.25, { top: false });
      k.disc('plain', C.gilt, 0, DIAL_Y, DIAL_Z + 0.04, DIAL_R, 20, [0, 0, -1]);
      k.disc('glow', C.iron, 0, DIAL_Y, DIAL_Z - 0.02, DIAL_R - 0.2, 20, [0, 0, -1]);
      k.disc('plain', C.gilt, 0, DIAL_Y, DIAL_Z - 0.06, 0.22, 6, [0, 0, -1]);
      k.pop();
    }
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) urn(k, sx * 3.75, 38, sz * 3.75, 1.4);

    // ---- the pepper pot: three limestone stages, belfry first, then the dome, ball and salmon ----
    stage(k, lime, 38, 5.6, 3.0, { top: C.paving });
    k.box('plain', C.chalkShade, 0, 43.6, 0, 6.8, 0.5, 6.8);
    stage(k, lime, 44.1, 3.9, 2.1, { top: C.paving });
    k.box('plain', C.chalkShade, 0, 48.0, 0, 5.0, 0.4, 5.0);
    for (let i = 0; i < 4; i++) {
      k.push(0, 0, 0, i * 90);
      arched(k, C.iron, 0, 39.2, 41.6, -3.05, 1.8);
      arched(k, C.iron, 0, 45, 46.7, -2.15, 1.1);
      k.pop();
    }
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      urn(k, sx * 2.75, 44.1, sz * 2.75, 1.0);
      urn(k, sx * 2.0, 48.4, sz * 2.0, 0.7);
    }
    k.prism('plain', C.chalk, 0, 48.4, 0, 1.5, 1.8, 8, { rot: 22.5 });
    // dome in three rings, the ball, the rod
    k.prism('plain', C.slate, 0, 50.2, 0, 1.6, 0.6, 8, { r1: 1.35, rot: 22.5, top: false });
    k.prism('plain', C.slate, 0, 50.8, 0, 1.35, 0.5, 8, { r1: 0.85, rot: 22.5, top: false });
    k.spire('plain', C.slate, 0, 51.3, 0, 0.85, 0.5, 8, 22.5);
    k.prism('plain', C.gilt, 0, 51.6, 0, 0.42, 0.45, 6, { r1: 0.42 });
    k.prism('plain', C.gilt, 0, 52.05, 0, 0.42, 0.3, 6, { r1: 0.15 });
    k.prism('plain', C.iron, 0, 52.3, 0, 0.06, 1.0, 4);
    // the salmon (about 3.3 m long), drawn on both sides, lying east-west
    k.push(0, 53.1, 0);
    for (const s of [-1, 1]) {
      const f = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number) =>
        s > 0 ? k.tri('plain', C.gilt, 0, ay, ax, 0, by, bx, 0, cy, cx, 1, 0, 0) : k.tri('plain', C.gilt, 0, ay, ax, 0, cy, cx, 0, by, bx, -1, 0, 0);
      f(-1.4, 0, 0.9, -0.35, 0.9, 0.35);
      f(-1.4, 0, 0.9, 0.35, -0.6, 0.38);
      f(-1.4, 0, -0.6, -0.36, 0.9, -0.35);
      f(0.9, 0, 1.9, -0.45, 1.9, 0.45);
    }
    k.pop();

    const g = k.group('cork-shandon-bells');
    // the hands: one pair per face, turned in animate
    const hourKit = hand(1.3, 0.38), minuteKit = hand(1.8, 0.28);
    const hands: Hands = { hour: [], minute: [], hourKey: Number.NaN, offsetMs: 0 };
    for (let i = 0; i < 4; i++) {
      const pivot = new THREE.Group();
      pivot.rotation.y = (-i * Math.PI) / 2;
      const a = (i * Math.PI) / 2;
      pivot.position.set(-DIAL_Z * Math.sin(a), DIAL_Y, DIAL_Z * Math.cos(a));
      const hour = hourKit.mesh('plain', `hour-${i}`)!;
      const minute = minuteKit.mesh('plain', `minute-${i}`)!;
      hour.position.z = -0.1;
      minute.position.z = -0.14;
      hour.castShadow = minute.castShadow = false;
      pivot.add(hour, minute);
      hands.hour.push(hour);
      hands.minute.push(minute);
      g.add(pivot);
    }
    g.userData.hands = hands;
    return g;
  },

  animate(group, utcMs) {
    const h = group.userData.hands as Hands | undefined;
    if (!h) return;
    const key = Math.floor(utcMs / 3600e3);
    if (key !== h.hourKey) {
      h.hourKey = key;
      h.offsetMs = irelandOffsetMs(utcMs);
    }
    for (let i = 0; i < 4; i++) {
      const t = utcMs + h.offsetMs + LIAR_MIN[i] * 60e3;
      h.minute[i].rotation.z = ((((t % 3600e3) + 3600e3) % 3600e3) / 3600e3) * 2 * Math.PI;
      h.hour[i].rotation.z = ((((t % 43200e3) + 43200e3) % 43200e3) / 43200e3) * 2 * Math.PI;
    }
  },
};
