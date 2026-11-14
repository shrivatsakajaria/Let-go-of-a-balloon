import { describe, expect, test } from 'vitest';
import { bezier, countText, easeMove, easeUi, REVEAL, revealAt } from '../../src/ui/revealmath';

describe('the reveal timeline', () => {
  test('the camera moves for 3-4 s, then a beat of stillness, then the names, then the count, then the buttons', () => {
    const [m0, m1] = REVEAL.move;
    expect(m1 - m0).toBeGreaterThanOrEqual(3);
    expect(m1 - m0).toBeLessThanOrEqual(4);
    expect(REVEAL.names[0] - m1).toBeCloseTo(0.6, 5);
    expect(REVEAL.count[0]).toBeGreaterThanOrEqual(REVEAL.names[1]);
    expect(REVEAL.count[1] - REVEAL.count[0]).toBeCloseTo(1.2, 5);
    expect(REVEAL.buttons).toBeGreaterThan(REVEAL.count[1]);
    // nothing moves or appears during the beat
    const a = revealAt(m1 + 0.01), b = revealAt(REVEAL.names[0] - 0.01);
    expect(a).toEqual({ ...b });
    expect(a.move).toBe(1);
    expect(a.route).toBe(1);
    expect(a.names).toBe(0);
    expect(a.count).toBe(0);
  });

  test('starts still on the balloon, ends on the finished card', () => {
    expect(revealAt(0)).toMatchObject({ move: 0, route: 0, names: 0, count: 0, buttons: false, done: false });
    expect(revealAt(REVEAL.end)).toEqual({ move: 1, route: 1, places: 1, names: 1, count: 1, buttons: true, done: true });
  });

  test('the route draws in as the camera rises', () => {
    const mid = revealAt((REVEAL.move[0] + REVEAL.move[1]) / 2);
    expect(mid.route).toBeGreaterThan(0.2);
    expect(mid.route).toBeLessThan(1);
    expect(mid.move).toBeGreaterThan(0.2);
  });
});

describe('easing', () => {
  test('the interface curve is cubic-bezier(0.22,1,0.36,1): no overshoot, monotonic, 0 and 1 at the ends', () => {
    let last = 0;
    for (let x = 0; x <= 1.0001; x += 0.01) {
      const y = easeUi(x);
      expect(y).toBeGreaterThanOrEqual(last - 1e-9);
      expect(y).toBeLessThanOrEqual(1);
      last = y;
    }
    expect(easeUi(0)).toBe(0);
    expect(easeUi(1)).toBe(1);
    expect(bezier(0, 0, 1, 1)(0.3)).toBeCloseTo(0.3, 3);
  });

  test('the camera eases in and out (calm at both ends)', () => {
    expect(easeMove(0.05)).toBeLessThan(0.01);
    expect(easeMove(0.95)).toBeGreaterThan(0.99);
    expect(easeMove(0.5)).toBeCloseTo(0.5, 6);
  });
});

describe('countText', () => {
  test('counts up and lands exactly on the final value', () => {
    expect(countText(894, 0, 0)).toBe('0');
    expect(countText(894, 0, 0.5)).toBe('447');
    expect(countText(894, 0, 1)).toBe('894');
    expect(countText(1587, 0, 1)).toBe('1,587');
    expect(countText(8.4, 1, 1)).toBe('8.4');
    expect(countText(8.4, 1, 0.5)).toBe('4.2');
    // never shows the final value before the end
    expect(countText(894, 0, 0.9999)).not.toBe('894');
  });
});
