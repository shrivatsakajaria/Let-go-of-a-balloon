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
      // it settles on the least delay seen within a few frames, half a millisecond a frame at most; from then on
      // frame for frame (doubles near 1.8e12 ms hold about a microsecond)
      if (i > 0) expect(Math.abs(now - prev - 1000 / 60)).toBeLessThan(0.51);
      if (i > 120) expect(now - prev).toBeCloseTo(1000 / 60, 3);
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
      if (i > 0) expect(Math.abs(now - prev - 1000 / 60)).toBeLessThan(0.51); // never a step: half a millisecond a frame at most
      prev = now;
    }
    expect(Math.abs(prev - (wall0 + 1000 + 599 * (1000 / 60) + 1))).toBeLessThan(1);
  });

  test('non-finite input falls back to the wall clock', () => {
    const c = new FrameClock();
    expect(c.at(Number.NaN, 123)).toBe(123);
    expect(c.at(10, 5000)).toBe(5000);
  });
});
