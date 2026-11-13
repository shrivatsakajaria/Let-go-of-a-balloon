/**
 * Glasgow's landmarks. Positions from OpenStreetMap (the City Chambers' outline and parts,
 * 2026-11): the building is a 73 m by 75 m quadrangle on the east side of George Square, its
 * west front at a bearing of 281 deg. The origin is the middle of the quadrangle, 22 m east of
 * the cities.json hero point (the central tower, which stands 15 m behind the front).
 */
import type { LandmarkSite } from '../types';

export const sites: LandmarkSite[] = [
  {
    id: 'glasgow-city-chambers',
    cityId: 'glasgow',
    name: 'Glasgow City Chambers',
    at: { lat: 55.860931, lon: -4.248266 },
    headingDeg: 281,
    // the quadrangle's corners are 53 m out, but the hiding circle is smaller: it takes every OSM
    // part of the building (outline, tower, the four corner domes, all within 45 m) and leaves the
    // small buildings on John Street (47 m off) and City Chambers East (72 m)
    footprintRadiusM: 56,
    hides: [{ x: 0, z: 0, r: 46 }],
  },
];
