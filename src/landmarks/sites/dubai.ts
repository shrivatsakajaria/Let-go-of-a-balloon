/**
 * Dubai's landmarks. The Burj Khalifa from OpenStreetMap (way 446646206 and its building parts,
 * 2026-11): `at` is the core under the spire (way 137147715), 21 m north of cities.json's hero
 * point; the front is the south wing, toward the lake and Burj Park (186.7 deg).
 */
import type { LandmarkSite } from '../types';

export const sites: LandmarkSite[] = [
  {
    id: 'dubai-burj-khalifa',
    cityId: 'dubai',
    name: 'Burj Khalifa',
    at: { lat: 25.19722, lon: 55.27416 },
    headingDeg: 186.7,
    // the model takes in the Dubai Fountain, whose far end is 345 m away in the lake
    footprintRadiusM: 346,
    // only the tower is hidden: every one of its OSM parts (and its podium) lies within 63 m of
    // the core; the low buildings by Burj Park (95 m and more) stay
    hides: [{ x: 0, z: 0, r: 66 }],
  },
];
