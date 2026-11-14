import { describe, expect, test } from 'vitest';
import { pumpUntil } from '../../src/app/cardshot';

describe('the card world can be cut short, and draws only what it sees', () => {
  test('waiting for its tiles stops at once when the visitor moves on', async () => {
    let alive = true;
    let steps = 0;
    const t0 = Date.now();
    setTimeout(() => (alive = false), 120);
    const r = await pumpUntil(() => (steps++, false), { maxMs: 20000, everyMs: 20, alive: () => alive });
    expect(r).toBe('cancelled');
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(steps).toBeGreaterThan(1);
  });

  test('an opened gate (the replay has ended) ends the wait at once, whatever the tiles', async () => {
    let open = false;
    setTimeout(() => (open = true), 60);
    const t0 = Date.now();
    expect(await pumpUntil(() => false, { maxMs: 20000, everyMs: 10, alive: () => true, stop: () => open })).toBe('stopped');
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  test('it ends when the tiles are in (twice in a row), or when the time is up', async () => {
    let n = 0;
    expect(await pumpUntil(() => ++n >= 3, { maxMs: 5000, everyMs: 1, alive: () => true })).toBe('ready');
    expect(n).toBe(4);
    expect(await pumpUntil(() => false, { maxMs: 50, everyMs: 5, alive: () => true })).toBe('timeout');
  });
});
