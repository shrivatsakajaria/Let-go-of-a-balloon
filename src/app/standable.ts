/**
 * Standable ground: where a person, a street camera and the balloon's first climb stand. The map's
 * drawn ground, or a landmark's own ground where it is higher (a summit rock and terrace a model
 * carries because the elevation data has lost the summit, as on Corcovado). Pure.
 */
import type { LatLon } from '../geo/coords';

export type GroundSources = {
  /** The drawn ground (the stream's groundAt). */
  groundAt(p: LatLon): number;
  /** A landmark's own ground at p (LandmarkLayer.groundAt), -Infinity where there is none. */
  landmarkGroundAt(p: LatLon): number;
};

/** The ground to stand on at p: the drawn ground or a landmark's own ground, whichever is higher. */
export function standableGround(s: GroundSources, p: LatLon): number {
  const g = s.groundAt(p), l = s.landmarkGroundAt(p);
  return l > g ? l : g;
}

/** How far a launch at p stands above the drawn ground (0 off any landmark's ground), for the route's climb. */
export function startLiftM(s: GroundSources, p: LatLon): number {
  return Math.max(0, standableGround(s, p) - s.groundAt(p));
}
