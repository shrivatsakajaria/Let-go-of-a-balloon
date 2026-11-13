/**
 * Singapore's landmarks. Positions from OpenStreetMap (Marina Bay Sands' towers, lobbies and
 * SkyPark, 2026-11): the towers stand on a gentle arc whose chord runs at 24 degrees, their faces to
 * the bay at 294 degrees.
 */
import type { LandmarkSite } from '../types';

export const sites: LandmarkSite[] = [
  {
    id: 'singapore-marina-bay-sands',
    cityId: 'singapore',
    name: 'Marina Bay Sands',
    // cities.json's hero point, by the middle tower (13 m from its centre)
    at: { lat: 1.2837, lon: 103.86072 },
    headingDeg: 294,
    // the SkyPark's south end is 175 m out
    footprintRadiusM: 176,
    // the towers and the lobbies between them (the cantilever has nothing of its own under it; the
    // Shoppes and the building under the cantilever stay)
    hides: [
      { x: -129, z: -8, r: 40 },
      { x: -70, z: 0, r: 30 },
      { x: -12.6, z: 2, r: 40 },
      { x: 40, z: -5, r: 28 },
      { x: 90, z: -10, r: 36 },
    ],
  },
];
