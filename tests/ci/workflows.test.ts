/// <reference types="node" />
// Checks on the GitHub workflows (R59), and a small harness that runs a step's shell script with
// stand-in commands, so the timer run's build and the site address can be tried without GitHub.
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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

const FAKE_SHA = 'c'.repeat(40);

/**
 * Run a step's script as GitHub would (bash -e), in a scratch checkout with a dist/ folder, with
 * stand-ins: npm and npx only print what they were asked, git rev-parse prints FAKE_SHA, and
 * scripts/site-url.sh prints an address or, with `siteUrlFails`, fails.
 */
function runWithStandIns(script: string, env: Record<string, string>, opts: { siteUrlFails?: boolean } = {}) {
  const bin = mkdtempSync(join(tmpdir(), 'wf-bin-'));
  const work = mkdtempSync(join(tmpdir(), 'wf-work-'));
  const exe = (p: string, body: string) => {
    writeFileSync(p, `#!/usr/bin/env bash\n${body}\n`);
    chmodSync(p, 0o755);
  };
  for (const cmd of ['npm', 'npx']) exe(join(bin, cmd), `echo "${cmd} $*"`);
  exe(join(bin, 'git'), `echo ${FAKE_SHA}`);
  mkdirSync(join(work, 'dist'));
  mkdirSync(join(work, 'scripts'));
  exe(join(work, 'scripts', 'site-url.sh'), opts.siteUrlFails ? 'exit 1' : 'echo https://site.test');
  const githubEnv = join(work, 'github-env');
  writeFileSync(githubEnv, '');
  const r = spawnSync('bash', ['-e', '-c', script], {
    cwd: work,
    env: { PATH: `${bin}:${process.env.PATH}`, GITHUB_ENV: githubEnv, ...env },
    encoding: 'utf8',
  });
  const file = (p: string) => (existsSync(join(work, p)) ? readFileSync(join(work, p), 'utf8') : null);
  return { code: r.status, out: r.stdout.trim(), buildJson: file('dist/build.json'), githubEnv: file('github-env') };
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
    expect(runWithStandIns(script, { EVENT: 'schedule' }).out).toBe('npx vite build');
    expect(runWithStandIns(script, { EVENT: 'push' }).out).toBe('npm run build');
    expect(runWithStandIns(script, { EVENT: 'workflow_dispatch' }).out).toBe('npm run build');
    expect(JSON.parse(read('package.json')).scripts.build).toBe('tsc --noEmit && vite build');
  });

  test('every build writes dist/build.json with the commit checked out (I-1)', () => {
    const script = runBlock(step(deploy, 'Build site'));
    for (const EVENT of ['schedule', 'push']) {
      const r = runWithStandIns(script, { EVENT });
      expect(r.code).toBe(0);
      expect(JSON.parse(r.buildJson!)).toEqual({ sha: FAKE_SHA });
    }
  });

  test('a timer run deploys when the live code differs, so a replaced push to main still goes live (I-1)', () => {
    const s = step(deploy, 'Check for a newer GFS run or newer code (scheduled runs only)');
    expect(s).toContain('./scripts/check-new-run.sh');
    expect(read('scripts/check-new-run.sh')).toMatch(/build\.json/);
    const queue = deploy.slice(0, deploy.indexOf('concurrency:'));
    expect(queue).not.toMatch(/nothing is lost/);
    expect(queue).toMatch(/build\.json/);
    expect(read('README.md')).not.toMatch(/nothing is lost/);
  });

  test('reading the site address fails the step when site-url.sh fails', () => {
    const script = runBlock(step(deploy, 'Read the site address'));
    const ok = runWithStandIns(script, {});
    expect(ok.code).toBe(0);
    expect(ok.githubEnv).toBe('SITE_URL=https://site.test\n');
    const bad = runWithStandIns(script, {}, { siteUrlFails: true });
    expect(bad.code).not.toBe(0);
    expect(bad.githubEnv).toBe('');
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
    expect(step(deploy, 'Read the site address')).toContain('url=$(./scripts/site-url.sh)');
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
