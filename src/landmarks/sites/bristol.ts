/**
 * Bristol's landmarks. Positions from OpenStreetMap (2026-11): the Clifton Suspension Bridge's
 * towers ("Clifton Tower" and "Leigh Woods Tower") stand 213 m apart on a line at a bearing of
 * 58 deg, Leigh Woods to Clifton; the deck carries the road at about 80.5 m above sea level
 * (Mapterhorn DEM on both approaches), 83 m over the river bed.
 */
import type { LandmarkSite } from '../types';

export const sites: LandmarkSite[] = [
  {
    id: 'bristol-clifton-suspension-bridge',
    cityId: 'bristol',
    name: 'Clifton Suspension Bridge',
    // NOT the span's middle (cities.json's hero point): the model stands on the drawn ground at
    // `at`, and in the gorge that is the river bed, 83 m below the deck and only as good as the
    // terrain tile. So `at` is on the level Clifton approach, on the bridge's axis 130 m from the
    // middle (ground 81.0 m, flat for 20 m round), and the deck is built at road level from there.
    at: { lat: 51.455555, lon: -2.626278 },
    // the front faces up the gorge (NNW); +x runs along the bridge toward Clifton
    headingDeg: 328,
    footprintRadiusM: 280,
    // only the two towers are OSM buildings ("guardhouse"); the circles along the deck take no
    // building but the OSM bridge road, which would otherwise be draped down the gorge under the
    // model's deck (the map leaves bridges out inside hiding circles); nothing else is hidden
    hides: [
      { x: -23.5, z: 0, r: 9 },
      { x: -236.5, z: 0, r: 9 },
      ...[-45, -75, -105, -135, -165, -195, -215].map((x) => ({ x, z: 0, r: 16 })),
    ],
  },
];
