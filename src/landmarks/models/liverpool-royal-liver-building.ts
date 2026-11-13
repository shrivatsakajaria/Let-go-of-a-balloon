/**
 * The Royal Liver Building (1911), 98 m: the long granite block (51.5 m) with its projecting end
 * pavilions and the four little domed corner turrets, and its two clock towers, one at the river
 * end and one at the city end: two stepped stages, the clock stage with a 7 m dial on each face
 * (lit from dusk, hands on UK time), an open ring of columns, a drum and a dome, and on top the
 * Liver birds, wings raised: the river bird looks out to sea, the city bird over the city. Now and
 * then each bird stretches its wings (the plan's animated touch). Faceted pale granite, Contour
 * colours.
 *
 * Model frame (types.ts): origin on the ground midway between the towers, front (local -z) toward
 * the river, +x to the north-west. Plan positions follow the OpenStreetMap building parts (2026-11).
 */
import * as THREE from 'three';
import { Kit, LANDMARK_COLOURS as C } from '../kit';
import type { LandmarkModel } from '../types';
import { CONTOUR, type RegionStyle } from '../../world/palette';

/** Everything stands on this (below the street, so slopes never show under it). */
const B = -4;
/** Roof of the main block, m. */
const ROOF = 51.5;
/** The towers' centres on the axis, m. */
const TOWERS = [-36, 36];
const DIAL_Y = 74.5;
const DIAL_R = 3.4;
/** Half the clock stage's width, m. */
const CS = 6;
/** The birds stand here, m. */
const BIRD_Y = 98.2;
/** Verdigris copper: the Contour pale sea-green. */
const BIRD = CONTOUR.waterShallow;

type Hands = { hour: THREE.Object3D[]; minute: THREE.Object3D[]; hourKey: number; offsetMs: number };
type Wings = { left: THREE.Object3D[]; right: THREE.Object3D[] };

/** Last Sunday of a month (0-based), 01:00 UTC: when UK clocks change. */
function changeUtc(year: number, month: number): number {
  const last = new Date(Date.UTC(year, month + 1, 0));
  return last.getTime() - last.getUTCDay() * 864e5 + 3600e3;
}

/** UK offset from UTC at utcMs (British Summer Time from the last Sunday of March to the last of October). */
function ukOffsetMs(utcMs: number): number {
  const y = new Date(utcMs).getUTCFullYear();
  return utcMs >= changeUtc(y, 2) && utcMs < changeUtc(y, 9) ? 3600e3 : 0;
}

/** One clock hand, pointing up (+y) from its pivot, facing -z. */
function hand(length: number, width: number): Kit {
  const k = new Kit();
  const w = width / 2;
  k.quad('plain', C.iron, [-w, -0.5, 0], [w, -0.5, 0], [w * 0.5, length, 0], [-w * 0.5, length, 0], [0, 0, -1]);
  k.tri('plain', C.iron, -w * 0.5, length, 0, w * 0.5, length, 0, 0, length + 0.4, 0, 0, 0, -1);
  return k;
}

/** One raised wing in its shoulder's frame, spreading toward +x (side -1: toward -x), seen from both faces. */
function wing(side: 1 | -1): Kit {
  const k = new Kit();
  const P: [number, number][] = [[0, -0.3], [0, 0.6], [0.9, 2.3], [1.55, 1.9], [1.2, 0.3]];
  for (const [n, z] of [[-1, -0.05], [1, 0.05]] as const) {
    for (let i = 1; i < P.length - 1; i++) {
      const a = P[0], b = P[i], c = P[i + 1];
      // wound so each face looks out along its own normal
      const [p, q] = side * n < 0 ? [b, c] : [c, b];
      k.tri('plain', BIRD, side * a[0], a[1], z, side * p[0], p[1], z, side * q[0], q[1], z, 0, 0, n);
    }
  }
  return k;
}

