import { describe, expect, test, vi } from 'vitest';
import type { Route, RoutePoint } from '../../src/flight/route';
import { CARD_CREDIT, cardFacts, cardLayout, cardWords, fitHeadline, isInAppBrowser, openInBrowserHref, shareCard, type CardFacts, type CardFont } from '../../src/ui/card';

const MANCHESTER = { lat: 53.4794, lon: -2.2453 };
const BERGEN = { lat: 60.3913, lon: 5.3221 };

/** A straight route from a to b over 72 h (433 ten-minute points), with a gust in the middle. */
function route(a = MANCHESTER, b = BERGEN, release = Date.UTC(2026, 10, 12, 14, 20)): Route {
  const points: RoutePoint[] = [];
  for (let i = 0; i <= 432; i++) {
    const f = i / 432;
    points.push({ tSec: i * 600, lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f, altM: 1500, groundM: 0, speedMs: i === 200 ? 17.8 : 5, headingDeg: 30 });
  }
  const hourly = Array.from({ length: 73 }, (_, h) => points[h * 6]);
  return { points, hourly, release, runId: '2026111218' };
}

const facts = (over: Partial<CardFacts> = {}): CardFacts => ({
  ...cardFacts(route(), { home: 'Manchester', landing: { name: 'Bergen', kind: 'town' }, own: true, now: Date.UTC(2026, 10, 13, 9) }),
  ...over,
});

/**
 * A stand-in for canvas measureText: Archivo at width 62 averages about 0.47 em a character in bold
 * and 0.42 em at regular weight (measured from the subset), spaces 0.22 em.
 */
const measure = (text: string, f: CardFont) =>
  [...text].reduce((w, c) => w + f.size * (c === ' ' ? 0.22 : f.weight >= 600 ? 0.47 : 0.42) * (f.condensed ? 1 : 1.25), 0);
const segWidth = (line: { text: string; bold: boolean }[], size: number) =>
  line.reduce((w, s) => w + measure(s.text, { size, weight: s.bold ? 700 : 400, condensed: true }), 0);

