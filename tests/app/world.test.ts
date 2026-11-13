import { expect, test } from 'vitest';
import { resumeAction, savedFor, type Handover } from '../../src/app/world';
import type { Route } from '../../src/flight/route';

const H = 3600e3;
const route = (releaseMs: number): Route => ({ points: [], hourly: [], release: releaseMs, runId: 'r' });
const choice = { name: 'Manchester', lat: 53.48, lon: -2.25, kind: 'search' as const };
const home = { name: 'Manchester', lat: 53.48, lon: -2.25 };
const now = Date.UTC(2026, 10, 13, 12);

test('a flight in the air carries on in Film, as a link opens', () => {
  const h: Handover = { choice, state: 'flight', flight: { route: route(now - 10 * H), home, own: true, launched: true } };
  expect(resumeAction(h, now)).toEqual({ kind: 'fly', mode: 'film' });
});

test('a landed flight is seen from the side, as open() shows it', () => {
  const h: Handover = { choice, state: 'flight', flight: { route: route(now - 73 * H), home, own: false } };
  expect(resumeAction(h, now)).toEqual({ kind: 'fly', mode: 'side' });
});

test('a released balloon still in its launch shot is a flight', () => {
  const h: Handover = { choice, state: 'launch', flight: { route: route(now - 5000), home, own: true, launched: true } };
  expect(resumeAction(h, now)).toEqual({ kind: 'fly', mode: 'film' });
});

test('a launch that had not let go yet starts again', () => {
  expect(resumeAction({ choice, state: 'launch', flight: null }, now)).toEqual({ kind: 'launch' });
});

test('the start screen stays as it is (a broken-link notice over it is kept)', () => {
  expect(resumeAction({ choice, state: 'start', flight: null }, now)).toEqual({ kind: 'stay' });
});

test('the winds error goes back to the start screen', () => {
  expect(resumeAction({ choice, state: 'error', flight: null }, now)).toEqual({ kind: 'start' });
});

test('a flight handed over (or on the 2D map) gives back the balloon it is, for the card and its link', () => {
  const r: Route = { points: [], hourly: [{ lat: 53.48, lon: -2.25 }], release: now, runId: 'r1' };
  expect(savedFor({ route: r, home, own: true })).toEqual({ v: 1, name: 'Manchester', start: { lat: 53.48, lon: -2.25 }, release: now, hourly: r.hourly, runId: 'r1' });
  // a "Use my location" balloon is shown as "your location" and saved as "Your location"
  expect(savedFor({ route: r, home: { ...home, name: 'your location' }, own: true }).name).toBe('Your location');
  // a flight that carries its saved balloon gives that one
  const saved = { v: 1 as const, name: 'X', start: { lat: 1, lon: 2 }, release: 5, hourly: [], runId: 'q' };
  expect(savedFor({ route: r, home, own: true, saved })).toBe(saved);
});
