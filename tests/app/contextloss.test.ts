import { beforeEach, expect, test, vi } from 'vitest';
import { watchContextLoss } from '../../src/app/contextloss';

const lose = (t: EventTarget) => {
  const e = new Event('webglcontextlost', { cancelable: true });
  t.dispatchEvent(e);
  return e;
};
const restore = (t: EventTarget) => t.dispatchEvent(new Event('webglcontextrestored'));

let canvas: EventTarget;
let calls: string[];
const handlers = () => ({ onLost: () => calls.push('lost'), onRestored: () => calls.push('restored'), onGiveUp: () => calls.push('give up') });

beforeEach(() => {
  vi.useFakeTimers();
  canvas = new EventTarget();
  calls = [];
});

test('the first loss asks the browser for the context back, and the scene is restored once it comes', () => {
  watchContextLoss(canvas, handlers(), { restoreWaitMs: 3000 });
  const e = lose(canvas);
  expect(e.defaultPrevented).toBe(true); // without this the browser never restores the context
  restore(canvas);
  vi.advanceTimersByTime(10_000);
  expect(calls).toEqual(['lost', 'restored']);
});

test('a second loss gives up on the 3D world (the 2D map takes over)', () => {
  const w = watchContextLoss(canvas, handlers(), { restoreWaitMs: 3000 });
  lose(canvas);
  restore(canvas);
  lose(canvas);
  expect(calls).toEqual(['lost', 'restored', 'lost', 'give up']);
  expect(w.losses).toBe(2);
  // and only once
  restore(canvas);
  lose(canvas);
  expect(calls.filter((c) => c === 'give up')).toHaveLength(1);
  expect(calls.at(-1)).toBe('give up');
});

test('a context that never comes back gives up after the wait', () => {
  watchContextLoss(canvas, handlers(), { restoreWaitMs: 3000 });
  lose(canvas);
  vi.advanceTimersByTime(2999);
  expect(calls).toEqual(['lost']);
  vi.advanceTimersByTime(2);
  expect(calls).toEqual(['lost', 'give up']);
  restore(canvas); // too late: the map has taken over
  expect(calls).toEqual(['lost', 'give up']);
});

test('dispose stops listening', () => {
  const w = watchContextLoss(canvas, handlers());
  w.dispose();
  lose(canvas);
  vi.advanceTimersByTime(60_000);
  expect(calls).toEqual([]);
});

test('a scene rebuilt after one loss gives up at its first loss (the page has lost two)', () => {
  const w = watchContextLoss(canvas, handlers(), { losses: 1 });
  lose(canvas);
  expect(calls).toEqual(['lost', 'give up']);
  expect(w.losses).toBe(2);
});
