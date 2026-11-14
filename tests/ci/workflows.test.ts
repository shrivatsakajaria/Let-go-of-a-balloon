/// <reference types="node" />
// Checks on the GitHub workflows (R59), and a small harness that runs a step's shell script with
// stand-in commands, so the timer run's build and the site address can be tried without GitHub.
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { SITE_URL } from '../../src/config';

const root = new URL('../../', import.meta.url).pathname;
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const deploy = read('.github/workflows/deploy.yml');
const keepalive = read('.github/workflows/keepalive.yml');

/** The text of one step (from its `- name:` line to the next step), by name. */
function step(yml: string, name: string): string {
  const start = yml.indexOf(`- name: ${name}\n`);
  if (start < 0) throw new Error(`no step named ${name}`);
  const next = yml.slice(start + 1).search(/\n {6}- (name|uses):/);
  return next < 0 ? yml.slice(start) : yml.slice(start, start + 1 + next);
}

/** The `run: |` block of a step, de-indented. */
function runBlock(stepText: string): string {
  const m = stepText.match(/\n( +)run: \|\n([\s\S]*)$/);
  if (!m) throw new Error('no run block');
  const indent = ' '.repeat(m[1].length + 2);
  const lines = m[2].split('\n');
  const end = lines.findIndex((l) => l.trim() !== '' && !l.startsWith(indent));
  return (end < 0 ? lines : lines.slice(0, end)).map((l) => l.slice(indent.length)).join('\n');
}

/** Run a script with stand-ins for npm and npx that only print what they were asked. */
function runWithStandIns(script: string, env: Record<string, string>): string {
  const bin = mkdtempSync(join(tmpdir(), 'wf-bin-'));
  for (const cmd of ['npm', 'npx']) {
    const p = join(bin, cmd);
    writeFileSync(p, `#!/usr/bin/env bash\necho "${cmd} $*"\n`);
    chmodSync(p, 0o755);
  }
  const r = spawnSync('bash', ['-e', '-c', script], { env: { PATH: `${bin}:${process.env.PATH}`, ...env }, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr);
  return r.stdout.trim();
}

describe('deploy.yml', () => {
  test('pushes deploy for branches only, not tags', () => {
    expect(deploy).toMatch(/\n {2}push:\n {4}branches: \['\*\*'\]/);
    expect(deploy).not.toMatch(/\n {4}tags:/);
  });

  test('two timers at different minutes', () => {
    const crons = [...deploy.matchAll(/- cron: '(\d+) \* \* \* \*'/g)].map((m) => Number(m[1]));
    expect(crons).toHaveLength(2);
    expect(new Set(crons).size).toBe(2);
  });

  test('one queue per Pages branch: the live site never shares a queue with a preview', () => {
    expect(deploy).toContain("group: deploy-${{ github.event_name == 'schedule' && 'main' || github.ref_name }}");
    expect(deploy).toContain('cancel-in-progress: false');
    // the same expression that picks the Pages branch
    expect(deploy).toContain("BRANCH: ${{ github.event_name == 'schedule' && 'main' || github.ref_name }}");
  });

  test('a timer run builds with vite build only; push and manual runs keep the full check', () => {
    const script = runBlock(step(deploy, 'Build site'));
    expect(runWithStandIns(script, { EVENT: 'schedule' })).toBe('npx vite build');
    expect(runWithStandIns(script, { EVENT: 'push' })).toBe('npm run build');
    expect(runWithStandIns(script, { EVENT: 'workflow_dispatch' })).toBe('npm run build');
    expect(JSON.parse(read('package.json')).scripts.build).toBe('tsc --noEmit && vite build');
  });

  test('every live run checks the age of the live winds, timer runs with nothing new included', () => {
    const s = step(deploy, 'Check the live winds are fresh');
    expect(s).toContain("if: steps.cf.outputs.has_cf == 'true' && env.BRANCH == 'main'");
    expect(s).toContain('./scripts/check-wind-age.sh');
    expect(s).not.toMatch(/newrun/);
    expect(deploy.indexOf('Check the live winds are fresh')).toBeGreaterThan(deploy.indexOf('Deploy to Cloudflare Pages'));
  });

  test('the site address comes from src/config.ts, not the workflow', () => {
    expect(deploy).not.toContain('pages.dev');
    expect(step(deploy, 'Read the site address')).toContain('echo "SITE_URL=$(./scripts/site-url.sh)" >> "$GITHUB_ENV"');
    const r = spawnSync('bash', [join(root, 'scripts/site-url.sh')], { encoding: 'utf8' });
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe(SITE_URL);
  });

  test('index.html takes the address from SITE_URL too', () => {
    const html = read('index.html');
    expect(html).not.toContain('pages.dev');
    expect(html).toContain('<meta property="og:url" content="%SITE_URL%/" />');
  });
});

describe('every workflow', () => {
  test('pins each action to a full commit', () => {
    for (const yml of [deploy, keepalive]) {
      const uses = [...yml.matchAll(/uses: (\S+)/g)].map((m) => m[1]);
      expect(uses.length).toBeGreaterThan(0);
      for (const u of uses) expect(u).toMatch(/@[0-9a-f]{40}$/);
    }
  });

  test('keep-alive checks out with the same action version as deploy', () => {
    const sha = (yml: string) => yml.match(/actions\/checkout@([0-9a-f]{40})/)![1];
    expect(sha(keepalive)).toBe(sha(deploy));
  });
});
