/**
 * Cardiff Castle: the walls round the green (the rebuilt Roman wall on its bank to the north and
 * east, the medieval south wall on Castle Street with the Barbican Tower at its gate), the Norman
 * shell keep on its motte with its gate tower and the wall running down to the south gate, and
 * Burges's Gothic west range: the Clock Tower at the south-west corner (46 m, with its gilt-framed
 * dials that light from dusk and keep UK time), the Octagon Tower and its spire, the Bute and Herbert towers.
 * Faceted grey and pale stone, slate and lead, Contour colours.
 *
 * Built in map metres (x east, z south of the origin, the middle of the green) inside a turn that
 * undoes the site's heading, so every part sits where OpenStreetMap has it. The castle's own grid
 * is turned 15 deg anticlockwise from north. Heights from the green (11.4 m above the sea); the
 * motte is in the map's ground (its top about 9 m up).
 */
import * as THREE from 'three';
import { Kit, LANDMARK_COLOURS as C } from '../kit';
import { clockState, hourAngle, localMs, minuteAngle, type ClockState } from '../clock';
import type { LandmarkModel } from '../types';
import type { Color } from '../../world/palette';

/** The site's heading (sites/cardiff.ts): the model is built in map axes inside a turn by -HEADING. */
const HEADING = 166;
/** The castle's grid: its walls run 15 deg anticlockwise from north. */
const GRID = -15;
const D = 180 / Math.PI;

/** A block on the line (e0, s0) to (e1, s1), w wide, walls from y0 to y1, then a roof roofH high along it. */
function bar(k: Kit, colour: Color, roof: Color, e0: number, s0: number, e1: number, s1: number, w: number, y0: number, y1: number, roofH = 0, hip = 0): void {
  const de = e1 - e0, ds = s1 - s0;
  k.push((e0 + e1) / 2, 0, (s0 + s1) / 2, Math.atan2(de, -ds) * D);
  k.box('walls', colour, 0, y0, 0, w, y1 - y0, Math.hypot(de, ds), { top: roofH <= 0, topColour: C.paving });
  if (roofH > 0) k.gable('plain', roof, 0, y1, 0, w + 0.6, Math.hypot(de, ds) + 0.6, roofH, { ends: colour, hip });
  k.pop();
}

/** A wall along a polyline of [east, south] points, `thick` thick, from y0 to y1, with a parapet. */
function wallLine(k: Kit, colour: Color, pts: number[][], y0: number, y1: number, thick: number): void {
  for (let i = 0; i + 1 < pts.length; i++) {
    const [e0, s0] = pts[i], [e1, s1] = pts[i + 1];
    const de = e1 - e0, ds = s1 - s0, len = Math.hypot(de, ds);
    k.push((e0 + e1) / 2, 0, (s0 + s1) / 2, Math.atan2(de, -ds) * D);
    k.box('plain', colour, 0, y0, 0, thick, y1 - y0, len + thick * 0.8, { topColour: C.paving });
    // the parapet on the outer (left) side
    k.box('plain', colour, -thick / 2 + 0.3, y1, 0, 0.6, 1.3, len + thick * 0.8);
    k.pop();
  }
}

/** A square tower, side s, at (e, s) turned to the castle's grid, y0 to y1, with a crenellated parapet. */
function tower(k: Kit, colour: Color, e: number, sth: number, side: number, y0: number, y1: number): void {
  k.push(e, 0, sth, GRID);
  k.box('walls', colour, 0, y0, 0, side, y1 - y0, side, { topColour: C.paving });
  for (let i = 0; i < 4; i++) {
    k.push(0, 0, 0, i * 90);
    for (const x of [-side / 2 + 0.6, 0, side / 2 - 0.6]) k.box('plain', colour, x, y1, -side / 2 + 0.4, 1.2, 1.4, 0.8);
    k.pop();
  }
  k.pop();
}

