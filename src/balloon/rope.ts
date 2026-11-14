import type * as THREE from 'three';

/**
 * The balloon's string: a Verlet chain hung from the knot (spec 7: "its string swings, a simple
 * rope simulation"). Point 0 is pinned to the knot; the last point is free, or pinned to the
 * person's hand while they hold it. Gravity pulls it down and air drag pulls each point toward
 * the air's velocity, so a climbing balloon trails its string below it and a crosswind leans it.
 *
 * It is a heavy ribbon (Task 26a), not a whippy thread: its motion is strongly damped toward the
 * knot's own (a swing out dies in a second or so, and the quick waves that run down a hanging
 * chain and whip its light tip never build), it answers only a share of the air going past it (a
 * crosswind leans it gently), its tip is weighted, and no point ever rises above the knot (a cone
 * just under the knot's horizontal: nothing of it can reach the balloon above).
 *
 * Works in real metres: the caller magnifies the drawn string about the knot (Balloon), so the
 * display scale never changes what is simulated. The air is given relative to the knot (the
 * balloon rides the wind; what the string feels is the climb and what crosswind is left). It runs
 * at a fixed 120 Hz substep so it behaves the same at any frame rate. A long frame (a paused or
 * hidden tab) simulates at most its last 0.25 s and carries the string along the rest of the
 * knot's way as it hangs, and a knot that jumps far in one frame (a floating-origin shift, a skip
 * along the route) carries the whole string with it instead of whipping it.
 */
export const ROPE_SEGMENTS = 20;
export const ROPE_SEG_M = 0.06;

const H = 1 / 120;
const MAX_SUBSTEPS = 30; // at most 0.25 s of simulation per call (the scene's own longest frame)
const ITERATIONS = 16;
const GRAVITY = 9.81;
/** Damping rate (1/s) toward the air the string feels: about critical for its swing (a heavy ribbon). */
const DRAG = 14;
/** The share of the air going past the knot that the string answers (a heavy ribbon leans a little). */
const AIR_SHARE = 0.25;
/** The tip weighs this many times any other point (its inverse mass is 1 / TIP_MASS). */
const TIP_MASS = 4;
/** Every point stays under the knot by at least this slope of its distance out from under it (tan 8 deg). */
const BELOW = 0.14;

type V3 = { x: number; y: number; z: number };
export type RopeStepOpts = {
  /** Air velocity relative to the knot, m/s (still air round a knot at rest by default). */
  air?: V3;
  /** Pin the free end here (the hand). Omit or null to let it swing. */
  end?: V3 | null;
};

export class Rope {
  readonly segments: number;
  readonly segLen: number;
  private p: Float64Array;
  private q: Float64Array; // previous positions
  private w: Float64Array; // inverse masses (0: pinned)
  private top = { x: 0, y: 0, z: 0 };
  private acc = 0;

  constructor(segments = ROPE_SEGMENTS, segLenM = ROPE_SEG_M) {
    this.segments = segments;
    this.segLen = segLenM;
    this.p = new Float64Array((segments + 1) * 3);
    this.q = new Float64Array((segments + 1) * 3);
    this.w = new Float64Array(segments + 1).fill(1);
    this.w[0] = 0;
    this.w[segments] = 1 / TIP_MASS;
  }

  get length(): number {
    return this.segLen * this.segments;
  }

  /** Lay the string straight down from the knot, at rest. */
  reset(top: V3): void {
    for (let i = 0; i <= this.segments; i++) {
      const k = i * 3;
      this.p[k] = this.q[k] = top.x;
      this.p[k + 1] = this.q[k + 1] = top.y - i * this.segLen;
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
    if (!Number.isFinite(top.x + top.y + top.z)) return;
    const dt = Number.isFinite(dtSec) ? Math.max(dtSec, 0) : 0;
    const t0 = this.top;
    const end = opts.end ?? null;
    let dx = top.x - t0.x, dy = top.y - t0.y, dz = top.z - t0.z;
    if (Math.hypot(dx, dy, dz) > Math.max(5, 10 * this.length)) {
      // a jump far beyond any real motion carries the string as it hangs, and takes no time
      this.translate(dx, dy, dz);
      this.top = { x: top.x, y: top.y, z: top.z };
      this.solve(top, end);
      return;
    }
    // a long frame simulates only its last 0.25 s: the knot's way before that carries the string as it hangs
    const sim = Math.min(dt, MAX_SUBSTEPS * H);
    if (dt > sim) {
      const carry = 1 - sim / dt;
      this.translate(dx * carry, dy * carry, dz * carry);
      t0.x += dx * carry;
      t0.y += dy * carry;
      t0.z += dz * carry;
      dx = top.x - t0.x;
      dy = top.y - t0.y;
      dz = top.z - t0.z;
    }
    this.acc = Math.min(this.acc + sim, (MAX_SUBSTEPS + 0.5) * H);
    const n = Math.min(MAX_SUBSTEPS, Math.floor(this.acc / H + 1e-9));
    this.acc -= n * H;
    const rel = opts.air ?? { x: 0, y: 0, z: 0 };
    // the air the string feels: moving with the knot through these substeps, plus its share of the air going past
    const sn = n * H;
    const vk = sn > 0 ? { x: dx / sn, y: dy / sn, z: dz / sn } : { x: 0, y: 0, z: 0 };
    const air = { x: vk.x + AIR_SHARE * rel.x, y: vk.y + AIR_SHARE * rel.y, z: vk.z + AIR_SHARE * rel.z };
    const keep = Math.exp(-DRAG * H);
    const a = { x: t0.x, y: t0.y, z: t0.z };
    for (let s = 1; s <= n; s++) {
      // the knot moves along a straight line through this frame's substeps
      const f = s / n;
      a.x = t0.x + dx * f;
      a.y = t0.y + dy * f;
      a.z = t0.z + dz * f;
      this.integrate(keep, air);
      this.solve(a, end);
    }
    if (n === 0) this.solve(top, end); // still honour the pins on a zero-length frame
    this.top = { x: top.x, y: top.y, z: top.z };
  }

  private integrate(keep: number, air: V3): void {
    const { p, q } = this;
    for (let i = 1; i <= this.segments; i++) {
      const k = i * 3;
      for (let c = 0; c < 3; c++) {
        const u = c === 0 ? air.x : c === 1 ? air.y : air.z;
        let nv = u + ((p[k + c] - q[k + c]) / H - u) * keep; // exact exponential drag toward the air's velocity
        if (c === 1) nv -= GRAVITY * H;
        q[k + c] = p[k + c];
        p[k + c] += nv * H;
      }
    }
  }

  private solve(top: V3, end: V3 | null): void {
    const { p, segments: n, segLen: len, w } = this;
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
        const wa = w[s];
        const wb = s + 1 === n && end ? 0 : w[s + 1];
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
      if (!end) this.below(top);
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
      this.below(top);
    }
  }

  /** Keep every point under the knot (below a cone just under its horizontal); one held there stops rising. */
  private below(top: V3): void {
    const { p, q } = this;
    for (let i = 1; i <= this.segments; i++) {
      const k = i * 3;
      const cap = top.y - BELOW * Math.hypot(p[k] - top.x, p[k + 2] - top.z);
      if (p[k + 1] > cap) {
        p[k + 1] = cap;
        if (q[k + 1] < cap) q[k + 1] = cap;
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
