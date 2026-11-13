/**
 * How long the person holds the balloon at Let go when the route is not ready (spec 7.2), counted in
 * real time (performance.now), not in the person's frame time:
 *  - up to 6 s;
 *  - up to 20 s while the start's winds are in and the route is still being worked out (a starved
 *    phone, slow terrain): the winds error is for winds that did not come;
 *  - a route that is ready keeps the hold until the hand opens on its next frame (a tab back from the
 *    background, whose frames stopped while its clock ran on).
 * After that the winds error (spec 7.4) and Try again.
 */
export const MAX_HOLD_MS = 6000;
export const LONG_HOLD_MS = 20000;

export type HoldState = {
  /** The route has come (the hand opens on the next frame). */
  routeReady: boolean;
  /** The start's winds are in (data.ts windsIn). */
  windsIn: boolean;
};

/** At `elapsedMs` after Let go with the hand still closed: true to keep holding, false for the winds error. */
export function keepHolding(elapsedMs: number, s: HoldState): boolean {
  if (s.routeReady) return true;
  if (elapsedMs < MAX_HOLD_MS) return true;
  return s.windsIn && elapsedMs < LONG_HOLD_MS;
}
