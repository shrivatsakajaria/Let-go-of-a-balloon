/**
 * Birmingham's landmarks. Positions from OpenStreetMap (the Library of Birmingham's building parts,
 * 2026-11): the stacked boxes are square to a bearing of 65.5 deg; the front, over Centenary Square
 * and its sunken amphitheatre, faces 155.5 deg. The Rep theatre adjoins on the right (+x).
 */
import type { LandmarkSite } from '../types';

export const sites: LandmarkSite[] = [
  {
    id: 'birmingham-library-of-birmingham',
    cityId: 'birmingham',
    name: 'Library of Birmingham',
    // the centre of the ground-floor box (cities.json's hero point is 5 m away, on the rotunda's side)
    at: { lat: 52.479717, lon: -1.908539 },
    headingDeg: 155.5,
    footprintRadiusM: 50,
    // every OSM part of the library, and the amphitheatre in the square in front of it (tagged as
    // a building but sunk below the square); the Rep and Baskerville House are kept
    hides: [
      { x: -2, z: -3, r: 40 },
      { x: -11, z: -54, r: 10 },
    ],
  },
];
