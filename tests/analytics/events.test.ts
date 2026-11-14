import { describe, expect, test } from 'vitest';
import { CITIES, MAX_BODY, SECS_BUCKETS, VIEWS, parseEvent, parseBody, secsBucket, toDataPoint, cleanCountry } from '../../src/analytics/events';
import { FEATURED_IDS } from '../../src/ui/featured';
import { VIEW_TABS } from '../../src/ui/hudmath';

describe('the event whitelist', () => {
  test('every allowed event, as the page sends it, is accepted unchanged', () => {
    const good = [
      { e: 'start_view' },
      { e: 'let_go', source: 'featured', city: 'paris' },
      { e: 'let_go', source: 'featured', city: 'london' },
      { e: 'let_go', source: 'search' },
      { e: 'let_go', source: 'location' },
      { e: 'link_open', landed: true },
      { e: 'link_open', landed: false },
      { e: 'replay_done' },
      { e: 'card_shown' },
      { e: 'card_share', method: 'share' },
      { e: 'card_share', method: 'save' },
      { e: 'card_share', method: 'copy' },
      { e: 'calendar_add' },
      { e: 'view_change', view: 'above' },
      { e: 'session_end', secs: '1-3m' },
    ];
    for (const ev of good) expect(parseEvent(ev), JSON.stringify(ev)).toEqual(ev);
  });

  test('anything else is refused: unknown names, unknown values, missing or extra fields, wrong types', () => {
    const bad: unknown[] = [
      null,
      'start_view',
      42,
      [],
      {},
      { e: 'pageview' },
      { e: 'START_VIEW' },
      { e: 'start_view', x: 1 },
      { e: 'let_go' },
      { e: 'let_go', source: 'gps' },
      { e: 'let_go', source: 'search', city: 'paris' }, // a city only with a featured start
      { e: 'let_go', source: 'featured', city: 'manchester' }, // not a featured city
      { e: 'let_go', source: 'featured' },
      { e: 'let_go', source: 'search', name: 'Windermere' },
      { e: 'let_go', source: 'location', lat: 51.5, lon: -0.12 },
      { e: 'link_open', landed: 'yes' },
      { e: 'link_open' },
      { e: 'card_share', method: 'email' },
      { e: 'view_change', view: 'ride' },
      { e: 'session_end', secs: 12 },
      { e: 'session_end', secs: '12s' },
      { e: 'calendar_add', place: 'Paris' },
      Object.assign(Object.create({ e: 'start_view' })), // inherited fields do not count
    ];
    for (const ev of bad) expect(parseEvent(ev), JSON.stringify(ev)).toBeNull();
  });

  test('the featured cities are London (the first start) and the start screen’s six', () => {
    expect([...CITIES]).toEqual(['london', ...FEATURED_IDS]);
  });

  test('the views are the HUD’s view buttons', () => {
    expect([...VIEWS]).toEqual([...VIEW_TABS]);
  });
});

describe('the body', () => {
  test('a small JSON body is read; junk, oversize or non-JSON bodies are refused', () => {
    expect(parseBody('{"e":"card_shown"}')).toEqual({ e: 'card_shown' });
    expect(parseBody('not json')).toBeNull();
    expect(parseBody('')).toBeNull();
    expect(parseBody(`{"e":"card_shown","pad":"${'x'.repeat(MAX_BODY)}"}`)).toBeNull();
    expect(parseBody(' '.repeat(MAX_BODY + 1) + '{"e":"card_shown"}')).toBeNull();
  });

  test('the longest allowed event fits well inside the limit', () => {
    const longest = JSON.stringify({ e: 'let_go', source: 'featured', city: 'cappadocia-goreme' });
    expect(longest.length).toBeLessThan(MAX_BODY);
  });
});

describe('session length buckets', () => {
  test.each([
    [0, '<10s'],
    [9.9, '<10s'],
    [10, '10-30s'],
    [29.9, '10-30s'],
    [30, '30-60s'],
    [59, '30-60s'],
    [60, '1-3m'],
    [179, '1-3m'],
    [180, '3-10m'],
    [599, '3-10m'],
    [600, '10m+'],
    [86400, '10m+'],
  ])('%s s is %s', (s, b) => expect(secsBucket(s)).toBe(b));

  test('nonsense times fall in the shortest bucket', () => {
    expect(secsBucket(-5)).toBe('<10s');
    expect(secsBucket(Number.NaN)).toBe('<10s');
  });

  test('every bucket is one the server accepts', () => {
    for (const s of SECS_BUCKETS) expect(parseEvent({ e: 'session_end', secs: s })).not.toBeNull();
  });
});

describe('what is stored', () => {
  test('a data point is the event, its one detail, a featured city if any, and the country', () => {
    expect(toDataPoint({ e: 'let_go', source: 'featured', city: 'tokyo' }, 'JP')).toEqual({ blobs: ['let_go', 'featured', 'tokyo', 'JP'], doubles: [1], indexes: ['let_go'] });
    expect(toDataPoint({ e: 'let_go', source: 'search' }, 'GB')).toEqual({ blobs: ['let_go', 'search', '', 'GB'], doubles: [1], indexes: ['let_go'] });
    expect(toDataPoint({ e: 'link_open', landed: true }, 'FR').blobs.slice(0, 2)).toEqual(['link_open', 'landed']);
    expect(toDataPoint({ e: 'link_open', landed: false }, 'FR').blobs.slice(0, 2)).toEqual(['link_open', 'flying']);
    expect(toDataPoint({ e: 'card_share', method: 'copy' }, 'FR').blobs.slice(0, 2)).toEqual(['card_share', 'copy']);
    expect(toDataPoint({ e: 'view_change', view: 'side' }, 'FR').blobs.slice(0, 2)).toEqual(['view_change', 'side']);
    expect(toDataPoint({ e: 'session_end', secs: '<10s' }, 'FR').blobs.slice(0, 2)).toEqual(['session_end', '<10s']);
    expect(toDataPoint({ e: 'start_view' }, 'FR').blobs).toEqual(['start_view', '', '', 'FR']);
  });

  test('the country is a two-letter code from the edge, or XX', () => {
    expect(cleanCountry('GB')).toBe('GB');
    expect(cleanCountry('T1')).toBe('T1'); // Tor, as Cloudflare names it
    expect(cleanCountry(undefined)).toBe('XX');
    expect(cleanCountry('gb')).toBe('XX');
    expect(cleanCountry('London')).toBe('XX');
    expect(cleanCountry(44)).toBe('XX');
  });
});
