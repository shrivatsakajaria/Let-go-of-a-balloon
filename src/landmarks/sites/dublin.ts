/**
 * Dublin's landmarks. The Spire stands in the middle of O'Connell Street, in front of the GPO; its
 * position is the OpenStreetMap monument (way 96578181, 2026-11), within half a metre of the
 * cities.json hero point.
 */
import type { LandmarkSite } from '../types';

export const sites: LandmarkSite[] = [
  {
    id: 'dublin-spire',
    cityId: 'dublin',
    name: 'The Spire (Monument of Light)',
    at: { lat: 53.3498, lon: -6.26025 },
    // a cone looks the same from every side; its front faces down O'Connell Street to the river
    headingDeg: 166.6,
    // 3 m across at the base: the circle takes the OSM building drawn for it (centroid 0.3 m off)
    // and nothing else
    footprintRadiusM: 3,
  },
];
