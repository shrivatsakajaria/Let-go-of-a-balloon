/**
 * Small geometry helpers for the tile mesh job: a growable flat-shaded triangle buffer, polygon
 * and line clipping, point in polygon, and a seeded hash. No three.js, no DOM: runs in a Worker.
 */
import type { MeshBuffers } from './terrain';
import { parseHex, type Color } from './color';

export type RGB = [number, number, number];

const RGB_CACHE = new Map<Color, RGB>();
/** Hex colour to 0..1 floats (cached). */
export function rgb(c: Color): RGB {
  let v = RGB_CACHE.get(c);
  if (!v) {
    const [r, g, b] = parseHex(c);
    v = [r / 255, g / 255, b / 255];
    RGB_CACHE.set(c, v);
  }
  return v;
}

export const scaleRGB = (c: RGB, s: number): RGB => [Math.min(1, c[0] * s), Math.min(1, c[1] * s), Math.min(1, c[2] * s)];
export const mixRGB = (a: RGB, b: RGB, f: number): RGB => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];

/** Deterministic hash of up to three integers to [0, 1). Never Math.random. */
export function hash01(a: number, b = 0, c = 0): number {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 2246822519) + 0x27d4eb2d) | 0;
  h = Math.imul(h ^ (h >>> 15), 2246822519);
  h = Math.imul(h ^ (h >>> 13), 3266489917);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/**
 * Non-indexed, flat-shaded triangles. Each triangle is wound so its geometric normal agrees with a
 * hint direction (front faces are counter-clockwise in three.js), and stores that unit normal.
 */
export class MeshBuilder {
  private pos: Float32Array;
  private nor: Float32Array;
  private col: Float32Array;
  private n = 0;

  constructor(triangles = 256) {
    this.pos = new Float32Array(triangles * 9);
    this.nor = new Float32Array(triangles * 9);
    this.col = new Float32Array(triangles * 9);
  }

  get triangles(): number {
    return this.n / 9;
  }

  private grow(): void {
    const g = (a: Float32Array) => {
      const b = new Float32Array(a.length * 2);
      b.set(a);
      return b;
    };
    this.pos = g(this.pos);
    this.nor = g(this.nor);
    this.col = g(this.col);
  }

  /** Add triangle a, b, c with colour c, oriented to face (hx, hy, hz). Degenerate triangles are dropped. */
  tri(
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
    cx: number, cy: number, cz: number,
    color: RGB,
    hx = 0, hy = 1, hz = 0,
  ): void {
    const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
    const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
    let nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    const len = Math.hypot(nx, ny, nz);
    if (!(len > 1e-4)) return; // slivers under ~0.00005 m2 are invisible and wind badly in float32
    nx /= len; ny /= len; nz /= len;
    let flip = false;
    if (nx * hx + ny * hy + nz * hz < 0) {
      flip = true;
      nx = -nx; ny = -ny; nz = -nz;
    }
    if (this.n + 9 > this.pos.length) this.grow();
    const p = this.pos, o = this.n;
    p[o] = ax; p[o + 1] = ay; p[o + 2] = az;
    if (flip) {
      p[o + 3] = cx; p[o + 4] = cy; p[o + 5] = cz;
      p[o + 6] = bx; p[o + 7] = by; p[o + 8] = bz;
    } else {
      p[o + 3] = bx; p[o + 4] = by; p[o + 5] = bz;
      p[o + 6] = cx; p[o + 7] = cy; p[o + 8] = cz;
    }
    for (let k = 0; k < 9; k += 3) {
      this.nor[o + k] = nx; this.nor[o + k + 1] = ny; this.nor[o + k + 2] = nz;
      this.col[o + k] = color[0]; this.col[o + k + 1] = color[1]; this.col[o + k + 2] = color[2];
    }
    this.n += 9;
  }

  /** Quad a, b, c, d (in order around its edge) as two triangles. */
  quad(
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
    cx: number, cy: number, cz: number,
    dx: number, dy: number, dz: number,
    color: RGB,
    hx = 0, hy = 1, hz = 0,
  ): void {
    this.tri(ax, ay, az, bx, by, bz, cx, cy, cz, color, hx, hy, hz);
    this.tri(ax, ay, az, cx, cy, cz, dx, dy, dz, color, hx, hy, hz);
  }

  /** Exact-length copies, safe to transfer. */
  build(): MeshBuffers {
    return { position: this.pos.slice(0, this.n), normal: this.nor.slice(0, this.n), color: this.col.slice(0, this.n) };
  }
}

// ---- rings and polygons (flat [x0, z0, x1, z1, ...], not closed) ----

export type Ring = Float64Array;
/** Outer ring first, then holes. */
export type Polygon = Ring[];

/** Shoelace signed area in the (x, z) plane, treated as a right-handed 2D frame. */
export function ringArea(r: ArrayLike<number>): number {
  let s = 0;
  const n = r.length;
  for (let i = 0, j = n - 2; i < n; j = i, i += 2) s += r[j] * r[i + 1] - r[i] * r[j + 1];
  return s / 2;
}

/** Area centroid of a ring (vertex mean if degenerate). */
export function ringCentroid(r: ArrayLike<number>): { x: number; z: number } {
  let a = 0, cx = 0, cz = 0;
  const n = r.length;
  for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
    const f = r[j] * r[i + 1] - r[i] * r[j + 1];
    a += f;
    cx += (r[j] + r[i]) * f;
    cz += (r[j + 1] + r[i + 1]) * f;
  }
  if (Math.abs(a) < 1e-9) {
    let sx = 0, sz = 0;
    for (let i = 0; i < n; i += 2) { sx += r[i]; sz += r[i + 1]; }
    return { x: sx / (n / 2), z: sz / (n / 2) };
  }
  return { x: cx / (3 * a), z: cz / (3 * a) };
}

