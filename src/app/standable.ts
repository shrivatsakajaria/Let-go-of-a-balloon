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

/**
 * The balloon's height over what is under it (scene y): over a landmark's ground where that is
 * higher than the drawn ground, else over the drawn ground. For the HUD's height, the shadow and
 * the person's leaving; not for sceneAltitude, whose route height already carries the lift.
 */
export function aglOver(y: number, drawnGround: number, landmarkGround: number): number {
  return Math.max(0, y - Math.max(drawnGround, landmarkGround));
}

/**
 * The floor a just-released balloon climbs from (hudmath.climbFloor): where the hand opened, only for
 * a launch from a landmark's terrace (a lifted start); NaN, no floor, anywhere else.
 */
export function climbFloorFrom(feetY: number, liftM: number): number {
  return liftM > 0 ? feetY + 1.5 : Number.NaN;
}

/**
 * The person's feet next frame: eased toward the ground as finer tiles arrive, snapped on the first
 * placement, after a change of over 200 m, or when a landmark's ground appears or leaves under them
 * (a terrace arriving after the 6 s wait must not lift them 180 m over half a second).
 */
export function nextFeet(prev: number, ground: number, dtSec: number, landmarkChanged: boolean): number {
  if (Number.isNaN(prev) || landmarkChanged || Math.abs(ground - prev) > 200) return ground;
  return prev + (ground - prev) * (1 - Math.exp(-dtSec / 0.6));
}
