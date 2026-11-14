import { describe, expect, test } from 'vitest';
import { CAP, PRODUCTION_HOSTS, armSessionEnd, createTracker, isProductionHost, letGoEvent, linkOpenEvent, type TrackEnv } from '../../src/analytics/track';
import { parseBody } from '../../src/analytics/events';
import type { SavedBalloon } from '../../src/flight/codec';
import type { StartChoice } from '../../src/ui/start';

const LIVE = 'let-go-of-a-balloon.pages.dev';

function env(over: Partial<TrackEnv> = {}) {
  const sent: string[] = [];
  const e: TrackEnv = { host: LIVE, gpc: false, bot: false, send: (b) => void sent.push(b), ...over };
  return { e, sent };
}

describe('where events are sent from', () => {
  test('the live site sends', () => {
    const { e, sent } = env();
    const t = createTracker(e);
    expect(t.enabled).toBe(true);
    expect(t.track({ e: 'start_view' })).toBe(true);
    expect(sent).toEqual(['{"e":"start_view"}']);
  });

  test('previews, localhost and the browser tests send nothing', () => {
    for (const host of ['localhost', '127.0.0.1', '3f2a9c1b.let-go-of-a-balloon.pages.dev', 'claude-task-30.let-go-of-a-balloon.pages.dev', 'let-go-of-a-balloon.pages.dev.evil.example', '']) {
      const { e, sent } = env({ host });
      const t = createTracker(e);
      expect(t.enabled, host).toBe(false);
      t.track({ e: 'start_view' });
      t.track({ e: 'card_shown' });
      expect(sent, host).toEqual([]);
    }
  });

  test('the production hosts are the pages.dev address and the address in src/config.ts', () => {
    expect(PRODUCTION_HOSTS.has(LIVE)).toBe(true);
    expect(isProductionHost(LIVE)).toBe(true);
    expect(isProductionHost('LET-GO-OF-A-BALLOON.PAGES.DEV')).toBe(false);
    for (const h of PRODUCTION_HOSTS) expect(h).not.toMatch(/localhost|^\d/);
  });

  test('Global Privacy Control on: nothing is sent', () => {
    const { e, sent } = env({ gpc: true });
    const t = createTracker(e);
    expect(t.enabled).toBe(false);
    t.track({ e: 'start_view' });
    expect(sent).toEqual([]);
  });

  test('a browser driven by a script (navigator.webdriver): nothing is sent', () => {
    const { e, sent } = env({ bot: true });
    createTracker(e).track({ e: 'start_view' });
    expect(sent).toEqual([]);
  });
});

describe('what is sent', () => {
  test('an event the whitelist does not allow is never sent', () => {
    const { e, sent } = env();
    const t = createTracker(e);
    expect(t.track({ e: 'let_go', source: 'search', lat: 51.5 } as never)).toBe(false);
    expect(t.track({ e: 'nope' } as never)).toBe(false);
    expect(sent).toEqual([]);
  });

  test(`at most ${CAP} events a page; the visit's length still goes at the end`, () => {
    expect(CAP).toBe(30);
    const { e, sent } = env();
    const t = createTracker(e);
    for (let i = 0; i < 100; i++) t.track({ e: 'view_change', view: 'above' });
    expect(sent).toHaveLength(CAP - 1);
    expect(t.track({ e: 'session_end', secs: '1-3m' })).toBe(true);
    expect(sent).toHaveLength(CAP);
    expect(t.track({ e: 'session_end', secs: '1-3m' })).toBe(false);
    expect(sent).toHaveLength(CAP);
  });

  test('a send that throws never breaks the page', () => {
    const t = createTracker(env({ send: () => { throw new Error('no beacon'); } }).e);
    expect(() => t.track({ e: 'card_shown' })).not.toThrow();
  });
});

