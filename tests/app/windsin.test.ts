import { expect, test, vi } from 'vitest';

// the wind loader, faked: a manifest that loads when asked to, or fails; winds are "in" north of 50°N
const loader = vi.hoisted(() => ({ fail: false, loads: 0 }));
vi.mock('../../src/wind/loader', () => ({
  loadManifest: vi.fn(async () => {
    loader.loads++;
    if (loader.fail) throw new Error('no manifest');
    return {};
  }),
  WindField: class {
    has(p: { lat: number }): boolean {
      return p.lat > 50;
    }
    async prepare(): Promise<void> {}
  },
}));
vi.mock('../../src/world/terrainsrc', () => ({ routeGround: vi.fn(async () => 0) }));

const { windField, windsIn } = await import('../../src/app/data');

const MANCHESTER = { lat: 53.48, lon: -2.24 };
const LISBON = { lat: 38.72, lon: -9.14 };

test('windsIn (the launch hold, spec 7.2) says whether the start\'s winds are in, and loads nothing itself', async () => {
  const t0 = Date.parse('2026-11-13T10:00:00Z');
  // no manifest yet: not in, and asking does not load one
  loader.fail = true;
  expect(windsIn(MANCHESTER, t0)).toBe(false);
  expect(loader.loads).toBe(0);
  // a manifest that fails: still not in (the winds error is right)
  await expect(windField(t0)).rejects.toThrow('no manifest');
  expect(windsIn(MANCHESTER, t0)).toBe(false);
  // once the field is in: in where its tiles are, not elsewhere
  loader.fail = false;
  await windField(t0);
  expect(windsIn(MANCHESTER, t0)).toBe(true);
  expect(windsIn(LISBON, t0)).toBe(false);
  expect(loader.loads).toBe(2);
});
