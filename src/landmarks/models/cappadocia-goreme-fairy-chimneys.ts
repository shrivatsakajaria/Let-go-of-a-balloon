/**
 * Fairy chimneys of Göreme: a cluster of fifteen tuff cones on a valley floor below Sunset Point. Most
 * carry a dark basalt cap stone on a narrow neck; three are the broad pointed cones that Göreme
 * carved into houses, with dark cave doors and windows (some lit from dusk: the glow bucket, as the
 * cave hotels are); one is a three-headed "mushroom" chimney. Faceted, leaning a little, in bands
 * of pale tuff (chalk, sand, limestone), the caps in dark iron grey. Contour colours.
 *
 * Model frame (types.ts): origin on the valley floor at the middle of the cluster, front (local -z)
 * toward Sunset Point, so the launch sees the cluster's best side; local +x runs down the valley
 * (south). Every chimney stands on a flared skirt sunk 9 m, as the valley floor rises some metres
 * toward the sides of the cluster.
 */
import { Kit, LANDMARK_COLOURS as C } from '../kit';
import type { LandmarkBucket, LandmarkModel } from '../types';

type P = [number, number, number];

/** A small seeded random (mulberry32), so the rocks are the same every time. */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One flat facet a, b, c, lit facing away from the interior point o. */
function facet(k: Kit, b: LandmarkBucket, colour: string, p: P, q: P, r: P, o: P): void {
  const ux = q[0] - p[0], uy = q[1] - p[1], uz = q[2] - p[2];
  const vx = r[0] - p[0], vy = r[1] - p[1], vz = r[2] - p[2];
  let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const cx = (p[0] + q[0] + r[0]) / 3 - o[0], cy = (p[1] + q[1] + r[1]) / 3 - o[1], cz = (p[2] + q[2] + r[2]) / 3 - o[2];
  if (nx * cx + ny * cy + nz * cz < 0) { nx = -nx; ny = -ny; nz = -nz; }
  k.tri(b, colour, p[0], p[1], p[2], q[0], q[1], q[2], r[0], r[1], r[2], nx, ny, nz);
}

/** A ring of a rock: centre, height, radius, and its band colour (for the facets above it). */
type Ring = { x: number; y: number; z: number; r: number; c: string };

/**
 * A faceted rock body through the rings, each ring's corners pushed in or out a little at random,
 * with a point (or a flat top) above the last ring. Returns the corners, for windows.
 */
function rock(k: Kit, rings: Ring[], sides: number, rnd: () => number, top: { y: number; c: string } | null): P[][] {
  const a0 = rnd() * Math.PI * 2;
  const pts = rings.map((g) => {
    const row: P[] = [];
    for (let j = 0; j < sides; j++) {
      const a = a0 + (j * 2 * Math.PI) / sides + (rnd() - 0.5) * 0.25;
      const r = g.r * (0.84 + rnd() * 0.3);
      row.push([g.x + r * Math.sin(a), g.y, g.z - r * Math.cos(a)]);
    }
    return row;
  });
  for (let i = 0; i < rings.length - 1; i++) {
    const lo = pts[i], hi = pts[i + 1], g = rings[i], h = rings[i + 1];
    for (let j = 0; j < sides; j++) {
      const n = (j + 1) % sides;
      const o0: P = [g.x, g.y, g.z], o1: P = [h.x, h.y, h.z];
      facet(k, 'plain', g.c, lo[j], lo[n], hi[n], o0);
      facet(k, 'plain', g.c, lo[j], hi[n], hi[j], o1);
    }
  }
  if (top) {
    const g = rings[rings.length - 1], last = pts[pts.length - 1];
    const apex: P = [g.x, top.y, g.z];
    for (let j = 0; j < sides; j++) facet(k, 'plain', top.c, last[j], last[(j + 1) % sides], apex, [g.x, g.y - 2, g.z]);
  }
  return pts;
}

