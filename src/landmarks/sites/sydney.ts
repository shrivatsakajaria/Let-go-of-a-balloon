/**
 * Sydney's landmarks. Positions from OpenStreetMap (the Opera House's outline and roof parts,
 * 2026-11): its podium's long sides run at 13.4 degrees, toward the point and the harbour.
 */
import type { LandmarkSite } from '../types';

export const sites: LandmarkSite[] = [
  {
    id: 'sydney-opera-house',
    cityId: 'sydney',
    name: 'Sydney Opera House',
    // cities.json's hero point, near the middle of the podium (10 m south of its centre)
    at: { lat: -33.8572, lon: 151.21512 },
    headingDeg: 13.4,
    // the podium's farthest corner (the Concert Hall's north-west wing) is 103 m out; everything
    // inside is the Opera House's own parts and the broadwalk roofs
    footprintRadiusM: 104,
  },
];
