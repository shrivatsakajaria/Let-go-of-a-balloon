/**
 * Cardiff's landmarks. Positions from OpenStreetMap (the castle's walls, towers and buildings,
 * 2026-11): the origin is the middle of the castle green (the cities.json hero point), the walls
 * enclose a 230 m by 240 m square turned 14 deg, and the south front on Castle Street faces a
 * bearing of 166 deg.
 */
import type { HideCircle, LandmarkSite } from '../types';

const CASTLE_HEADING = 166;

/** A circle given in map metres (x east, z south of the origin) as a model-frame circle. */
function mapCircle(e: number, s: number, r: number, headingDeg: number): HideCircle {
  const h = (headingDeg * Math.PI) / 180;
  return { x: e * Math.cos(h) + s * Math.sin(h), z: -e * Math.sin(h) + s * Math.cos(h), r };
}

export const sites: LandmarkSite[] = [
  {
    id: 'cardiff-castle',
    cityId: 'cardiff',
    name: 'Cardiff Castle',
    at: { lat: 51.48233, lon: -3.18117 },
    headingDeg: CASTLE_HEADING,
    // the corners of the walls are 139 m out
    footprintRadiusM: 142,
    // the green is open: circles over the keep and the west range, the Clock Tower, the south
    // gate, the north-west walls, the North Gate and the east wall take every OSM part of the
    // castle and nothing on Castle Street, Kingsway or in Bute Park
    hides: [
      [-30, 20, 85], [-58, 104, 18], [40, 85, 18], [-80, -70, 40], [-25, -99, 10], [90, -20, 32],
    ].map(([e, s, r]) => mapCircle(e, s, r, CASTLE_HEADING)),
  },
];
