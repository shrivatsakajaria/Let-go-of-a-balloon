import { describe, expect, test } from 'vitest';
import { buildTopIndex, maxTopNear, nearestNear } from '../../src/world/topindex';

describe('top index', () => {
  // a seeded scatter of buildings and trees over a 1.6 km tile
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const n = 3000;
  const tops = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    tops[i * 4] = rnd() * 1600;
    tops[i * 4 + 1] = -rnd() * 1600;
    tops[i * 4 + 2] = 1 + rnd() * 30;
    tops[i * 4 + 3] = 10 + rnd() * 80;
  }
  const ix = buildTopIndex(tops)!;

  test('the highest top near a point is the same as scanning every item', () => {
    for (let k = 0; k < 400; k++) {
      const x = -50 + rnd() * 1700, z = 50 - rnd() * 1700, r = rnd() * 40;
      let best = -Infinity;
      for (let i = 0; i < n; i++) {
        const dx = tops[i * 4] - x, dz = tops[i * 4 + 1] - z, rr = r + tops[i * 4 + 2];
        if (dx * dx + dz * dz <= rr * rr && tops[i * 4 + 3] > best) best = tops[i * 4 + 3];
      }
      expect(maxTopNear(ix, x, z, r, -Infinity)).toBe(best);
    }
  });

  test('the nearest circle within reach is the same as scanning every item', () => {
    for (let k = 0; k < 400; k++) {
      const x = rnd() * 1600, z = -rnd() * 1600, r = rnd() * 10;
      let best = -1, gap = Infinity;
      for (let i = 0; i < n; i++) {
        const g = Math.hypot(tops[i * 4] - x, tops[i * 4 + 1] - z) - tops[i * 4 + 2];
        if (g <= r && g < gap) { gap = g; best = i; }
      }
      expect(nearestNear(ix, x, z, r)).toBe(best);
    }
  });

  test('no items: no index', () => {
    expect(buildTopIndex(new Float32Array(0))).toBeNull();
  });
});
