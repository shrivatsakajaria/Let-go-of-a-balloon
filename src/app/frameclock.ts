/**
 * The wall-clock time a frame shows (UTC ms), from its requestAnimationFrame timestamp (Task 26c). The live
 * route follows the clock; Date.now() is a whole millisecond read whenever the frame's callback happens to
 * run (late by a varying few ms on a busy page), which would jitter a balloon at 10 m/s by a centimetre or two
 * a frame, and the camera aimed at it with it. The frame's own timestamp is smooth: it is anchored to the wall
 * clock once, and again whenever the two drift more than DRIFT_MS apart (a sleep, a change of the time).
 */
const DRIFT_MS = 250;

export class FrameClock {
  private base = Number.NaN;

  /** The time to show for a frame stamped frameMs (performance.now's clock), the wall clock reading wallMs. */
  at(frameMs: number, wallMs: number): number {
    if (!Number.isFinite(frameMs)) return wallMs;
    if (!(Math.abs(this.base + frameMs - wallMs) <= DRIFT_MS)) this.base = wallMs - frameMs;
    return this.base + frameMs;
  }
}