/** A Liver bird's body, head and beak, standing on (0, 0, 0) of the current frame and facing -z. */
function birdBody(k: Kit): void {
  k.prism('plain', BIRD, 0, -0.2, 0, 0.6, 0.6, 6);
  k.box('plain', BIRD, 0, 0.4, 0.05, 0.6, 0.8, 0.5);
  k.prism('plain', BIRD, 0, 1.2, 0.1, 0.85, 1.9, 6, { r1: 0.62 });
  // the tail, sloping back and down
  k.quad('plain', BIRD, [-0.45, 1.5, 0.7], [0.45, 1.5, 0.7], [0.3, 0.7, 1.6], [-0.3, 0.7, 1.6], [0, 0.7, 1]);
  k.quad('plain', BIRD, [0.45, 1.5, 0.7], [-0.45, 1.5, 0.7], [-0.3, 0.7, 1.6], [0.3, 0.7, 1.6], [0, -0.7, -1]);
  // neck and head, reaching forward
  k.prism('plain', BIRD, 0, 3.0, -0.15, 0.36, 1.0, 6, { r1: 0.3 });
  k.box('plain', BIRD, 0, 4.0, -0.35, 0.56, 0.6, 0.95, { bottom: true });
  // the beak, a long wedge toward -z, with the sprig of laver hanging from it
  const t: [number, number, number] = [0, 4.15, -1.65];
  k.tri('plain', BIRD, -0.2, 4.45, -0.82, 0.2, 4.45, -0.82, t[0], t[1], t[2], 0, 1, -0.3);
  k.tri('plain', BIRD, 0.2, 4.45, -0.82, 0.2, 4.1, -0.82, t[0], t[1], t[2], 1, 0, -0.3);
  k.tri('plain', BIRD, -0.2, 4.1, -0.82, -0.2, 4.45, -0.82, t[0], t[1], t[2], -1, 0, -0.3);
  k.tri('plain', BIRD, 0.2, 4.1, -0.82, -0.2, 4.1, -0.82, t[0], t[1], t[2], 0, -1, -0.3);
  for (const n of [-1, 1]) {
    const z = -1.2 + n * 0.02;
    if (n < 0) k.quad('plain', CONTOUR.land[3], [-0.12, 4.1, z], [0.12, 4.1, z], [0.2, 3.1, z], [-0.05, 3.2, z], [0, 0, -1]);
    else k.quad('plain', CONTOUR.land[3], [0.12, 4.1, z], [-0.12, 4.1, z], [-0.05, 3.2, z], [0.2, 3.1, z], [0, 0, 1]);
  }
}

/** One clock tower above the roof, centred on (0, 0, 0) of the current frame. */
function tower(k: Kit): void {
  // two stepped stages, with piers at the corners of the upper one
  k.box('walls', C.chalkShade, 0, ROOF - 1, 0, 20, 59 - ROOF + 1, 19);
  k.box('plain', C.chalk, 0, 58.4, 0, 20.6, 0.8, 19.6, { top: false });
  k.box('walls', C.chalkShade, 0, 59, 0, 14, 10, 14, { topColour: C.slate });
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) k.box('plain', C.chalk, sx * 7, 59, sz * 7, 1.8, 10.6, 1.8);
  // the clock stage and its dials, a cornice, a little dome at each corner
  k.box('plain', C.chalkShade, 0, 69, 0, 2 * CS, 11.5, 2 * CS, { topColour: C.slate });
  k.box('plain', C.chalk, 0, 80, 0, 2 * CS + 0.8, 0.8, 2 * CS + 0.8, { topColour: C.slate });
  for (let i = 0; i < 4; i++) {
    k.push(0, 0, 0, i * 90);
    k.disc('plain', C.iron, 0, DIAL_Y, -CS - 0.05, DIAL_R + 0.35, 20, [0, 0, -1]);
    k.disc('glow', C.chalk, 0, DIAL_Y, -CS - 0.12, DIAL_R, 20, [0, 0, -1]);
    k.pop();
  }
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    k.prism('plain', C.chalk, sx * (CS - 0.6), 80.8, sz * (CS - 0.6), 1.0, 1.0, 8, { top: false });
    k.spire('plain', C.slate, sx * (CS - 0.6), 81.8, sz * (CS - 0.6), 1.05, 1.4, 8);
  }
  // the open ring of columns round a dark core, its entablature, the drum and the dome
  k.prism('plain', C.chalk, 0, 80.8, 0, 5.3, 0.8, 12, { topColour: C.paving });
  k.prism('plain', C.stoneDeep, 0, 81.6, 0, 2.8, 7.4, 8, { top: false });
  for (let i = 0; i < 12; i++) {
    const a = ((i + 0.5) * Math.PI) / 6;
    k.prism('plain', C.chalk, Math.sin(a) * 4.5, 81.6, -Math.cos(a) * 4.5, 0.38, 7.4, 4, { top: false });
  }
  k.prism('plain', C.chalk, 0, 89, 0, 5.3, 1.5, 12, { topColour: C.slate });
  k.prism('plain', C.chalkShade, 0, 90.5, 0, 3.3, 4.7, 12, { top: false });
  k.prism('plain', C.chalk, 0, 94.8, 0, 3.6, 0.5, 12, { top: false });
  k.prism('plain', C.slate, 0, 95.3, 0, 3.4, 1.4, 12, { r1: 2.6, top: false });
  k.prism('plain', C.slate, 0, 96.7, 0, 2.6, 1.0, 12, { r1: 1.4, top: false });
  k.spire('plain', C.slate, 0, 97.7, 0, 1.4, 0.5, 12);
}

