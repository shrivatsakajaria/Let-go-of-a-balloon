import { describe, expect, it } from 'vitest';
import {
  boxShift,
  easeToward,
  edgeFade,
  heightFade,
  layerDistance,
  STREAK_COUNT,
  STREAK_LAYERS,
  STREAK_MIN_REL_MS,
  STREAK_SPEEDUP,
  streakPos,
  streakTarget,
  streakVelocity,
  type StreakState,
} from '../../src/world/windstreaks';

const cruise: StreakState = { released: true, landed: false, replay: false, reduced: false, shot: 'ride', aglM: 1500, toLandS: 40 * 3600 };

describe('wind streaks: when they show', () => {
  it('fade in with height: none up to 300 m above the ground, all by 600 m, rising smoothly between', () => {
    expect(heightFade(0)).toBe(0);
    expect(heightFade(300)).toBe(0);
    expect(heightFade(600)).toBe(1);
    expect(heightFade(1500)).toBe(1);
    expect(heightFade(Number.NaN)).toBe(0);
    let last = 0;
    for (let h = 300; h <= 600; h += 10) {
      const f = heightFade(h);
      expect(f).toBeGreaterThanOrEqual(last);
      last = f;
    }
    expect(heightFade(450)).toBeCloseTo(0.5, 5);
  });

  it('show at cruise in every live view, never before release, in the launch, landed, in the replay or with reduced motion', () => {
    for (const shot of ['ride', 'circling', 'side', 'down']) expect(streakTarget({ ...cruise, shot })).toBe(1);
    expect(streakTarget({ ...cruise, released: false })).toBe(0);
    expect(streakTarget({ ...cruise, shot: 'launch' })).toBe(0);
    expect(streakTarget({ ...cruise, landed: true })).toBe(0);
    expect(streakTarget({ ...cruise, replay: true })).toBe(0);
    expect(streakTarget({ ...cruise, reduced: true })).toBe(0);
    expect(streakTarget({ ...cruise, aglM: 200 })).toBe(0);
    expect(streakTarget({ ...cruise, aglM: 450 })).toBeCloseTo(0.5, 5);
  });

  it('fade out over the last minutes before the landing', () => {
    expect(streakTarget({ ...cruise, toLandS: 0 })).toBe(0);
    expect(streakTarget({ ...cruise, toLandS: -5 })).toBe(0);
    expect(streakTarget({ ...cruise, toLandS: 600 })).toBe(1);
    const mid = streakTarget({ ...cruise, toLandS: 150 });
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    // no landing known (a balloon still in the hand): only the height counts
    expect(streakTarget({ ...cruise, toLandS: Number.NaN })).toBe(1);
  });

  it('ease toward the target over a few seconds, never past it', () => {
    let v = 0;
    for (let i = 0; i < 60; i++) v = easeToward(v, 1, 1 / 60, 1.5);
    expect(v).toBeGreaterThan(0.4); // about half way after a second
    expect(v).toBeLessThan(0.6);
    for (let i = 0; i < 240; i++) v = easeToward(v, 1, 1 / 60, 1.5);
    expect(v).toBeGreaterThan(0.95);
    expect(v).toBeLessThanOrEqual(1);
    expect(easeToward(0.3, 1, 0, 1.5)).toBe(0.3);
    expect(easeToward(0.3, 0, 100, 1.5)).toBeCloseTo(0, 9);
    // a long pause (a background tab) lands on the target, not past it
    expect(easeToward(0.3, 1, 1e6, 1.5)).toBe(1);
  });
});

describe('wind streaks: the wind to their velocity', () => {
  it('travel along the wind (u east is +x, v north is -z), faster than the balloon so they flow past it', () => {
    const out = { x: 0, z: 0 };
    streakVelocity(10, 0, out);
    expect(out.z).toBeCloseTo(0, 9);
    expect(out.x).toBeCloseTo(10 * STREAK_SPEEDUP, 6);
    streakVelocity(0, 8, out);
    expect(out.x).toBeCloseTo(0, 9);
    expect(out.z).toBeCloseTo(-8 * STREAK_SPEEDUP, 6);
    // the direction is the wind's
    streakVelocity(3, -4, out);
    expect(Math.atan2(-out.z, out.x)).toBeCloseTo(Math.atan2(-4, 3), 9);
  });

  it('flow past the balloon at least STREAK_MIN_REL_MS in a light wind; stay put in a calm', () => {
    const out = { x: 0, z: 0 };
    streakVelocity(1, 0, out);
    expect(out.x - 1).toBeCloseTo(STREAK_MIN_REL_MS, 6);
    streakVelocity(0, 0, out);
    expect(out.x).toBe(0);
    expect(out.z).toBe(0);
    streakVelocity(Number.NaN, 2, out);
    expect(out.x).toBe(0);
    expect(out.z).toBe(0);
  });
});