/** The Norman shell keep: a 12-sided ring wall of radius r, `t` thick, from y0 to y1. */
function shell(k: Kit, colour: Color, e: number, s: number, r: number, t: number, y0: number, y1: number): void {
  const n = 12;
  for (let i = 0; i < n; i++) {
    const a = (i * 2 * Math.PI) / n, b = ((i + 1) * 2 * Math.PI) / n, m = (a + b) / 2;
    const p = (rad: number, ang: number, y: number): [number, number, number] => [e + rad * Math.sin(ang), y, s - rad * Math.cos(ang)];
    const ri = r - t;
    const out: [number, number, number] = [Math.sin(m), 0, -Math.cos(m)];
    k.quad('plain', colour, p(r, a, y0), p(r, b, y0), p(r, b, y1), p(r, a, y1), out);
    k.quad('plain', colour, p(ri, b, y0), p(ri, a, y0), p(ri, a, y1), p(ri, b, y1), [-out[0], 0, -out[2]]);
    k.quad('plain', C.paving, p(ri, a, y1), p(ri, b, y1), p(r, b, y1), p(r, a, y1), [0, 1, 0]);
  }
}

export const model: LandmarkModel = {
  build(style) {
    const k = new Kit();
    const pivots: THREE.Group[] = [];
    // the walls' grey stone: the region's where it has one
    const GREY = style.walls[3] ?? C.stoneDeep;
    k.push(0, 0, 0, -HEADING);

    // ---- the walls round the green ----
    // north and east: the Roman wall rebuilt on its bank (the bank is in the map's ground)
    wallLine(k, GREY, [[-32, -100], [-18, -102], [-1, -106], [16, -111], [42, -117], [63, -123]], -3, 10, 3);
    wallLine(k, GREY, [[63, -123], [71, -96], [78, -76], [82, -57], [86, -41], [91, -23], [94, -10], [100, 13], [103, 25], [107, 41], [112, 61], [115, 70]], -3, 10, 3);
    // south: the Roman wall to the gate, then the medieval wall to the Clock Tower
    wallLine(k, GREY, [[115, 70], [92, 78], [74, 84], [53, 88], [36, 92]], -3, 10, 3);
    wallLine(k, GREY, [[22, 96], [0, 101], [-36, 108], [-55, 112]], -3, 11, 2.6);
    // west: behind the house, and the north-west walls to the North Gate
    wallLine(k, GREY, [[-70, 82], [-89, 33], [-99, -10], [-107, -46], [-113, -75], [-111, -78], [-72, -89], [-45, -95], [-32, -100]], -3, 10, 2.6);
    // the North Gate: two half-round towers
    for (const [e, s] of [[-30, -97.5], [-20, -100.5]]) k.prism('plain', GREY, e, -3, s, 3.6, 15, 8, { topColour: C.paving });
    k.push(-25, 0, -99, GRID);
    k.box('plain', GREY, 0, 6, 0, 7, 7, 4);
    k.box('plain', C.iron, 0, -1, -2.05, 3.2, 7, 0.2, { top: false });
    k.pop();

    // ---- the south gate and the Barbican Tower ----
    tower(k, GREY, 31, 89, 8, -3, 19);
    k.push(26, 0, 94, GRID);
    k.box('plain', GREY, 0, -3, 0, 6, 15, 6, { topColour: C.paving });
    k.box('plain', C.iron, 0, -1, 3.05, 3, 6.5, 0.2, { top: false });
    k.pop();

    // ---- the Norman keep: a 12-sided shell on the motte, its gate tower, the wall down to the gate ----
    shell(k, GREY, -50, -40, 13.5, 2, 4, 20);
    tower(k, GREY, -44, -25, 8, 5, 27);
    wallLine(k, GREY, [[-41, -21], [-37, -10]], 2, 13, 2);
    wallLine(k, GREY, [[-37, -10], [-32, 5]], -1, 9, 2);
    wallLine(k, GREY, [[-32, 5], [-12, 32], [-2, 48], [3, 60]], -3, 7, 2);

    // ---- the west range: the house, the Bute, Octagon and Herbert towers ----
    bar(k, C.stone, C.slate, -82, 32, -69, 72, 14, -3, 17, 6);
    tower(k, C.stone, -84, 36, 10, -3, 30);
    k.push(-84, 0, 36, GRID);
    k.pyramid('plain', C.slate, 0, 31.4, 0, 9, 9, 7);
    k.pop();
    k.prism('walls', C.stone, -79, -3, 52, 6.2, 33, 8, { topColour: C.paving });
    k.prism('plain', C.stoneDeep, -79, 30, 52, 6.6, 1.2, 8);
    k.spire('plain', C.iron, -79, 31.2, 52, 5.4, 16, 8);
    k.prism('plain', C.gilt, -79, 47, 52, 0.15, 1.6, 4);
    tower(k, C.stone, -75, 67, 9, -3, 24);
    k.push(-75, 0, 67, GRID);
    k.pyramid('plain', C.slate, 0, 25.4, 0, 8, 8, 6);
    k.pop();
    // the low range from the house to the Clock Tower
    bar(k, C.stone, C.slate, -67, 80, -62, 102, 10, -3, 12, 4);

    // ---- the Clock Tower: shaft, dials, the machicolated upper stage, turrets, the steep roof ----
    k.push(-58.3, 0, 108.8, GRID);
    k.box('walls', C.stone, 0, -3, 0, 10, 33, 10, { top: false });
    k.box('plain', C.chalk, 0, 30, 0, 11.6, 0.8, 11.6, { top: false });
    k.box('plain', C.stone, 0, 30.8, 0, 11.2, 6.2, 11.2, { topColour: C.paving });
    for (let i = 0; i < 4; i++) {
      k.push(0, 0, 0, i * 90);
      k.box('plain', C.gilt, 0, 21.4, -5.2, 6.4, 6.4, 0.4, { top: false });
      k.disc('glow', C.chalk, 0, 24.6, -5.45, 2.7, 16, [0, 0, -1]);
      k.disc('plain', C.iron, 0, 24.6, -5.5, 0.3, 6, [0, 0, -1]);
      // the hands' pivot on the dial (the hands are added below, turned in animate)
      pivots.push(k.place(new THREE.Group(), 0, 24.6, -5.5));
      // a lancet pair in the upper stage
      for (const x of [-1.6, 1.6]) k.box('plain', C.iron, x, 32.2, -5.65, 1.1, 3.6, 0.2, { top: false });
      k.pop();
    }
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      k.prism('plain', C.stone, sx * 5.4, 31, sz * 5.4, 1.5, 8, 8, { top: false });
      k.spire('plain', C.slate, sx * 5.4, 39, sz * 5.4, 1.7, 4, 8);
    }
    k.pyramid('plain', C.slate, 0, 37, 0, 9.4, 9.4, 7.5);
    k.prism('plain', C.gilt, 0, 44.4, 0, 0.2, 1.8, 4);
    k.pop();

    k.pop();
    const g = k.group('cardiff-castle');
    // the hands, dark iron, one pair per dial, on UK time
    const hourKit = hand(1.6, 0.3), minuteKit = hand(2.2, 0.24);
    const hands: Hands = { ...clockState(), hour: [], minute: [] };
    pivots.forEach((pivot, i) => {
      const hour = hourKit.mesh('plain', `hour-${i}`)!;
      const minute = minuteKit.mesh('plain', `minute-${i}`)!;
      hour.position.z = -0.03;
      minute.position.z = -0.06;
      hour.castShadow = minute.castShadow = false;
      pivot.add(hour, minute);
      hands.hour.push(hour);
      hands.minute.push(minute);
      g.add(pivot);
    });
    g.userData.hands = hands;
    return g;
  },

  animate(group, utcMs) {
    const h = group.userData.hands as Hands | undefined;
    if (!h) return;
    const t = localMs(h, utcMs);
    const minute = minuteAngle(t), hour = hourAngle(t);
    for (let i = 0; i < h.hour.length; i++) {
      h.hour[i].rotation.z = hour;
      h.minute[i].rotation.z = minute;
    }
  },
};

type Hands = ClockState & { hour: THREE.Object3D[]; minute: THREE.Object3D[] };

/** One hand, pointing up (+y) from its pivot, in the dial's plane, facing -z. */
function hand(length: number, width: number): Kit {
  const k = new Kit();
  const w = width / 2;
  k.quad('plain', C.iron, [-w, -0.3, 0], [w, -0.3, 0], [w * 0.8, length, 0], [-w * 0.8, length, 0], [0, 0, -1]);
  return k;
}
