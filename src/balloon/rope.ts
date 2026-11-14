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
 * in fixed 120 Hz substeps, its knot a little behind the real one so it moves at an even speed
 * whatever the frame rate and however the frames fall (see step). A long frame (a paused or hidden
 * tab) simulates at most its last 0.25 s, and a jump far beyond any real motion (a floating-origin
 * shift, a skip along the route) or a stall's sudden leap carries the string as it hangs instead
 * of whipping it.
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
/**
 * The most the knot's velocity may change in a frame: MAX_ACCEL m/s for each second of it, counted
 * up to 1/15 s, plus MAX_DV. Above what the balloon does at real frame rates (its release eases at up
 * to about 25 m/s/s), far below the leap of a stalled frame told as 0.25 s (the scene caps its frame
 * time while the route goes on by the clock; Balloon passes the real time, this is the backstop).
 */
const MAX_ACCEL = 30;
const MAX_DV = 0.3;

type V3 = { x: number; y: number; z: number };
export type RopeStepOpts = {
  /** Air velocity relative to the knot, m/s (still air round a knot at rest by default). */
  air?: V3;
  /** Pin the free end here (the hand). Omit or null to let it swing. */
  end?: V3 | null;
};

const ZERO: Readonly<V3> = { x: 0, y: 0, z: 0 };
function set(o: V3, v: V3): void {
  o.x = v.x;
  o.y = v.y;
  o.z = v.z;
}

export class Rope {
  readonly segments: number;
  readonly segLen: number;
  private p: Float64Array;
  private q: Float64Array; // previous positions
  private w: Float64Array; // inverse masses (0: pinned)
  /** The simulated knot (point 0's pin), the real one as last given, and the knot's velocity (m/s). */
  private knot: V3 = { x: 0, y: 0, z: 0 };
  private real: V3 = { x: 0, y: 0, z: 0 };
  private vel: V3 = { x: 0, y: 0, z: 0 };
  /** Just reset: the first frame's velocity is taken as it comes. */
  private fresh = true;
  /** Simulation time not yet run (s): the simulated knot is this far behind the real one. */
  private acc = 0;
  // scratch, so a frame allocates nothing
  private t0: V3 = { x: 0, y: 0, z: 0 };
  private air: V3 = { x: 0, y: 0, z: 0 };
  private endOff: V3 = { x: 0, y: 0, z: 0 };
  private endAt: V3 = { x: 0, y: 0, z: 0 };

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
    set(this.knot, top);
    set(this.real, top);
    set(this.vel, ZERO);
    this.fresh = true;
    this.acc = 0;
  }

  point(i: number, out: THREE.Vector3): THREE.Vector3 {
    const k = i * 3;
    return out.set(this.p[k], this.p[k + 1], this.p[k + 2]);
  }

  /**
   * One frame of dtSec, the knot now at `top`. The simulation runs in whole 120 Hz substeps, so it
   * stops short of now by up to a substep (60 Hz with half a millisecond of jitter is 1, 3, 2
   * substeps a frame, and 144 Hz is 0 or 1). Its knot runs that far behind the real one, at the
   * frame's velocity, so it moves at an even speed however the frames fall; the end pin keeps its
   * place relative to the knot. Point 0 is that simulated knot: draw the string from point 0.
   */
  step(dtSec: number, top: V3, opts: RopeStepOpts = {}): void {
    if (!Number.isFinite(top.x + top.y + top.z)) return;
    const dt = Number.isFinite(dtSec) ? Math.max(dtSec, 0) : 0;
    const R = this.real, K = this.knot, v = this.vel;
    let pinEnd: V3 | null = null;
    if (opts.end) {
      const e = opts.end;
      this.endOff.x = e.x - top.x;
      this.endOff.y = e.y - top.y;
      this.endOff.z = e.z - top.z;
      pinEnd = this.endOff;
    }
    const dx = top.x - R.x, dy = top.y - R.y, dz = top.z - R.z;
    set(R, top);
    if (!(dt > 0) || Math.hypot(dx, dy, dz) > Math.max(5, 10 * this.length)) {
      // a jump far beyond any real motion (or a frame of no time) carries the string as it hangs
      this.carry(dx, dy, dz);
      this.solve(K, pinEnd);
      return;
    }
    // the knot's velocity this frame; a sudden change no balloon makes is a stall or a skip, and the
    // part of it past a plausible change is carried
    let vx = dx / dt, vy = dy / dt, vz = dz / dt;
    if (!this.fresh) {
      const ex = vx - v.x, ey = vy - v.y, ez = vz - v.z;
      const e = Math.hypot(ex, ey, ez);
      const lim = MAX_ACCEL * Math.min(dt, 1 / 15) + MAX_DV;
      if (e > lim) {
        vx = v.x + (ex * lim) / e;
        vy = v.y + (ey * lim) / e;
        vz = v.z + (ez * lim) / e;
      }
    }
    this.fresh = false;
    v.x = vx;
    v.y = vy;
    v.z = vz;
    // a long frame simulates only its last 0.25 s: the knot's way before that, and anything past the
    // plausible velocity, carries the string as it hangs
    const sim = Math.min(dt, MAX_SUBSTEPS * H);
    this.carry(dx - vx * sim, dy - vy * sim, dz - vz * sim);
    this.acc = Math.min(this.acc + sim, (MAX_SUBSTEPS + 0.5) * H);
    const n = Math.min(MAX_SUBSTEPS, Math.floor(this.acc / H + 1e-9));
    this.acc -= n * H;
    if (n === 0) {
      this.solve(K, pinEnd); // no substep this frame: the simulated knot waits (it is behind by acc)
      return;
    }
    // the simulated knot goes from where it was to the real one less the time not yet simulated
    const t0 = this.t0;
    set(t0, K);
    const sx = R.x - vx * this.acc - t0.x, sy = R.y - vy * this.acc - t0.y, sz = R.z - vz * this.acc - t0.z;
    const sn = n * H;
    // the air the string feels: moving with the knot through these substeps, plus its share of the air going past
    const rel = opts.air ?? ZERO;
    const air = this.air;
    air.x = sx / sn + AIR_SHARE * rel.x;
    air.y = sy / sn + AIR_SHARE * rel.y;
    air.z = sz / sn + AIR_SHARE * rel.z;
    const keep = Math.exp(-DRAG * H);
    for (let s = 1; s <= n; s++) {
      // the knot moves along a straight line through this frame's substeps
      const f = s / n;
      K.x = t0.x + sx * f;
      K.y = t0.y + sy * f;
      K.z = t0.z + sz * f;
      this.integrate(keep, air);
      this.solve(K, pinEnd);
    }
  }

  /** The string and its simulated knot moved as one: it hangs as it was. */
  private carry(dx: number, dy: number, dz: number): void {
    if (dx === 0 && dy === 0 && dz === 0) return;
    this.translate(dx, dy, dz);
    this.knot.x += dx;
    this.knot.y += dy;
    this.knot.z += dz;
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

  /** Satisfy the pins (the knot; the end at `endOff` from the knot, when held) and the segment lengths. */
  private solve(top: V3, endOff: V3 | null): void {
    const { p, segments: n, segLen: len, w } = this;
    const pin = (i: number, v: V3) => {
      p[i * 3] = v.x;
      p[i * 3 + 1] = v.y;
      p[i * 3 + 2] = v.z;
    };
    pin(0, top);
    const end = endOff ? this.endAt : null;
    if (end && endOff) {
      end.x = top.x + endOff.x;
      end.y = top.y + endOff.y;
      end.z = top.z + endOff.z;
      pin(n, end);
    }
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
