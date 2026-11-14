import { describe, expect, it } from 'vitest';
import { keepHolding, LONG_HOLD_MS, MAX_HOLD_MS, type HoldState } from '../../src/app/hold';

/**
 * Run a launch's hold as the frame loop does (a check every 250 ms of real time from 6 s) with the
 * winds and the route as `at(ms)` says; returns when the hand opened ('released', ms) or when the
 * winds error showed ('error', ms).
 */
function launch(at: (ms: number) => HoldState): { outcome: 'released' | 'error'; ms: number } {
  for (let ms = 0; ms <= 60_000; ms += 250) {
    const s = at(ms);
    // the person opens the hand on the frame after the route came (from 1.2 s)
    if (s.routeReady && ms >= 1200) return { outcome: 'released', ms };
    if (ms >= MAX_HOLD_MS && !keepHolding(ms, s)) return { outcome: 'error', ms };
  }
  throw new Error('never ended');
}

describe('the launch hold (spec 7.2, ruling R53)', () => {
  it('winds in and the route slow: holds past 6 s, then lets go when the route comes', () => {
    const r = launch((ms) => ({ windsIn: true, routeReady: ms >= 11_000 }));
    expect(r).toEqual({ outcome: 'released', ms: 11_000 });
  });

  it('winds in and no route: the winds error at 20 s', () => {
    const r = launch(() => ({ windsIn: true, routeReady: false }));
    expect(r).toEqual({ outcome: 'error', ms: LONG_HOLD_MS });
  });

  it('no winds: the winds error at 6 s, as before', () => {
    const r = launch(() => ({ windsIn: false, routeReady: false }));
    expect(r).toEqual({ outcome: 'error', ms: MAX_HOLD_MS });
  });

  it('winds that arrive late (after 6 s) are too late: the error was shown at 6 s', () => {
    const r = launch((ms) => ({ windsIn: ms >= 7000, routeReady: false }));
    expect(r).toEqual({ outcome: 'error', ms: MAX_HOLD_MS });
  });

  it('a route that came while the tab was away is never answered with the error (the hand opens next frame)', () => {
    expect(keepHolding(45_000, { windsIn: false, routeReady: true })).toBe(true);
    expect(keepHolding(45_000, { windsIn: true, routeReady: false })).toBe(false);
  });
});
