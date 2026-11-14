/**
 * "Your balloons" as rows (owner's decision, 14 November 2026, panel review): each balloon's start, where it
 * is now ("Over the North Sea", "Landed near Strzelce Krajeńskie, Poland") and how long it has been up.
 * Loaded on demand by the start screen, with the gazetteer that names the places.
 */
import { FLIGHT_HOURS } from '../config';
import type { SavedBalloon } from '../flight/codec';
import { balloonStatus } from '../flight/store';
import { wrapLon, type LatLon } from '../geo/coords';
import type { Place } from '../geo/gazetteer';
import { countryLabel, withArticle, withCountry } from '../geo/places';

const H = 3600e3;

/** Where a saved balloon is at nowMs, between its hourly points (its start before release, its end after 72 h). */
export function positionNow(b: SavedBalloon, nowMs: number): LatLon {
  const pts = b.hourly;
  if (!pts.length) return b.start;
  const h = Math.min(FLIGHT_HOURS, Math.max(0, (nowMs - b.release) / H));
  if (!Number.isFinite(h) || h <= 0 || pts.length < 2) return pts[0];
  if (h >= pts.length - 1) return pts[pts.length - 1];
  const i = Math.floor(h);
  const f = Math.min(1, h - i);
  const a = pts[i], c = pts[i + 1];
  // the short way round across the date line
  const dLon = ((((c.lon - a.lon) % 360) + 540) % 360) - 180;
  return { lat: a.lat + (c.lat - a.lat) * f, lon: wrapLon(a.lon + dLon * f) };
}

/** A town this close is what it is over; further out it is near it. */
const OVER_TOWN_KM = 10;

/**
 * Where it is, in a few words. Landed: "Landed near Bergen, Norway" (a landing town always with its country),
 * "Came down in the North Sea". Flying: "Over the North Sea", "Over Leeds", "Near Dijon, France" (the country
 * when it is not the start's). Generic names stay lower case (R56): "Over open countryside".
 */
export function whereText(place: Place | null, landed: boolean, homeCountry: string | null): string {
  if (landed) {
    if (!place) return 'Landed';
    if (place.kind === 'sea') return `Came down in ${withArticle(place.name, 'sea')}`;
    if (place.kind === 'town') return `Landed near ${place.name}${place.country ? `, ${countryLabel(place.country)}` : ''}`;
    return `Landed in ${withArticle(place.name, place.kind)}`;
  }
  if (!place) return '';
  if (place.generic) return `Over ${place.name}`;
  if (place.kind === 'town') {
    const name = withCountry(place.name, place.country, homeCountry);
    return (place.distanceKm ?? 0) <= OVER_TOWN_KM ? `Over ${name}` : `Near ${name}`;
  }
  return `Over ${withArticle(place.name, place.kind)}`;
}

/** "25 min aloft", "14 h aloft", "72 h aloft". */
export function aloftText(b: SavedBalloon, nowMs: number): string {
  const s = balloonStatus(b, nowMs);
  if (s.landed) return `${FLIGHT_HOURS} h aloft`;
  return s.hoursAloft < 1 ? `${Math.max(0, Math.floor((nowMs - b.release) / 60e3))} min aloft` : `${Math.floor(s.hoursAloft)} h aloft`;
}
