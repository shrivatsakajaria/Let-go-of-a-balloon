/**
 * What the balloon is over, in words. Loaded map tiles give the best names (their labels sit under
 * the balloon); everywhere else (the landing place, replay, far points) the gazetteer answers.
 */
import { bearingDeg, haversineKm, type LatLon } from './coords';
import { GENERIC_LAND, GENERIC_SEA, nearestPlace, townsNear } from './gazetteer';
import type { Label } from '../world/meshjob';

/** Label kinds (OpenMapTiles `place` and `water_name` classes, plus park and peak where present). */
const WATER_KINDS = new Set(['ocean', 'sea', 'bay', 'strait', 'channel', 'lake', 'river', 'reservoir', 'water']);
const TOWN_KINDS = new Set(['city', 'town', 'village']);
const LANDMARK_KINDS = new Set(['park', 'peak', 'mountain_peak', 'nature_reserve']);

/** A water label only counts when the balloon is this close to it (labels sit at the middle of the water). */
const WATER_LABEL_KM = 3;
/** Seas, bays and straits: their labels count from WATER_LABEL_KM. Lakes and rivers only from this close. */
const OPEN_WATER = new Set(['ocean', 'sea', 'bay', 'strait', 'channel']);
const INLAND_WATER_KM = 0.5;
const SMALL_WATER = /\b(fountains?|pond|pool|basin|lido|moat|reflecting)\b/i;
const TOWN_LABEL_KM = 5;
const LANDMARK_KM = 5;
/** A gazetteer town this close is "over" it; further out it is "near" it. */
const OVER_TOWN_KM = 10;
/** A map label and a gazetteer town of the same name this close are the same town. */
const SAME_TOWN_KM = 10;

/** Names that never take "the": "Lake Windermere", "Loch Ness", "Isle of Man", "Mount Etna". */
const NO_ARTICLE = /^(Lake|Lac|Lago|Loch|Lough|Mount|Mont|Mt\.?|Isle|Isla|Island|Cape|Port|Saint|St\.?)\s/i;
/** "Bay of Biscay", "Gulf of Mexico", "Firth of Forth", "Strait of Gibraltar". */
const OF_FORM = /^(Gulf|Bay|Strait|Straits|Sea|Firth|Bight|Sound|Channel|Passage)\s+of\s/i;
/** Features English calls "the ...": seas, ranges, districts, deserts, plains. */
const THE_ENDINGS =
  /\s(Sea|Ocean|Channel|Strait|Straits|Gulf|Passage|Desert|Basin|Plateau|Peninsula|Range|Mountains|Hills|Downs|Highlands|Lowlands|District|Delta|Valley|Coast|Islands|Isles|Archipelago|Plain|Plains|Steppe|Tundra|Alps|Massif)$/i;

