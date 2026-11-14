/**
 * The balloon's string, art-directed (Task 26c): not a simulation but a gentle curve whose shape comes
 * from a few smoothed numbers, so it cannot jerk. It "behaves heavier without being heavier": it hangs in
 * a soft curve under the knot, leans slowly with the air going past it, and sways a little.
 *
 * - Shape: a quadratic Bezier from the knot (point 0) to the free end, its middle a little nearer the
 *   vertical than its end (it leaves the knot steeper, as a hanging string does), its chord shortened so
 *   the curve is always the string's own length.
 * - Lean (the end's direction from straight down, as an angle vector): toward the air going past the knot,
 *   less while it climbs (the air from above holds it straight), at most MAX_LEAN. It follows its target
 *   through a critically damped spring of LEAN_T_S, turning no faster than MAX_RATE and changing that
 *   no faster than MAX_ACCEL, in substeps of at most 1/60 s of the time that really went by: the same at
 *   any frame rate, and a stall of seconds only lets it move as far as those limits allow.
 * - Sway: a slow, small swing (periods of 7 and 11 s, about 2.5 deg), easing in after the let-go.
 * - Held: the string runs from the knot to the hand, bowed a little with its slack.
 * - The let-go: the free end eases from where the hand held it to the hanging shape over RELEASE_S
 *   (smootherstep: no overshoot), the held shape carrying on as it was moving for a moment and coming
 *   to rest (so nothing stops dead as the hand opens), and the lean starts where the held string pointed.
 * - Never above the knot: every point is kept under a cone just below the knot's horizontal.
 *
 * Works in real metres relative to the knot; the caller magnifies it about the drawn knot. No allocation per step.
 */
export const STRING_LENGTH_M = 1.2;
export const STRING_SEGMENTS = 24;
/** The let-go: from the hand to hanging, this long (s). */
export const RELEASE_S = 1.3;
/** The air past the knot leans the string only from the let-go on over this long (s). */
const AIR_IN_S = 3;

const RAD = Math.PI / 180;
const LEAN_T_S = 1.2;
const MAX_LEAN = 30 * RAD;
const MAX_RATE = 25 * RAD;
const MAX_ACCEL = 40 * RAD;
/** Lean per m/s of air across the knot, and how much a climb (m/s of air from above) straightens it. */
const LEAN_PER_MS = 0.4;
const CLIMB_STRAIGHT = 0.35;
/** The middle of the string leans this share less than its end. */
const BOW = 0.45;
const SWAY = 2.5 * RAD;
const SWAY_IN_S = 3;
const SUBSTEP_S = 1 / 60;
/** The held shape's own motion carries on into the let-go, dying away over this long (s). */
const CARRY_S = 0.35;
const MAX_STEP_S = 10;
/** Every point stays under the knot by at least this slope of its distance out from under it (tan 8 deg). */
const BELOW = 0.14;

type V3 = { x: number; y: number; z: number };

/** Smootherstep on [0, 1]: at rest at both ends, its acceleration continuous too. */
export function smootherstep(x: number): number {
  const u = Math.min(1, Math.max(0, x));
  return u * u * u * (u * (u * 6 - 15) + 10);
}

/** Exact critically damped step of x toward 0 (velocity v, angular frequency w) over dt. */
function damp(x: number, v: number, w: number, dt: number): [number, number] {
  const e = Math.exp(-w * dt);
  const t = v + w * x;
  return [(x + t * dt) * e, (v - w * t * dt) * e];
}

