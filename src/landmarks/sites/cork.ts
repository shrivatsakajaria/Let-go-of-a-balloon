/**
 * Cork's landmarks. St Anne's, Shandon: the steeple stands at the west end of the church, its door
 * on Church Street. Position: the centre of the tower in the OpenStreetMap church outline (way
 * 104004889, 2026-11), 2 m north of the cities.json hero point (the bell-tower node). The church is
 * square to the compass, so the steeple's front faces due west.
 */
import type { LandmarkSite } from '../types';

export const sites: LandmarkSite[] = [
  {
    id: 'cork-shandon-bells',
    cityId: 'cork',
    name: "Shandon Bells (St Anne's Church)",
    at: { lat: 51.903278, lon: -8.476167 },
    headingDeg: 270,
    // the model takes in the nave and chancel behind the tower (east, +z), 33 m long
    footprintRadiusM: 34,
    // OSM draws tower and church as one building (centroid 14 m east of the tower): one circle takes
    // it and none of the houses round the churchyard (checked on the 2026-11 OSM data)
    hides: [{ x: 0, z: 15, r: 18 }],
  },
];
