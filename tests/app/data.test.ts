import { expect, test } from 'vitest';
import { linkRoute } from '../../src/app/data';
import type { SavedBalloon } from '../../src/flight/codec';

const balloon: SavedBalloon = {
  v: 1,
  name: 'Manchester',
  start: { lat: 53.48, lon: -2.24 },
  release: Date.parse('2026-11-13T10:00:00Z'),
  hourly: Array.from({ length: 73 }, (_, i) => ({ lat: 53.48 + 0.01 * i, lon: -2.24 + 0.25 * i })),
  runId: '2026111218',
};

test('a link opens even when the terrain never answers: after the wait the ground counts as sea level', async () => {
  const never = Object.assign(() => new Promise<number>(() => {}), { peek: () => undefined });
  const t0 = Date.now();
  const r = await linkRoute(balloon, never, 60);
  expect(Date.now() - t0).toBeLessThan(1500);
  expect(r.points).toHaveLength(433);
  expect(r.points.every((p) => p.groundM === 0)).toBe(true);
  expect(r.runId).toBe('2026111218');
});

test('ground that answers in time is used, and a failed request counts as sea level', async () => {
  let n = 0;
  const g = Object.assign(async () => (n++ % 2 ? 120 : Promise.reject(new Error('down'))), { peek: () => undefined });
  const r = await linkRoute(balloon, g, 5000);
  expect(r.points.some((p) => p.groundM === 120)).toBe(true);
  expect(r.points.some((p) => p.groundM === 0)).toBe(true);
});
