import { expect, test } from 'vitest';
import { clockState, hourAngle, localMs, minuteAngle, ukOffsetMs } from '../../src/landmarks/clock';

test('UK and Irish clocks: GMT in winter, an hour on from 01:00 UTC on the last Sunday of March to the last Sunday of October', () => {
  expect(ukOffsetMs(Date.UTC(2026, 0, 15, 12))).toBe(0);
  expect(ukOffsetMs(Date.UTC(2026, 6, 15, 12))).toBe(3600e3);
  expect(ukOffsetMs(Date.UTC(2026, 2, 29, 0, 59))).toBe(0);
  expect(ukOffsetMs(Date.UTC(2026, 2, 29, 1, 0))).toBe(3600e3);
  expect(ukOffsetMs(Date.UTC(2026, 9, 25, 0, 59))).toBe(3600e3);
  expect(ukOffsetMs(Date.UTC(2026, 9, 25, 1, 0))).toBe(0);
  // another year: 2027 changes on 28 March and 31 October
  expect(ukOffsetMs(Date.UTC(2027, 2, 28, 0, 59))).toBe(0);
  expect(ukOffsetMs(Date.UTC(2027, 2, 28, 1, 0))).toBe(3600e3);
  expect(ukOffsetMs(Date.UTC(2027, 9, 31, 0, 59))).toBe(3600e3);
  expect(ukOffsetMs(Date.UTC(2027, 9, 31, 1, 0))).toBe(0);
});

test('local time is worked out with the offset cached per UTC hour', () => {
  const c = clockState();
  expect(localMs(c, Date.UTC(2026, 6, 15, 14, 45))).toBe(Date.UTC(2026, 6, 15, 15, 45));
  expect(c.hourKey).toBe(Math.floor(Date.UTC(2026, 6, 15, 14) / 3600e3));
  // within the same hour the cached offset is used (a stale one shows it was not worked out again)
  c.offsetMs = 123;
  expect(localMs(c, Date.UTC(2026, 6, 15, 14, 50))).toBe(Date.UTC(2026, 6, 15, 14, 50) + 123);
  // the next hour works it out again
  expect(localMs(c, Date.UTC(2026, 6, 15, 15, 5))).toBe(Date.UTC(2026, 6, 15, 16, 5));
  // across the October change
  expect(localMs(c, Date.UTC(2026, 9, 25, 0, 30))).toBe(Date.UTC(2026, 9, 25, 1, 30));
  expect(localMs(c, Date.UTC(2026, 9, 25, 1, 30))).toBe(Date.UTC(2026, 9, 25, 1, 30));
});

test('hand angles, clockwise from twelve in radians', () => {
  const t = Date.UTC(2026, 6, 15, 15, 45);
  expect(minuteAngle(t)).toBeCloseTo((3 * Math.PI) / 2, 9);
  expect(hourAngle(t)).toBeCloseTo((3.75 / 12) * 2 * Math.PI, 9);
  expect(minuteAngle(Date.UTC(2026, 6, 15, 9, 0))).toBeCloseTo(0, 9);
  expect(hourAngle(Date.UTC(2026, 6, 15, 21, 0))).toBeCloseTo((9 / 12) * 2 * Math.PI, 9);
  // before 1970 too (no negative angles)
  expect(minuteAngle(-15 * 60e3)).toBeCloseTo((3 * Math.PI) / 2, 9);
});