export type BBox = { x0: number; z0: number; x1: number; z1: number };

export function bbox(r: ArrayLike<number>): BBox {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < r.length; i += 2) {
    if (r[i] < x0) x0 = r[i];
    if (r[i] > x1) x1 = r[i];
    if (r[i + 1] < z0) z0 = r[i + 1];
    if (r[i + 1] > z1) z1 = r[i + 1];
  }
  return { x0, z0, x1, z1 };
}

/** Even-odd point in polygon over the outer ring and its holes. */
export function pointInPolygon(poly: Polygon, x: number, z: number): boolean {
  let c = false;
  for (const r of poly) {
    const n = r.length;
    for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
      const zi = r[i + 1], zj = r[j + 1];
      if (zi > z !== zj > z) {
        const xi = r[i], xj = r[j];
        if (x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
      }
    }
  }
  return c;
}

/** Polygon area: outer minus holes. */
export function polygonArea(poly: Polygon): number {
  let a = Math.abs(ringArea(poly[0]));
  for (let k = 1; k < poly.length; k++) a -= Math.abs(ringArea(poly[k]));
  return Math.max(0, a);
}

/** Drop consecutive duplicate points and (for rings) a closing point equal to the first. */
export function dedupe(pts: number[], eps = 1e-9, closed = true): number[] {
  const out: number[] = [];
  for (let i = 0; i < pts.length; i += 2) {
    const n = out.length;
    if (n && Math.abs(out[n - 2] - pts[i]) <= eps && Math.abs(out[n - 1] - pts[i + 1]) <= eps) continue;
    out.push(pts[i], pts[i + 1]);
  }
  while (closed && out.length >= 4 && Math.abs(out[0] - out[out.length - 2]) <= eps && Math.abs(out[1] - out[out.length - 1]) <= eps) out.length -= 2;
  return out;
}

/**
 * Sutherland-Hodgman clip of a closed ring against the half-plane a*x + b*y + c >= 0. Works for
 * any polygon (concave ones may gain zero-width bridges along the line, which triangulate to nothing).
 */
export function clipRingHalfPlane(r: ArrayLike<number>, a: number, b: number, c: number): number[] {
  const out: number[] = [];
  const n = r.length;
  if (n < 6) return out;
  let px = r[n - 2], py = r[n - 1];
  let pd = a * px + b * py + c;
  for (let i = 0; i < n; i += 2) {
    const x = r[i], y = r[i + 1];
    const d = a * x + b * y + c;
    if (d >= 0) {
      if (pd < 0) {
        const t = pd / (pd - d);
        out.push(px + (x - px) * t, py + (y - py) * t);
      }
      out.push(x, y);
    } else if (pd >= 0) {
      const t = pd / (pd - d);
      out.push(px + (x - px) * t, py + (y - py) * t);
    }
    px = x; py = y; pd = d;
  }
  return dedupe(out);
}

/** Clip a closed ring to the box [0, e] x [0, e]. */
export function clipRingToBox(r: ArrayLike<number>, e: number): number[] {
  let o = clipRingHalfPlane(r, 1, 0, 0);
  o = clipRingHalfPlane(o, -1, 0, e);
  o = clipRingHalfPlane(o, 0, 1, 0);
  o = clipRingHalfPlane(o, 0, -1, e);
  return o;
}

/** Clip a polyline to the box [lo, hi] x [lo, hi]; returns the pieces inside (Liang-Barsky per segment). */
export function clipLineToBox(l: ArrayLike<number>, hi: number, lo = 0): number[][] {
  const pieces: number[][] = [];
  let cur: number[] | null = null;
  for (let i = 0; i + 3 < l.length; i += 2) {
    const x0 = l[i], y0 = l[i + 1], x1 = l[i + 2], y1 = l[i + 3];
    const dx = x1 - x0, dy = y1 - y0;
    let t0 = 0, t1 = 1;
    let ok = true;
    for (const [p, q] of [[-dx, x0 - lo], [dx, hi - x0], [-dy, y0 - lo], [dy, hi - y0]]) {
      if (p === 0) {
        if (q < 0) { ok = false; break; }
      } else {
        const t = q / p;
        if (p < 0) { if (t > t1) { ok = false; break; } if (t > t0) t0 = t; }
        else { if (t < t0) { ok = false; break; } if (t < t1) t1 = t; }
      }
    }
    if (!ok) { cur = null; continue; }
    const ax = x0 + dx * t0, ay = y0 + dy * t0, bx = x0 + dx * t1, by = y0 + dy * t1;
    if (!cur || t0 > 0) {
      cur = [ax, ay];
      pieces.push(cur);
    }
    cur.push(bx, by);
    if (t1 < 1) cur = null;
  }
  return pieces.map((p) => dedupe(p, 1e-9, false)).filter((p) => p.length >= 4);
}

/**
 * Clip a triangle (flat xz) to the tile rectangle x in [0, W], z in [-H, 0]; returns the convex
 * polygon inside (flat xz, maybe empty).
 */
export function clipTriToTile(ax: number, az: number, bx: number, bz: number, cx: number, cz: number, W: number, H: number): number[] {
  let o = clipRingHalfPlane([ax, az, bx, bz, cx, cz], 1, 0, 0);
  o = clipRingHalfPlane(o, -1, 0, W);
  o = clipRingHalfPlane(o, 0, -1, 0);
  o = clipRingHalfPlane(o, 0, 1, H);
  return o;
}
