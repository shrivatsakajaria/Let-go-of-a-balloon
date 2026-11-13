/**
 * The Elizabeth Tower (Big Ben), 96 m: a square stone shaft with Perpendicular panelling and corner
 * buttresses, the clock stage with four 7 m dials in gilt frames (opal faces that light from dusk,
 * hands that show London time), the belfry with its tall lancets, and the steep iron spire with
 * lucarnes, corner pinnacles and a gilt finial. Faceted chalk stone, Contour colours.
 *
 * Model frame (types.ts): origin on the ground at the tower's centre, front (local -z) along the
 * palace axis, toward Bridge Street.
 */
import * as THREE from 'three';
import { Kit, LANDMARK_COLOURS as C } from '../kit';
import type { LandmarkModel } from '../types';

/** Half the shaft's width, m. */
const S = 6;
/** Clock dial: radius and centre height, m. */
const DIAL_R = 3.5;
const DIAL_Y = 57.5;
const DIAL_Z = -(S + 1.1);

type Hands = { hour: THREE.Object3D[]; minute: THREE.Object3D[]; hourKey: number; offsetMs: number };

/** Last Sunday of a month (0-based), 01:00 UTC: when UK clocks change. */
function changeUtc(year: number, month: number): number {
  const last = new Date(Date.UTC(year, month + 1, 0));
  return last.getTime() - last.getUTCDay() * 864e5 + 3600e3;
}

/** London's offset from UTC at utcMs: British Summer Time from the last Sunday of March to the last of October. */
export function londonOffsetMs(utcMs: number): number {
  const y = new Date(utcMs).getUTCFullYear();
  return utcMs >= changeUtc(y, 2) && utcMs < changeUtc(y, 9) ? 3600e3 : 0;
}

/** One hand, pointing up (+y) from its pivot, in the dial's plane, facing -z. */
function hand(length: number, width: number): Kit {
  const k = new Kit();
  const w = width / 2;
  k.quad('plain', C.iron, [-w, -0.5, 0], [w, -0.5, 0], [w * 0.5, length, 0], [-w * 0.5, length, 0], [0, 0, -1]);
  k.tri('plain', C.iron, -w * 0.5, length, 0, w * 0.5, length, 0, 0, length + 0.35, 0, 0, 0, -1);
  return k;
}

/** Everything drawn on one face of the tower (the -z face of the current frame). */
function face(k: Kit): void {
  const z = -S;
  // panelling: two tall ribs on the shaft, and a third on the base
  for (const x of [-2.2, 2.2]) k.box('plain', C.chalkShade, x, 3, z - 0.2, 0.6, 49, 0.5, { top: false });
  k.box('plain', C.stoneDeep, 0, 3, z - 0.1, 3.2, 12, 0.3, { top: false });
  // the clock: a gilt frame, the opal dial (glow), a stone pediment over it with two pinnacles
  k.box('plain', C.gilt, 0, DIAL_Y - 4.4, z - 1.0, 8.8, 8.8, 0.4, { top: false });
  k.disc('glow', C.chalk, 0, DIAL_Y, DIAL_Z - 0.02, DIAL_R, 24, [0, 0, -1]);
  k.disc('plain', C.iron, 0, DIAL_Y, DIAL_Z - 0.06, 0.35, 6, [0, 0, -1]);
  k.push(0, 63, z - 0.4, 90);
  k.gable('plain', C.chalk, 0, 0, 0, 1.6, 9.2, 3.2, { ends: C.stone });
  k.pop();
  for (const x of [-4.8, 4.8]) {
    k.prism('plain', C.chalk, x, 62, z - 0.5, 0.55, 4.2, 4);
    k.spire('plain', C.chalkShade, x, 66.2, z - 0.5, 0.75, 2.4, 4);
  }
  // belfry lancets: three tall dark openings with pointed heads
  for (const x of [-3.2, 0, 3.2]) {
    k.box('plain', C.iron, x, 65.4, -5.55, 1.7, 5.8, 0.3, { top: false });
    k.push(x, 71.2, -5.55);
    k.quad('plain', C.iron, [-0.85, 0, -0.15], [0.85, 0, -0.15], [0.3, 0.9, -0.15], [-0.3, 0.9, -0.15], [0, 0, -1]);
    k.pop();
  }
  // a lucarne (dormer) on the spire, gilt-roofed
  k.box('plain', C.chalkShade, 0, 77, -4.35, 2.4, 3.2, 1.6);
  k.push(0, 80.2, -4.35, 90);
  k.gable('plain', C.gilt, 0, 0, 0, 1.8, 2.8, 1.6, { ends: C.chalk });
  k.pop();
}

