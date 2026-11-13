/**
 * Barcelona's landmarks. The Sagrada Família from OpenStreetMap (relation 9194723 and the tower
 * parts, 2026-11): `at` is the crossing under the Tower of Jesus Christ (way 359084982), 12 m
 * north-west of cities.json's hero point; the nave runs on the Eixample grid, the Glory façade
 * facing south-east (134.5 deg) onto Carrer de Mallorca.
 */
import type { LandmarkSite } from '../types';

export const sites: LandmarkSite[] = [
  {
    id: 'barcelona-sagrada-familia',
    cityId: 'barcelona',
    name: 'Sagrada Família',
    at: { lat: 41.40359, lon: 2.17435 },
    headingDeg: 134.5,
    // the temple block's corners and the cranes' reach (the front crane's jib swings over the street)
    footprintRadiusM: 105,
    // the basilica (its outline and every tower part) lies within 55 m of the crossing, the two
    // sacristies behind the apse a little further; the shop, the guardhouse and the schools stay
    hides: [{ x: 0, z: -4, r: 54 }, { x: -31, z: 44, r: 13 }, { x: 31, z: 44, r: 13 }],
  },
];