describe('no personal data in what is sent', () => {
  const choice = (c: Partial<StartChoice>): StartChoice => ({ name: 'Windermere', lat: 54.3803, lon: -2.9076, kind: 'search', ...c });

  test('Let go says only the kind of start, and a featured city by its id', () => {
    expect(letGoEvent(choice({ kind: 'search' }))).toEqual({ e: 'let_go', source: 'search' });
    expect(letGoEvent(choice({ kind: 'gps', name: 'Your location' }))).toEqual({ e: 'let_go', source: 'location' });
    expect(letGoEvent(choice({ kind: 'featured', name: 'Paris', cityId: 'paris' }))).toEqual({ e: 'let_go', source: 'featured', city: 'paris' });
    expect(letGoEvent(choice({ kind: 'default', name: 'London', cityId: 'london' }))).toEqual({ e: 'let_go', source: 'featured', city: 'london' });
    // a featured kind with a city not on the list is counted as a search, never by its name
    expect(letGoEvent(choice({ kind: 'featured', name: 'Leeds', cityId: 'leeds' }))).toEqual({ e: 'let_go', source: 'search' });
  });

  test('no body holds a coordinate or a place name', () => {
    const { e, sent } = env();
    const t = createTracker(e);
    const starts = [choice({ kind: 'search' }), choice({ kind: 'gps', name: 'Your location', lat: 53.4794, lon: -2.2453 }), choice({ kind: 'featured', name: 'Tokyo', cityId: 'tokyo', lat: 35.6586, lon: 139.7454 })];
    for (const s of starts) t.track(letGoEvent(s));
    const b: SavedBalloon = { v: 1, name: 'Windermere', start: { lat: 54.3803, lon: -2.9076 }, release: Date.UTC(2026, 10, 10, 9), hourly: [{ lat: 54.3803, lon: -2.9076 }], runId: '2026111006' };
    t.track(linkOpenEvent(b, Date.UTC(2026, 10, 14)));
    expect(sent.length).toBe(4);
    for (const body of sent) {
      expect(body).not.toMatch(/\d/); // no numbers at all: no coordinates, no times
      // a featured city goes by its id ("tokyo"), never a place's name as shown
      expect(body).not.toMatch(/Windermere|Tokyo|Your location|"(lat|lon|name|start|hourly)"/);
      expect(parseBody(body)).not.toBeNull();
    }
  });

  test('a link says only whether its balloon has landed (72 hours after the release)', () => {
    const release = Date.UTC(2026, 10, 10, 9);
    const b = { v: 1, name: 'x', start: { lat: 0, lon: 0 }, release, hourly: [], runId: 'r' } as SavedBalloon;
    expect(linkOpenEvent(b, release + 71 * 3600e3)).toEqual({ e: 'link_open', landed: false });
    expect(linkOpenEvent(b, release + 72 * 3600e3)).toEqual({ e: 'link_open', landed: true });
  });
});

describe('the visit’s length', () => {
  test('is sent once, as a bucket, when the page goes away', () => {
    const { e, sent } = env();
    const t = createTracker(e);
    const page = new EventTarget();
    let now = 1_000;
    armSessionEnd(t, page, () => now);
    now += 95_000;
    page.dispatchEvent(new Event('pagehide'));
    page.dispatchEvent(new Event('pagehide'));
    expect(sent).toEqual(['{"e":"session_end","secs":"1-3m"}']);
  });

  test('a page restored from the back-forward cache counts as a new visit', () => {
    const { e, sent } = env();
    const t = createTracker(e);
    const page = new EventTarget();
    let now = 0;
    armSessionEnd(t, page, () => now);
    now = 5_000;
    page.dispatchEvent(new Event('pagehide'));
    now = 600_000;
    page.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }));
    now = 640_000;
    page.dispatchEvent(new Event('pagehide'));
    expect(sent).toEqual(['{"e":"session_end","secs":"<10s"}', '{"e":"session_end","secs":"30-60s"}']);
  });

  test('nothing is sent where tracking is off', () => {
    const { e, sent } = env({ host: 'localhost' });
    const page = new EventTarget();
    armSessionEnd(createTracker(e), page, () => 0);
    page.dispatchEvent(new Event('pagehide'));
    expect(sent).toEqual([]);
  });
});
