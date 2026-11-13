import type * as THREE from 'three';

/**
 * The balloon's string: a Verlet chain hung from the knot (spec 7: "its string swings, a simple
 * rope simulation"). Point 0 is pinned to the knot; the last point is free, or pinned to the
 * person's hand while they hold it. Gravity pulls it down and air drag pulls each point toward
 * the air's velocity, so a climbing balloon trails its string and gusts make the end swing.
 *
 * Works in scene metres. It runs at a fixed 120 Hz substep so it behaves the same at any frame
 * rate, and a knot that jumps far in one frame (a floating-origin shift, a skip along the route)
 * carries the whole string with it instead of whipping it.
 */
export const ROPE_SEGMENTS = 20;
export const ROPE_SEG_M = 0.06;

const H = 1 / 120;
const MAX_SUBSTEPS = 12; // at most 0.1 s of simulation per call
const ITERATIONS = 16;
const GRAVITY = 9.81;
/** Air drag rate (1/s): a still-air terminal speed of about g / DRAG = 2.5 m/s for a light ribbon. */
const DRAG = 4;

type V3 = { x: number; y: number; z: number };
export type RopeStepOpts = {
  /** Air velocity in m/s (scene frame). Defaults to still air. */
  wind?: V3;
  /** Pin the free end here (the hand). Omit or null to let it swing. */
  end?: V3 | null;
};

export class Rope {
  readonly segments: number;
  private len: number;
  private p: Float64Array;
  private q: Float64Array; // previous positions
  private top = { x: 0, y: 0, z: 0 };
  private acc = 0;

  constructor(segments = ROPE_SEGMENTS, segLenM = ROPE_SEG_M) {
    this.segments = segments;
    this.len = segLenM;
    this.p = new Float64Array((segments + 1) * 3);
    this.q = new Float64Array((segments + 1) * 3);
  }

  /** Current segment length (the real 0.06 m times the balloon's display scale). */
  get segLen(): number {
    return this.len;
  }
  set segLen(m: number) {
    if (Number.isFinite(m) && m > 0) this.len = m;
  }

  get length(): number {
    return this.len * this.segments;
  }

  /** Lay the string straight down from the knot, at rest. */
  reset(top: V3): void {
    for (let i = 0; i <= this.segments; i++) {
      const k = i * 3;
      this.p[k] = this.q[k] = top.x;
      this.p[k + 1] = this.q[k + 1] = top.y - i * this.len;
      this.p[k + 2] = this.q[k + 2] = top.z;
    }
    this.top = { x: top.x, y: top.y, z: top.z };
    this.acc = 0;
  }

  point(i: number, out: THREE.Vector3): THREE.Vector3 {
    const k = i * 3;
    return out.set(this.p[k], this.p[k + 1], this.p[k + 2]);
  }

  step(dtSec: number, top: V3, opts: RopeStepOpts = {}): void {
    const dt = Number.isFinite(dtSec) ? Math.min(Math.max(dtSec, 0), MAX_SUBSTEPS * H) : 0;
    const t0 = this.top;
    const jump = Math.hypot(top.x - t0.x, top.y - t0.y, top.z - t0.z);
    if (jump > Math.max(5, 10 * this.length)) {
      this.translate(top.x - t0.x, top.y - t0.y, top.z - t0.z);
      t0.x = top.x;
      t0.y = top.y;
      t0.z = top.z;
    }
    this.acc += dt;
    const n = Math.min(MAX_SUBSTEPS, Math.floor(this.acc / H + 1e-9));
    this.acc -= n * H;
    const end = opts.end ?? null;
    const w = opts.wind ?? { x: 0, y: 0, z: 0 };
    const keep = Math.exp(-DRAG * H);
    const a = { x: t0.x, y: t0.y, z: t0.z };
    for (let s = 1; s <= n; s++) {
      // the knot moves along a straight line through this frame's substeps
      const f = s / n;
      a.x = t0.x + (top.x - t0.x) * f;
      a.y = t0.y + (top.y - t0.y) * f;
      a.z = t0.z + (top.z - t0.z) * f;
      this.integrate(keep, w);
      this.solve(a, end);
    }
    if (n === 0) this.solve(top, end); // still honour the pins on a zero-length frame
    this.top = { x: top.x, y: top.y, z: top.z };
  }

  private integrate(keep: number, w: V3): void {
    const { p, q } = this;
    for (let i = 1; i <= this.segments; i++) {
      const k = i * 3;
      for (let c = 0; c < 3; c++) {
        const v = (p[k + c] - q[k + c]) / H;
        const air = c === 0 ? w.x : c === 1 ? w.y : w.z;
        let nv = air + (v - air) * keep; // exact exponential drag toward the air's velocity
        if (c === 1) nv -= GRAVITY * H;
        q[k + c] = p[k + c];
        p[k + c] += nv * H;
      }
    }
  }

  private solve(top: V3, end: V3 | null): void {
    const { p, segments: n, len } = this;
    const pin = (i: number, v: V3) => {
      p[i * 3] = v.x;
      p[i * 3 + 1] = v.y;
      p[i * 3 + 2] = v.z;
    };
    pin(0, top);
    if (end) pin(n, end);
    for (let it = 0; it < ITERATIONS; it++) {
      const down = it % 2 === 0;
      for (let j = 0; j < n; j++) {
        const s = down ? j : n - 1 - j;
        const ka = s * 3, kb = ka + 3;
        const wa = s === 0 ? 0 : 1;
        const wb = s + 1 === n && end ? 0 : 1;
        if (wa + wb === 0) continue;
        const dx = p[kb] - p[ka], dy = p[kb + 1] - p[ka + 1], dz = p[kb + 2] - p[ka + 2];
        const d = Math.hypot(dx, dy, dz) || 1e-9;
        const c = (d - len) / d / (wa + wb);
        p[ka] += dx * c * wa;
        p[ka + 1] += dy * c * wa;
        p[ka + 2] += dz * c * wa;
        p[kb] -= dx * c * wb;
        p[kb + 1] -= dy * c * wb;
        p[kb + 2] -= dz * c * wb;
      }
    }
    if (!end) {
      // free end: a last top-down pass makes every segment exactly its length (an inextensible string)
      for (let s = 0; s < n; s++) {
        const ka = s * 3, kb = ka + 3;
        const dx = p[kb] - p[ka], dy = p[kb + 1] - p[ka + 1], dz = p[kb + 2] - p[ka + 2];
        const d = Math.hypot(dx, dy, dz) || 1e-9;
        const c = len / d;
        p[kb] = p[ka] + dx * c;
        p[kb + 1] = p[ka + 1] + dy * c;
        p[kb + 2] = p[ka + 2] + dz * c;
      }
    }
  }

  private translate(dx: number, dy: number, dz: number): void {
    for (let i = 0; i <= this.segments; i++) {
      const k = i * 3;
      this.p[k] += dx;
      this.q[k] += dx;
      this.p[k + 1] += dy;
      this.q[k + 1] += dy;
      this.p[k + 2] += dz;
      this.q[k + 2] += dz;
    }
  }
}
