/// <reference types="node" />
// A small harness for scripts/check-wind-age.sh, the Deploy workflow's "are the live winds fresh?"
// check (R59): it fails the run, so GitHub emails, once the newest deployed run is over 18 h old.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';

const SCRIPT = new URL('../../scripts/check-wind-age.sh', import.meta.url).pathname;
const dir = mkdtempSync(join(tmpdir(), 'windage-'));
const NOW = Date.parse('2026-11-14T12:00:00Z') / 1000;

function manifest(name: string, body: unknown): string {
  const p = join(dir, name);
  writeFileSync(p, typeof body === 'string' ? body : JSON.stringify(body));
  return p;
}
const runs = (...issued: string[]) => ({ runs: issued.map((i) => ({ id: i.replace(/\D/g, '').slice(0, 10), issued: i })) });

function check(path: string, extra: Record<string, string> = {}) {
  const r = spawnSync('bash', [SCRIPT], {
    env: { PATH: process.env.PATH, MANIFEST: path, NOW: String(NOW), ...extra },
    encoding: 'utf8',
  });
  return { code: r.status, out: r.stdout + r.stderr };
}

test('newest run 10 h old: passes', () => {
  const r = check(manifest('fresh.json', runs('2026-11-14T02:00:00Z', '2026-11-13T20:00:00Z')));
  expect(r.code).toBe(0);
  expect(r.out).toMatch(/2026111402.*10 h/);
});

test('newest run exactly 18 h old: still passes', () => {
  expect(check(manifest('edge.json', runs('2026-11-13T18:00:00Z'))).code).toBe(0);
});

test('newest run over 18 h old: fails with an error annotation', () => {
  const r = check(manifest('stale.json', runs('2026-11-13T12:00:00Z', '2026-11-13T06:00:00Z')));
  expect(r.code).toBe(1);
  expect(r.out).toContain('::error');
  expect(r.out).toMatch(/24 h old/);
});

test('the newest run counts, whatever the order in the manifest', () => {
  expect(check(manifest('order.json', runs('2026-11-12T00:00:00Z', '2026-11-14T06:00:00Z'))).code).toBe(0);
});

test('no runs at all: fails', () => {
  expect(check(manifest('empty.json', { runs: [] })).code).toBe(1);
});

test('a manifest that is not JSON (the Pages fallback page): fails', () => {
  expect(check(manifest('html.json', '<!doctype html><title>app</title>')).code).toBe(1);
});

test('a missing manifest: fails', () => {
  expect(check(join(dir, 'nope.json')).code).toBe(1);
});

test('writes a line to the run summary page when there is one', () => {
  const summary = join(dir, 'summary.md');
  writeFileSync(summary, '');
  check(manifest('sum.json', runs('2026-11-13T00:00:00Z')), { GITHUB_STEP_SUMMARY: summary });
  expect(readFileSync(summary, 'utf8')).toMatch(/Live winds are 36 h old/);
});

test('MAX_AGE_HOURS moves the limit', () => {
  const p = manifest('limit.json', runs('2026-11-14T00:00:00Z'));
  expect(check(p, { MAX_AGE_HOURS: '6' }).code).toBe(1);
  expect(check(p, { MAX_AGE_HOURS: '12' }).code).toBe(0);
});
