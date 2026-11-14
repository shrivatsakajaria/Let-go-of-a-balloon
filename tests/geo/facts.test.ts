import { beforeEach, expect, test, vi } from 'vitest';
import { destination } from '../../src/geo/coords';
import {
  FACT_ROTATE_MS,
  MAX_CROSSING_MIN,
  compassWord,
  crossingTime,
  factsFor,
  formatDuration,
  townDiameterKm,
  type FactState,
} from '../../src/geo/facts';
import { clearGazetteerCache } from '../../src/geo/gazetteer';
import { townAhead } from '../../src/geo/places';
import { positionAt, type Route, type RoutePoint } from '../../src/flight/route';
import { stubGazetteer } from './helpers';

const HOUR = 3600e3;
const MANCHESTER = { name: 'Manchester', lat: 53.483, lon: -2.244 };

/** A 72 h route heading `headingDeg` at `speedMs`, from `start`, in 10-minute steps. */
function straightRoute(start: { lat: number; lon: number }, releaseUtcMs: number, headingDeg: number, speedMs: number): Route {
  const points: RoutePoint[] = [];
  let p = start;
  for (let i = 0; i <= 432; i++) {
    points.push({ tSec: i * 600, lat: p.lat, lon: p.lon, altM: 1500, groundM: 50, speedMs, headingDeg });
    p = destination(p, headingDeg, (speedMs * 600) / 1000);
  }
  return { points, hourly: [], release: releaseUtcMs, runId: 'test' };
}

const RELEASE = Date.UTC(2026, 10, 12, 20, 0);
function state(over: Partial<FactState> = {}, nowUtcMs = RELEASE + 2 * HOUR, headingDeg = 45, speedMs = 31 / 3.6): FactState {
  const route = straightRoute(MANCHESTER, RELEASE, headingDeg, speedMs);
  return { route, nowUtcMs, home: MANCHESTER, here: positionAt(route, nowUtcMs), ...over };
}

beforeEach(() => {
  clearGazetteerCache();
  vi.unstubAllGlobals();
});

test('the fact line rotates every 6 seconds', () => expect(FACT_ROTATE_MS).toBe(6000));

test('wind speed is in km/h and the direction is where it comes from', () => {
  // heading 45 (blowing to the north-east) means it comes from the south-west
  const wind = factsFor(state())[0];
  expect(wind).toBe('Wind at 1.5 km: 31 km/h from the south-west');
  expect(wind).not.toMatch(/mph|m\/s/);
});

test('compass words for the eight directions, from any bearing', () => {
  const words = [0, 45, 90, 135, 180, 225, 270, 315].map(compassWord);
  expect(words).toEqual(['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west']);
  expect(compassWord(360)).toBe('north');
  expect(compassWord(350)).toBe('north');
  expect(compassWord(-45)).toBe('north-west');
  expect(compassWord(22)).toBe('north');
  expect(compassWord(23)).toBe('north-east');
});

test('crossing Leeds at 31 km/h takes about 23 minutes', () => {
  const facts = factsFor(state({ nearestTown: { name: 'Leeds', population: 455_000, distanceKm: 12 } }));
  expect(facts).toContain('At this speed it would cross Leeds in about 23 minutes');
});

test('the town model gives Leeds about 12 km and is bounded', () => {
  expect(townDiameterKm(455_000)).toBeCloseTo(12, 0);
  expect(townDiameterKm(10)).toBe(1);
  expect(townDiameterKm(40_000_000)).toBe(60);
});

test('crossing times are rounded to friendly values', () => {
  expect(crossingTime(0.4)).toBe('about a minute');
  expect(crossingTime(5)).toBe('about 5 minutes');
  expect(crossingTime(23.2)).toBe('about 23 minutes');
  expect(crossingTime(52)).toBe('about an hour');
  expect(crossingTime(90)).toBe('about an hour and a half');
  expect(crossingTime(190)).toBe('about 3 hours');
});

