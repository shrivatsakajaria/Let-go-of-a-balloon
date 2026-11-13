/**
 * The Statue of Liberty, 93 m to the tip of the torch: Fort Wood's eleven-pointed granite star,
 * the stepped concrete foundation and the granite pedestal (corner piers, the loggia of each face,
 * the cornice), and the copper figure in its pale verdigris: the draped robe, the head with the
 * seven rays of the crown, the left arm holding the tablet and the right arm raising the torch,
 * whose gilt flame lights from dusk and flickers. Faceted, Contour colours.
 *
 * Heights and the plan of the star and the pedestal from OpenStreetMap (the island's building
 * parts, 2026-11). Model frame (types.ts): origin on the ground at the pedestal's centre, front
 * (local -z) where she looks, to the south-east down the harbour toward the Narrows; +x is her
 * right, the torch arm.
 */
import * as THREE from 'three';
import { Kit, LANDMARK_COLOURS as C } from '../kit';
import type { Color } from '../../world/palette';
import type { LandmarkBucket, LandmarkModel } from '../types';

type P3 = [number, number, number];

/** Verdigris: the copper's pale green-blue patina (Contour's shallow-water colour, CONTOUR.waterShallow). */
const COPPER: Color = C.copper;
/** Top of the pedestal (m): the figure stands on it. */
const PT = 46.9;

/** Fort Wood's star (model frame, OSM), its wall top 9.5 m up. */
const STAR = [
  35.3, 18.8, 35.0, 35.1, 18.3, 34.2, 12.8, 47.0, 4.3, 39.3, -1.6, 39.5, -9.4, 48.1, -16.2, 34.7, -33.0, 34.5,
  -32.6, 18.2, -45.3, 12.6, -34.7, 1.1, -46.6, -9.9, -32.9, -17.2, -33.2, -37.0, -17.5, -33.6, 0.7, -52.3,
  19.2, -33.4, 35.5, -36.4, 35.5, -17.0, 49.2, -10.3, 37.8, 0.6, 49.2, 12.7,
];

const sub = (a: P3, b: P3): P3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: P3, b: P3): P3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: P3): P3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const mean = (ps: P3[]): P3 => {
  const s: P3 = [0, 0, 0];
  for (const p of ps) for (let i = 0; i < 3; i++) s[i] += p[i] / ps.length;
  return s;
};

/** An upright ellipse of n points round (cx, y, cz), the first toward -z. */
function ellipse(cx: number, y: number, cz: number, rx: number, rz: number, n = 10): P3[] {
  const out: P3[] = [];
  for (let i = 0; i < n; i++) {
    const a = ((i + 0.5) / n) * 2 * Math.PI;
    out.push([cx + rx * Math.sin(a), y, cz - rz * Math.cos(a)]);
  }
  return out;
}

/** A ring of n points of radius r round c, square to direction d (for arms and handles). */
function ringAround(c: P3, d: P3, r: number, n = 6): P3[] {
  const t = unit(d);
  const u = unit(cross(Math.abs(t[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0], t));
  const v = cross(t, u);
  const out: P3[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 2 * Math.PI, s = Math.sin(a) * r, co = Math.cos(a) * r;
    out.push([c[0] + u[0] * s + v[0] * co, c[1] + u[1] * s + v[1] * co, c[2] + u[2] * s + v[2] * co]);
  }
  return out;
}

/**
 * Quads between consecutive rings (closed loops of the same length), each lit away from the axis
 * through the rings' centres; the first and last rings capped unless told not to.
 */
function loft(k: Kit, b: LandmarkBucket, colour: Color, rings: P3[][], o: { start?: boolean; end?: boolean } = {}): void {
  const cs = rings.map(mean);
  for (let r = 0; r + 1 < rings.length; r++) {
    const A = rings[r], B = rings[r + 1], m = mean([cs[r], cs[r + 1]]);
    for (let i = 0; i < A.length; i++) {
      const j = (i + 1) % A.length;
      const h = sub(mean([A[i], A[j], B[j], B[i]]), m);
      k.quad(b, colour, A[i], A[j], B[j], B[i], h);
    }
  }
  const cap = (ring: P3[], c: P3, out: P3) => {
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i], q = ring[(i + 1) % ring.length];
      k.tri(b, colour, c[0], c[1], c[2], p[0], p[1], p[2], q[0], q[1], q[2], out[0], out[1], out[2]);
    }
  };
  const n = rings.length - 1;
  if (o.start ?? true) cap(rings[0], cs[0], sub(cs[0], cs[1]));
  if (o.end ?? true) cap(rings[n], cs[n], sub(cs[n], cs[n - 1]));
}

/** A thin pointed ray from base b to tip t (a crown ray), three-sided. */
function ray(k: Kit, colour: Color, b: P3, t: P3, r: number): void {
  const ring = ringAround(b, sub(t, b), r, 3);
  for (let i = 0; i < 3; i++) {
    const p = ring[i], q = ring[(i + 1) % 3];
    k.tri('plain', colour, p[0], p[1], p[2], q[0], q[1], q[2], t[0], t[1], t[2], ...sub(mean([p, q]), b));
  }
}

