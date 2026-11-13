/**
 * Mumbai's landmarks. Positions from OpenStreetMap (2026-11): the Gateway of India is way 28845634
 * with its 3D parts (ways 434893308 to 434894536). Its frontage runs at 52/232 deg, so the arch's
 * axis points 142 deg to the harbour and 322 deg to Apollo Bunder plaza, where the launch spot is.
 */
import type { LandmarkSite } from '../types';

export const sites: LandmarkSite[] = [
  {
    id: 'mumbai-gateway-of-india',
    cityId: 'mumbai',
    name: 'Gateway of India',
    // the centre of the central block and dome (OSM way 434893308), half a metre from the sheet's hero point
    at: { lat: 18.921966, lon: 72.834565 },
    // the harbour face; the plaza face looks back at the launch spot
    headingDeg: 142,
    // 44 m across the wings, the harbour steps 17 m out: nothing else stands within 60 m
    footprintRadiusM: 26,
  },
];
