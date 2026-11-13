/**
 * Rio de Janeiro's landmarks. Positions from OpenStreetMap (the cable car's ropes and stations,
 * 2026-11). Sugarloaf and its cable car are one landmark, placed at Station I on Praia Vermelha
 * (on the ground near the sea, so the model stands at a height the map draws reliably), with its
 * front up the line toward the summit; the summit (cities.json's hero point) is 1,304 m ahead.
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
];