/** Fort Wood: the star's walls and its paved top. */
function fort(k: Kit): void {
  const n = STAR.length / 2, top = 9.5;
  // which side of an edge is out: the ring's winding (shoelace)
  let area = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += STAR[2 * i] * STAR[2 * j + 1] - STAR[2 * j] * STAR[2 * i + 1];
  }
  const out = Math.sign(area);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ax = STAR[2 * i], az = STAR[2 * i + 1], bx = STAR[2 * j], bz = STAR[2 * j + 1];
    const hx = out * (bz - az), hz = -out * (bx - ax);
    k.quad('plain', C.stoneDeep, [ax, -3, az], [bx, -3, bz], [bx, top, bz], [ax, top, az], [hx, 0, hz]);
    // a parapet course along the top
    k.quad('plain', C.stone, [ax, top, az], [bx, top, bz], [bx, top + 0.9, bz], [ax, top + 0.9, az], [hx, 0, hz]);
    k.tri('plain', C.paving, 0, top + 0.9, 0, ax, top + 0.9, az, bx, top + 0.9, bz, 0, 1, 0);
  }
}

/** One face of the pedestal (the -z face of the current frame): piers, the loggia, the panel. */
function pedestalFace(k: Kit): void {
  const z = -7.5;
  // the loggia: a dark recess with four columns, and the balcony slab under it
  k.box('plain', C.iron, 0, 36.5, z - 0.05, 8.4, 5.6, 0.3, { top: false });
  for (const x of [-3.2, -1.05, 1.05, 3.2]) k.prism('plain', C.chalk, x, 36.5, z - 0.45, 0.42, 5.6, 6);
  k.box('plain', C.chalk, 0, 35.8, z - 0.6, 10, 0.7, 1.4);
  k.box('plain', C.chalkShade, 0, 42.1, z - 0.35, 10.6, 1.0, 0.9);
  // the panel below with its round shields, and the corner piers
  k.box('plain', C.stoneDeep, 0, 27, z - 0.08, 7.2, 7.5, 0.3, { top: false });
  for (const x of [-2.4, 0, 2.4]) k.disc('plain', C.chalk, x, 43.6, z - 0.42, 0.5, 6, [0, 0, -1]);
  for (const x of [-6.4, 6.4]) k.box('plain', C.chalkShade, x, 26, z - 0.25, 2.4, 19, 1.2, { top: false });
}

