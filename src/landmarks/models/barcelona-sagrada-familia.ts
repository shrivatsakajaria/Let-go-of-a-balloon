/**
 * The Sagrada Família as it stands in 2026: the Tower of Jesus Christ (172.5 m) over the crossing
 * with its four-armed cross, the four Evangelists' towers (135 m) round it, the Virgin Mary's tower
 * (138 m) over the apse with its star, the Nativity façade (north-east) and the Passion façade
 * (south-west) each with four spindle bell towers (98-112 m), the nave and transept, the apse and
 * the two domed sacristies, and the unfinished Glory façade (south-east) with two tower cranes that
 * slowly slew (the CSV's animated touch). The cross and the star light from dusk.
 *
 * Model frame (types.ts): origin on the ground at the crossing (under the Tower of Jesus Christ);
 * the front (local -z) is the Glory façade toward Carrer de Mallorca (134.5 deg, the Eixample
 * grid); +x is the Passion façade, -x the Nativity façade, +z the apse. Plan from the OpenStreetMap
 * building parts (2026-11).
 */
import * as THREE from 'three';
import { Kit, LANDMARK_COLOURS as C } from '../kit';
import type { LandmarkModel } from '../types';
import type { Color } from '../../world/palette';

/** The Nativity cypress: Contour's deepest sage (CONTOUR.land[4]). */
const CYPRESS: Color = '#76a063';

/** Everything stands on this (below the street). */
const B = -4;

/**
 * A Gaudí spindle: a round tower narrowing like a parabola from radius r at y0 to a point at y1,
 * then its pinnacle (a gilt shaft, a ring and a ball) above.
 */
function spindle(k: Kit, colour: Color, x: number, z: number, y0: number, y1: number, r: number, sides = 8): void {
  const n = 6;
  for (let i = 0; i < n; i++) {
    const t0 = i / n, t1 = (i + 1) / n;
    const ra = r * (1 - 0.82 * t0 ** 1.7), rb = r * (1 - 0.82 * t1 ** 1.7);
    k.prism('plain', colour, x, y0 + (y1 - y0) * t0, z, ra, (y1 - y0) / n, sides, { r1: rb, top: i === n - 1 });
  }
  const p = r * 0.18;
  k.prism('plain', C.chalk, x, y1, z, p * 1.6, 2, 6, { r1: p * 2.6 });
  k.prism('plain', C.gilt, x, y1 + 2, z, p * 2.6, 3.5, 6, { r1: p * 1.2 });
  k.spire('plain', C.gilt, x, y1 + 5.5, z, p * 1.2, 2.4, 6);
}

/** A façade's four bell towers, on x = fx, at z = ±7.5 (inner) and ±15.5 (outer): straight shafts through the façade, spindles above. */
function belfries(k: Kit, colour: Color, fx: number, inner: number, outer: number): void {
  for (const [z, top] of [[-15.5, outer], [-7.5, inner], [7.5, inner], [15.5, outer]]) {
    // a straight shaft through the façade, then the free spindle above it
    k.prism('plain', colour, fx, 16, z, 3.4, 26, 8, { top: false });
    spindle(k, colour, fx, z, 42, top - 8, 3.4);
  }
}

/** A tower crane: the mast in the model kit, the slewing top as its own mesh (turned in animate). */
function crane(k: Kit, x: number, z: number, h: number, jib: number, name: string): THREE.Object3D {
  k.box('plain', C.chalkShade, x, B, z, 2, h - B, 2, { top: false });
  const t = new Kit();
  t.box('plain', C.slate, 0, 0, -jib / 2 + 1, 1.6, 1.8, jib);
  t.box('plain', C.slate, 0, 0, 6, 1.6, 1.4, 12);
  t.box('plain', C.iron, 0, -2.4, 10.5, 3, 2.4, 3);
  t.box('plain', C.chalk, 1.6, -2.6, 0, 1.8, 2.6, 2.2);
  t.spire('plain', C.slate, 0, 1.8, 0, 1.4, 6, 4, 45);
  const top = t.mesh('plain', name)!;
  top.position.set(x, h, z);
  return top;
}

type Cranes = { tops: THREE.Object3D[] };

