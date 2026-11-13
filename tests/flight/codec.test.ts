import { describe, expect, test } from 'vitest';
import { BadLinkError, decodeBalloon, encodeBalloon, linkFor, type SavedBalloon } from '../../src/flight/codec';
import { destination, haversineKm, lonDelta, wrapLon, type LatLon } from '../../src/geo/coords';

function straight(start: LatLon, bearing: number, kmPerHour: number, wobble = 0): LatLon[] {
  const out: LatLon[] = [];
  let p = start;
  for (let i = 0; i < 73; i++) {
    out.push(p);
    p = destination(p, bearing + Math.sin(i / 3) * wobble, kmPerHour);
  }
  return out;
}

function make(hourly: LatLon[], name = 'Lisbon'): SavedBalloon {
  return { v: 1, name, start: hourly[0], release: Date.UTC(2026, 10, 12, 9, 30), hourly, runId: '1731403800' };
}

function expectClose(a: SavedBalloon, b: SavedBalloon, metres = 15) {
  expect(b.hourly).toHaveLength(73);
  for (let i = 0; i < 73; i++) {
    expect(haversineKm(a.hourly[i], b.hourly[i]) * 1000).toBeLessThan(metres);
  }
}

describe('codec', () => {
  test('round trip keeps every hourly point within 15 m', async () => {
    const b = make(straight({ lat: 38.7223, lon: -9.1393 }, 70, 36, 25));
    const d = await decodeBalloon(await encodeBalloon(b));
    expectClose(b, d);
    expect(d.name).toBe('Lisbon');
    expect(d.runId).toBe(b.runId);
    expect(d.release).toBe(b.release);
    expect(d.v).toBe(1);
    expect(haversineKm(d.start, b.start) * 1000).toBeLessThan(15);
  });

  test('a fast high-latitude route (5 deg per hour) round-trips within 15 m', async () => {
    const hourly: LatLon[] = [];
    for (let i = 0; i < 73; i++) hourly.push({ lat: 84 + 5 * (1 - Math.abs(Math.sin(i / 20))) * 0.99 + (i % 2) * 0.001, lon: wrapLon(10 + i * 5) });
    const b = make(hourly, 'Pole');
    expectClose(b, await decodeBalloon(await encodeBalloon(b)));
  });

  test('a date-line route round-trips with no 360 degree jump', async () => {
    const hourly: LatLon[] = [];
    for (let i = 0; i < 73; i++) hourly.push({ lat: 10 + i * 0.01, lon: wrapLon(179.5 + i * 0.6) });
    expect(hourly[1].lon).toBeCloseTo(-179.9, 5);
    const b = make(hourly);
    const d = await decodeBalloon(await encodeBalloon(b));
    expectClose(b, d);
    for (let i = 1; i < 73; i++) expect(Math.abs(lonDelta(d.hourly[i - 1].lon, d.hourly[i].lon) - 0.6)).toBeLessThan(0.001);
    for (const p of d.hourly) expect(p.lon >= -180 && p.lon < 180).toBe(true);
  });

  test('link length under 600 chars for a 2,600 km route', async () => {
    const b = make(straight({ lat: 38.7223, lon: -9.1393 }, 60, 2600 / 72, 20), 'Lisbon, Portugal');
    expect(haversineKm(b.hourly[0], b.hourly[72])).toBeGreaterThan(2000);
    const link = linkFor(await encodeBalloon(b));
    expect(link.startsWith('/?b=')).toBe(true);
    expect(link.length).toBeLessThan(600);
    expect(link).toMatch(/^\/\?b=[A-Za-z0-9_-]+$/);
    console.log('link length', link.length);
  });

  test('a non-Latin name with emoji round-trips', async () => {
    const b = make(straight({ lat: 35.68, lon: 139.69 }, 90, 30), '東京 🎈 Zürich');
    expect((await decodeBalloon(await encodeBalloon(b))).name).toBe('東京 🎈 Zürich');
  });

  test('a long name is cut at 80 bytes on a code point boundary', async () => {
    const b = make(straight({ lat: 35.68, lon: 139.69 }, 90, 30), '🎈'.repeat(30)); // 120 bytes
    const d = await decodeBalloon(await encodeBalloon(b));
    expect(d.name).toBe('🎈'.repeat(20));
    expect(new TextEncoder().encode(d.name).length).toBe(80);
  });

  test('corrupted payload throws BadLinkError', async () => {
    const p = await encodeBalloon(make(straight({ lat: 1, lon: 2 }, 10, 30)));
    for (const bad of ['', 'not base64 !!', p.slice(0, 20), p.slice(0, p.length >> 1), 'AAAA' + p.slice(4)]) {
      await expect(decodeBalloon(bad)).rejects.toBeInstanceOf(BadLinkError);
    }
  });

  test('a payload with 72 points throws BadLinkError', async () => {
    const b = make(straight({ lat: 1, lon: 2 }, 10, 30));
    const p = await encodeBalloon({ ...b, hourly: b.hourly.slice(0, 72) });
    await expect(decodeBalloon(p)).rejects.toBeInstanceOf(BadLinkError);
  });

  test('an unknown version throws BadLinkError', async () => {
    const p = await encodeBalloon({ ...make(straight({ lat: 1, lon: 2 }, 10, 30)), v: 2 as unknown as 1 });
    await expect(decodeBalloon(p)).rejects.toBeInstanceOf(BadLinkError);
  });
});
