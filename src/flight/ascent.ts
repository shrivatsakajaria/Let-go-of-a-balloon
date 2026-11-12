import { CLIMB_RATE_MS } from '../config';

export { cruiseLevel } from '../wind/sampler';

/** Altitude ASL after tSec of climbing from groundM at 1.5 m/s, capped at the cruise target. */
export function altitudeAt(tSec: number, groundM: number, cruiseTargetM: number): number {
  return Math.min(groundM + CLIMB_RATE_MS + CLIMB_RATE_MS * tSec, cruiseTargetM);
}