/** The figure: robe, head and crown, arms, the tablet and the torch (not its flame). */
function figure(k: Kit): void {
  // the robe, from the hem up to the shoulders and the neck
  const robe: [number, number, number, number][] = [
    [PT - 0.6, 5.4, 4.7, 0.3], [PT + 2, 5.2, 4.6, 0.2], [PT + 9, 4.5, 3.9, 0.3], [PT + 16, 4.0, 3.3, 0.4],
    [PT + 22, 4.5, 3.3, 0.3], [PT + 25.6, 5.0, 3.0, 0.4], [PT + 27.2, 3.1, 2.3, 0.3], [PT + 28.2, 1.4, 1.4, 0.2],
  ];
  loft(k, 'plain', COPPER, robe.map(([y, rx, rz, cz]) => ellipse(0, y, cz, rx, rz, 10)), { start: false, end: false });
  // drapery folds down the front: three shallow ridges
  for (const x of [-2.1, 0.2, 2.4]) {
    loft(k, 'plain', COPPER, [ringAround([x, PT + 1, -4.55], [0.05, 1, 0.08], 0.6, 4), ringAround([x * 0.9, PT + 13, -3.45], [0, 1, 0], 0.4, 4)], { start: false });
  }
  // the head, a little forward, and the crown's band
  const hy = PT + 28.2;
  loft(k, 'plain', COPPER, [
    ellipse(0, hy, 0.2, 1.3, 1.3, 8), ellipse(0, hy + 1.0, -0.1, 1.6, 1.8, 8), ellipse(0, hy + 3.3, -0.1, 1.8, 1.9, 8),
    ellipse(0, hy + 4.4, 0, 2.05, 2.05, 8), ellipse(0, hy + 5.1, 0, 1.6, 1.7, 8), ellipse(0, hy + 5.5, 0.1, 0.7, 0.7, 8),
  ], { start: false });
  // the seven rays, fanned round the front and rising a little
  const cy = hy + 4.6;
  for (let i = -3; i <= 3; i++) {
    const a = (i * 27 * Math.PI) / 180, up = 0.42 - Math.abs(i) * 0.05;
    const d: P3 = [Math.sin(a), up, -Math.cos(a)];
    const b: P3 = [1.7 * d[0], cy, 1.7 * d[2]];
    ray(k, COPPER, b, [b[0] + 3.6 * d[0], cy + 3.6 * d[1], b[2] + 3.6 * d[2]], 0.38);
  }
  // the right arm, raised: sleeve, forearm, hand, and the torch's handle, cup and balcony
  const sh: P3 = [4.0, PT + 25.8, 0.3], el: P3 = [5.0, PT + 32.2, 0.6], hd: P3 = [5.5, PT + 38.3, 0.8];
  loft(k, 'plain', COPPER, [ringAround(sh, sub(el, sh), 1.7, 7), ringAround(el, sub(hd, sh), 1.25, 7), ringAround(hd, sub(hd, el), 0.9, 7)]);
  const t0: P3 = [5.55, PT + 37.9, 0.8], t1: P3 = [5.6, PT + 41.3, 0.8];
  loft(k, 'plain', COPPER, [ringAround(t0, [0, 1, 0], 0.55, 6), ringAround(t1, [0, 1, 0], 0.6, 6), ringAround([5.6, PT + 42.4, 0.8], [0, 1, 0], 1.2, 6)]);
  k.prism('plain', COPPER, 5.6, PT + 42.4, 0.8, 1.6, 0.35, 10);
  // the left arm, down and bent to hold the tablet against her side
  const ls: P3 = [-4.1, PT + 25.6, 0.2], le: P3 = [-5.1, PT + 19.6, -0.4], lh: P3 = [-4.8, PT + 17.4, -2.4];
  loft(k, 'plain', COPPER, [ringAround(ls, sub(le, ls), 1.55, 6), ringAround(le, sub(lh, ls), 1.2, 6), ringAround(lh, sub(lh, le), 0.9, 6)]);
  // the tablet, 7.2 by 4.1 m, leaning back with its face forward and out
  const c: P3 = [-5.8, PT + 21, -1.2];
  const u = unit([0.18, 0.92, 0.35]), w = unit(cross(u, [-0.5, 0, -1])), t = unit(cross(u, w));
  const corner = (a: number, b: number, s: number): P3 => [c[0] + u[0] * a + w[0] * b + t[0] * s, c[1] + u[1] * a + w[1] * b + t[1] * s, c[2] + u[2] * a + w[2] * b + t[2] * s];
  const rect = (s: number): P3[] => [corner(-3.6, -2.05, s), corner(-3.6, 2.05, s), corner(3.6, 2.05, s), corner(3.6, -2.05, s)];
  loft(k, 'plain', COPPER, [rect(-0.35), rect(0.35)]);
}

/** The flame, from its base (origin) up: a gilt teardrop that lights from dusk. */
function flame(): Kit {
  const k = new Kit();
  k.prism('glow', C.gilt, 0, 0, 0, 0.75, 1.0, 6, { r1: 1.0, top: false });
  k.spire('glow', C.gilt, 0, 1.0, 0, 1.0, 2.6, 6);
  return k;
}

type Flame = { mesh: THREE.Object3D };

export const model: LandmarkModel = {
  build() {
    const k = new Kit();
    fort(k);
    // the stepped foundation inside the fort
    k.box('plain', C.stone, 0, 9, 0, 40, 5, 40, { topColour: C.paving });
    k.box('plain', C.stone, 0, 14, 0, 25.5, 4, 25.5, { topColour: C.paving });
    k.box('plain', C.chalkShade, 0, 18, 0, 18.4, 5.4, 18.4);
    // the pedestal: base course, shaft, cornice, and the attic under her feet
    k.box('plain', C.chalkShade, 0, 23, 0, 17.2, 3, 17.2);
    k.box('plain', C.stone, 0, 26, 0, 15, 19, 15, { top: false, taper: 0.97 });
    k.box('plain', C.chalk, 0, 45, 0, 16.4, 1.2, 16.4);
    k.box('plain', C.stone, 0, 46.2, 0, 13, 0.7, 13);
    for (let i = 0; i < 4; i++) {
      k.push(0, 0, 0, i * 90);
      pedestalFace(k);
      k.pop();
    }
    figure(k);
    const g = k.group('new-york-statue-of-liberty');
    const f = flame().mesh('glow', 'new-york-statue-of-liberty-flame')!;
    f.position.set(5.6, PT + 42.75, 0.8);
    f.castShadow = false;
    g.add(f);
    g.userData.flame = { mesh: f } satisfies Flame;
    return g;
  },

  /** The flame flickers once it is lit (from dusk); by day it stands still. */
  animate(group, utcMs, light) {
    const f = group.userData.flame as Flame | undefined;
    if (!f) return;
    const lit = Math.min(1, Math.max(0, (light.night - 0.06) / 0.34));
    const t = utcMs / 1000;
    const s = lit * (0.05 * Math.sin(t * 7.3) + 0.03 * Math.sin(t * 11.9 + 1.3) + 0.02 * Math.sin(t * 17.1 + 2.1));
    f.mesh.scale.set(1 - s * 0.4, 1 + s, 1 - s * 0.4);
  },
};
