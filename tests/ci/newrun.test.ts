/// <reference types="node" />
// A harness for scripts/check-new-run.sh, the timer run's "anything to deploy?" check, with a
// stand-in curl: NOAA's index files and the live site's manifest and build.json come from here.
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';

const SCRIPT = new URL('../../scripts/check-new-run.sh', import.meta.url).pathname;
const SITE = 'https://site.test';
const SHA = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);

/** Today's date in UTC as YYYYMMDD, as the script computes it. */
const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');

/**
 * Run the script. `idx` lists the NOAA index files that exist (e.g. `06/1p00`, today's cycle 06);
 * `site` maps the live site's paths to their bodies (a missing path answers 404).
 */
function check(idx: string[], site: Record<string, string>, buildSha = SHA) {
  const dir = mkdtempSync(join(tmpdir(), 'newrun-'));
  for (const [path, body] of Object.entries(site)) writeFileSync(join(dir, path.replace(/\//g, '_')), body);
  const ready = idx.map((k) => `gfs.${today}/${k.split('/')[0]}/atmos/gfs.t${k.split('/')[0]}z.pgrb2.${k.split('/')[1]}.f120.idx`);
  const curl = join(dir, 'curl');
  writeFileSync(
    curl,
    `#!/usr/bin/env bash
url=""; head=0
for a in "$@"; do case "$a" in http*) url="$a";; -I) head=1;; esac; done
if [ $head = 1 ]; then
  for r in ${ready.map((r) => `'${r}'`).join(' ')}; do
    case "$url" in *"/$r") printf 200; exit 0;; esac
  done
  printf 404; exit 0
fi
path=\${url#${SITE}/}; path=\${path%%\\?*}
f="${dir}/\${path//\\//_}"
[ -f "$f" ] || exit 22
cat "$f"
`,
  );
  chmodSync(curl, 0o755);
  const r = spawnSync('bash', [SCRIPT], {
    env: { PATH: `${dir}:${process.env.PATH}`, SITE_URL: SITE, BUILD_SHA: buildSha },
    encoding: 'utf8',
  });
  expect(r.status).toBe(0);
  const out: Record<string, string> = Object.fromEntries(r.stdout.trim().split('\n').map((l) => l.split('=') as [string, string]));
  return { new: out.new, run: out.run, log: r.stderr };
}

const manifest = (id: string) => JSON.stringify({ runs: [{ id, issued: '' }] });
const build = (sha: string) => JSON.stringify({ sha });

test('nothing newer and the same code live: nothing to do', () => {
  const r = check(['06/1p00', '06/0p25'], { 'winds/manifest.json': manifest(`${today}06`), 'build.json': build(SHA) });
  expect(r.new).toBe('false');
  expect(r.run).toBe(`${today}06`);
});

test('a newer GFS run with both products at f120: deploy', () => {
  const r = check(['12/1p00', '12/0p25'], { 'winds/manifest.json': manifest(`${today}06`), 'build.json': build(SHA) });
  expect(r.new).toBe('true');
  expect(r.run).toBe(`${today}12`);
});

test('a run is ready only when both products have f120 (as run_is_ready)', () => {
  const r = check(['12/0p25', '06/1p00', '06/0p25'], { 'winds/manifest.json': manifest(`${today}06`), 'build.json': build(SHA) });
  expect(r.run).toBe(`${today}06`);
  expect(r.new).toBe('false');
});

test('the live site runs other code (a replaced push to main): deploy, with no newer GFS run', () => {
  const r = check(['06/1p00', '06/0p25'], { 'winds/manifest.json': manifest(`${today}06`), 'build.json': build(OTHER) });
  expect(r.new).toBe('true');
  expect(r.log).toMatch(/other code/);
});

test('no build.json on the live site yet (the first deploy with it): deploy', () => {
  expect(check(['06/1p00', '06/0p25'], { 'winds/manifest.json': manifest(`${today}06`) }).new).toBe('true');
});

test('the live build.json is the Pages fallback page: deploy', () => {
  expect(check(['06/1p00', '06/0p25'], { 'winds/manifest.json': manifest(`${today}06`), 'build.json': '<!doctype html>' }).new).toBe('true');
});

test('no ready GFS run and the same code: nothing to do', () => {
  const r = check([], { 'winds/manifest.json': manifest(`${today}06`), 'build.json': build(SHA) });
  expect(r.new).toBe('false');
  expect(r.run).toBe('');
});
