/**
 * New York's landmarks. Positions from OpenStreetMap (Liberty Island's building parts, 2026-11):
 * the Statue of Liberty stands on the centre of its square pedestal, whose sides run at 56.9 and
 * 146.9 degrees; she looks out of its south-east face, down the harbour toward the Narrows.
 */
import type { LandmarkSite } from '../types';

export const sites: LandmarkSite[] = [
  {
    id: 'new-york-statue-of-liberty',
    cityId: 'new-york',
    name: 'Statue of Liberty',
    // the pedestal's centre (cities.json's hero point is 1.6 m off it)
    at: { lat: 40.689253, lon: -74.044532 },
    headingDeg: 146.9,
    // Fort Wood's star reaches 52 m from the centre; the Screening Building (57 m) stays
    footprintRadiusM: 53,
  },
];