describe('the card', () => {
  test('card is exactly 1080x1350, the scene in the top 60% and the text in the bottom 40%', () => {
    const L = cardLayout(cardWords(facts()), measure);
    expect([L.width, L.height]).toEqual([1080, 1350]);
    expect(L.sceneBottom).toBeGreaterThanOrEqual(0.6 * 1350);
    const kicker = L.texts.find((t) => t.role === 'kicker')!;
    expect(kicker.y - kicker.size).toBeGreaterThanOrEqual(0.55 * 1350);
    // nothing runs off the card or into the bottom margin
    for (const t of L.texts) {
      expect(t.x).toBeGreaterThanOrEqual(64);
      expect(t.x + t.width).toBeLessThanOrEqual(1080 - 64);
      expect(t.y).toBeLessThanOrEqual(1350 - 48);
    }
    // sizes from spec 6.5
    const sizes = (role: string) => [...new Set(L.texts.filter((t) => t.role === role).map((t) => t.size))];
    expect(sizes('kicker')).toEqual([32]);
    expect(sizes('stat-value')).toEqual([56]);
    expect(sizes('stat-label')).toEqual([26]);
    expect(sizes('credit')).toEqual([22]);
  });

  test('the credit line breaks between credits, never inside one ("© Mapterhorn" stays together)', () => {
    const lines = cardLayout(cardWords(facts()), measure).texts.filter((t) => t.role === 'credit').map((t) => t.text);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join(' · ')).toBe(CARD_CREDIT);
    for (const l of lines) expect(l).not.toMatch(/(^·|·$|©$)/);
  });

  test('headline for Manchester to Bergen fits on two lines at the chosen size', () => {
    const h = fitHeadline('Manchester', 'Bergen', measure, 1080 - 2 * 72);
    expect(h.size).toBe(120);
    expect(h.lines.map((l) => l.map((s) => s.text).join(''))).toEqual(['Manchester', 'to Bergen']);
    // "to" at regular weight, the places bold
    expect(h.lines[1]).toEqual([{ text: 'to ', bold: false }, { text: 'Bergen', bold: true }]);
    for (const l of h.lines) expect(segWidth(l, h.size)).toBeLessThanOrEqual(936);
  });

  test('a short headline stays on one line; a long one shrinks toward 88 px, then gives the last word an ellipsis', () => {
    expect(fitHeadline('Leeds', 'York', measure, 936).lines).toHaveLength(1);
    const long = fitHeadline('Llanfairpwllgwyngyll', 'Saint-Pierre-et-Miquelon', measure, 936);
    expect(long.size).toBeLessThan(120);
    expect(long.size).toBeGreaterThanOrEqual(88);
    expect(long.lines).toHaveLength(2);
    const huge = fitHeadline('Ciudad Autónoma de Buenos Aires', 'Santa Cruz de la Sierra in the Department of Santa Cruz', measure, 936);
    expect(huge.size).toBe(88);
    expect(huge.lines).toHaveLength(2);
    const last = huge.lines[1].map((s) => s.text).join('');
    expect(last.endsWith('…')).toBe(true);
    for (const l of huge.lines) expect(segWidth(l, huge.size)).toBeLessThanOrEqual(936);
  });

  test('share text is "My balloon from Manchester is expected to land near Bergen."', () => {
    const w = cardWords(facts());
    expect(w.shareText).toBe('My balloon from Manchester is expected to land near Bergen.');
    expect(w.kicker).toBe('Expected to land near');
    expect([w.from, w.to]).toEqual(['Manchester', 'Bergen']);
    expect(cardWords(facts({ landed: true })).shareText).toBe('My balloon from Manchester landed near Bergen.');
    expect(cardWords(facts({ landed: true })).kicker).toBe('Landed near');
    expect(cardWords(facts({ own: false })).shareText).toBe('A balloon from Manchester is expected to land near Bergen.');
  });

  test('a sea landing reads "Expected to come down in the North Sea"', () => {
    const w = cardWords(facts({ landing: { name: 'North Sea', kind: 'sea' } }));
    expect(w.sentence).toBe('Expected to come down in the North Sea');
    expect(w.kicker).toBe('Expected to come down in');
    expect(w.to).toBe('the North Sea');
    expect(w.shareText).toBe('My balloon from Manchester is expected to come down in the North Sea.');
    expect(w.alt.startsWith('Expected to come down in the North Sea.')).toBe(true);
    const landed = cardWords(facts({ landing: { name: 'North Sea', kind: 'sea' }, landed: true }));
    expect(landed.sentence).toBe('Came down in the North Sea');
    expect(landed.kicker).toBe('Came down in');
  });

  test('stats: straight-line distance, 72 h aloft and the top speed; the date and time of release where it was let go', () => {
    const w = cardWords(facts());
    expect(w.stats).toEqual([
      { label: 'Distance', value: '894 km' },
      { label: 'Time aloft', value: '72 h' },
      { label: 'Top speed', value: '64 km/h' },
    ]);
    // 14:20 UTC on 12 Nov is 14:20 in Manchester
    expect(w.when).toBe('Let go on Thu 12 Nov at 14:20');
    expect(w.credit).toBe(CARD_CREDIT);
    expect(CARD_CREDIT).toBe('Winds: NOAA GFS · Map: © OpenMapTiles © OpenStreetMap contributors · Terrain: © Mapterhorn · A Still Signal build');
    expect(w.filename).toBe('balloon-manchester-to-bergen.png');
  });

  test('a slow balloon\'s top speed keeps a decimal rather than reading "0 km/h"', () => {
    expect(cardWords(facts({ topSpeedKmh: 0.36 })).stats[2].value).toBe('0.4 km/h');
    expect(cardWords(facts({ topSpeedKmh: 9.96 })).stats[2].value).toBe('10 km/h');
  });

  test('a landing place that could not be named still makes a card', () => {
    const w = cardWords(facts({ landing: null }));
    expect(w.kicker).toBe('Let go from');
    expect(w.from).toBe('Manchester');
    expect(w.to).toBe('');
    expect(w.shareText).toBe('My balloon from Manchester is on its way.');
  });
});

