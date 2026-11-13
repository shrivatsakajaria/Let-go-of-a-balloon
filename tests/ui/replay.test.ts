import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { clearGazetteerCache } from '../../src/geo/gazetteer';
import { playReplay, replayNames } from '../../src/ui/replay';
import type { Route, RoutePoint } from '../../src/flight/route';
import { stubGazetteer } from '../geo/helpers';
import { MAX_NAMES } from '../../src/ui/replaymath';

beforeEach(() => {
  clearGazetteerCache();
  vi.unstubAllGlobals();
});

/** A straight 72 hours from Manchester over Leeds and the North Sea to Bergen. */
function manchesterToBergen(): Route {
  const a = { lat: 53.48, lon: -2.24 }, b = { lat: 60.39, lon: 5.32 };
  const points: RoutePoint[] = Array.from({ length: 433 }, (_, i) => {
    const f = i / 432;
    return { tSec: i * 600, lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f, altM: 1500, groundM: 0, speedMs: 4, headingDeg: 40 };
  });
  return { points, hourly: [], release: 0, runId: 'x' };
}

test('the names on the way: real gazetteer, the biggest crossed, never the start or the landing, at most five', async () => {
  stubGazetteer({}, true);
  const names = await replayNames(manchesterToBergen(), { home: 'Manchester', landing: 'Bergen' });
  const list = names.map((n) => n.name);
  expect(list.length).toBeGreaterThan(0);
  expect(list.length).toBeLessThanOrEqual(MAX_NAMES);
  expect(list).toContain('the North Sea');
  expect(list).not.toContain('Manchester');
  expect(list).not.toContain('Bergen');
  // in the order they are crossed
  for (let i = 1; i < names.length; i++) expect(names[i].frac).toBeGreaterThan(names[i - 1].frac);
});

test('no gazetteer (offline): no names, and no error', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
  expect(await replayNames(manchesterToBergen(), { home: 'Manchester', landing: 'Bergen' })).toEqual([]);
});

test('names: a cancelled lookup stops asking and gives none', async () => {
  const fetch = stubGazetteer({}, true);
  const ac = new AbortController();
  ac.abort();
  expect(await replayNames(manchesterToBergen(), { home: 'Manchester', landing: 'Bergen', signal: ac.signal })).toEqual([]);
  expect(fetch).not.toHaveBeenCalled();
});

describe('playReplay: the end, Back to live and Escape (fake timers, a fake page)', () => {
  type Listener = (e: { key: string }) => void;
  let listeners: Set<Listener>;
  beforeEach(() => {
    vi.useFakeTimers();
    listeners = new Set();
    vi.stubGlobal('window', globalThis);
    vi.stubGlobal('addEventListener', (type: string, fn: Listener) => type === 'keydown' && listeners.add(fn));
    vi.stubGlobal('removeEventListener', (type: string, fn: Listener) => type === 'keydown' && listeners.delete(fn));
    vi.stubGlobal('requestAnimationFrame', (cb: (t: number) => void) => setTimeout(() => cb(Date.now()), 16));
    vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  function host() {
    const kids = [{ textContent: '' }, { textContent: '' }];
    const slot = { innerHTML: '', children: kids, classList: { toggle() {}, remove() {} }, style: { opacity: '' } } as unknown as HTMLElement;
    return {
      scene: { startReplay: vi.fn(), stopReplay: vi.fn() },
      hud: { setReplay: vi.fn(), replaySlot: slot, setOver: vi.fn() },
      layer: {} as HTMLElement,
      band: () => ({ top: 100, bottom: 600 }),
      reducedMotion: false,
      exit: vi.fn(),
    };
  }

  test('at 20 s: onEnd once, Escape let go (the card owns it), no timer left; it holds until Back to live', async () => {
    const h = host();
    const onEnd = vi.fn();
    const ac = new AbortController();
    let done = false;
    void playReplay(manchesterToBergen(), { host: h, onEnd, signal: ac.signal, clock: () => Date.now(), landing: Promise.resolve({ name: 'Bergen', kind: 'town' }) }).then(() => (done = true));
    expect(h.scene.startReplay).toHaveBeenCalledTimes(1);
    expect(listeners.size).toBe(1);
    await vi.advanceTimersByTimeAsync(19_900);
    expect(onEnd).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(300);
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(done).toBe(true);
    expect(listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(h.scene.stopReplay).not.toHaveBeenCalled(); // holding on the landing
    expect((h.hud.replaySlot.children[0] as unknown as { textContent: string }).textContent).toBe('Bergen');
    await vi.advanceTimersByTimeAsync(30_000);
    expect(onEnd).toHaveBeenCalledTimes(1);
    ac.abort(); // Back to live
    expect(h.scene.stopReplay).toHaveBeenCalledTimes(1);
    expect(h.hud.setReplay).toHaveBeenLastCalledWith(false);
  });

  test('Back to live at 5 s: gone at once, no onEnd ever, nothing left listening or ticking', async () => {
    const h = host();
    const onEnd = vi.fn();
    const ac = new AbortController();
    let done = false;
    void playReplay(manchesterToBergen(), { host: h, onEnd, signal: ac.signal, clock: () => Date.now() }).then(() => (done = true));
    await vi.advanceTimersByTimeAsync(5000);
    for (const l of listeners) l({ key: 'Escape' });
    expect(h.exit).toHaveBeenCalledTimes(1); // Escape asks for Back to live
    ac.abort();
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(true);
    expect(h.scene.stopReplay).toHaveBeenCalledTimes(1);
    expect(listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(onEnd).not.toHaveBeenCalled();
  });
});