export const model: LandmarkModel = {
  build() {
    const k = new Kit();
    const stone = C.stone, body = C.chalkShade, old = C.stoneDeep;
    // the paved temple block
    k.box('plain', C.stoneDeep, 0, B, -3, 92, -B + 0.15, 112, { topColour: C.paving });

    // nave (to the Glory façade) and transept: aisles, then the high central vessel and its roof
    k.box('plain', body, 0, B, -35, 45, 30 - B, 36, { topColour: old });
    k.box('plain', body, 0, 30, -35, 17, 16, 36, { top: false });
    k.push(0, 46, -35);
    k.gable('plain', stone, 0, 0, 0, 17, 36, 13, { ends: body });
    k.pop();
    k.box('plain', body, 0, B, 0, 70, 30 - B, 30, { topColour: old });
    k.push(0, 46, 0, 90);
    k.gable('plain', stone, 0, 0, 0, 17, 70, 13, { ends: body });
    k.pop();
    for (const s of [-1, 1]) k.box('plain', body, s * 27, 30, 0, 16, 16, 17, { top: false });
    // the crossing, under the towers
    k.box('plain', body, 0, B, 0, 38, 62 - B, 38, { topColour: old });
    k.prism('plain', stone, 0, 62, 0, 19.5, 18, 8, { r1: 16, rot: 22.5, topColour: old });

    // the apse: a ring of chapels and its pinnacles, a stone roof rising to the Virgin Mary's tower
    k.prism('plain', body, 0, B, 17, 27, 32 - B, 12, { r1: 26, topColour: old });
    k.prism('plain', stone, 0, 32, 17, 22, 16, 12, { r1: 9 });
    for (let i = 0; i < 7; i++) {
      const a = ((i - 3) * 28 * Math.PI) / 180;
      spindle(k, stone, Math.sin(a) * 26, 17 + Math.cos(a) * 26, 28, 44, 2.2, 6);
    }
    // the sacristies: square halls, each with a ribbed dome and a pinnacle
    for (const s of [-1, 1]) {
      k.box('plain', body, s * 31, B, 44, 16, 22 - B, 16, { top: false });
      k.prism('plain', stone, s * 31, 22, 44, 11, 10, 12, { r1: 5 });
      spindle(k, stone, s * 31, 32, 44, 44, 3, 8);
    }

    // the Glory façade, unfinished: the porch walls, a lower front
    k.box('plain', old, 0, B, -55, 48, 34 - B, 7, { topColour: C.paving });
    for (const x of [-16, -6, 6, 16]) k.box('plain', stone, x, B, -59, 4, 26 - B, 4, { topColour: old });

    // the Nativity façade (-x): older, darker stone, three portals under gables, the green cypress
    k.box('plain', old, -38, B, 0, 8, 34 - B, 42, { top: false });
    for (const [z, h] of [[-12, 42], [0, 48], [12, 42]]) {
      k.push(-42.5, 0, z, -90);
      k.gable('plain', old, 0, 30, 0, 11, 4, h - 30, { ends: old });
      k.pop();
    }
    k.spire('plain', CYPRESS, -41, 46, 0, 3.6, 14, 8);
    belfries(k, old, -38, 107, 98);

    // the Passion façade (+x): plain stone, the pediment over the leaning-column porch
    k.box('plain', stone, 38, B, 0, 8, 40 - B, 42, { top: false });
    k.push(41, 40, 0, 90);
    k.gable('plain', body, 0, 0, 0, 42, 3, 16, { ends: stone });
    k.pop();
    k.box('plain', body, 46, 19, 0, 8, 3, 32);
    for (let i = 0; i < 6; i++) k.prism('plain', stone, 48.5, B, -12.5 + i * 5, 0.9, 19 - B, 5, { r1: 1.3, top: false });
    belfries(k, stone, 38, 112, 107);

    // the four Evangelists' towers round the crossing, each crowned by its emblem (a plain sculpted block)
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const x = sx * 12, z = sz * 12;
      k.prism('plain', C.chalk, x, 62, z, 5.2, 18, 8, { top: false });
      k.prism('plain', C.chalk, x, 80, z, 5.2, 46, 8, { r1: 3.2, top: false });
      k.prism('plain', C.chalkShade, x, 126, z, 3.4, 3, 8, { r1: 4.2 });
      k.box('plain', C.gilt, x, 129, z, 4, 4.5, 4);
      k.spire('plain', C.gilt, x, 133.5, z, 2.6, 1.8, 4, 45);
    }

    // the Virgin Mary's tower over the apse, its twelve-pointed star (lit from dusk)
    k.prism('plain', C.chalk, 0, 44, 22, 7, 40, 12, { r1: 6, top: false });
    k.prism('plain', C.chalk, 0, 84, 22, 6, 42, 12, { r1: 3.6, top: false });
    k.prism('plain', C.chalkShade, 0, 126, 22, 3.6, 4, 12, { r1: 1.2 });
    for (const [ax, ay, az] of [[1, 0, 0], [0, 1, 0], [0, 0, 1], [0.7, 0.7, 0], [-0.7, 0.7, 0], [0, 0.7, 0.7]]) {
      k.push(0, 134, 22);
      k.box('glow', C.chalk, 0, -3.8 * ay, 0, 0.8 + 6.8 * Math.abs(ax), 0.8 + 7.6 * ay, 0.8 + 6.8 * Math.abs(az));
      k.pop();
    }

    // the Tower of Jesus Christ: a fluted shaft over the crossing, the white tip, the four-armed cross (lit from dusk)
    k.prism('plain', C.chalk, 0, 80, 0, 9.5, 30, 12, { r1: 8.6, top: false });
    k.prism('plain', C.chalk, 0, 110, 0, 8.6, 26, 12, { r1: 6.4, top: false });
    k.prism('plain', C.chalk, 0, 136, 0, 6.4, 18, 12, { r1: 4, top: false });
    k.prism('plain', C.chalk, 0, 154, 0, 4, 4, 12, { r1: 2.2 });
    k.box('glow', C.chalk, 0, 158, 0, 2.6, 14.5, 2.6);
    k.box('glow', C.chalk, 0, 165, 0, 13.5, 2.4, 2.4);
    k.box('glow', C.chalk, 0, 165, 0, 2.4, 2.4, 13.5);

    // the cranes over the Glory works (front, right) and behind the Nativity façade
    const tops = [crane(k, 16, -62, 92, 40, 'crane-0'), crane(k, -30, 32, 118, 40, 'crane-1')];
    const g = k.group('barcelona-sagrada-familia');
    for (const t of tops) g.add(t);
    tops[0].rotation.y = 0.5;
    tops[1].rotation.y = 2.4;
    g.userData.cranes = { tops } satisfies Cranes;
    return g;
  },

  animate(group, utcMs) {
    const c = group.userData.cranes as Cranes | undefined;
    if (!c) return;
    // each crane swings its load to and fro: a slow slew, minutes per sweep
    const s = utcMs / 1000;
    c.tops[0].rotation.y = 0.5 + 0.9 * Math.sin((s * 2 * Math.PI) / 260);
    c.tops[1].rotation.y = 2.4 + 0.7 * Math.sin((s * 2 * Math.PI) / 340 + 1.3);
  },
};
