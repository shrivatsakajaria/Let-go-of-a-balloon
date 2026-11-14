import { CLIMB_RATE_MS } from '../config';

/**
 * The drawn balloon slides up a facade it meets (ruling R57b). The route knows nothing of buildings, so a
 * balloon released toward a building would pass into it; a real one rises along the wall and over the roof.
 * This is a visual nudge to the drawn position only (the route's winds, timing and the HUD's height are
 * untouched):
 * - lift: metres added to the drawn height. It rises, eased, before the balloon reaches a building in its
 *   way (looking AHEAD_S ahead along the drift, as the route will climb meanwhile) to clear its top by
 *   MARGIN_M, and goes again no faster than DECAY_MS once past it (slower than the climb, so the drawn
 *   balloon never sinks);
 * - back: metres the drawn balloon is held back along its drift while it is still below the top of a wall
 *   just ahead (it is pressed against the wall and slides up it), let go again as the lift clears it. Its
 *   own speed along the drift changes by no more than brakeMs2 (Task 26c): it slows to a stop short of a
 *   wall it sees coming at its height, gets going again once it is clear, and catches up with its route at
 *   up to catchUp of its speed again, easing off as it gets there.
 * Both are then eased (critically damped, over smoothLiftS and smoothBackS): no lurch the launch camera,
 * aimed at it, would pass on.
 * No allocation per step.
 */
export const SLIDE = { marginM: 1.2, radiusM: 1, aheadS: 5, riseTauS: 0.8, maxRiseMs: 3, decayMs: 0.8, smoothLiftS: 0.5, smoothBackS: 0.15, catchUp: 0.5, brakeMs2: 2 } as const;

/** Highest building or landmark top (absolute) within r of the scene point (x, z); ground or less where none. */
export type TopAt = (x: number, z: number, r: number) => number;

export class FacadeSlide {
  /** The eased lift and hold-back (m): read these. */
  lift = 0;
  back = 0;
  private liftV = 0;
  private backV = 0;
  /** What the facade asks for (before easing). */
  private rawLift = 0;
  private rawBack = 0;
  private v = 0;
  /** The drawn balloon's own speed along the drift (m/s; NaN before the first step). */
  private drawnV = Number.NaN;

  reset(): void {
    this.lift = this.back = this.v = this.rawLift = this.rawBack = this.liftV = this.backV = 0;
    this.drawnV = Number.NaN;
  }

  /**
   * The hold-back over dt for a drift at v (m/s) with `room` (m) before a wall at its height: the drawn
   * balloon's speed goes toward its route's plus what catches it up, never more than lets it stop in the
   * room it has, and changes by no more than brakeMs2 (a wall that shows up nearer than that, or a slower
   * drift, it slows for at once).
   */
  private hold(v: number, room: number, dt: number): void {
    const a = SLIDE.brakeMs2;
    if (!Number.isFinite(this.drawnV)) this.drawnV = room > 0 ? v : 0;
    // (the drawn balloon, eased, runs on ahead of this by what the easing lags: that much less room)
    const lag = Math.max(0, this.rawBack - this.back);
    const want = Math.min(v + Math.min(SLIDE.catchUp * v, Math.sqrt(2 * a * this.rawBack)), Math.sqrt(2 * a * Math.max(0, room - lag)));
    this.drawnV = want < this.drawnV ? want : Math.min(want, this.drawnV + a * dt);
    this.rawBack = Math.max(0, this.rawBack + (v - this.drawnV) * dt);
  }

  /** Ease lift and back toward what is asked (exact critically damped steps). */
  private smooth(dt: number): void {
    const step = (x: number, v: number, target: number, T: number): [number, number] => {
      const w = 2 / T, e = Math.exp(-w * dt);
      const d = x - target, t = v + w * d;
      return [target + (d + t * dt) * e, (v - w * t * dt) * e];
    };
    [this.lift, this.liftV] = step(this.lift, this.liftV, this.rawLift, SLIDE.smoothLiftS);
    [this.back, this.backV] = step(this.back, this.backV, this.rawBack, SLIDE.smoothBackS);
    if (this.lift < 1e-6 && this.rawLift === 0) this.lift = this.liftV = 0;
    if (this.back < 1e-6 && this.rawBack === 0) this.back = this.backV = 0;
  }

