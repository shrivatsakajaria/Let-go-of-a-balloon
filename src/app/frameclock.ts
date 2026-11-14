/**
 * The wall-clock time a frame shows (UTC ms), from its requestAnimationFrame timestamp (Task 26c). The live
 * route follows the clock; Date.now() is a whole millisecond read whenever the frame's callback happens to
 * run (late by a varying few ms on a busy page), which would jitter a balloon at 10 m/s by a centimetre or two
 * a frame, and the camera aimed at it with it. The frame's own timestamp is smooth.
 *
 * Its offset to the wall clock is the least seen (a callback can only run late, never early), reached at
 * most SLEW_MS a frame so it never steps; and taken afresh when the two drift more than DRIFT_MS apart (a
 * sleep, a change of the time).
 */
const DRIFT_MS = 250;
const SLEW_MS = 0.5;

export class FrameClock {
  private base = Number.NaN;
  private least = Number.NaN;

  /** The time to show for a frame stamped frameMs (performance.now's clock), the wall clock reading wallMs. */
  at(frameMs: number, wallMs: number): number {
    if (!Number.isFinite(frameMs) || !Number.isFinite(wallMs)) return wallMs;
    const off = wallMs - frameMs;
    if (!(Math.abs(this.base - off) <= DRIFT_MS)) {
      this.base = this.least = off;
    } else {
      this.least = Math.min(this.least, off);
      this.base += Math.max(-SLEW_MS, Math.min(SLEW_MS, this.least - this.base));
    }
    return this.base + frameMs;
  }
}
