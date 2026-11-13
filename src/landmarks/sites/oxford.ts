/**
 * Oxford's landmarks. Positions from OpenStreetMap (2026-11): the Radcliffe Camera is way 4884600,
 * with its 3D parts (the lower rotunda way 385163420, the drum and dome way 237779894, the cupola
 * way 1259054050, the north stair way 1259054048).
 */
import type { LandmarkSite } from '../types';

export const sites: LandmarkSite[] = [
  {
    id: 'oxford-radcliffe-camera',
    cityId: 'oxford',
    name: 'Radcliffe Camera',
    // the centre of the drum and cupola (both OSM parts agree), 2 m south of the sheet's hero point
    // (that is the centroid of the outline with its north stair)
    at: { lat: 51.753434, lon: -1.253994 },
    // the north stair; the building is round, so this only sets which bay faces where
    headingDeg: 343,
    // the rotunda is 31.6 m across, the stair reaches 18 m out; the colleges round the square stand
    // 30 m and more from the centre
    footprintRadiusM: 19,
  },
];