  /**
   * One frame. (x, y, z): the route's drawn position (scene), (ux, uz) the drift's unit direction and
   * speed its speed (m/s). Returns nothing; read lift and back.
   */
  step(x: number, y: number, z: number, ux: number, uz: number, speed: number, dt: number, top: TopAt): void {
    if (!(dt > 0) || !Number.isFinite(x + y + z)) return;
    const v = Number.isFinite(speed) && Number.isFinite(ux + uz) ? Math.max(0, speed) : 0;
    // what it must be lifted by to clear what lies ahead when it gets there (fully for what it reaches
    // within half the look-ahead, part of the way beyond: it starts up the wall early, not at it)
    let want = 0;
    const n = 6;
    const bx = x - ux * this.rawBack, bz = z - uz * this.rawBack;
    for (let k = 0; k <= n; k++) {
      const tau = (SLIDE.aheadS * k) / n;
      const T = top(bx + ux * v * tau, bz + uz * v * tau, SLIDE.radiusM);
      if (!Number.isFinite(T)) continue;
      const need = T + SLIDE.marginM - (y + CLIMB_RATE_MS * tau);
      if (need > 0) want = Math.max(want, need * Math.min(1, (2 * (n + 1 - k)) / (n + 2)));
    }
    if (want > this.rawLift) {
      // eased up (critically damped), no faster than maxRiseMs
      const w = 2 / SLIDE.riseTauS;
      const ex = Math.exp(-w * dt);
      const d = this.rawLift - want;
      const tmp = this.v + w * d;
      let next = want + (d + tmp * dt) * ex;
      this.v = (this.v - w * tmp * dt) * ex;
      if (next - this.rawLift > SLIDE.maxRiseMs * dt) {
        next = this.rawLift + SLIDE.maxRiseMs * dt;
        this.v = SLIDE.maxRiseMs;
      }
      this.rawLift = Math.max(this.rawLift, next);
    } else {
      this.v = 0;
      this.rawLift = Math.max(want, this.rawLift - SLIDE.decayMs * dt);
    }
    // how far it can go before a wall at its height (looking as far ahead as it takes to stop): it slows for
    // one, is held against it while it slides up it, and goes on once the way ahead is clear at its height
    // (as high as it will be by the time it gets there: climbing, and the lift rising, at half its most)
    const yNow = y + this.rawLift;
    const sp = Number.isFinite(this.drawnV) ? Math.max(this.drawnV, v) : v;
    const rising = Math.max(0, want - this.rawLift);
    const yAt = (d: number) => {
      const t = d / Math.max(0.5, sp);
      return yNow + CLIMB_RATE_MS * t + Math.min(rising, 0.5 * SLIDE.maxRiseMs * t);
    };
    const reach = (sp * sp) / (2 * SLIDE.brakeMs2) + 1;
    let room = Infinity;
    if (blockedAt(x, z, ux, uz, this.rawBack, yNow, top)) room = 0;
    else {
      for (let d = 1; d <= reach + 1; d++) {
        if (!blockedAt(x, z, ux, uz, this.rawBack - d, yAt(d), top)) continue;
        // (to a few centimetres)
        let lo = d - 1, hi = d;
        for (let k = 0; k < 4; k++) {
          const m = (lo + hi) / 2;
          if (blockedAt(x, z, ux, uz, this.rawBack - m, yAt(m), top)) hi = m;
          else lo = m;
        }
        room = lo;
        break;
      }
    }
    this.hold(v, room, dt);
    this.smooth(dt);
  }

  /** Well up, with nothing to look up (no lookups): the lift goes as in step, the hold catches up. */
  ease(speed: number, dt: number): void {
    if (!(dt > 0)) return;
    this.v = 0;
    this.rawLift = Math.max(0, this.rawLift - SLIDE.decayMs * dt);
    this.hold(Number.isFinite(speed) ? Math.max(0, speed) : 0, Infinity, dt);
    this.smooth(dt);
  }
}

/** Is the way just ahead of the drawn balloon (held `back` m) walled at its height? */
function blockedAt(x: number, z: number, ux: number, uz: number, back: number, yNow: number, top: TopAt): boolean {
  return top(x - ux * back + ux * SLIDE.radiusM, z - uz * back + uz * SLIDE.radiusM, SLIDE.radiusM * 0.5) > yNow - 0.3;
}
