/**
 * Galway's landmarks. The Spanish Arch: a stretch of the town wall at the mouth of the Corrib, the
 * Spanish Parade before it. Position: the middle of the wall in OpenStreetMap (way 36783334 and the
 * city-wall line 1532285288, 2026-11), 3.5 m east of the cities.json hero point. The wall runs
 * south-west to north-east (bearing 45 deg) and the arches open south-east onto the Parade (the
 * footway through the arch, way 202324012), so the front faces 135 deg.
 */
import type { LandmarkSite } from '../types';

export const sites: LandmarkSite[] = [
  {
    id: 'galway-spanish-arch',
    cityId: 'galway',
    name: 'Spanish Arch',
    at: { lat: 53.269804, lon: -9.053937 },
    headingDeg: 135,
    // 36 m of wall: the ends are 18 m out
    footprintRadiusM: 19,
    // two small circles along the wall take the OSM arch building and leave the building that leans
    // on its back (way 36783337, 7 m behind) and the City Museum
    hides: [
      { x: 9, z: 0, r: 6 },
      { x: 1, z: 0, r: 4.5 },
    ],
  },
];