export class BalloonString {
  readonly segments = STRING_SEGMENTS;
  readonly length = STRING_LENGTH_M;
  /** Lean (an angle vector: x east, z scene z) and its rate (rad/s). */
  private lx = 0;
  private lz = 0;
  private vx = 0;
  private vz = 0;
  private swayT = 0;
  /** Time since the let-go (s); NaN while held, before any release. */
  private since = Number.NaN;
  private held = false;
  /** The held shape as the hand opened (control point and end, from the knot), and how it was moving (m/s). */
  private readonly h1 = { x: 0, y: 0, z: 0 };
  private readonly h2 = { x: 0, y: 0, z: 0 };
  private readonly v1 = { x: 0, y: 0, z: 0 };
  private readonly v2 = { x: 0, y: 0, z: 0 };
  /** While held: the shape last frame, to tell how it moves. */
  private readonly p1 = { x: 0, y: 0, z: 0 };
  private readonly p2 = { x: 0, y: 0, z: 0 };
  private heldFrames = 0;
  /** The current shape (from the knot): control point and end; and the drawn points. */
  private readonly c1 = { x: 0, y: 0, z: 0 };
  private readonly c2 = { x: 0, y: 0, z: 0 };
  private readonly pts: Float64Array;
  private started = false;

  constructor() {
    this.pts = new Float64Array((STRING_SEGMENTS + 1) * 3);
  }

  /** The hand holds the end (read every step). */
  hold(): void {
    this.held = true;
    this.since = Number.NaN;
    this.heldFrames = 0;
    zero(this.v1);
    zero(this.v2);
  }

  /** The hand opens: the end eases from where it was to hanging. */
  release(): void {
    if (!this.held) {
      if (!this.started) this.since = Infinity; // never held: it simply hangs
      return;
    }
    this.held = false;
    this.since = 0;
    this.h1.x = this.c1.x;
    this.h1.y = this.c1.y;
    this.h1.z = this.c1.z;
    this.h2.x = this.c2.x;
    this.h2.y = this.c2.y;
    this.h2.z = this.c2.z;
    // the lean starts where the held string pointed, at rest
    const r = Math.hypot(this.h2.x, this.h2.y, this.h2.z);
    if (r > 1e-9) {
      const ang = Math.min(MAX_LEAN, Math.acos(Math.min(1, Math.max(-1, -this.h2.y / r))));
      const hr = Math.hypot(this.h2.x, this.h2.z);
      this.lx = hr > 1e-9 ? (ang * this.h2.x) / hr : 0;
      this.lz = hr > 1e-9 ? (ang * this.h2.z) / hr : 0;
    }
    this.vx = this.vz = 0;
  }

  /**
   * One frame: `elapsed` is the time that really went by (s). `air` is the air going past the knot (m/s,
   * relative to it: y < 0 while climbing); `hand` the held end (from the knot, real metres), while held.
   */
  step(elapsed: number, air: V3, hand: V3 | null): void {
    const dt = Number.isFinite(elapsed) ? Math.min(MAX_STEP_S, Math.max(0, elapsed)) : 0;
    if (!this.started && !this.held && Number.isNaN(this.since)) this.since = Infinity;
    // the lean's target: across the air, straightened by a climb; ramped in through the let-go
    const ax = Number.isFinite(air.x) ? air.x : 0, az = Number.isFinite(air.z) ? air.z : 0;
    const climb = Number.isFinite(air.y) ? Math.max(0, -air.y) : 0;
    const across = Math.hypot(ax, az);
    let tx = 0, tz = 0;
    if (across > 1e-9) {
      const ang = Math.min(MAX_LEAN, Math.atan((LEAN_PER_MS * across) / (1 + CLIMB_STRAIGHT * climb)));
      tx = (ang * ax) / across;
      tz = (ang * az) / across;
    }
    if (!this.held && this.since < AIR_IN_S) {
      // (the drawn balloon eases onto the wind for a couple of seconds: the air it seems to feel meanwhile is
      // not real, and comes in only as it settles)
      const k = smootherstep(this.since / AIR_IN_S);
      tx *= k * k;
      tz *= k * k;
    }
    if (!this.started) {
      this.lx = tx;
      this.lz = tz;
    } else if (dt > 0) this.lean(tx, tz, dt);
    if (!this.held) {
      if (this.since < AIR_IN_S + SWAY_IN_S) this.since += dt;
      this.swayT += dt;
    }
    this.started = true;
    this.shape(hand);
    if (this.held && dt > 0) {
      // how the held shape moves (smoothed over a few frames), to carry on with as the hand opens
      if (this.heldFrames++ > 0) {
        const k = 1 - Math.exp(-dt / 0.08);
        track(this.v1, this.c1, this.p1, dt, k);
        track(this.v2, this.c2, this.p2, dt, k);
      }
      copy(this.p1, this.c1);
      copy(this.p2, this.c2);
    }
  }