test('no crossing fact when the balloon is nearly still, or no town is ahead, or it is too far', () => {
  const town = { name: 'Leeds', population: 455_000, distanceKm: 12 };
  expect(factsFor(state({ nearestTown: town }, RELEASE + 2 * HOUR, 45, 2 / 3.6)).some((f) => f.includes('cross'))).toBe(false);
  expect(factsFor(state()).some((f) => f.includes('cross'))).toBe(false);
  expect(factsFor(state({ nearestTown: { ...town, distanceKm: 45 } })).some((f) => f.includes('cross'))).toBe(false);
});

test('the crossing fact only when the crossing takes 3 hours or less (London at 7 km/h is silly, at 20 km/h it is fine)', () => {
  expect(MAX_CROSSING_MIN).toBe(180);
  const london = { name: 'London', population: 8_960_000, distanceKm: 10 };
  const at = (kmh: number) => factsFor(state({ nearestTown: london }, RELEASE + 2 * HOUR, 45, kmh / 3.6)).filter((f) => f.includes('cross'));
  expect(at(7)).toEqual([]);
  expect(at(20)).toEqual(['At this speed it would cross London in about 3 hours']);
  // a village at a normal speed is the fact at its best
  expect(factsFor(state({ nearestTown: { name: 'Saffron Walden', population: 16_000, distanceKm: 8 } }, RELEASE + 2 * HOUR, 45, 7 / 3.6))).toContain(
    'At this speed it would cross Saffron Walden in about 19 minutes',
  );
});

test('distance from home and time to landing share a line', () => {
  const s = state({}, RELEASE + 2 * HOUR); // 62 km along
  const line = factsFor(s)[1];
  expect(line).toBe('62 km from Manchester so far · Expected to land in 2 days 22 hours');
});

test('no fact repeats the header: "Over ..." and the local time are already under and in the clock', () => {
  const facts = factsFor(state({}, Date.UTC(2026, 10, 13, 7, 42)));
  expect(facts.some((f) => /^Over /.test(f))).toBe(false);
  expect(facts.some((f) => /^Local time/.test(f))).toBe(false);
});

test('sunrise or sunset is counted along the route', () => {
  const facts = factsFor(state({}, Date.UTC(2026, 10, 13, 5, 0)));
  const sun = facts.find((f) => /^Sun(rise|set) in /.test(f));
  expect(sun).toMatch(/^Sunrise in (\d+ hours? )?\d+ minutes?$/);
});

test('a landing place adds its own line, and the sea is the shareable joke', () => {
  expect(factsFor(state({ landing: { name: 'North Sea', kind: 'sea' } })).at(-1)).toBe('Expected to come down in the North Sea');
  expect(factsFor(state({ landing: { name: 'Bergen', kind: 'town' } })).at(-1)).toBe('Expected to land near Bergen');
  expect(factsFor(state({ landing: { name: 'Alps', kind: 'region' } })).at(-1)).toBe('Expected to land in the Alps');
});

test('durations: days and hours, hours, minutes', () => {
  expect(formatDuration(2 * 24 * HOUR + 6 * HOUR)).toBe('2 days 6 hours');
  expect(formatDuration(5 * HOUR)).toBe('5 hours');
  expect(formatDuration(40 * 60e3)).toBe('40 minutes');
  expect(formatDuration(2 * HOUR + 10 * 60e3)).toBe('2 hours 10 minutes');
  expect(formatDuration(24 * HOUR)).toBe('1 day');
  expect(formatDuration(HOUR + 60e3)).toBe('1 hour 1 minute');
  expect(formatDuration(10e3)).toBe('less than a minute');
  expect(formatDuration(23 * HOUR + 40 * 60e3)).toBe('23 hours 40 minutes');
});

