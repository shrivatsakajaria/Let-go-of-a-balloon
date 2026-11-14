/**
 * The wall-clock time a frame shows (UTC ms), from its requestAnimationFrame timestamp (Task 26c). The live
 * route follows the clock; Date.now() is a whole millisecond read whenever the frame's callback happens to
 * run (late by a varying few ms on a busy page), which would jitter a balloon at 10 m/s by a centimetre or two
 * a frame, and the camera aimed at it with it. The frame's own timestamp is smooth.
 *
 * Its offset to the wall clock is the least seen over the last WINDOW_MS or so (a callback can only run late,
 * never early, so the least is the true offset; and a wall clock that drifts or is corrected is followed
 * within about a second). The offset in use eases toward it by at most SLEW_MS plus SLEW_SHARE of the
 * difference a frame, so it never steps (a correction of under a second is eased in over a few seconds), and
 * is taken afresh when the two are more than SNAP_MS apart (a sleep, a change of the time).
 */
const SNAP_MS = 1000;
const WINDOW_MS = 500;
const SLEW_MS = 0.5;
const SLEW_SHARE = 0.005;

export class FrameClock {
  private base = Number.NaN;
  /** The least offset seen in this window and the one before, and when this window began. */
  private least = Number.NaN;
  private before = Number.NaN;
  private windowAt = Number.NaN;

  /** The time to show for a frame stamped frameMs (performance.now's clock), the wall clock reading wallMs. */
  at(frameMs: number, wallMs: number): number {
    if (!Number.isFinite(frameMs) || !Number.isFinite(wallMs)) return wallMs;
    const off = wallMs - frameMs;
    if (!(Math.abs(this.base - off) <= SNAP_MS)) {
      this.base = this.least = this.before = off;
      this.windowAt = frameMs;
      return this.base + frameMs;
    }
    if (!(frameMs - this.windowAt < WINDOW_MS) || frameMs < this.windowAt) {
      this.before = this.least;
      this.least = off;
      this.windowAt = frameMs;
    } else this.least = Math.min(this.least, off);
    const d = Math.min(this.least, this.before) - this.base;
    const step = SLEW_MS + SLEW_SHARE * Math.abs(d);
    this.base += Math.max(-step, Math.min(step, d));
    return this.base + frameMs;
  }
}