/** A basalt cap stone on a neck at (x, y, z): an overhanging boulder, flat-ish on top. */
function cap(k: Kit, x: number, y: number, z: number, r: number, h: number, rnd: () => number): void {
  const sides = 7;
  const a0 = rnd() * Math.PI * 2;
  const under: P[] = [], upper: P[] = [];
  for (let j = 0; j < sides; j++) {
    const a = a0 + (j * 2 * Math.PI) / sides;
    const s = 0.85 + rnd() * 0.3;
    under.push([x + r * s * Math.sin(a), y - 0.2 - rnd() * 0.5, z - r * s * Math.cos(a)]);
    upper.push([x + r * s * 0.8 * Math.sin(a + 0.2), y + h * (0.55 + rnd() * 0.2), z - r * s * 0.8 * Math.cos(a + 0.2)]);
  }
  const mid: P = [x, y + h * 0.4, z];
  const bottom: P = [x, y + 0.3, z];
  const crown: P = [x + (rnd() - 0.5) * r * 0.3, y + h, z + (rnd() - 0.5) * r * 0.3];
  for (let j = 0; j < sides; j++) {
    const n = (j + 1) % sides;
    facet(k, 'plain', C.stoneDeep, under[j], under[n], bottom, [x, y + h, z]);
    facet(k, 'plain', C.iron, under[j], under[n], upper[n], mid);
    facet(k, 'plain', C.iron, under[j], upper[n], upper[j], mid);
    facet(k, 'plain', C.iron, upper[j], upper[n], crown, [x, y, z]);
  }
}

/** Tuff bands, foot to top. */
const BANDS = [C.stone, C.chalkShade, C.chalk, C.chalkShade, C.stone, C.chalk];

type Chimney = { x: number; z: number; h: number; r: number; kind: 'cap' | 'house' | 'triple' };

/** The cluster (model metres): x down the valley, -z toward Sunset Point. */
const CHIMNEYS: Chimney[] = [
  { x: 0, z: 2, h: 21, r: 6.5, kind: 'house' },
  { x: -12, z: -9, h: 17, r: 3.4, kind: 'cap' },
  { x: 11, z: -13, h: 16, r: 4.6, kind: 'triple' },
  { x: -22, z: 5, h: 22, r: 4.2, kind: 'cap' },
  { x: 19, z: 7, h: 23, r: 5.5, kind: 'house' },
  { x: -6, z: 15, h: 12, r: 3.2, kind: 'cap' },
  { x: 29, z: -5, h: 11, r: 3, kind: 'cap' },
  { x: -31, z: -7, h: 14, r: 3.8, kind: 'cap' },
  { x: 6, z: 21, h: 14, r: 3.6, kind: 'cap' },
  { x: -18, z: -21, h: 7, r: 3.0, kind: 'cap' },
  { x: 33, z: 14, h: 18, r: 3.4, kind: 'cap' },
  { x: -31, z: 14, h: 18, r: 5, kind: 'house' },
  { x: 22, z: -21, h: 10, r: 3, kind: 'cap' },
  { x: -3, z: -23, h: 8, r: 2.6, kind: 'cap' },
  { x: -22, z: 26, h: 12, r: 3.4, kind: 'cap' },
];

/** A cave door or window on a rock face: a small upright panel with a rounded head, facing (nx, nz). */
function cave(k: Kit, b: LandmarkBucket, colour: string, p: P, nx: number, nz: number, w: number, h: number): void {
  // across the face: (nz, -nx)... turned so the panel faces outward
  const tx = -nz, tz = nx;
  const x0 = p[0] - (tx * w) / 2, z0 = p[2] - (tz * w) / 2, x1 = p[0] + (tx * w) / 2, z1 = p[2] + (tz * w) / 2;
  const y0 = p[1], y1 = p[1] + h;
  const o: P = [p[0] - nx, p[1] + h / 2, p[2] - nz];
  facet(k, b, colour, [x0, y0, z0], [x1, y0, z1], [x1, y1, z1], o);
  facet(k, b, colour, [x0, y0, z0], [x1, y1, z1], [x0, y1, z0], o);
  facet(k, b, colour, [x0, y1, z0], [x1, y1, z1], [p[0], y1 + w * 0.45, p[2]], o);
}

/** A point on the middle of face j between rings i and i + 1, a little proud of it, and its outward direction. */
function onFace(pts: P[][], i: number, j: number, t: number, cx: number, cz: number): { p: P; nx: number; nz: number } {
  const n = (j + 1) % pts[i].length;
  const lo = pts[i], hi = pts[i + 1];
  const p: P = [0, 0, 0];
  for (let d = 0; d < 3; d++) p[d] = ((lo[j][d] + lo[n][d]) / 2) * (1 - t) + ((hi[j][d] + hi[n][d]) / 2) * t;
  let nx = p[0] - cx, nz = p[2] - cz;
  const l = Math.hypot(nx, nz) || 1;
  nx /= l;
  nz /= l;
  p[0] += nx * 0.35;
  p[2] += nz * 0.35;
  return { p, nx, nz };
}

