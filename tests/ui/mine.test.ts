import { describe, expect, test } from 'vitest';
import type { SavedBalloon } from '../../src/flight/codec';
import { aloftText, positionNow, whereText } from '../../src/ui/mine';

const H = 3600e3;
const RELEASE = Date.UTC(2026, 10, 14, 15, 0);
const hourly = Array.from({ length: 73 }, (_, h) => ({ lat: 51.5 + h * 0.1, lon: -0.12 + h * 0.5 }));
const b: SavedBalloon = { v: 1, name: 'London', start: { lat: 51.5, lon: -0.12 }, release: RELEASE, hourly, runId: '2026111412' };

describe('"Your balloons" rows (owner\'s decision, 14 November 2026, panel review)', () => {
  test('positionNow follows the hourly points, held at the ends', () => {
    expect(positionNow(b, RELEASE - H)).toEqual(hourly[0]);
    const mid = positionNow(b, RELEASE + 2.5 * H);
    expect(mid.lat).toBeCloseTo(51.75, 6);
    expect(mid.lon).toBeCloseTo(1.13, 6);
    expect(positionNow(b, RELEASE + 100 * H)).toEqual(hourly[72]);
  });

  test('positionNow takes the short way across the date line', () => {
    const across = { ...b, hourly: Array.from({ length: 73 }, (_, h) => ({ lat: 0, lon: h === 0 ? 179.5 : -179.5 })) };
    expect(Math.abs(positionNow(across, RELEASE + 0.5 * H).lon)).toBeCloseTo(180, 6);
  });

  test('where it is, flying', () => {
    expect(whereText({ kind: 'sea', name: 'North Sea' }, false, 'United Kingdom')).toBe('Over the North Sea');
    expect(whereText({ kind: 'sea', name: 'open sea', generic: true }, false, 'United Kingdom')).toBe('Over open sea');
    expect(whereText({ kind: 'region', name: 'open countryside', generic: true }, false, null)).toBe('Over open countryside');
    expect(whereText({ kind: 'town', name: 'Leeds', country: 'United Kingdom', distanceKm: 3 }, false, 'United Kingdom')).toBe('Over Leeds');
    expect(whereText({ kind: 'town', name: 'Dijon', country: 'France', distanceKm: 18 }, false, 'United Kingdom')).toBe('Near Dijon, France');
    expect(whereText(null, false, null)).toBe('');
  });

  test('where it is, landed: a landing town always with its country', () => {
    expect(whereText({ kind: 'town', name: 'Strzelce Krajeńskie', country: 'Poland', distanceKm: 4 }, true, 'Poland')).toBe('Landed near Strzelce Krajeńskie, Poland');
    expect(whereText({ kind: 'sea', name: 'North Sea' }, true, null)).toBe('Came down in the North Sea');
    expect(whereText({ kind: 'region', name: 'Alps' }, true, null)).toBe('Landed in the Alps');
    expect(whereText(null, true, null)).toBe('Landed');
  });

  test('time aloft: minutes in the first hour, hours after, 72 h once down', () => {
    expect(aloftText(b, RELEASE + 25 * 60e3)).toBe('25 min aloft');
    expect(aloftText(b, RELEASE + 14.5 * H)).toBe('14 h aloft');
    expect(aloftText(b, RELEASE + 90 * H)).toBe('72 h aloft');
  });
});
