import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { headersFor, parseHeaders, parseCsp } from '../scripts/pages-headers';

const rules = parseHeaders(readFileSync(new URL('../public/_headers', import.meta.url), 'utf8'));
const page = headersFor(rules, '/');
const csp = parseCsp(page['content-security-policy'] ?? '');

test('the page is served with a content security policy, enforced', () => {
  expect(page['content-security-policy']).toBeTruthy();
  expect(page['content-security-policy-report-only']).toBeUndefined();
});

test('scripts only from this site: no inline scripts, no eval', () => {
  expect(csp['script-src']).toEqual(["'self'"]);
  expect(csp['default-src']).toEqual(["'self'"]);
  expect(csp['object-src']).toEqual(["'none'"]);
  expect(csp['base-uri']).toEqual(["'self'"]);
  expect(page['content-security-policy']).not.toMatch(/unsafe-eval/);
});

test('connections go only to the services the app uses (spec 9)', () => {
  const allowed = new Set(csp['connect-src']);
  for (const host of [
    "'self'", // winds, gazetteer, fonts
    'https://tiles.openfreemap.org',
    'https://download.mapterhorn.com',
    'https://tiles.mapterhorn.com',
    'https://s3.amazonaws.com/elevation-tiles-prod/',
    'https://geocoding-api.open-meteo.com',
  ])
    expect(allowed.has(host), host).toBe(true);
  expect(allowed.size).toBe(6);
  expect(csp['connect-src'].join(' ')).not.toMatch(/\*/);
});

test('the map worker comes from this site; the page cannot be framed', () => {
  expect(csp['worker-src']).toEqual(["'self'"]);
  expect(csp['frame-ancestors']).toEqual(["'none'"]);
  expect(page['x-frame-options']).toBe('DENY');
});

test('the other security headers', () => {
  expect(page['x-content-type-options']).toBe('nosniff');
  expect(page['referrer-policy']).toBe('strict-origin-when-cross-origin');
  expect(page['permissions-policy']).toMatch(/(^|, )geolocation=\(self\)(,|$)/);
});

test('hashed assets are cached for a year; the page and the wind manifest are checked often', () => {
  expect(headersFor(rules, '/assets/main-abc123.js')['cache-control']).toBe('public, max-age=31536000, immutable');
  for (const p of ['/', '/index.html']) expect(headersFor(rules, p)['cache-control']).toBe('public, max-age=0, must-revalidate');
  expect(headersFor(rules, '/winds/manifest.json')['cache-control']).toBe('public, max-age=300');
  // the files under a run id never change
  expect(headersFor(rules, '/winds/cruise/2026111218/0_0_0.bin.gz')['cache-control']).toBe('public, max-age=31536000, immutable');
});

test('no two rules set the same header on one path (Pages would join the values)', () => {
  for (const p of ['/', '/index.html', '/assets/x.js', '/winds/manifest.json', '/winds/climb/1/0_0.bin.gz', '/gazetteer/5_1_1.json', '/fonts/archivo-subset.woff2']) {
    const seen = new Map<string, number>();
    for (const r of rules) if (r.match(p)) for (const k of Object.keys(r.headers)) seen.set(k, (seen.get(k) ?? 0) + 1);
    for (const [k, n] of seen) expect(n, `${p} ${k}`).toBe(1);
  }
});
