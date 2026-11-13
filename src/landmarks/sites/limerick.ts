/**
 * Limerick's landmarks. King John's Castle stands on King's Island with its curtain wall on the
 * Shannon. Position: the middle of the castle's OpenStreetMap outline (relation 1304392, 2026-11),
 * 32 m west of the cities.json hero point (which is on its east side). The river front runs at a
 * bearing of 337 deg, so the front, facing the river and Clancy's Strand across it, faces 247 deg.
 */
import type { LandmarkSite } from '../types';

export const sites: LandmarkSite[] = [
  {
    id: 'limerick-king-johns-castle',
    cityId: 'limerick',
    name: "King John's Castle",
    at: { lat: 52.66969, lon: -8.625544 },
    headingDeg: 247,
    // the castle is about 90 by 75 m; its round towers reach 57 m from the middle
    footprintRadiusM: 58,
    // four circles over the ward take the castle (in whatever pieces a tile cuts it into) and none
    // of its neighbours: the visitor centre and the Widow's Almshouses to the south-east, the houses
    // of Castle Street (checked on the 2026-11 OSM data)
    hides: [
      { x: 20, z: -10, r: 28 },
      { x: -14, z: -10, r: 26 },
      { x: 22, z: 22, r: 22 },
      { x: -6, z: 26, r: 18 },
    ],
  },
];
