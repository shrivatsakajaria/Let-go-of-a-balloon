/**
 * Manchester's landmarks. Positions from OpenStreetMap (the Town Hall's building parts, 2026-11):
 * the Town Hall is a triangle whose Albert Square front runs at a bearing of 23.5 deg, so the
 * front faces 293.5 deg, across the square; the clock tower stands in the middle of that front.
 */
import type { LandmarkSite } from '../types';

export const sites: LandmarkSite[] = [
  {
    id: 'manchester-town-hall',
    cityId: 'manchester',
    name: 'Manchester Town Hall',
    // the clock tower's centre (cities.json's hero point, which OSM puts on the tower)
    at: { lat: 53.47935, lon: -2.24465 },
    headingDeg: 293.5,
    footprintRadiusM: 104,
    // the triangle is 92 m along the square and 100 m deep: five circles take every OSM part of
    // it (the rear tower included) and nothing across Lloyd Street, Princess Street or the square
    // (the Albert Memorial, the Town Hall Extension and its bridges are kept)
    hides: [
      { x: 0, z: 0, r: 10 },
      { x: -26, z: 8, r: 24 },
      { x: 22, z: 8, r: 24 },
      { x: -4, z: 40, r: 28 },
      { x: -10, z: 77, r: 23 },
    ],
  },
];