describe('sharing', () => {
  const blob = new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' });
  const words = cardWords(facts());

  test('share falls back to download when canShare is false', async () => {
    const share = vi.fn(async () => {});
    const download = vi.fn();
    const r = await shareCard(blob, words, 'https://example.test/#b=abc', { nav: { canShare: () => false, share }, download });
    expect(r).toBe('downloaded');
    expect(share).not.toHaveBeenCalled();
    expect(download).toHaveBeenCalledWith(blob, 'balloon-manchester-to-bergen.png');
  });

  test('with no Web Share at all it downloads', async () => {
    const download = vi.fn();
    expect(await shareCard(blob, words, 'https://example.test/#b=abc', { nav: {}, download })).toBe('downloaded');
    expect(download).toHaveBeenCalledOnce();
  });

  test('where files can be shared, the system share sheet gets the image, the text and the link', async () => {
    const share = vi.fn(async (_d: ShareData) => {});
    const download = vi.fn();
    const r = await shareCard(blob, words, 'https://example.test/#b=abc', { nav: { canShare: (d?: ShareData) => !!d?.files?.length, share }, download });
    expect(r).toBe('shared');
    const data = share.mock.calls[0][0];
    expect(data.text).toBe('My balloon from Manchester is expected to land near Bergen.');
    expect(data.url).toBe('https://example.test/#b=abc');
    expect(data.files?.[0].name).toBe('balloon-manchester-to-bergen.png');
    expect(data.files?.[0].type).toBe('image/png');
    expect(download).not.toHaveBeenCalled();
  });

  test('closing the share sheet is not an error and does not download', async () => {
    const abort = Object.assign(new Error('cancelled'), { name: 'AbortError' });
    const download = vi.fn();
    const r = await shareCard(blob, words, 'u', { nav: { canShare: () => true, share: async () => Promise.reject(abort) }, download });
    expect(r).toBe('cancelled');
    expect(download).not.toHaveBeenCalled();
  });

  test('a share that fails for another reason downloads instead', async () => {
    const download = vi.fn();
    const r = await shareCard(blob, words, 'u', { nav: { canShare: () => true, share: async () => Promise.reject(new TypeError('no')) }, download });
    expect(r).toBe('downloaded');
  });
});

describe('in-app browsers', () => {
  const LINKEDIN = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [LinkedInApp]/9.29.8';
  const X_ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0 Mobile Safari/537.36 TwitterAndroid';
  const X_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Twitter for iPhone/10.48';
  const SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
  const CHROME = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36';

  test('the LinkedIn and X in-app browsers are recognised; Safari and Chrome are not', () => {
    expect(isInAppBrowser(LINKEDIN)).toBe(true);
    expect(isInAppBrowser(X_ANDROID)).toBe(true);
    expect(isInAppBrowser(X_IOS)).toBe(true);
    expect(isInAppBrowser(SAFARI)).toBe(false);
    expect(isInAppBrowser(CHROME)).toBe(false);
  });

  test('"Open in your browser" hands the link to the phone\'s browser', () => {
    const url = 'https://let-go-of-a-balloon.pages.dev/#b=abc';
    expect(openInBrowserHref(url, X_ANDROID)).toBe('intent://let-go-of-a-balloon.pages.dev/#b=abc#Intent;scheme=https;action=android.intent.action.VIEW;end');
    expect(openInBrowserHref(url, LINKEDIN)).toBe('x-safari-https://let-go-of-a-balloon.pages.dev/#b=abc');
    expect(openInBrowserHref(url, CHROME)).toBe(url);
  });
});
