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
 *   just ahead (it is pressed against the wall and slides up it), let go again as the lift clears it.
 * No allocation per step.
 */
export const SLIDE = { marginM: 1.2, radiusM: 1, aheadS: 3, riseTauS: 0.5, maxRiseMs: 6, decayMs: 0.8 } as const;

/** Highest building or landmark top (absolute) within r of the scene point (x, z); ground or less where none. */
export type TopAt = (x: number, z: number, r: number) => number;

export class FacadeSlide {
  lift = 0;
  back = 0;
  private v = 0;

  reset(): void {
    this.lift = this.back = this.v = 0;
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
    const bx = x - ux * this.back, bz = z - uz * this.back;
    for (let k = 0; k <= n; k++) {
      const tau = (SLIDE.aheadS * k) / n;
      const T = top(bx + ux * v * tau, bz + uz * v * tau, SLIDE.radiusM);
      if (!Number.isFinite(T)) continue;
      const need = T + SLIDE.marginM - (y + CLIMB_RATE_MS * tau);
      if (need > 0) want = Math.max(want, need * Math.min(1, (2 * (n + 1 - k)) / (n + 2)));
    }
    if (want > this.lift) {
      // eased up (critically damped), no faster than maxRiseMs
      const w = 2 / SLIDE.riseTauS;
      const ex = Math.exp(-w * dt);
      const d = this.lift - want;
      const tmp = this.v + w * d;
      let next = want + (d + tmp * dt) * ex;
      this.v = (this.v - w * tmp * dt) * ex;
      if (next - this.lift > SLIDE.maxRiseMs * dt) {
        next = this.lift + SLIDE.maxRiseMs * dt;
        this.v = SLIDE.maxRiseMs;
      }
      this.lift = Math.max(this.lift, next);
    } else {
      this.v = 0;
      this.lift = Math.max(want, this.lift - SLIDE.decayMs * dt);
    }
    // pressed against a wall it has not yet cleared: held back along the drift (it slides up the wall);
    // let go again (catching up no faster than its own speed) once the way ahead is clear at its height
    const yNow = y + this.lift;
    if (blockedAt(x, z, ux, uz, this.back, yNow, top)) this.back += v * dt;
    else if (this.back > 0) {
      const nb = Math.max(0, this.back - v * dt);
      if (!blockedAt(x, z, ux, uz, nb, yNow, top)) this.back = nb;
    }
  }

  /** Well up, with nothing to look up (no lookups): the lift goes as in step, the hold catches up. */
  ease(speed: number, dt: number): void {
    if (!(dt > 0)) return;
    this.v = 0;
    this.lift = Math.max(0, this.lift - SLIDE.decayMs * dt);
    this.back = Math.max(0, this.back - (Number.isFinite(speed) ? Math.max(0, speed) : 0) * dt);
  }
}

/** Is the way just ahead of the drawn balloon (held `back` m) walled at its height? */
function blockedAt(x: number, z: number, ux: number, uz: number, back: number, yNow: number, top: TopAt): boolean {
  return top(x - ux * back + ux * SLIDE.radiusM, z - uz * back + uz * SLIDE.radiusM, SLIDE.radiusM * 0.5) > yNow - 0.3;
}