/** A domed corner turret on the roof, at (x, z). */
function turret(k: Kit, x: number, z: number): void {
  k.box('plain', C.chalkShade, x, ROOF - 1, z, 9, 7.5, 3);
  k.box('plain', C.chalkShade, x, ROOF - 1, z, 3, 7.5, 9);
  k.prism('plain', C.chalk, x, ROOF - 1, z, 3.4, 5.9, 8, { top: false });
  k.prism('plain', C.chalk, x, ROOF + 4.9, z, 3.8, 0.6, 8, { top: false });
  k.prism('plain', C.slate, x, ROOF + 5.5, z, 3.6, 2.2, 8, { r1: 2.4, top: false });
  k.spire('plain', C.slate, x, ROOF + 7.7, z, 2.4, 1.9, 8);
  k.prism('plain', C.chalk, x, ROOF + 9.6, z, 0.25, 1.0, 4);
}

export const model: LandmarkModel = {
  build(_style: RegionStyle) {
    const k = new Kit();
    // the block: the recessed middle, the end pavilions, a granite plinth, the cornice and attic
    k.box('walls', C.chalkShade, 0, B, 0, 50, ROOF - B, 52, { topColour: C.slate });
    for (const z of [-36, 35]) {
      k.box('walls', C.chalkShade, 0, B, z, 56, ROOF - B, 20, { topColour: C.slate });
      for (const x of [-28.3, 28.3]) for (const dz of [-6, 0, 6]) k.box('plain', C.chalk, x, 8, z + dz, 0.6, ROOF - 10, 0.9, { top: false });
    }
    k.box('plain', C.stoneDeep, 0, B, -36, 56.6, 10 - B, 20.6, { top: false });
    k.box('plain', C.stoneDeep, 0, B, 35, 56.6, 10 - B, 20.6, { top: false });
    k.box('plain', C.stoneDeep, 0, B, 0, 50.6, 10 - B, 52, { top: false });
    k.box('plain', C.chalk, 0, ROOF - 1, -36, 57, 1.2, 21, { top: false });
    k.box('plain', C.chalk, 0, ROOF - 1, 35, 57, 1.2, 21, { top: false });
    k.box('plain', C.chalk, 0, ROOF - 1, 0, 51, 1.2, 52, { top: false });
    k.box('plain', C.chalkShade, 0, ROOF - 1, -1, 34, 55 - ROOF + 1, 16, { topColour: C.slate });
    // the river entrance, projecting from the front
    k.box('walls', C.chalkShade, 0.5, B, -49.5, 11, 10 - B, 7, { topColour: C.slate });
    k.box('plain', C.chalk, 0.5, 10, -48, 5, 6.5, 2.4);
    k.box('plain', C.iron, 0.5, 0, -53.1, 4, 6, 0.3, { top: false });
    for (const [x, z] of [[-20, -34], [20, -34], [-20, 34], [20, 34]]) turret(k, x, z);
    for (const z of TOWERS) {
      k.push(0, 0, z);
      tower(k);
      k.pop();
    }
    // the birds' bodies: the river bird faces the river (-z), the city bird the city (+z)
    for (const z of TOWERS) {
      k.push(0, BIRD_Y, z, z < 0 ? 0 : 180);
      birdBody(k);
      k.pop();
    }
    const g = k.group('liverpool-royal-liver-building');

    // the wings, each on a shoulder pivot, turned in animate
    const wings: Wings = { left: [], right: [] };
    const wk = { left: wing(-1), right: wing(1) };
    for (const z of TOWERS) {
      const bird = new THREE.Group();
      bird.position.set(0, BIRD_Y, z);
      bird.rotation.y = z < 0 ? 0 : Math.PI;
      for (const side of ['left', 'right'] as const) {
        const pivot = new THREE.Group();
        pivot.position.set(side === 'left' ? -0.55 : 0.55, 2.7, 0.15);
        const m = wk[side].mesh('plain', `wing-${side}`)!;
        pivot.add(m);
        bird.add(pivot);
        wings[side].push(pivot);
      }
      g.add(bird);
    }
    g.userData.wings = wings;

    // the clock hands, one pair per dial
    const hourKit = hand(2.1, 0.5), minuteKit = hand(3.0, 0.36);
    const hands: Hands = { hour: [], minute: [], hourKey: Number.NaN, offsetMs: 0 };
    for (const z of TOWERS) {
      for (let i = 0; i < 4; i++) {
        const pivot = new THREE.Group();
        pivot.rotation.y = (-i * Math.PI) / 2;
        const a = (i * Math.PI) / 2;
        // the dial's centre, turned with its face (as Kit.push turns: clockwise from above)
        pivot.position.set((CS + 0.12) * Math.sin(a), DIAL_Y, z - (CS + 0.12) * Math.cos(a));
        const hour = hourKit.mesh('plain', `hour-${i}`)!;
        const minute = minuteKit.mesh('plain', `minute-${i}`)!;
        hour.position.z = -0.12;
        minute.position.z = -0.2;
        hour.castShadow = minute.castShadow = false;
        pivot.add(hour, minute);
        hands.hour.push(hour);
        hands.minute.push(minute);
        g.add(pivot);
      }
    }
    g.userData.hands = hands;
    return g;
  },

  animate(group, utcMs) {
    const h = group.userData.hands as Hands | undefined;
    const w = group.userData.wings as Wings | undefined;
    if (h) {
      // the UK offset is worked out once an hour
      const key = Math.floor(utcMs / 3600e3);
      if (key !== h.hourKey) {
        h.hourKey = key;
        h.offsetMs = ukOffsetMs(utcMs);
      }
      const t = utcMs + h.offsetMs;
      const minute = ((((t % 3600e3) + 3600e3) % 3600e3) / 3600e3) * 2 * Math.PI;
      const hour = ((((t % 43200e3) + 43200e3) % 43200e3) / 43200e3) * 2 * Math.PI;
      for (let i = 0; i < h.hour.length; i++) {
        h.hour[i].rotation.z = hour;
        h.minute[i].rotation.z = minute;
      }
    }
    if (w) {
      // every 23 s a bird stretches: two slow beats of its wings over 2.4 s (the city bird 9 s later)
      for (let b = 0; b < w.left.length; b++) {
        const u = (((utcMs / 1000 + b * 9) % 23) + 23) % 23;
        const s = u < 2.4 ? Math.sin((Math.PI * u) / 1.2) : 0;
        const a = 0.32 * s * s;
        w.right[b].rotation.z = a;
        w.left[b].rotation.z = -a;
      }
    }
  },
};

