import { describe, expect, test } from 'vitest';
import type { Route, RoutePoint } from '../../src/flight/route';
import {
  announcement,
  clockText,
  dayLine,
  heightText,
  midnightTicks,
  progress,
  sceneAltitude,
  speedText,
  sceneLabel,
  brightLuminance,
  type AnnounceState,
} from '../../src/ui/hudmath';

const H = 3600e3;
const STEP = 600e3;

/** A route sitting still at p (or drifting east by dLonPerStep), 433 points at 10 minutes. */
function routeAt(release: number, p: { lat: number; lon: number }, dLonPerStep = 0): Route {
  const points: RoutePoint[] = [];
  for (let i = 0; i <= 432; i++) {
    points.push({ tSec: i * 600, lat: p.lat, lon: p.lon + dLonPerStep * i, altM: 1500, groundM: 50, speedMs: 8, headingDeg: 90 });
  }
  return { points, hourly: [], release, runId: 'x' };
}

describe('dayLine', () => {
  const r = Date.parse('2026-11-13T10:00:00Z');
  test('"Day 1 of 3 · 14 h aloft"', () => {
    expect(dayLine(r, r + 14 * H + 20 * 60e3)).toBe('Day 1 of 3 · 14 h aloft');
  });
  test('day 2 starts at 24 h, day 3 at 48 h', () => {
    expect(dayLine(r, r + 24 * H)).toBe('Day 2 of 3 · 24 h aloft');
    expect(dayLine(r, r + 50 * H)).toBe('Day 3 of 3 · 50 h aloft');
  });
  test('the first hour counts minutes', () => {
    expect(dayLine(r, r + 25 * 60e3)).toBe('Day 1 of 3 · 25 min aloft');
    expect(dayLine(r, r - 5000)).toBe('Day 1 of 3 · 0 min aloft');
  });
  test('after 72 h it has landed', () => {
    expect(dayLine(r, r + 80 * H)).toBe('Landed · 72 h aloft');
  });
});

describe('progress', () => {
  test('release to 72 h, clamped', () => {
    const r = 1e12;
    expect(progress(r, r - 1)).toBe(0);
    expect(progress(r, r + 36 * H)).toBeCloseTo(0.5, 9);
    expect(progress(r, r + 100 * H)).toBe(1);
  });
});

describe('midnightTicks', () => {
  test('London: a tick at each local midnight, at the right place along 72 h', () => {
    // released 10:00 UTC (= 10:00 GMT in November): midnights at 14 h, 38 h and 62 h
    const r = Date.parse('2026-11-13T10:00:00Z');
    const ticks = midnightTicks(routeAt(r, { lat: 51.5, lon: -0.12 }));
    expect(ticks.length).toBe(3);
    expect(ticks[0]).toBeCloseTo(14 / 72, 3);
    expect(ticks[1]).toBeCloseTo(38 / 72, 3);
    expect(ticks[2]).toBeCloseTo(62 / 72, 3);
  });
  test('Tokyo (UTC+9): midnight is 15:00 UTC', () => {
    const r = Date.parse('2026-11-13T10:00:00Z');
    const ticks = midnightTicks(routeAt(r, { lat: 35.68, lon: 139.76 }));
    expect(ticks[0]).toBeCloseTo(5 / 72, 3);
    expect(ticks.length).toBe(3);
  });
  test('a release just after midnight has no tick at 0, and none at 72 h', () => {
    const r = Date.parse('2026-11-13T00:05:00Z');
    const ticks = midnightTicks(routeAt(r, { lat: 51.5, lon: -0.12 }));
    expect(ticks.every((t) => t > 0.001 && t < 0.999)).toBe(true);
    expect(ticks.length).toBe(2); // 24 h and 48 h less 5 minutes; 72 h is the ring
  });
  test('ticks are sorted and inside (0, 1) for a route crossing time zones', () => {
    const r = Date.parse('2026-11-13T18:00:00Z');
    const ticks = midnightTicks(routeAt(r, { lat: 50, lon: -10 }, 0.25)); // 108 degrees east over 72 h
    expect(ticks.length).toBeGreaterThanOrEqual(2);
    for (let i = 0; i < ticks.length; i++) {
      expect(ticks[i]).toBeGreaterThan(0);
      expect(ticks[i]).toBeLessThan(1);
      if (i) expect(ticks[i]).toBeGreaterThan(ticks[i - 1]);
    }
  });
});

