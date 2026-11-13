/**
 * Rio de Janeiro's landmarks. Positions from OpenStreetMap (the cable car's ropes and stations,
 * 2026-11). Sugarloaf and its cable car are one landmark, placed at Station I on Praia Vermelha
 * (on the ground near the sea, so the model stands at a height the map draws reliably), with its
 * front up the line toward the summit; the summit is 1,304 m ahead.
 *
 * Christ the Redeemer stands on the OSM node of the statue on Corcovado, facing 82 degrees (east
 * over the city and the bay, along the summit's front platform in OSM). Its model carries the
 * summit rock and terrace; the launch platform's centre is 30 m in front of the statue.
 */
import type { LandmarkSite } from '../types';

export const sites: LandmarkSite[] = [
  {
    id: 'rio-de-janeiro-sugarloaf',
    cityId: 'rio-de-janeiro',
    name: 'Sugarloaf Mountain and cable car',
    at: { lat: -22.955699, lon: -43.1669426 },
    headingDeg: 58,
    // the rock's grid reaches 1,731 m out (its far corner, past the summit)
    footprintRadiusM: 1735,
    // only the stations and the summit's buildings (under the rock); Urca's other buildings stay
    hides: [
      { x: 6, z: 11, r: 22 },
      { x: -270, z: -398, r: 16 },
      { x: -250, z: -572, r: 14 },
      { x: -10, z: -1275, r: 60 },
    ],
  },
  {
    id: 'rio-de-janeiro-christ-the-redeemer',
    cityId: 'rio-de-janeiro',
    name: 'Christ the Redeemer',
    at: { lat: -22.951917, lon: -43.210459 },
    headingDeg: 82,
    // the summit rock's grid reaches 416 m out (its far corners)
    footprintRadiusM: 420,
    // the summit rock and terrace are the model's own ground: a launch on them waits for it
    carriesGround: true,
    // the statue, its pedestal and chapel only (the summit's other buildings lie under the rock)
    hides: [{ x: 0, z: 0, r: 12 }],
  },
];
