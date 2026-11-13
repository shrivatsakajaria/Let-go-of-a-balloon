/**
 * Tokyo's landmarks. The Shibuya scramble crossing from OpenStreetMap (the junction node 291758776,
 * the crossing ways and the corner buildings, 2026-11): `at` is the middle of the five crossings,
 * 2 m east of cities.json's hero point; the front looks toward Hachiko Square and the station
 * (170.8 deg), the way back to the launch spot.
 */
import type { LandmarkSite } from '../types';

export const sites: LandmarkSite[] = [
  {
    id: 'tokyo-shibuya-crossing',
    cityId: 'tokyo',
    name: 'Shibuya scramble crossing',
    at: { lat: 35.6595, lon: 139.70052 },
    headingDeg: 170.8,
    // the far corner of the west block
    footprintRadiusM: 106,
    // the five corner buildings the model rebuilds with their screens (QFRONT, MAGNET, the
    // station-front building, the west block, the north-west corner); the kiosks and subway
    // entrances round the crossing, and every other block, stay
    hides: [{ x: 6, z: 45, r: 13 }, { x: -44, z: 36, r: 15 }, { x: 59, z: -22, r: 16 }, { x: 77, z: 48, r: 13 }, { x: 47, z: 47, r: 10 }],
  },
];