describe('stats', () => {
  test('height in metres while low, to 10 m higher up, with a thousands separator', () => {
    expect(heightText(3.4)).toBe('3 m');
    expect(heightText(86.4)).toBe('86 m');
    expect(heightText(1512)).toBe('1,510 m');
    expect(heightText(-4)).toBe('0 m');
  });
  test('speed in km/h', () => {
    expect(speedText(8.6)).toBe('31 km/h');
    expect(speedText(0.1)).toBe('0 km/h');
  });
  test('clock is the local 24-hour time at the place', () => {
    expect(clockText(Date.parse('2026-11-13T15:07:00Z'), { lat: 51.5, lon: -0.12 })).toBe('15:07');
    expect(clockText(Date.parse('2026-11-13T15:07:00Z'), { lat: 35.68, lon: 139.76 })).toBe('00:07');
  });
});

describe('sceneAltitude', () => {
  test('at release it stands on the drawn ground, whatever the coarse route ground says', () => {
    expect(sceneAltitude(51.5, 50, 12)).toBeCloseTo(13.5, 6); // 1.5 m above the drawn street
    expect(sceneAltitude(51.5, 50, 80)).toBeCloseTo(81.5, 6);
  });
  test('at cruise it flies the route height (a pressure level), not the drawn ground', () => {
    expect(sceneAltitude(1500, 50, 12)).toBeCloseTo(1500, 6);
    expect(sceneAltitude(1500, 50, 200)).toBeCloseTo(1500, 6);
  });
  test('blends smoothly, monotonic in the route height', () => {
    let prev = -Infinity;
    for (let a = 51.5; a <= 1500; a += 1.5) {
      const y = sceneAltitude(a, 50, 20);
      expect(y).toBeGreaterThan(prev);
      prev = y;
    }
  });
  test('never under the drawn ground', () => {
    expect(sceneAltitude(700, 100, 900)).toBeGreaterThanOrEqual(930);
    expect(sceneAltitude(NaN, 50, 12)).toBe(13.5);
  });
});

describe('announcements: only the launch, a change of country and the landing', () => {
  const base: AnnounceState = { phase: 'flying', home: 'London', country: 'United Kingdom', landing: null, own: true };
  test('launch', () => {
    expect(announcement(null, { ...base })).toBe('Your balloon is on its way from London');
  });
  test('a shared balloon opened in flight is not a launch', () => {
    expect(announcement(null, { ...base, own: false })).toBeNull();
  });
  test('nothing for the same country, or over the sea', () => {
    expect(announcement(base, { ...base })).toBeNull();
    expect(announcement(base, { ...base, country: null })).toBeNull();
  });
  test('a new country, also after a stretch of sea', () => {
    expect(announcement(base, { ...base, country: 'France' })).toBe('Your balloon is over France now');
    expect(announcement({ ...base, country: null, lastCountry: 'United Kingdom' }, { ...base, country: 'United Kingdom', lastCountry: 'United Kingdom' })).toBeNull();
    expect(announcement({ ...base, country: null, lastCountry: 'United Kingdom' }, { ...base, country: 'Norway', lastCountry: 'United Kingdom' })).toBe('Your balloon is over Norway now');
  });
  test('landing, on land and at sea; a landed link announces it once', () => {
    expect(announcement(base, { ...base, phase: 'landed', landing: { name: 'Bergen', kind: 'town' } })).toBe('Your balloon landed near Bergen');
    expect(announcement(base, { ...base, phase: 'landed', landing: { name: 'North Sea', kind: 'sea' } })).toBe('Your balloon came down in the North Sea');
    expect(announcement(null, { ...base, own: false, phase: 'landed', landing: { name: 'Bergen', kind: 'town' } })).toBe('This balloon landed near Bergen');
    const landed: AnnounceState = { ...base, phase: 'landed', landing: { name: 'Bergen', kind: 'town' } };
    expect(announcement(landed, { ...landed })).toBeNull();
  });
});

describe('sceneLabel', () => {
  test('"Your balloon is over the North Sea, 412 km from Manchester"', () => {
    expect(sceneLabel({ own: true, over: 'the North Sea', km: 412.3, home: 'Manchester', landed: null })).toBe(
      'Your balloon is over the North Sea, 412 km from Manchester',
    );
    expect(sceneLabel({ own: false, over: 'Leeds', km: 4.25, home: 'Manchester', landed: null })).toBe('This balloon is over Leeds, 4.3 km from Manchester');
    expect(sceneLabel({ own: true, over: 'x', km: 900, home: 'Manchester', landed: 'Landed near Bergen' })).toBe('Your balloon landed near Bergen, 900 km from Manchester');
  });
});

describe('brightLuminance', () => {
  test('the bright end of the pixels behind the text, not the mean', () => {
    const px = new Uint8Array(4 * 100);
    for (let i = 0; i < 100; i++) px.set(i < 85 ? [20, 20, 30, 255] : [255, 255, 255, 255], i * 4);
    expect(brightLuminance(px)).toBeGreaterThan(0.9);
    expect(brightLuminance(new Uint8Array(4 * 10))).toBe(0);
  });
});
