import { describe, expect, test, vi } from 'vitest';
import type { Route, RoutePoint } from '../../src/flight/route';
import { CARD_CREDIT, tameWarm, startName, cardFacts, cardWords, isInAppBrowser, openInBrowserHref, shareCard, sketchPicture, type CardFacts } from '../../src/ui/card';

const MANCHESTER = { lat: 53.4794, lon: -2.2453 };
const BERGEN = { lat: 60.3913, lon: 5.3221 };

/** A straight route from a to b over 72 h (433 ten-minute points), with a gust in the middle. */
function route(a = MANCHESTER, b = BERGEN, release = Date.UTC(2026, 10, 12, 14, 20)): Route {
  const points: RoutePoint[] = [];
  const dLon = ((((b.lon - a.lon + 180) % 360) + 360) % 360) - 180;
  for (let i = 0; i <= 432; i++) {
    const f = i / 432;
    points.push({ tSec: i * 600, lat: a.lat + (b.lat - a.lat) * f, lon: ((((a.lon + dLon * f + 180) % 360) + 360) % 360) - 180, altM: 1500, groundM: 0, speedMs: i === 200 ? 17.8 : 5, headingDeg: 30 });
  }
  const hourly = Array.from({ length: 73 }, (_, h) => points[h * 6]);
  return { points, hourly, release, runId: '2026111218' };
}

const facts = (over: Partial<CardFacts> = {}): CardFacts => ({
  ...cardFacts(route(), { home: 'Manchester', landing: { name: 'Bergen', kind: 'town' }, own: true, now: Date.UTC(2026, 10, 13, 9), country: 'United Kingdom' }),
  ...over,
});

describe('the card\'s words (design A)', () => {
  test('share text is "My balloon from Manchester is expected to land near Bergen."; the panel says "Expected to land" with the time there', () => {
    const w = cardWords(facts());
    expect(w.shareText).toBe('My balloon from Manchester is expected to land near Bergen.');
    expect(w.kicker).toBe('Expected to land');
    expect(w.sentence).toBe('Expected to land near Bergen');
    expect([w.from, w.to, w.toName]).toEqual(['Manchester', 'Bergen', 'Bergen']);
    // 72 h after 14:20 UTC on 12 Nov is 14:20 UTC on 15 Nov: 15:20 in Bergen
    expect(w.when).toBe('Sun 15 Nov, 15:20');
    // under the start's name: when it was let go, local time there
    expect(w.fromLine).toBe('Let go Thu 12 Nov, 14:20');
    const landed = cardWords(facts({ landed: true }));
    expect(landed.shareText).toBe('My balloon from Manchester landed near Bergen.');
    expect(landed.kicker).toBe('Landed');
    expect(landed.sentence).toBe('Landed near Bergen');
    expect(cardWords(facts({ own: false })).shareText).toBe('A balloon from Manchester is expected to land near Bergen.');
  });

  test('a sea landing: "Expected to come down at sea" (R56), the sea named big as the map names it', () => {
    const w = cardWords(facts({ landing: { name: 'North Sea', kind: 'sea' } }));
    expect(w.kicker).toBe('Expected to come down at sea');
    expect(w.sentence).toBe('Expected to come down in the North Sea');
    expect(w.to).toBe('the North Sea');
    expect(w.toName).toBe('North Sea');
    expect(w.shareText).toBe('My balloon from Manchester is expected to come down in the North Sea.');
    expect(w.alt.startsWith('Expected to come down in the North Sea, ')).toBe(true);
    const landed = cardWords(facts({ landing: { name: 'North Sea', kind: 'sea' }, landed: true }));
    expect(landed.kicker).toBe('Came down at sea');
    expect(landed.sentence).toBe('Came down in the North Sea');
  });

  test('stats: straight-line distance, 72 h aloft and the top speed, as numbers to count up to and units', () => {
    const w = cardWords(facts());
    expect(w.stats.map((s) => [s.label, s.value, s.num, s.unit])).toEqual([
      ['Distance', '894 km', 894, 'km'],
      ['Time aloft', '72 h', 72, 'h'],
      ['Top speed', '64 km/h', 64, 'km/h'],
    ]);
    expect(w.credit).toBe(CARD_CREDIT);
    expect(w.creditLine).toBe(`let-go-of-a-balloon.pages.dev · ${CARD_CREDIT}`);
    expect(CARD_CREDIT).toMatch(/Natural Earth/);
    expect(w.filename).toBe('balloon-manchester-to-bergen.png');
  });

  test('the comparison line: about the length of Britain from the United Kingdom; none where nothing fits', () => {
    expect(cardWords(facts()).compare).toBe('About the length of Britain');
    expect(cardWords(facts({ country: null })).compare).toBeNull();
    expect(cardWords(facts()).alt).toMatch(/About the length of Britain\.$/);
  });

  test('the day-progress line: local midnights where it was let go, and how much is flown', () => {
    const w = cardWords(facts());
    // let go 14:20 on 12 Nov in Manchester: midnights at 9 h 40, 33 h 40 and 57 h 40 (to the quarter hour)
    expect(w.ticks.map((t) => Math.round(t * 72 * 4) / 4)).toEqual([9.75, 33.75, 57.75]);
    expect(w.flown).toBeGreaterThan(0.2);
    expect(w.flown).toBeLessThan(0.3);
    expect(cardWords(facts({ landed: true, nowMs: Date.UTC(2026, 10, 20) })).flown).toBe(1);
  });

  test('a short trip keeps a decimal; a slow balloon\'s top speed keeps one rather than reading "0 km/h"', () => {
    expect(cardWords(facts({ distanceKm: 8.44 })).stats[0]).toMatchObject({ value: '8.4 km', num: 8.4, decimals: 1 });
    expect(cardWords(facts({ distanceKm: 1587.4 })).stats[0]).toMatchObject({ value: '1,587 km', num: 1587, decimals: 0 });
    expect(cardWords(facts({ topSpeedKmh: 0.36 })).stats[2].value).toBe('0.4 km/h');
    expect(cardWords(facts({ topSpeedKmh: 9.96 })).stats[2].value).toBe('10 km/h');
  });

  test('a start from "Use my location" is named for the place, never "Your location"', () => {
    const p = { lat: 54.6, lon: -3.1 };
    expect(startName(p, { kind: 'town', name: 'Keswick', country: 'United Kingdom', distanceKm: 3 })).toBe('Keswick');
    // a town too far off to be honest about: its country instead
    expect(startName(p, { kind: 'town', name: 'Keswick', country: 'United Kingdom', distanceKm: 40 })).toBe('the United Kingdom');
    expect(startName(p, { kind: 'town', name: 'Voss', country: 'Norway', distanceKm: 40 })).toBe('Norway');
    expect(startName(p, { kind: 'sea', name: 'North Sea' })).toBe('the North Sea');
    expect(startName(p, { kind: 'region', name: 'Cairngorms' })).toBe('the Cairngorms');
    expect(startName(p, { kind: 'region', name: 'open countryside', generic: true })).toBe('open countryside');
    // nothing known: where it is, to a tenth of a degree
    expect(startName({ lat: 53.4794, lon: -2.2453 }, null)).toBe('53.5° N 2.2° W');
    expect(startName({ lat: -33.87, lon: 151.21 }, null)).toBe('33.9° S 151.2° E');
  });

  test('a start name that begins in lower case is capitalised on the card only', () => {
    const w = cardWords(facts({ home: 'the North Sea' }));
    expect(w.from).toBe('The North Sea');
    expect(w.shareText).toBe('My balloon from the North Sea is expected to land near Bergen.');
  });

  test('a landing place that could not be named still makes a card', () => {
    const w = cardWords(facts({ landing: null }));
    expect(w.kicker).toBe('Expected to land');
    expect(w.from).toBe('Manchester');
    expect(w.to).toBe('');
    expect(w.toName).toBe('');
    expect(w.shareText).toBe('My balloon from Manchester is on its way.');
  });
});

