import { describe, expect, test } from 'vitest';
import { FacadeSlide, SLIDE, type TopAt } from '../../src/balloon/slide';

type Box = { x0: number; x1: number; z0: number; z1: number; top: number };
const city = (boxes: Box[], ground = 0): TopAt => (x, z, r) => {
  let best = ground;
  for (const b of boxes) if (x + r > b.x0 && x - r < b.x1 && z + r > b.z0 && z - r < b.z1) best = Math.max(best, b.top);
  return best;
};
const inside = (boxes: Box[], x: number, y: number, z: number) => boxes.some((b) => x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1 && y < b.top);

/** A balloon drifting east at v m/s from x0, climbing 1.5 m/s from 2.4 m; returns the drawn track. */
function fly(boxes: Box[], v: number, seconds: number, x0 = 0) {
  const s = new FacadeSlide();
  const top = city(boxes);
  const dt = 1 / 30;
  const track: { t: number; x: number; y: number; lift: number; back: number }[] = [];
  for (let i = 1; i <= seconds / dt; i++) {
    const t = i * dt;
    const x = x0 + v * t, y = 2.4 + 1.5 * t;
    s.step(x, y, 0, 1, 0, v, dt, top);
    track.push({ t, x: x - s.back, y: y + s.lift, lift: s.lift, back: s.back });
  }
  return track;
}

describe('facade slide (R57b)', () => {
  test('nothing in the way: the drawn balloon is the route', () => {
    for (const p of fly([], 3, 20)) {
      expect(p.lift).toBe(0);
      expect(p.back).toBe(0);
    }
  });

  test('a building across its path: it slides up the facade and over the roof, never inside, never sinking, then carries on', () => {
    const boxes: Box[] = [{ x0: 20, x1: 60, z0: -30, z1: 30, top: 30 }];
    const track = fly(boxes, 3, 40);
    let prev = -Infinity;
    for (const p of track) {
      expect(inside(boxes, p.x, p.y, 0), `${p.t.toFixed(2)}: ${p.x.toFixed(1)}, ${p.y.toFixed(1)}`).toBe(false);
      expect(p.y).toBeGreaterThanOrEqual(prev - 1e-9); // the drawn balloon never sinks
      prev = p.y;
    }
    // it was lifted over the roof, and held back at the wall while it rose
    expect(Math.max(...track.map((p) => p.lift))).toBeGreaterThan(10);
    expect(Math.max(...track.map((p) => p.back))).toBeGreaterThan(0.5);
    // past the building it is back on its route: no longer held back, and the lift is going
    const end = track[track.length - 1];
    expect(end.back).toBe(0);
    expect(end.lift).toBeLessThan(Math.max(...track.map((p) => p.lift)));
    // the lift rises smoothly (no jump over a frame)
    for (let i = 1; i < track.length; i++) expect(track[i].lift - track[i - 1].lift).toBeLessThanOrEqual(SLIDE.maxRiseMs / 30 + 1e-9);
  });

  test('well up (no lookups), what lift it has goes gently, never all at once', () => {
    // lifted over a building, then well up: the lift goes no faster than it decays, and in the end all of it
    const boxes: Box[] = [{ x0: 20, x1: 60, z0: -30, z1: 30, top: 30 }];
    const s = new FacadeSlide();
    const top = city(boxes);
    for (let i = 1; i <= 30 * 14; i++) s.step(3 * i / 30, 2.4 + 1.5 * i / 30, 0, 1, 0, 3, 1 / 30, top);
    expect(s.lift).toBeGreaterThan(5);
    let prev = s.lift;
    for (let i = 0; i < 30 * 60; i++) {
      s.ease(3, 1 / 30);
      expect(prev - s.lift).toBeLessThanOrEqual(SLIDE.decayMs / 30 + 1e-9);
      prev = s.lift;
    }
    expect(s.lift).toBeLessThan(1e-3);
    expect(s.back).toBeLessThan(1e-3);
  });

  test('the drawn balloon never lurches: its speed changes smoothly as it meets a wall, slides up it and goes on (at 30 and 60 Hz)', () => {
    const boxes: Box[] = [{ x0: 20, x1: 60, z0: -30, z1: 30, top: 30 }];
    for (const hz of [30, 60]) {
      const s = new FacadeSlide();
      const top = city(boxes);
      const dt = 1 / hz;
      let prev: { x: number; y: number } | null = null, pv: { x: number; y: number } | null = null, worst = 0;
      for (let i = 1; i <= 40 * hz; i++) {
        const t = i * dt, x = 3 * t, y = 2.4 + 1.5 * t;
        s.step(x, y, 0, 1, 0, 3, dt, top);
        const p = { x: x - s.back, y: y + s.lift };
        expect(inside(boxes, p.x, p.y, 0), `${hz} Hz ${t.toFixed(2)}`).toBe(false);
        if (prev) {
          const v = { x: (p.x - prev.x) / dt, y: (p.y - prev.y) / dt };
          if (pv) worst = Math.max(worst, Math.hypot(v.x - pv.x, v.y - pv.y) / dt);
          pv = v;
        }
        prev = p;
      }
      expect(worst, `${hz} Hz`).toBeLessThan(16); // m/s/s: easing to a stop and up (unsmoothed it was about 180: a lurch)
    }
  });

  test('a tall tower beside its path, not across it: no lift', () => {
    const boxes: Box[] = [{ x0: 20, x1: 60, z0: 6, z1: 40, top: 100 }];
    for (const p of fly(boxes, 3, 30)) {
      expect(p.lift).toBe(0);
      expect(p.back).toBe(0);
    }
  });
});
