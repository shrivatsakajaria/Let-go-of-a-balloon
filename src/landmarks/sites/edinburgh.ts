/**
 * Edinburgh's landmarks. Positions from OpenStreetMap (the castle's parts, 2026-11): the origin is
 * the summit of Castle Rock by St Margaret's Chapel, and the castle runs 270 m east-west from the
 * Gatehouse on the Esplanade to the Western Defences. The cities.json hero point is the Gatehouse
 * front (so the launch view from the Esplanade frames the gate, not the summit behind it).
 */
import type { HideCircle, LandmarkSite } from '../types';

/** The Gatehouse faces the Esplanade at a bearing of 84 deg (its OSM front wall). */
const CASTLE_HEADING = 84;

/** A circle given in map metres (x east, z south of the origin) as a model-frame circle. */
function mapCircle(e: number, s: number, r: number, headingDeg: number): HideCircle {
  const h = (headingDeg * Math.PI) / 180;
  return { x: e * Math.cos(h) + s * Math.sin(h), z: -e * Math.sin(h) + s * Math.cos(h), r };
}

export const sites: LandmarkSite[] = [
  {
    id: 'edinburgh-castle',
    cityId: 'edinburgh',
    name: 'Edinburgh Castle',
    at: { lat: 55.94869, lon: -3.20043 },
    headingDeg: CASTLE_HEADING,
    // the rock faces under the walls reach out to 143 m (the Western Defences)
    footprintRadiusM: 145,
    // two circles take every OSM building of the castle (Gatehouse to the Western Defences, the
    // Esplanade's ticket huts included) and nothing below the rock (Castle Terrace, the
    // Grassmarket, Ramsay Garden)
    hides: [mapCircle(50, 30, 75, CASTLE_HEADING), mapCircle(-60, 0, 75, CASTLE_HEADING)],
  },
];
