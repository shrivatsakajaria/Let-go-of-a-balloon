import { test, expect } from 'vitest';
import { sunPosition, moonPosition, nextSunEvent } from '../../src/geo/sun';
import { localTime } from '../../src/geo/time';

test('noon sun high in London midsummer', () =>
  expect(sunPosition(Date.UTC(2026, 5, 21, 12, 0), { lat: 51.5, lon: -0.12 }).elevationDeg).toBeCloseTo(61.9, 0));

test('midnight sun below horizon in Manchester November', () =>
  expect(sunPosition(Date.UTC(2026, 10, 12, 0, 0), { lat: 53.48, lon: -2.24 }).elevationDeg).toBeLessThan(-30));

test('sunrise Manchester 13 Nov 2026 about 07:30 UTC', () => {
  const e = nextSunEvent(Date.UTC(2026, 10, 13, 0, 0), { lat: 53.48, lon: -2.24 })!;
  expect(e.kind).toBe('sunrise');
  expect(Math.abs(e.utcMs - Date.UTC(2026, 10, 13, 7, 30))).toBeLessThan(10 * 60e3);
});

test('local time in Bergen is CET', () =>
  expect(localTime(Date.UTC(2026, 10, 15, 20, 0), { lat: 60.39, lon: 5.32 }).label).toBe('Sun 21:00'));

test('azimuth is south at London noon, clockwise from north', () => {
  const a = sunPosition(Date.UTC(2026, 5, 21, 12, 2), { lat: 51.5, lon: -0.12 }).azimuthDeg;
  expect(Math.abs(a - 180)).toBeLessThan(3);
});

test('sunset at Manchester 13 Nov about 16:15 UTC', () => {
  const e = nextSunEvent(Date.UTC(2026, 10, 13, 12, 0), { lat: 53.48, lon: -2.24 })!;
  expect(e.kind).toBe('sunset');
  expect(Math.abs(e.utcMs - Date.UTC(2026, 10, 13, 16, 15))).toBeLessThan(10 * 60e3);
});

test('no sun event in polar night', () =>
  expect(nextSunEvent(Date.UTC(2026, 11, 21, 0, 0), { lat: 85, lon: 0 })).toBeNull());

test('route is used for event search', () => {
  // balloon travelling east is already in daylight later; just check it returns something sane
  const e = nextSunEvent(Date.UTC(2026, 10, 13, 0, 0), { lat: 53, lon: 0 }, (t) => ({ lat: 53, lon: ((t - Date.UTC(2026, 10, 13)) / 3.6e6) * 5 }));
  expect(e).not.toBeNull();
});

test('moon is new near 9 Nov 2026 and full near 24 Nov 2026', () => {
  const p = { lat: 51.5, lon: 0 };
  expect(moonPosition(Date.UTC(2026, 10, 9, 13, 0), p).illumination).toBeLessThan(0.05);
  expect(moonPosition(Date.UTC(2026, 10, 24, 22, 50), p).illumination).toBeGreaterThan(0.95);
});

test('full moon is up at midnight, opposite the sun', () => {
  const m = moonPosition(Date.UTC(2026, 10, 24, 23, 0), { lat: 51.5, lon: 0 });
  expect(m.elevationDeg).toBeGreaterThan(30);
  expect(m.azimuthDeg).toBeGreaterThan(120);
  expect(m.azimuthDeg).toBeLessThan(240);
});
