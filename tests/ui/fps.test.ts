import { expect, test } from 'vitest';
import { FpsMeter, fpsText } from '../../src/ui/fps';

test('60 frames a second reads 60 fps, slowest frame 17 ms', () => {
  const m = new FpsMeter();
  for (let i = 0; i <= 120; i++) m.tick(i * (1000 / 60));
  expect(Math.round(m.fps)).toBe(60);
  expect(Math.round(m.worstMs)).toBe(17);
  expect(fpsText(m)).toBe('60 fps · slowest 17 ms');
});

test('only the last second counts, so a hitch shows and then goes', () => {
  const m = new FpsMeter();
  let t = 0;
  for (let i = 0; i < 30; i++) m.tick((t += 16.7));
  m.tick((t += 250)); // a quarter-second hitch
  expect(Math.round(m.worstMs)).toBe(250);
  for (let i = 0; i < 90; i++) m.tick((t += 16.7));
  expect(Math.round(m.worstMs)).toBe(17);
});

test('before two frames there is nothing to say', () => {
  const m = new FpsMeter();
  expect(fpsText(m)).toBe('– fps');
  m.tick(0);
  expect(fpsText(m)).toBe('– fps');
});