describe('wind streaks: recycled round the view', () => {
  const seeds = Array.from({ length: 200 }, (_, i) => ({ x: (i * 0.618034) % 1, y: (i * 0.414214) % 1, z: (i * 0.732051) % 1 }));

  it('the shift is a fraction of the box, whatever the anchor (a flight of thousands of kilometres)', () => {
    const out = { x: 0, y: 0, z: 0 };
    for (const size of STREAK_LAYERS)
      for (const a of [0, 1, -1, 1234.5, -987654.3, 4.2e6]) {
        boxShift({ x: a, y: -a, z: a / 3 }, { x: 17, y: 1500, z: -40 }, size, out);
        for (const k of ['x', 'y', 'z'] as const) {
          expect(out[k]).toBeGreaterThanOrEqual(0);
          expect(out[k]).toBeLessThan(1);
        }
      }
  });

  it('the anchor may wrap at the largest box: every box repeats there', () => {
    const big = STREAK_LAYERS[STREAK_LAYERS.length - 1];
    const a = { x: 0, y: 0, z: 0 }, b = { x: 0, y: 0, z: 0 };
    for (const size of STREAK_LAYERS) {
      expect(big % size).toBe(0);
      boxShift({ x: 123.4, y: 0, z: -56.7 }, { x: 10, y: 1400, z: 20 }, size, a);
      boxShift({ x: 123.4 + 3 * big, y: 0, z: -56.7 - 7 * big }, { x: 10, y: 1400, z: 20 }, size, b);
      expect(b.x).toBeCloseTo(a.x, 9);
      expect(b.z).toBeCloseTo(a.z, 9);
    }
  });

  it('every streak stays in its box, wherever the wind has carried them and wherever the box is', () => {
    const shift = { x: 0, y: 0, z: 0 };
    const p = { x: 0, y: 0, z: 0 };
    for (const size of STREAK_LAYERS)
      for (const center of [{ x: 300, y: 1350, z: -800 }, { x: -5e4, y: 900, z: 3e4 }])
        for (const a of [0, 55.5, -3210, 7.7e5]) {
          boxShift({ x: a, y: 0, z: -a }, center, size, shift);
          for (const s of seeds) {
            streakPos(s, shift, center, size, p);
            expect(Math.abs(p.x - center.x)).toBeLessThanOrEqual(size / 2 + 1e-6);
            expect(Math.abs(p.y - center.y)).toBeLessThanOrEqual(size / 2 + 1e-6);
            expect(Math.abs(p.z - center.z)).toBeLessThanOrEqual(size / 2 + 1e-6);
          }
        }
  });

  it('move with the wind by exactly its step, and with the box not at all, and are invisible wherever they wrap round (no pop-in)', () => {
    const size = STREAK_LAYERS[0];
    const center = { x: 0, y: 1400, z: 0 };
    const a = { x: 0, y: 0, z: 0 };
    const sh = { x: 0, y: 0, z: 0 };
    const before = { x: 0, y: 0, z: 0 };
    const after = { x: 0, y: 0, z: 0 };
    const q = (p: { x: number; y: number; z: number }) => ({ x: (p.x - center.x) / size, y: (p.y - center.y) / size, z: (p.z - center.z) / size });
    const wind = { x: 0.6, z: -0.3 }; // metres a frame: 40 m/s at 60 frames a second
    const box = { x: -0.2, y: 0.15, z: 0.3 }; // the camera turning and the balloon flying
    for (let f = 0; f < 600; f++) {
      boxShift(a, center, size, sh);
      const pos0 = seeds.map((s) => ({ ...streakPos(s, sh, center, size, before) }));
      a.x += wind.x;
      a.z += wind.z;
      center.x += box.x;
      center.y += box.y;
      center.z += box.z;
      boxShift(a, center, size, sh);
      seeds.forEach((s, i) => {
        streakPos(s, sh, center, size, after);
        const moved = Math.hypot(after.x - pos0[i].x - wind.x, after.y - pos0[i].y, after.z - pos0[i].z - wind.z);
        if (moved > 1e-6) {
          // wrapped: it left at one face and came back at the other, both where it cannot be seen
          expect(edgeFade(q(pos0[i]))).toBeLessThan(0.02);
          expect(edgeFade(q(after))).toBeLessThan(0.02);
        }
      });
    }
  });

  it('are fully visible in the middle of the box and gone at its faces', () => {
    expect(edgeFade({ x: 0, y: 0, z: 0 })).toBe(1);
    expect(edgeFade({ x: 0.5, y: 0, z: 0 })).toBe(0);
    expect(edgeFade({ x: 0, y: -0.5, z: 0 })).toBe(0);
    expect(edgeFade({ x: 0, y: 0, z: 0.5 })).toBe(0);
    expect(edgeFade({ x: 0.2, y: 0.1, z: -0.2 })).toBeGreaterThan(0.5);
  });

  it('the boxes sit one behind another along the look, with no gap between them, for every view', () => {
    for (const fov of [34, 40, 50]) {
      for (let k = 1; k < STREAK_LAYERS.length; k++) {
        const near = layerDistance(STREAK_LAYERS[k - 1], fov), far = layerDistance(STREAK_LAYERS[k], fov);
        expect(far).toBeGreaterThan(near);
        // the far box starts before the near box ends: their fades overlap
        expect(far - 0.5 * STREAK_LAYERS[k]).toBeLessThan(near + 0.5 * STREAK_LAYERS[k - 1] - 10);
      }
      // each is about as tall as the view at its distance
      for (const size of STREAK_LAYERS) {
        const viewH = 2 * layerDistance(size, fov) * Math.tan((fov * Math.PI) / 360);
        expect(size / viewH).toBeGreaterThan(1);
        expect(size / viewH).toBeLessThan(1.4);
      }
    }
  });

  it('a few thousand vertices in one draw', () => {
    expect(STREAK_COUNT * 4).toBeLessThanOrEqual(4000);
  });
});
