/**
 * The live fact line (spec 6.3, wording from 7.4: British English, km/h, no exclamation marks).
 * factsFor returns every fact that applies right now; the caller shows one at a time and moves on
 * every FACT_ROTATE_MS. What the balloon is over and the local time are left out: the header carries them.
 */
import { FLIGHT_HOURS } from '../config';
import { haversineKm, type LatLon } from './coords';
import { nearestPlace, type Place } from './gazetteer';
import { countryLabel, withArticle, withCountry } from './places';
import { nextSunEvent } from './sun';
import { localTime } from './time';
import { positionAt, type Route, type RoutePoint } from '../flight/route';

export { FACT_ROTATE_MS } from '../config';

export type FactState = {
  route: Route;
  nowUtcMs: number;
  home: { name: string; lat: number; lon: number };
  /** Where the balloon is now: positionAt(route, nowUtcMs). */
  here: RoutePoint;
  /** The nearest town ahead along the heading, if any (see townAhead): the crossing fact needs it. */
  nearestTown?: { name: string; population: number; distanceKm: number; country?: string };
  /** Where the route ends, from nearestPlace on the last point (a town's country is always said). */
  landing?: Pick<Place, 'name' | 'kind' | 'country'>;
  /** The start's country: a town ahead in another country is named with its own (null: not known). */
  homeCountry?: string | null;
};

/** Below this the crossing time is silly (hours to cross a village), so the fact is skipped. */
export const MIN_CROSSING_KMH = 3;
/**
 * A crossing longer than this (minutes) is skipped too: a big city in a light wind takes longer than the
 * wind stays the same or the town stays ahead (ruling R56: the fact shows only for 3 hours or less).
 */
export const MAX_CROSSING_MIN = 180;
/** Only a town this close ahead is worth mentioning. */
export const TOWN_AHEAD_KM = 30;

const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
/** Eight-point compass word for a bearing in degrees: 225 is "south-west". */
export const compassWord = (deg: number): string => COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];

const plural = (n: number, unit: string): string => `${n} ${unit}${n === 1 ? '' : 's'}`;

/** "40 minutes", "5 hours", "2 hours 10 minutes", "2 days 6 hours". */
export function formatDuration(ms: number): string {
  const minutes = Math.round(Math.max(0, ms) / 60000);
  if (minutes < 1) return 'less than a minute';
  if (minutes < 60) return plural(minutes, 'minute');
  if (minutes < 1440) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m ? `${plural(h, 'hour')} ${plural(m, 'minute')}` : plural(h, 'hour');
  }
  const hours = Math.round(ms / 3600e3);
  const d = Math.floor(hours / 24);
  const h = hours % 24;
  return h ? `${plural(d, 'day')} ${plural(h, 'hour')}` : plural(d, 'day');
}

/**
 * How far across a town is. Towns are not outlined in the data, so this assumes built-up area grows
 * with population at a constant density: diameter = 0.0178 km x sqrt(population), which gives
 * Leeds (about 455,000 people) 12 km, Bergen (~290,000) 9.6 km and a 5,000-person town 1.3 km.
 * Clamped to 1-60 km.
 */
export function townDiameterKm(population: number): number {
  return Math.max(1, Math.min(60, 0.01779 * Math.sqrt(Math.max(0, population))));
}

/** "about 5 minutes", "about 23 minutes", "about an hour", "about 3 hours". */
export function crossingTime(minutes: number): string {
  if (minutes < 1.5) return 'about a minute';
  if (minutes < 45) return `about ${Math.round(minutes)} minutes`;
  if (minutes < 75) return 'about an hour';
  if (minutes < 105) return 'about an hour and a half';
  return `about ${Math.round(minutes / 60)} hours`;
}

const dateParts = (utcMs: number, tz: string): string => {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short' }).formatToParts(new Date(utcMs));
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('weekday')} ${get('day')} ${get('month')}`;
};

/** "in the North Sea" / "near Bergen, Norway": where the balloon comes down (a town with its country, always). */
function landingWhere(l: Pick<Place, 'name' | 'kind' | 'country'>): string {
  if (l.kind !== 'town') return `in ${withArticle(l.name, l.kind)}`;
  return l.country ? `near ${l.name}, ${countryLabel(l.country)}` : `near ${l.name}`;
}

/** "Expected to come down in the North Sea", "Expected to land near Bergen". */
export function expectedLandingText(l: Pick<Place, 'name' | 'kind' | 'country'>): string {
  return l.kind === 'sea' ? `Expected to come down ${landingWhere(l)}` : `Expected to land ${landingWhere(l)}`;
}

/** "Landed near Bergen on Sun 15 Nov", dated where it came down. */
export function landedText(l: Pick<Place, 'name' | 'kind' | 'country'> | undefined, landedAt: LatLon, utcMs: number): string {
  const date = dateParts(utcMs, localTime(utcMs, landedAt).tz);
  if (!l) return `Landed on ${date}`;
  return `${l.kind === 'sea' ? 'Came down' : 'Landed'} ${landingWhere(l)} on ${date}`;
}

const distanceText = (km: number): string => (km < 10 ? km.toFixed(1) : String(Math.round(km)));

export function factsFor(s: FactState): string[] {
  const { route, nowUtcMs, home, here } = s;
  const landingMs = route.release + FLIGHT_HOURS * 3600e3;
  const last = route.points[route.points.length - 1];
  const fromHomeKm = haversineKm(home, here);

  if (nowUtcMs >= landingMs) {
    const flown = haversineKm(home, last);
    return [landedText(s.landing, last, landingMs), `${distanceText(flown)} km from ${home.name} in ${FLIGHT_HOURS} hours`];
  }

  const facts: string[] = [];
  const kmh = here.speedMs * 3.6;
  const height = `${Math.max(0.1, here.altM / 1000).toFixed(1)} km`;
  facts.push(
    Math.round(kmh) < 1
      ? `Almost no wind at ${height}`
      : `Wind at ${height}: ${Math.round(kmh)} km/h from the ${compassWord(here.headingDeg + 180)}`,
  );

  const town = s.nearestTown;
  if (town && kmh >= MIN_CROSSING_KMH && town.distanceKm <= TOWN_AHEAD_KM) {
    const mins = (townDiameterKm(town.population) / kmh) * 60;
    if (mins <= MAX_CROSSING_MIN) {
      // "cross Rijssen, Netherlands, in about 8 minutes": the country set off by commas, as in a sentence
      const where = withCountry(town.name, town.country, s.homeCountry);
      facts.push(`At this speed it would cross ${where}${where === town.name ? '' : ','} in ${crossingTime(mins)}`);
    }
  }

  const gone = fromHomeKm < 1 ? `Just let go from ${home.name}` : `${distanceText(fromHomeKm)} km from ${home.name} so far`;
  facts.push(`${gone} · Expected to land in ${formatDuration(landingMs - nowUtcMs)}`);

  // "Over ..." and the local time are not facts here: the header shows both all the time (under and in the clock)

  const sun = nextSunEvent(nowUtcMs, here, (t) => positionAt(route, t));
  if (sun) facts.push(`${sun.kind === 'sunrise' ? 'Sunrise' : 'Sunset'} in ${formatDuration(sun.utcMs - nowUtcMs)}`);

  if (s.landing) facts.push(expectedLandingText(s.landing));
  return facts;
}

/** Where the route ends, for the landing facts. */
export async function landingPlace(route: Route): Promise<Place> {
  return nearestPlace(route.points[route.points.length - 1]);
}
