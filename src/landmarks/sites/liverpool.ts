/**
 * Liverpool's landmarks. Positions from OpenStreetMap (the Royal Liver Building's building parts,
 * 2026-11): its two clock towers stand on its long axis, 72 m apart at a bearing of 59 deg; the
 * river end (the Pier Head and the Mersey) faces 239 deg.
 */
import type { LandmarkSite } from '../types';

export const sites: LandmarkSite[] = [
  {
    id: 'liverpool-royal-liver-building',
    cityId: 'liverpool',
    name: 'Royal Liver Building',
    // midway between the two towers (1 m from cities.json's hero point)
    at: { lat: 53.405846, lon: -2.995851 },
    headingDeg: 239,
    footprintRadiusM: 55,
    // two circles over the 92 m by 56 m block take every OSM part of it, and nothing of the
    // Cunard Building, the Pier Head kiosks or the buildings across the Strand
    hides: [
      { x: 0, z: -20, r: 34 },
      { x: 0, z: 20, r: 34 },
    ],
  },
];