describe('the plain sketch (no picture at all)', () => {
  test('a route across the date line is drawn short, not as a 360 degree streak', () => {
    const pic = sketchPicture(route({ lat: 52, lon: 178 }, { lat: 54, lon: -176 }));
    const xs = pic.route.map((p) => p.x);
    // from one side of the line to the other: a few degrees, fitted in the picture
    for (let i = 1; i < xs.length; i++) expect(Math.abs(xs[i] - xs[i - 1])).toBeLessThan(20);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...xs)).toBeLessThanOrEqual(1080);
    expect(pic.start).toEqual({ x: pic.route[0].x, y: pic.route[0].y, seen: true });
  });
});

describe('the picture', () => {
  const hsv = (r: number, g: number, b: number) => {
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), c = mx - mn;
    let h = 0;
    if (c) h = mx === r ? ((g - b) / c) % 6 : mx === g ? (b - r) / c + 2 : (r - g) / c + 4;
    return { h: ((h * 60) + 360) % 360, s: mx ? c / mx : 0, v: mx / 255 };
  };
  test('rust and clay slopes are calmed so the balloon stays the one bright thing; greens, sea and sky are left alone', () => {
    // rust (hue 29, saturation 0.78), sage, sea, peach sky
    const px = new Uint8ClampedArray([200, 116, 44, 255, 118, 160, 99, 255, 43, 127, 176, 255, 240, 200, 160, 255]);
    tameWarm(px);
    const rust = hsv(px[0], px[1], px[2]);
    expect(rust.s).toBeLessThanOrEqual(0.52);
    expect(Math.abs(rust.h - 29)).toBeLessThan(4);
    expect(rust.v).toBeCloseTo(200 / 255, 2);
    expect([...px.slice(4, 16)]).toEqual([118, 160, 99, 255, 43, 127, 176, 255, 240, 200, 160, 255]);
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
    // with a fallback, so a phone with no browser to hand it to still opens the page
    expect(openInBrowserHref(url, X_ANDROID)).toBe(
      `intent://let-go-of-a-balloon.pages.dev/#b=abc#Intent;scheme=https;action=android.intent.action.VIEW;S.browser_fallback_url=${encodeURIComponent(url)};end`,
    );
    expect(openInBrowserHref(url, LINKEDIN)).toBe('x-safari-https://let-go-of-a-balloon.pages.dev/#b=abc');
    expect(openInBrowserHref(url, CHROME)).toBe(url);
  });
});

describe('strings and the landed HUD', () => {
  test('the card strings live in copy.ts; the HUD does not pull in the card view, and "Show the card" is a quiet text action', async () => {
    const { readFileSync } = await import('node:fs');
    const { COPY } = await import('../../src/ui/copy');
    const hud = readFileSync(new URL('../../src/ui/hud.ts', import.meta.url), 'utf8');
    expect(hud).not.toMatch(/cardview/);
    expect(hud).toMatch(/class="link show-card"/);
    expect(COPY.shareCard).toBe('Share card');
    expect(COPY.saveImage).toBe('Save image');
    expect(COPY.copyLink).toBe('Copy link');
    expect(COPY.linkCopied).toBe('Link copied');
    expect(COPY.pressAndHold).toBe('Press and hold to save');
    expect(COPY.openInBrowser).toBe('Open in your browser');
    expect(COPY.showCard).toBe('Show the card');
  });
});
