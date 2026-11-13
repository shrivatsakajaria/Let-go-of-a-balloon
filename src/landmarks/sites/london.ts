/**
 * London's landmarks. Positions from OpenStreetMap (the building parts in the OpenFreeMap tile,
 * 2026-11): the Palace of Westminster's long axis runs from the Victoria Tower to the Elizabeth
 * Tower at a bearing of 11.7 deg, and both models are built on it.
 */
import type { LandmarkSite } from '../types';

/** The Palace's long axis (Victoria Tower to Elizabeth Tower), compass degrees. */
export const WESTMINSTER_AXIS_DEG = 11.7;

export const sites: LandmarkSite[] = [
  {
    id: 'london-elizabeth-tower',
    cityId: 'london',
    name: 'Elizabeth Tower (Big Ben)',
    at: { lat: 51.50070, lon: -0.124573 },
    headingDeg: WESTMINSTER_AXIS_DEG,
    footprintRadiusM: 12,
  },
  {
    id: 'london-palace-of-westminster',
    cityId: 'london',
    name: 'Palace of Westminster',
    // the middle of the axis between the two towers; the river front is about 65 m to the east
    at: { lat: 51.499515, lon: -0.124965 },
    headingDeg: WESTMINSTER_AXIS_DEG,
    footprintRadiusM: 160,
    // the palace is 290 m long and up to 145 m wide: eight circles over it take every OSM part of it
    // (checked on the 2026-11 tile) and nothing across the road (the Abbey, the Jewel Tower,
    // Portcullis House)
    hides: [[-100, -20, 46], [-33, -20, 46], [37, -14, 48], [107, -10, 50]].flatMap(([z, a, b]) => [a, b].map((x) => ({ x, z, r: 52 }))),
  },
];
