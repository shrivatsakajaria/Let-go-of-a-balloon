/**
 * Belfast's landmarks. City Hall fills Donegall Square; its main front faces north up Donegall
 * Place. Position: the middle of the building between its four corner towers in OpenStreetMap
 * (way 539787113 and its parts, 2026-11), 17 m south of the cities.json hero point (which is the
 * great dome, over the north range). The towers put the front 3.5 deg west of north.
 */
import type { LandmarkSite } from '../types';

export const sites: LandmarkSite[] = [
  {
    id: 'belfast-city-hall',
    cityId: 'belfast',
    name: 'Belfast City Hall',
    at: { lat: 54.596435, lon: -5.930038 },
    headingDeg: 356.5,
    // the quadrangle is 95 by 74 m: its corners are 60 m from the middle
    footprintRadiusM: 61,
    // one circle takes all 48 OSM parts of the hall and nothing across the streets round the square
    // (the nearest, the Scottish Provident Building, is 128 m out; checked on the 2026-11 OSM data)
  },
];
