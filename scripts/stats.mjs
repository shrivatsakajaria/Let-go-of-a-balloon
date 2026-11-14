#!/usr/bin/env node
/**
 * The site's anonymous numbers, in plain words (spec 16, docs/for-sk/analytics.md).
 *
 *   node scripts/stats.mjs                  the last 7 days
 *   node scripts/stats.mjs --days 30        the last 30 days
 *   node scripts/stats.mjs --yesterday      yesterday (UTC)
 *   node scripts/stats.mjs --date 2026-11-13
 *
 * Reads Workers Analytics Engine (SQL API, dataset lgoab_events) with a read-only token (Account
 * Analytics Read). Visits are the start screen seen first plus shared links opened, by country (from
 * Cloudflare's edge), device class (from the User-Agent, at the edge) and referring site (hostname).
 * At most 31 days at a time.
 *
 * The token comes from CF_ANALYTICS_TOKEN, or, with none set, from a proxy that adds the
 * Authorization header itself (a Claude session's saved credential). It is never printed.
 * No dependencies: Node 22's fetch.
 */
import { pathToFileURL } from 'node:url';

export const ACCOUNT_ID = 'd09a4e2d2ffe34fc1dc94d13f30da27d';
export const DATASET = 'lgoab_events';
const API = 'https://api.cloudflare.com/client/v4';
const DAY = 86400e3;

/** The time range asked for, in UTC: { start, end, label }. */
export function parseArgs(argv, now = new Date()) {
  const at = (flag) => {
    const i = argv.indexOf(flag);
    return i < 0 ? null : argv[i + 1] ?? '';
  };
  const midnight = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = (d) => d.toISOString().slice(0, 10);
  if (argv.includes('--yesterday')) {
    const end = midnight(now);
    const start = new Date(end.getTime() - DAY);
    return { start, end, label: `yesterday, ${day(start)} (UTC)` };
  }
  const date = at('--date');
  if (date !== null) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) throw new Error('--date wants YYYY-MM-DD');
    const start = new Date(`${date}T00:00:00Z`);
    return { start, end: new Date(start.getTime() + DAY), label: `${date} (UTC)` };
  }
  const daysArg = at('--days');
  const days = daysArg === null ? 7 : Number(daysArg);
  if (!Number.isInteger(days) || days < 1 || days > 31) throw new Error('--days wants a whole number from 1 to 31 (ask for longer ranges a month at a time)');
  return { start: new Date(now.getTime() - days * DAY), end: now, label: `the last ${days} day${days === 1 ? '' : 's'} to ${now.toISOString().slice(0, 16).replace('T', ' ')} UTC` };
}

const sqlTime = (d) => d.toISOString().slice(0, 19).replace('T', ' ');
const where = (start, end) => `timestamp >= toDateTime('${sqlTime(start)}') AND timestamp < toDateTime('${sqlTime(end)}')`;

/** Each event and detail (and featured city), weighted by Analytics Engine's sampling. */
export function eventsSql(start, end) {
  return `SELECT blob1 AS event, blob2 AS detail, blob3 AS city, SUM(_sample_interval) AS n FROM ${DATASET} WHERE ${where(start, end)} GROUP BY event, detail, city ORDER BY n DESC FORMAT JSON`;
}

/** Where people let go from, by the country Cloudflare's edge saw. */
export function countriesSql(start, end) {
  return `SELECT blob4 AS country, SUM(_sample_interval) AS n FROM ${DATASET} WHERE ${where(start, end)} AND blob1 = 'let_go' GROUP BY country ORDER BY n DESC LIMIT 15 FORMAT JSON`;
}

/** Visits (the start screen seen first, and shared links opened) by country, device and referrer. */
export function visitsSql(start, end) {
  return `SELECT blob4 AS country, blob5 AS device, blob6 AS ref, SUM(_sample_interval) AS n FROM ${DATASET} WHERE ${where(start, end)} AND blob1 IN ('start_view', 'link_open') GROUP BY country, device, ref ORDER BY n DESC FORMAT JSON`;
}

const headers = (token, extra = {}) => ({ ...extra, ...(token ? { Authorization: `Bearer ${token}` } : {}) });

/** One API call; errors come back as a short message, never with the request's headers. */
async function call(fetchFn, url, init) {
  const res = await fetchFn(url, init);
  const text = await res.text();
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = JSON.parse(text);
      const errs = j.errors?.map((e) => e.message).filter(Boolean);
      if (errs?.length) msg += `: ${errs.join('; ')}`;
    } catch {
      if (text) msg += `: ${text.slice(0, 200)}`;
    }
    throw new Error(msg);
  }
  return JSON.parse(text);
}