/** "the North Sea", "the Lake District", "Lake Windermere", "Leeds": a name with the article English uses. */
export function withArticle(name: string, kind: string): string {
  if (/^the\s/i.test(name) || kind === 'town' || kind === 'city' || kind === 'village') return name;
  if (OF_FORM.test(name) || THE_ENDINGS.test(name)) return `the ${name}`; // before NO_ARTICLE: "the Lake District"
  if (NO_ARTICLE.test(name)) return name;
  if (kind === 'sea' || kind === 'ocean') return `the ${name}`; // "the Pacific", "the Baltic"
  if (kind === 'region' && /^[\p{L}\s'-]+s$/u.test(name) && name.length > 3) return `the ${name}`; // "the Alps", "the Ardennes"
  return name;
}

/** CLDR's long forms (the gazetteer's country names come from Intl.DisplayNames), as people say them. */
const COUNTRY_TIDY: [RegExp, string][] = [
  [/^Congo - Brazzaville$/, 'Republic of the Congo'],
  [/^Congo - Kinshasa$/, 'Democratic Republic of the Congo'],
  [/^Myanmar \(Burma\)$/, 'Myanmar'],
  [/^(Hong Kong|Macao) SAR China$/, '$1'],
  [/^St\. /, 'St '],
  [/^U\.S\. /, 'US '],
  [/ & /g, ' and '],
];
/** Country names English gives "the". */
const THE_COUNTRY =
  /^(United\s|US\s|Netherlands$|Philippines$|Bahamas$|Gambia$|Maldives$|Seychelles$|Comoros$|Czech Republic$|Dominican Republic$|Central African Republic$|Democratic Republic|Republic of|Palestinian Territories$|.+\sIslands$)/;

/**
 * A country's name as it reads in a sentence ("over the Netherlands now", "over the United Kingdom"):
 * tidied from CLDR's long forms, with "the" where English uses it.
 */
export function countryName(c: string): string {
  const name = countryLabel(c);
  return THE_COUNTRY.test(name) ? `the ${name}` : name;
}

/** A country's name after a place, with no article: "near Strzelce Krajeńskie, Poland", "Hilo, United States". */
export function countryLabel(c: string): string {
  return COUNTRY_TIDY.reduce((s, [re, to]) => s.replace(re, to), c.trim());
}

/**
 * "Strzelce Krajeńskie, Poland": a place named with its country when that is not the start's country
 * (owner's decision, 14 November 2026, panel review), so people can place it. Left alone when either country
 * is unknown, for the generic names (R56), and when the name is the country.
 */
export function withCountry(name: string, country: string | null | undefined, homeCountry: string | null | undefined): string {
  if (!country || !homeCountry || country === homeCountry) return name;
  if (name === GENERIC_LAND || name === GENERIC_SEA || /^countryside near /.test(name)) return name;
  const c = countryLabel(country);
  return name === c || name.endsWith(`, ${c}`) ? name : `${name}, ${c}`;
}

/** The start's country, from the gazetteer (null where it has no town near): what withCountry compares with. */
export async function countryAt(p: LatLon): Promise<string | null> {
  const key = `${p.lat.toFixed(4)},${p.lon.toFixed(4)}`;
  if (countries.has(key)) return countries.get(key)!;
  const place = await nearestPlace(p).catch(() => undefined);
  if (place === undefined) return null; // offline for a moment: asked again next time
  const c = place.kind === 'town' ? place.country ?? null : null;
  if (countries.size >= 64) countries.delete(countries.keys().next().value!);
  countries.set(key, c);
  return c;
}
/** Starts' countries, once each (a flight asks every few seconds; "Your balloons" once per row). */
const countries = new Map<string, string | null>();

/** "Over the North Sea", "Over Leeds". */
export const overText = (place: string): string => `Over ${place}`;

function nearest(labels: Label[], p: LatLon, kinds: Set<string>, maxKm: number): Label | undefined {
  let best: Label | undefined;
  let bestKm = maxKm;
  for (const l of labels) {
    if (!kinds.has(l.kind)) continue;
    const km = haversineKm(p, l);
    if (km <= bestKm) {
      best = l;
      bestKm = km;
    }
  }
  return best;
}

/**
 * The name for what is under p, with its article: "the North Sea", "Leeds", "the Lake District".
 * Order: a water name right here, a town within 5 km, a park or peak within 5 km, then the gazetteer.
 */
export async function placeOver(p: LatLon, labels: Label[]): Promise<string> {
  return (await placeOverAt(p, labels)).name;
}

/**
 * placeOver, with the country of the place named, from the same source as the name (review of Task 29: a map
 * label's name with the nearest gazetteer town's country gave "Over Enschede, Germany" near the border). A
 * town label takes the country of the gazetteer town of that name close by; a gazetteer town its own; water,
 * parks, peaks, regions and the sea none (they can lie across borders).
 */
export async function placeOverAt(p: LatLon, labels: Label[]): Promise<{ name: string; country?: string }> {
  // ornamental water (a fountain, a pond) is never what a balloon is over; a lake or river label sits in
  // its middle, so it only counts close by
  const real = labels.filter((l) => !SMALL_WATER.test(l.name) && (OPEN_WATER.has(l.kind) || haversineKm(p, l) <= INLAND_WATER_KM));
  const water = nearest(real, p, WATER_KINDS, WATER_LABEL_KM);
  if (water) return { name: withArticle(water.name, water.kind) };
  const town = nearest(labels, p, TOWN_KINDS, TOWN_LABEL_KM);
  if (town) {
    const key = town.name.toLowerCase();
    const same = (await townsNear(town, SAME_TOWN_KM).catch(() => [])).find((t) => t.name.toLowerCase() === key);
    return same ? { name: town.name, country: same.country } : { name: town.name };
  }
  const landmark = nearest(labels, p, LANDMARK_KINDS, LANDMARK_KM);
  if (landmark) return { name: withArticle(landmark.name, 'region') };

  const place = await nearestPlace(p);
  if (place.kind === 'town') {
    if ((place.distanceKm ?? 0) <= OVER_TOWN_KM) return { name: place.name, country: place.country };
    return { name: place.region ? withArticle(place.region, 'region') : `countryside near ${place.name}` };
  }
  return { name: withArticle(place.name, place.kind) };
}

/**
 * The biggest town within radiusKm that lies roughly along the heading (within 35 degrees), for
 * "At this speed it would cross ...": the biggest, because the nearest is often a suburb of it
 * (Liversedge before Leeds). Null when none.
 */
export async function townAhead(
  here: { lat: number; lon: number; headingDeg: number },
  radiusKm = 30,
): Promise<{ name: string; population: number; distanceKm: number; country: string } | null> {
  let best: { name: string; population: number; distanceKm: number; country: string } | null = null;
  for (const t of await townsNear(here, radiusKm)) {
    const off = Math.abs(((bearingDeg(here, t) - here.headingDeg + 540) % 360) - 180);
    if ((t.distanceKm < 2 || off <= 35) && (!best || t.population > best.population)) {
      best = { name: t.name, population: t.population, distanceKm: t.distanceKm, country: t.country };
    }
  }
  return best;
}
