/**
 * Paris's landmarks. The Eiffel Tower from OpenStreetMap (way 5013364 and its building parts,
 * 2026-11): the centre, midway between the four pillars, is cities.json's hero point; the faces
 * stand square to the Champ de Mars axis, the south-east face at 134.2 deg.
 */
import type { LandmarkSite } from '../types';

export const sites: LandmarkSite[] = [
  {
    id: 'paris-eiffel-tower',
    cityId: 'paris',
    name: 'Eiffel Tower',
    at: { lat: 48.85826, lon: 2.2945 },
    headingDeg: 134.2,
    // the pillars' outer corners are 87 m from the centre
    footprintRadiusM: 89,
    // every OSM part of the tower (and its own 330 m outline) has its centroid within 65 m; the
    // TDF building by the south pillar (95 m) and the kiosks on the Champ de Mars stay
    hides: [{ x: 0, z: 0, r: 70 }],
  },
];