  /** Point i (0 at the knot), real metres from the knot. */
  point(i: number, out: V3): V3 {
    const k = Math.min(this.segments, Math.max(0, i)) * 3;
    out.x = this.pts[k];
    out.y = this.pts[k + 1];
    out.z = this.pts[k + 2];
    return out;
  }

  /** The lean toward its target: a critically damped spring, its rate and its change capped, in substeps. */
  private lean(tx: number, tz: number, dt: number): void {
    const n = Math.ceil(dt / SUBSTEP_S - 1e-9);
    const h = dt / n;
    const w = 2 / LEAN_T_S;
    for (let s = 0; s < n; s++) {
      let [x, vx] = damp(this.lx - tx, this.vx, w, h);
      let [z, vz] = damp(this.lz - tz, this.vz, w, h);
      x += tx;
      z += tz;
      // the change of rate this substep, then the rate, within their limits
      let dvx = vx - this.vx, dvz = vz - this.vz;
      const dv = Math.hypot(dvx, dvz);
      let capped = false;
      if (dv > MAX_ACCEL * h) {
        dvx *= (MAX_ACCEL * h) / dv;
        dvz *= (MAX_ACCEL * h) / dv;
        capped = true;
      }
      vx = this.vx + dvx;
      vz = this.vz + dvz;
      const v = Math.hypot(vx, vz);
      if (v > MAX_RATE) {
        vx *= MAX_RATE / v;
        vz *= MAX_RATE / v;
        capped = true;
      }
      if (capped) {
        x = this.lx + ((this.vx + vx) / 2) * h;
        z = this.lz + ((this.vz + vz) / 2) * h;
      }
      this.lx = x;
      this.lz = z;
      this.vx = vx;
      this.vz = vz;
    }
  }