export const model: LandmarkModel = {
  build() {
    const k = new Kit();
    // plinth, shaft, belt courses, clock stage, belfry, parapets
    k.box('plain', C.stoneDeep, 0, -4, 0, 2 * S + 1.4, 7, 2 * S + 1.4, { topColour: C.paving });
    k.box('walls', C.stone, 0, 3, 0, 2 * S, 49.2, 2 * S, { top: false });
    for (const y of [16, 33]) k.box('plain', C.chalk, 0, y, 0, 2 * S + 0.7, 0.6, 2 * S + 0.7);
    k.box('plain', C.stone, 0, 52, 0, 2 * S + 1.6, 11, 2 * S + 1.6);
    k.box('plain', C.chalk, 0, 51.6, 0, 2 * S + 2.0, 0.8, 2 * S + 2.0, { top: false });
    k.box('plain', C.stone, 0, 63, 0, 11, 11.4, 11);
    k.box('plain', C.chalk, 0, 74.4, 0, 11.8, 1, 11.8);
    // corner buttresses up the shaft, corner pinnacles at the clock stage and at the belfry
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      k.box('plain', C.stone, sx * S, 3, sz * S, 1.7, 49, 1.7);
      k.prism('plain', C.chalk, sx * (S + 0.9), 62, sz * (S + 0.9), 1.0, 4.6, 4, { rot: 45 });
      k.spire('plain', C.chalkShade, sx * (S + 0.9), 66.6, sz * (S + 0.9), 1.0, 3.4, 4, 45);
      k.prism('plain', C.chalk, sx * 5.3, 75.4, sz * 5.3, 0.8, 3.6, 4, { rot: 45 });
      k.spire('plain', C.gilt, sx * 5.3, 79, sz * 5.3, 0.8, 3.6, 4, 45);
    }
    for (let i = 0; i < 4; i++) {
      k.push(0, 0, 0, i * 90);
      face(k);
      k.pop();
    }
    // the spire, its lantern and the gilt finial
    k.pyramid('plain', C.iron, 0, 75.4, 0, 10.6, 10.6, 15.6);
    k.prism('plain', C.iron, 0, 88.6, 0, 1.4, 3.6, 8, { top: false });
    k.spire('plain', C.gilt, 0, 92.2, 0, 1.5, 3.3, 8);
    k.prism('plain', C.gilt, 0, 95.4, 0, 0.18, 0.8, 4);

    const g = k.group('london-elizabeth-tower');
    // hands, one pair per dial, turned in animate
    const hourKit = hand(2.2, 0.5), minuteKit = hand(3.1, 0.36);
    const hands: Hands = { hour: [], minute: [], hourKey: Number.NaN, offsetMs: 0 };
    for (let i = 0; i < 4; i++) {
      const pivot = new THREE.Group();
      pivot.rotation.y = (-i * Math.PI) / 2;
      const a = (i * Math.PI) / 2;
      // the dial centre, turned with its face (as Kit.push turns: clockwise from above)
      pivot.position.set(-DIAL_Z * Math.sin(a), DIAL_Y, DIAL_Z * Math.cos(a));
      const hour = hourKit.mesh('plain', `hour-${i}`)!;
      const minute = minuteKit.mesh('plain', `minute-${i}`)!;
      hour.position.z = -0.12;
      minute.position.z = -0.18;
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
    // the UK offset is worked out once an hour
    const key = Math.floor(utcMs / 3600e3);
    if (key !== h.hourKey) {
      h.hourKey = key;
      h.offsetMs = londonOffsetMs(utcMs);
    }
    const t = utcMs + h.offsetMs;
    const minute = ((((t % 3600e3) + 3600e3) % 3600e3) / 3600e3) * 2 * Math.PI;
    const hour = ((((t % 43200e3) + 43200e3) % 43200e3) / 43200e3) * 2 * Math.PI;
    for (let i = 0; i < 4; i++) {
      h.hour[i].rotation.z = hour;
      h.minute[i].rotation.z = minute;
    }
  },
};