function chimney(k: Kit, c: Chimney, rnd: () => number, index: number): void {
  const lean = () => (rnd() - 0.5) * c.h * 0.14;
  const lx = lean(), lz = lean();
  const band = (i: number) => BANDS[(i + index) % BANDS.length];
  // the flared skirt, sunk into the valley floor
  const rings: Ring[] = [
    { x: c.x, y: -9, z: c.z, r: c.r * 1.55, c: C.sand },
    { x: c.x, y: 0, z: c.z, r: c.r * 1.12, c: band(0) },
  ];
  if (c.kind === 'house') {
    // a broad cone, drawn in to a blunt point
    const fr = [[0.22, 0.84], [0.5, 0.6], [0.78, 0.36], [0.94, 0.17]];
    fr.forEach(([f, s], i) => rings.push({ x: c.x + lx * f, y: c.h * f, z: c.z + lz * f, r: c.r * s, c: band(i + 2) }));
    const pts = rock(k, rings, 9, rnd, { y: c.h, c: C.chalk });
    // cave doors and windows on the faces toward the front and the sides (two of them lit from dusk)
    let lit = 0;
    for (const [i, t, w, h] of [[1, 0.15, 1.3, 2.0], [2, 0.35, 0.9, 1.2], [3, 0.3, 0.8, 1.0], [4, 0.2, 0.6, 0.8]] as const) {
      for (let j = 0; j < 9; j += 2) {
        const f = onFace(pts, i, j, t, c.x + lx * 0.5, c.z + lz * 0.5);
        if (f.nz > 0.55) continue;
        const glow = (i === 2 || i === 3) && lit < 2 && f.nz < -0.3 && (j + index) % 4 === 0;
        if (glow) lit++;
        cave(k, glow ? 'glow' : 'plain', C.iron, f.p, f.nx, f.nz, w, h);
      }
    }
    return;
  }
  if (c.kind === 'triple') {
    // a broad foot that splits into three capped necks
    rings.push({ x: c.x, y: c.h * 0.35, z: c.z, r: c.r * 0.82, c: band(2) });
    rock(k, rings, 9, rnd, { y: c.h * 0.45, c: band(3) });
    for (let m = 0; m < 3; m++) {
      const a = (m * 2 * Math.PI) / 3 + 0.4, d = c.r * 0.45;
      const x = c.x + Math.sin(a) * d, z = c.z - Math.cos(a) * d, h = c.h * (0.78 + m * 0.11);
      const nr = c.r * 0.34;
      rock(k, [
        { x, y: c.h * 0.3, z, r: nr * 1.3, c: band(3 + m) },
        { x: x + Math.sin(a) * 0.6, y: h * 0.7, z: z - Math.cos(a) * 0.6, r: nr * 0.8, c: band(4 + m) },
        { x: x + Math.sin(a) * 0.9, y: h, z: z - Math.cos(a) * 0.9, r: nr * 0.55, c: band(5) },
      ], 6, rnd, null);
      cap(k, x + Math.sin(a) * 0.9, h, z - Math.cos(a) * 0.9, nr * 1.5, nr * 1.3, rnd);
    }
    return;
  }
  // a tapering column on a narrow neck, and its cap stone
  const fr = [[0.14, 0.84], [0.38, 0.6], [0.64, 0.42], [0.86, 0.31], [1, 0.26]];
  fr.forEach(([f, s], i) => rings.push({ x: c.x + lx * f, y: c.h * f, z: c.z + lz * f, r: c.r * s, c: band(i + 2) }));
  rock(k, rings, 8, rnd, null);
  cap(k, c.x + lx, c.h, c.z + lz, c.r * (0.55 + rnd() * 0.25), c.r * (0.4 + rnd() * 0.2), rnd);
}

/** Low tuff mounds between the chimneys' feet (x, z, radius, height). */
const MOUNDS = [[-7, -3, 8, 4.5], [12, 13, 7, 3.5], [-24, -12, 6, 3], [27, 4, 6, 2.5], [-14, 19, 6, 3]];

export const model: LandmarkModel = {
  build() {
    const k = new Kit();
    const rnd = random(1907);
    CHIMNEYS.forEach((c, i) => chimney(k, c, rnd, i));
    for (const [x, z, r, h] of MOUNDS) {
      rock(k, [
        { x, y: -9, z, r: r * 1.3, c: C.stone },
        { x, y: h * 0.45, z, r: r * 0.85, c: C.chalkShade },
        { x: x + 0.5, y: h * 0.85, z, r: r * 0.45, c: C.chalk },
      ], 7, rnd, { y: h, c: C.chalk });
    }
    return k.group('cappadocia-goreme-fairy-chimneys');
  },
};
