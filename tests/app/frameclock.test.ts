import { describe, expect, test } from 'vitest';
import { FrameClock } from '../../src/app/frameclock';

/**
 * The live route is shown at each frame's own time (Task 26c): Date.now() is a whole millisecond read
 * whenever the frame's callback happens to run, which jitters a balloon at 10 m/s by a centimetre or two a
 * frame (and the camera aimed at it with it).
 */
describe('frame clock', () => {
  test('frames 16.67 ms apart are shown 16.67 ms apart, however late their callbacks run and however Date.now rounds', () => {
    const c = new FrameClock();
    let seed = 9;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const wall0 = 1_800_000_000_000;
    let prev = Number.NaN;
    for (let i = 0; i < 600; i++) {
      const frame = 1000 + i * (1000 / 60);
      const wall = Math.floor(wall0 + frame + rnd() * 4); // the callback runs up to 4 ms late
      const now = c.at(frame, wall);
      // it follows the least delay seen lately, half a millisecond a frame at most (a few millimetres of a
      // balloon at 10 m/s), never the callbacks' own jitter of up to 4 ms
      if (i > 0) expect(Math.abs(now - prev - 1000 / 60)).toBeLessThan(0.51);
      expect(Math.abs(now - (wall0 + frame))).toBeLessThan(6); // and it is the wall clock's time
      prev = now;
    }
  });

  test('a clock that drifts away (a sleep, a change of the time) is followed again at once', () => {
    const c = new FrameClock();
    c.at(1000, 5_000_000);
    expect(c.at(1016, 5_000_017)).toBeCloseTo(5_000_016, 6);
    // the machine slept for an hour: the frame clock barely moved, the wall clock did
    expect(c.at(1033, 5_000_033 + 3_600_000)).toBe(5_000_033 + 3_600_000);
    expect(c.at(1050, 5_000_050 + 3_600_000)).toBeCloseTo(5_000_050 + 3_600_000, 6);
  });

  test('a first frame whose callback ran late (a page still loading) is not kept: the clock settles on the true offset, gently', () => {
    const c = new FrameClock();
    const wall0 = 1_800_000_000_000;
    let prev = Number.NaN;
    for (let i = 0; i < 600; i++) {
      const frame = 1000 + i * (1000 / 60);
      const late = i === 0 ? 200 : 1; // the first callback ran 200 ms after its frame began
      const now = c.at(frame, wall0 + frame + late);
      if (i > 0) expect(Math.abs(now - prev - 1000 / 60)).toBeLessThan(1.6); // never a step: a millisecond and a half a frame at most
      prev = now;
    }
    expect(Math.abs(prev - (wall0 + 1000 + 599 * (1000 / 60) + 1))).toBeLessThan(1);
  });

  test('a wall clock that slowly gains on the frame clock is followed, never by a jump', () => {
    const c = new FrameClock();
    const wall0 = 1_800_000_000_000;
    let prev = Number.NaN, worst = 0;
    for (let i = 0; i < 60 * 120; i++) {
      const frame = 1000 + i * (1000 / 60);
      const gain = 0.002 * (frame - 1000); // 2 ms a second
      const now = c.at(frame, Math.floor(wall0 + frame + gain + 0.5));
      if (i > 0) worst = Math.max(worst, Math.abs(now - prev - 1000 / 60));
      prev = now;
    }
    expect(worst).toBeLessThan(0.6);
    expect(Math.abs(prev - (wall0 + 1000 + (60 * 120 - 1) * (1000 / 60) + 0.002 * (60 * 120 - 1) * (1000 / 60)))).toBeLessThan(20);
  });

  test('a step of under a second is eased in (no jump), a bigger one is taken at once', () => {
    const c = new FrameClock();
    let prev = c.at(1000, 5_000_000);
    let worst = 0;
    for (let i = 1; i < 600; i++) {
      const frame = 1000 + i * 16;
      const now = c.at(frame, 5_000_000 + i * 16 + (i >= 10 ? 400 : 0));
      worst = Math.max(worst, Math.abs(now - prev - 16));
      prev = now;
    }
    expect(worst).toBeLessThan(10); // at most a few ms a frame
    expect(Math.abs(prev - (5_000_000 + 599 * 16 + 400))).toBeLessThan(1);
    expect(c.at(1000 + 600 * 16, 5_000_000 + 600 * 16 + 400 + 5000)).toBe(5_000_000 + 600 * 16 + 400 + 5000);
  });

  test('non-finite input falls back to the wall clock', () => {
    const c = new FrameClock();
    expect(c.at(Number.NaN, 123)).toBe(123);
    expect(c.at(10, 5000)).toBe(5000);
  });
});