  /** Work out the curve (control point, end) and its points. */
  private shape(hand: V3 | null): void {
    const L = this.length;
    const c1 = this.c1, c2 = this.c2;
    if (this.held && hand) {
      // knot to hand, bowed with its slack (downwind, the way it leans)
      c2.x = hand.x;
      c2.y = hand.y;
      c2.z = hand.z;
      const c = Math.hypot(hand.x, hand.y, hand.z);
      const sag = c < L ? c * Math.sqrt(0.375 * (L / Math.max(c, 1e-6) - 1)) : 0;
      // the bow's direction: across the chord, toward the lean (with a little bias so it is never undefined)
      let bx = this.lx + 0.05, bz = this.lz;
      const ux = hand.x / Math.max(c, 1e-9), uy = hand.y / Math.max(c, 1e-9), uz = hand.z / Math.max(c, 1e-9);
      const d = bx * ux + bz * uz;
      let px = bx - d * ux, py = -d * uy, pz = bz - d * uz;
      const pl = Math.hypot(px, py, pz) || 1;
      px /= pl;
      py /= pl;
      pz /= pl;
      c1.x = hand.x / 2 + px * sag;
      c1.y = hand.y / 2 + py * sag;
      c1.z = hand.z / 2 + pz * sag;
    } else {
      // hanging: the lean plus the sway (easing in after the let-go)
      const s = Number.isFinite(this.since) ? smootherstep(this.since / SWAY_IN_S) : 1;
      const sw = SWAY * s;
      const t = this.swayT;
      let lx = this.lx + sw * (0.7 * Math.sin((2 * Math.PI * t) / 7.3) + 0.3 * Math.sin((2 * Math.PI * t) / 11.1 + 1.3));
      let lz = this.lz + sw * (0.7 * Math.sin((2 * Math.PI * t) / 10.7 + 2.1) + 0.3 * Math.sin((2 * Math.PI * t) / 6.9 + 0.4));
      const th = Math.hypot(lx, lz);
      if (th > MAX_LEAN) {
        lx *= MAX_LEAN / th;
        lz *= MAX_LEAN / th;
      }
      hang(lx, lz, L, c1, c2);
      const u = this.since;
      if (u >= 0 && u < RELEASE_S) {
        const k = smootherstep(u / RELEASE_S);
        // the held shape carries on as it was moving, coming to rest over CARRY_S
        const c = CARRY_S * (1 - Math.exp(-u / CARRY_S));
        c1.x = this.h1.x + this.v1.x * c + (c1.x - this.h1.x - this.v1.x * c) * k;
        c1.y = this.h1.y + this.v1.y * c + (c1.y - this.h1.y - this.v1.y * c) * k;
        c1.z = this.h1.z + this.v1.z * c + (c1.z - this.h1.z - this.v1.z * c) * k;
        c2.x = this.h2.x + this.v2.x * c + (c2.x - this.h2.x - this.v2.x * c) * k;
        c2.y = this.h2.y + this.v2.y * c + (c2.y - this.h2.y - this.v2.y * c) * k;
        c2.z = this.h2.z + this.v2.z * c + (c2.z - this.h2.z - this.v2.z * c) * k;
      }
    }
    const n = this.segments, p = this.pts;
    for (let i = 0; i <= n; i++) {
      const f = i / n, a = 2 * (1 - f) * f, b = f * f;
      const x = a * c1.x + b * c2.x, z = a * c1.z + b * c2.z;
      let y = a * c1.y + b * c2.y;
      if (!this.held || !hand) {
        const cap = -BELOW * Math.hypot(x, z);
        if (y > cap) y = cap;
      }
      p[i * 3] = x;
      p[i * 3 + 1] = y;
      p[i * 3 + 2] = z;
    }
  }
}

function zero(v: V3): void {
  v.x = v.y = v.z = 0;
}
function copy(o: V3, v: V3): void {
  o.x = v.x;
  o.y = v.y;
  o.z = v.z;
}
/** Ease velocity v toward (c - p) / dt by k. */
function track(v: V3, c: V3, p: V3, dt: number, k: number): void {
  v.x += ((c.x - p.x) / dt - v.x) * k;
  v.y += ((c.y - p.y) / dt - v.y) * k;
  v.z += ((c.z - p.z) / dt - v.z) * k;
}

/** The hanging curve for a lean (angle vector): control point and end, the curve the string's length. */
function hang(lx: number, lz: number, L: number, c1: V3, c2: V3): void {
  const th = Math.hypot(lx, lz);
  const dx = th > 1e-9 ? lx / th : 0, dz = th > 1e-9 ? lz / th : 0;
  const t1 = th * (1 - BOW);
  // unit chord: the end at angle th, the control point half way down at the gentler angle
  const ex = Math.sin(th) * dx, ey = -Math.cos(th), ez = Math.sin(th) * dz;
  const mx = 0.5 * Math.sin(t1) * dx, my = -0.5 * Math.cos(t1), mz = 0.5 * Math.sin(t1) * dz;
  // its length for a unit chord, by a few samples (it is within a few per cent of 1)
  let len = 0, px = 0, py = 0, pz = 0;
  for (let i = 1; i <= 8; i++) {
    const f = i / 8, a = 2 * (1 - f) * f, b = f * f;
    const x = a * mx + b * ex, y = a * my + b * ey, z = a * mz + b * ez;
    len += Math.hypot(x - px, y - py, z - pz);
    px = x;
    py = y;
    pz = z;
  }
  const k = L / len;
  c1.x = mx * k;
  c1.y = my * k;
  c1.z = mz * k;
  c2.x = ex * k;
  c2.y = ey * k;
  c2.z = ez * k;
}