export async function fetchSql(fetchFn, token, account, sql) {
  const j = await call(fetchFn, `${API}/accounts/${account}/analytics_engine/sql`, { method: 'POST', headers: headers(token, { 'Content-Type': 'text/plain' }), body: sql });
  return (j.data ?? []).map((r) => ({ ...r, n: Number(r.n) }));
}

const SECS = ['<10s', '10-30s', '30-60s', '1-3m', '3-10m', '10m+'];
const list = (pairs) => (pairs.length ? pairs.map(([k, n]) => `${k} ${n}`).join(', ') : 'none');

/** Totals of n by one field, largest first (ties in the order first seen). */
function totals(rows, key, limit = 15) {
  const m = new Map();
  for (const r of rows) m.set(r[key] || '(unknown)', (m.get(r[key] || '(unknown)') ?? 0) + r.n);
  return [...m].sort((a, b) => b[1] - a[1]).slice(0, limit);
}

/** The plain summary. visits/rows/countries may be null, with the reason in error. */
export function report({ label, visits, rows, error, countries }) {
  const out = [`Let Go of a Balloon: ${label}`, ''];
  if (!visits || !rows) {
    out.push(`Not available (${error ?? 'no data'})`);
    return out.join('\n');
  }
  out.push(`Visits: ${visits.reduce((a, r) => a + r.n, 0)} (the start screen, or a shared link, opened)`);
  out.push(`  Countries: ${list(totals(visits, 'country'))}`);
  out.push(`  Came from: ${list(totals(visits, 'ref'))}`);
  out.push(`  Devices:   ${list(totals(visits, 'device'))}`);
  out.push('');
  const of = (e) => rows.filter((r) => r.event === e);
  const sum = (rs) => rs.reduce((a, r) => a + r.n, 0);
  const details = (rs, order) => {
    const m = new Map();
    for (const r of rs) m.set(r.detail, (m.get(r.detail) ?? 0) + r.n);
    const keys = order ? order.filter((k) => m.has(k)) : [...m.keys()].sort((a, b) => m.get(b) - m.get(a));
    return keys.map((k) => [k, m.get(k)]);
  };
  const line = (name, e, order, extra) => {
    const rs = of(e);
    const d = details(rs, order).filter(([k]) => k);
    out.push(`${name.padEnd(24)}${sum(rs)}${d.length ? ` (${extra ? extra(rs, d) : list(d)})` : ''}`);
  };
  out.push('Events (each counted once per press; one visitor can press many times)');
  line('Start screen seen', 'start_view');
  line('Let go', 'let_go', ['featured', 'search', 'location'], (rs, d) =>
    d
      .map(([k, n]) => {
        if (k !== 'featured') return `${k} ${n}`;
        const cities = new Map();
        for (const r of rs) if (r.detail === 'featured') cities.set(r.city, (cities.get(r.city) ?? 0) + r.n);
        return `featured ${n}: ${[...cities].sort((a, b) => b[1] - a[1]).map(([c, m]) => `${c || '?'} ${m}`).join(', ')}`;
      })
      .join('; '),
  );
  line('Shared links opened', 'link_open', ['landed', 'flying']);
  line('Watched the whole trip', 'replay_done');
  line('Landing card seen', 'card_shown');
  line('Card shared or saved', 'card_share', ['share', 'save', 'copy']);
  line('Calendar reminder added', 'calendar_add');
  line('View changed', 'view_change', ['film', 'above', 'side']);
  line('Visits timed', 'session_end', SECS);
  if (countries) out.push('', `Let go by country: ${list(countries.map((r) => [r.country, r.n]))}`);
  return out.join('\n');
}

async function main() {
  const { start, end, label } = parseArgs(process.argv.slice(2));
  const token = process.env.CF_ANALYTICS_TOKEN || '';
  const account = process.env.CF_ACCOUNT_ID || ACCOUNT_ID;
  const why = (e) => (e instanceof Error ? e.message : String(e));
  let visits = null, rows = null, countries = null, error;
  try {
    visits = await fetchSql(fetch, token, account, visitsSql(start, end));
    rows = await fetchSql(fetch, token, account, eventsSql(start, end));
    countries = await fetchSql(fetch, token, account, countriesSql(start, end));
  } catch (e) {
    error = why(e);
  }
  console.log(report({ label, visits, rows, error, countries }));
  if (/Authorization|Authentication|9106|10000/i.test(String(error)))
    console.error('\nNo working read-only token. See docs/for-sk/analytics.md, "Asking me for the numbers".');
  if (error) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  });
}
