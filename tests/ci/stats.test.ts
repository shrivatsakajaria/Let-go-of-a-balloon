import { describe, expect, test } from 'vitest';
// @ts-expect-error: a plain Node script with no types
import { ACCOUNT_ID, DATASET, eventsSql, parseArgs, report, rumQuery } from '../../scripts/stats.mjs';

const NOW = new Date('2026-11-14T10:30:00Z');

describe('scripts/stats.mjs', () => {
  test('the days asked for, in UTC: the last N whole days to now, yesterday, or one date', () => {
    expect(parseArgs([], NOW)).toMatchObject({ start: new Date('2026-11-07T10:30:00Z'), end: NOW });
    expect(parseArgs(['--days', '1'], NOW)).toMatchObject({ start: new Date('2026-11-13T10:30:00Z'), end: NOW });
    expect(parseArgs(['--yesterday'], NOW)).toMatchObject({ start: new Date('2026-11-13T00:00:00Z'), end: new Date('2026-11-14T00:00:00Z') });
    expect(parseArgs(['--date', '2026-11-10'], NOW)).toMatchObject({ start: new Date('2026-11-10T00:00:00Z'), end: new Date('2026-11-11T00:00:00Z') });
    expect(() => parseArgs(['--days', 'lots'], NOW)).toThrow();
    expect(() => parseArgs(['--date', '10/11/2026'], NOW)).toThrow();
  });

  test('the account and the dataset are this site’s', () => {
    expect(ACCOUNT_ID).toBe('d09a4e2d2ffe34fc1dc94d13f30da27d');
    expect(DATASET).toBe('lgoab_events');
  });

  test('the SQL counts each event and detail with its sample weight, in the range asked', () => {
    const sql = eventsSql(new Date('2026-11-13T00:00:00Z'), new Date('2026-11-14T00:00:00Z'));
    expect(sql).toMatch(/SUM\(_sample_interval\)/);
    expect(sql).toMatch(/FROM lgoab_events/);
    expect(sql).toMatch(/timestamp >= toDateTime\('2026-11-13 00:00:00'\)/);
    expect(sql).toMatch(/timestamp < toDateTime\('2026-11-14 00:00:00'\)/);
    expect(sql).toMatch(/FORMAT JSON$/);
  });

  test('the Web Analytics query reads visits by country, referrer and device', () => {
    const q = rumQuery();
    for (const f of ['rumPageloadEventsAdaptiveGroups', 'countryName', 'refererHost', 'deviceType', 'visits', 'accountTag']) expect(q).toContain(f);
  });

  test('a plain summary', () => {
    const rum = {
      total: [{ count: 150, sum: { visits: 120 } }],
      countries: [{ sum: { visits: 80 }, dimensions: { countryName: 'GB' } }, { sum: { visits: 40 }, dimensions: { countryName: 'FR' } }],
      referers: [{ sum: { visits: 100 }, dimensions: { refererHost: '' } }, { sum: { visits: 20 }, dimensions: { refererHost: 't.co' } }],
      devices: [{ sum: { visits: 90 }, dimensions: { deviceType: 'mobile' } }],
    };
    const rows = [
      { event: 'let_go', detail: 'featured', city: 'london', n: 30 },
      { event: 'let_go', detail: 'search', city: '', n: 10 },
      { event: 'link_open', detail: 'landed', city: '', n: 4 },
      { event: 'card_share', detail: 'copy', city: '', n: 2 },
      { event: 'session_end', detail: '1-3m', city: '', n: 7 },
      { event: 'session_end', detail: '<10s', city: '', n: 3 },
    ];
    const text = report({ label: '13 Nov 2026', rum, rows, countries: [{ country: 'GB', n: 25 }] });
    expect(text).toContain('Visits: 120 (150 page views)');
    expect(text).toContain('GB 80, FR 40');
    expect(text).toContain('(direct) 100, t.co 20');
    expect(text).toContain('mobile 90');
    expect(text).toMatch(/Let go\s+40 \(featured 30: london 30; search 10\)/);
    expect(text).toMatch(/Shared links opened\s+4 \(landed 4\)/);
    expect(text).toMatch(/Watched the whole trip\s+0/);
    expect(text).toMatch(/Card shared or saved\s+2 \(copy 2\)/);
    // the visit lengths in their own order, shortest first
    expect(text).toMatch(/<10s 3, 1-3m 7/);
    expect(text).toContain('Let go by country: GB 25');
  });

  test('missing parts are said plainly, not as a crash', () => {
    const text = report({ label: 'x', rum: null, rumError: 'not switched on', rows: null, rowsError: 'no dataset yet', countries: null });
    expect(text).toContain('Visits: not available (not switched on)');
    expect(text).toContain('Events: not available (no dataset yet)');
  });
});
