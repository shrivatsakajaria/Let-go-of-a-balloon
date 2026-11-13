import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { decodeBalloon, encodeBalloon, type SavedBalloon } from '../../src/flight/codec';
import { balloonId, balloonStatus, store } from '../../src/flight/store';

class MemStorage {
  m = new Map<string, string>();
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
}

function bal(i: number, release = 1_700_000_000_000 + i * 60_000): SavedBalloon {
  const hourly = Array.from({ length: 73 }, (_, h) => ({ lat: 10 + i * 0.1 + h * 0.01, lon: 20 + h * 0.01 }));
  return { v: 1, name: `B${i}`, start: hourly[0], release, hourly, runId: String(1000000000 + i) };
}

beforeEach(() => { vi.stubGlobal('localStorage', new MemStorage()); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('store', () => {
  test('add lists newest first and remove works', () => {
    store.add(bal(1));
    store.add(bal(2));
    const l = store.list();
    expect(l.map((b) => b.name)).toEqual(['B2', 'B1']);
    expect(l[0].id).toBeTruthy();
    expect(store.remove(l[0].id!).map((b) => b.name)).toEqual(['B1']);
    expect(store.list().map((b) => b.name)).toEqual(['B1']);
  });

  test('dedupes the same balloon', () => {
    store.add(bal(1));
    store.add(bal(2));
    store.add(bal(1));
    expect(store.list().map((b) => b.name)).toEqual(['B1', 'B2']);
  });

  test('caps at 20, dropping the oldest', () => {
    for (let i = 0; i < 25; i++) store.add(bal(i));
    const l = store.list();
    expect(l).toHaveLength(20);
    expect(l[0].name).toBe('B24');
    expect(l[19].name).toBe('B5');
  });

  test('works with localStorage throwing', () => {
    const boom = () => { throw new Error('denied'); };
    vi.stubGlobal('localStorage', { getItem: boom, setItem: boom, removeItem: boom });
    expect(store.list()).toEqual([]);
    expect(store.add(bal(1))).toEqual([]);
    expect(store.remove('x')).toEqual([]);
  });

  test('works with no localStorage at all', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(store.list()).toEqual([]);
    expect(store.add(bal(1))).toEqual([]);
  });

  test('drops stored entries with bad numbers or the wrong number of points', () => {
    const good = bal(1);
    const bad: unknown[] = [
      { ...good, start: { lat: Number.NaN, lon: 1 } },
      { ...good, start: { lat: 1, lon: 'x' } },
      { ...good, start: null },
      { ...good, release: Number.POSITIVE_INFINITY },
      { ...good, release: '1700000000000' },
      { ...good, hourly: good.hourly.slice(0, 72) },
      { ...good, hourly: [...good.hourly, good.hourly[0]] },
      { ...good, hourly: good.hourly.map((p, i) => (i === 40 ? { lat: p.lat, lon: null } : p)) },
      { ...good, hourly: good.hourly.map((p, i) => (i === 40 ? null : p)) },
    ];
    // JSON turns NaN and Infinity into null, so write them as they would arrive
    localStorage.setItem('lgoab.balloons.v1', JSON.stringify([...bad, good]));
    expect(store.list().map((b) => b.name)).toEqual(['B1']);
  });

  test('a balloon saved here and the same balloon opened from its link share an id', async () => {
    const b = bal(3);
    b.start = { lat: 51.50071234, lon: -0.12634567 };
    b.release = Date.UTC(2026, 10, 12, 9, 30, 17);
    const fromLink = await decodeBalloon(await encodeBalloon(b));
    expect(balloonId(fromLink)).toBe(balloonId(b));
    store.add(b);
    store.add(fromLink);
    expect(store.list()).toHaveLength(1);
  });

  test('junk JSON gives an empty list and is overwritten on add', () => {
    localStorage.setItem('lgoab.balloons.v1', '{not json');
    expect(store.list()).toEqual([]);
    localStorage.setItem('lgoab.balloons.v1', '{"a":1}');
    expect(store.list()).toEqual([]);
    localStorage.setItem('lgoab.balloons.v1', '[1,null,{"v":1}]');
    expect(store.list()).toEqual([]);
    expect(store.add(bal(1))).toHaveLength(1);
  });
});

describe('balloonStatus', () => {
  const b = bal(1, Date.UTC(2026, 10, 12, 0, 0));
  const H = 3600_000;
  test('aloft after release', () => {
    expect(balloonStatus(b, b.release + 10 * H)).toEqual({ landed: false, hoursAloft: 10 });
  });
  test('landed at exactly 72 h and after, hours capped', () => {
    expect(balloonStatus(b, b.release + 71.99 * H).landed).toBe(false);
    expect(balloonStatus(b, b.release + 72 * H)).toEqual({ landed: true, hoursAloft: 72 });
    expect(balloonStatus(b, b.release + 500 * H)).toEqual({ landed: true, hoursAloft: 72 });
  });
  test('a NaN or infinite clock reads as not landed, zero hours', () => {
    expect(balloonStatus(b, Number.NaN)).toEqual({ landed: false, hoursAloft: 0 });
    expect(balloonStatus(b, Number.POSITIVE_INFINITY)).toEqual({ landed: false, hoursAloft: 0 });
  });
  test('before release is zero hours', () => {
    expect(balloonStatus(b, b.release - 5 * H)).toEqual({ landed: false, hoursAloft: 0 });
  });
});