test('after landing the facts say where and when', () => {
  // released 12 Nov 20:00 UTC, lands 15 Nov 20:00 UTC = Sun 15 Nov 21:00 in Bergen
  const route = straightRoute({ lat: 60.39, lon: 5.32 }, RELEASE, 90, 0);
  const now = RELEASE + 80 * HOUR;
  const facts = factsFor({ route, nowUtcMs: now, home: MANCHESTER, here: positionAt(route, now), landing: { name: 'Bergen', kind: 'town' } });
  expect(facts[0]).toBe('Landed near Bergen on Sun 15 Nov');
  expect(facts[1]).toMatch(/^\d+ km from Manchester in 72 hours$/);
  expect(facts.join(' ')).not.toMatch(/Expected|Wind/);
});

test('landed at sea', () => {
  const route = straightRoute({ lat: 56, lon: 3 }, RELEASE, 90, 0);
  const facts = factsFor({ route, nowUtcMs: RELEASE + 73 * HOUR, home: MANCHESTER, here: route.points[432], landing: { name: 'North Sea', kind: 'sea' } });
  expect(facts[0]).toBe('Came down in the North Sea on Sun 15 Nov');
});

test('copy is British: no exclamation marks or US spellings', () => {
  const all = factsFor(state({ nearestTown: { name: 'Leeds', population: 455_000, distanceKm: 12 }, landing: { name: 'Bergen', kind: 'town' } })).join(' ');
  expect(all).not.toMatch(/!|color|meters|kilometers|miles/i);
});

test('townAhead picks the biggest town along the heading, not behind', async () => {
  stubGazetteer({}, true);
  // 15 km south-west of Leeds, heading north-east: Leeds is ahead
  const here = { ...destination({ lat: 53.8, lon: -1.55 }, 225, 15), headingDeg: 45 };
  expect((await townAhead(here))?.name).toBe('Leeds');
  // heading the other way, the same position has Leeds behind (something else may be ahead, not Leeds)
  expect((await townAhead({ ...here, headingDeg: 225 }))?.name).not.toBe('Leeds');
  // open sea: nothing
  expect(await townAhead({ lat: 56, lon: 3, headingDeg: 90 })).toBeNull();
});

// owner's decision, 14 November 2026 (panel review): place names people can place
test('the landing line always names the country of a town', () => {
  const at = (l: FactState['landing']) => factsFor(state({ landing: l })).at(-1);
  expect(at({ name: 'Strzelce Krajeńskie', kind: 'town', country: 'Poland' })).toBe('Expected to land near Strzelce Krajeńskie, Poland');
  // tidied, with no article: "near Hilo, United States", never "the United States"
  expect(at({ name: 'Hilo', kind: 'town', country: 'United States' })).toBe('Expected to land near Hilo, United States');
  expect(at({ name: 'North Sea', kind: 'sea', country: undefined })).toBe('Expected to come down in the North Sea');
});

test('after landing the country is named too', () => {
  const route = straightRoute({ lat: 60.39, lon: 5.32 }, RELEASE, 90, 0);
  const now = RELEASE + 80 * HOUR;
  const facts = factsFor({ route, nowUtcMs: now, home: MANCHESTER, here: positionAt(route, now), landing: { name: 'Bergen', kind: 'town', country: 'Norway' } });
  expect(facts[0]).toBe('Landed near Bergen, Norway on Sun 15 Nov');
});

test('a town ahead in another country than the start is named with its country; at home it is not', () => {
  const leeds = { name: 'Leeds', population: 455_000, distanceKm: 12, country: 'United Kingdom' };
  const cross = (homeCountry: string | null) => factsFor(state({ nearestTown: leeds, homeCountry })).find((f) => f.startsWith('At this speed'));
  expect(cross('United Kingdom')).toMatch(/cross Leeds in /);
  expect(cross('Ireland')).toMatch(/cross Leeds, United Kingdom, in /);
  expect(cross(null)).toMatch(/cross Leeds in /);
});
