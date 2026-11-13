/**
 * Göreme's landmark: the fairy chimneys. They are terrain all round the town, so the model is a
 * cluster placed where the launch sees it (the sheet's hero point is `at`): on the floor of the valley
 * 175 m west of Sunset Point (bearing 283 deg from the launch spot, about 27 m below it, the sunset
 * side). The place was picked on the Terrarium elevation tiles: the floor there runs north-south and
 * falls about 1 m in 20 m, and no OSM building stands within 90 m of it.
 */
import type { LandmarkSite } from '../types';

export const sites: LandmarkSite[] = [
  {
    id: 'cappadocia-goreme-fairy-chimneys',
    cityId: 'cappadocia-goreme',
    name: 'Fairy chimneys',
    at: { lat: 38.640159, lon: 34.829095 },
    // the cluster's front faces back up to Sunset Point (283 - 180)
    headingDeg: 103,
    // fifteen chimneys over about 80 m by 55 m, their sunk skirts included
    footprintRadiusM: 43,
  },
];
