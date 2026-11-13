/**
 * Landmarks (spec 10): small hand-made Contour models that stand in for the plain extruded block at
 * a famous spot, loaded only when the balloon is near them.
 *
 * Adding a landmark takes two files, and no edit to any shared file (the registry finds them):
 *  - `src/landmarks/sites/<cityId>.ts` exports `sites: LandmarkSite[]`: where each landmark of the
 *    city stands. Tiny and loaded up front, so the map can leave out its buildings before any model
 *    has loaded.
 *  - `src/landmarks/models/<id>.ts` exports `model: LandmarkModel`: the code that builds it. Loaded
 *    lazily (its own chunk) by id; the file name is the site's id.
 *
 * Model frame: metres, y up, origin on the ground at `at`. Build the landmark with its front (the
 * side `headingDeg` points to) toward local -z; local +x is then to its right. With headingDeg 0
 * the local axes are the scene's: x east, z south (-z north). The layer turns the group by
 * headingDeg (compass, clockwise) and stands it on the drawn ground at `at`; take the walls a few
 * metres below y = 0 so a sloping street never shows under them.
 *
 * Budget per model module: under 4,000 triangles and under 30 KB gzipped; Contour colours only
 * (kit.ts LANDMARK_COLOURS and the region style's walls and roofs). animate must not allocate.
 */
import type * as THREE from 'three';
import type { LatLon } from '../geo/coords';
import type { Light, RegionStyle } from '../world/palette';

/** The plan's interface (Task 20). */
export interface Landmark {
  id: string;
  cityId: string;
  at: LatLon;
  /** Compass bearing the model's front (local -z) faces. */
  headingDeg: number;
  /** Map buildings whose centroid is within this many metres of `at` are not drawn (unless `hides` says otherwise). */
  footprintRadiusM: number;
  build(style: RegionStyle): THREE.Group;
  /** Called every frame while the landmark is shown. Must not allocate. */
  animate?(group: THREE.Group, utcMs: number, light: Light): void;
}

/** A circle in the model frame (metres) whose map buildings are not drawn. */
export type HideCircle = { x: number; z: number; r: number };

/** Where a landmark stands: everything but its code. */
export type LandmarkSite = Omit<Landmark, 'build' | 'animate'> & {
  /** Plain name, for checks and captions. */
  name: string;
  /**
   * For long buildings a single circle hides too much: these circles (model frame) replace the
   * footprint circle for hiding map buildings. footprintRadiusM still bounds the whole model.
   */
  hides?: HideCircle[];
};

/** What a model module exports as `model`. */
export type LandmarkModel = Pick<Landmark, 'build' | 'animate'>;

/**
 * Mesh buckets (mesh.userData.bucket), each drawn with a shared Contour material by the layer:
 *  - walls: stone with the Contour window pattern (subtle by day, some windows lit at night);
 *  - plain: stone, roofs, spires, metal: no windows;
 *  - glow:  surfaces that light up from dusk (clock faces, lanterns), dim by day.
 */
export type LandmarkBucket = 'walls' | 'plain' | 'glow';
export const LANDMARK_BUCKETS: LandmarkBucket[] = ['walls', 'plain', 'glow'];
