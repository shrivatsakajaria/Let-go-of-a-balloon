import { readFileSync } from 'node:fs';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { headersFor, parseHeaders } from '../scripts/pages-headers';
import { liveWorld, startAtAlbertSquare, SWIFTSHADER } from './fixtures';

/**
 * The Content-Security-Policy in public/_headers, enforced on the built site. `vite preview` does not
 * read _headers, so every response from the local server is given the headers Cloudflare Pages would
 * send for its path (the page, its scripts, the map workers). Any violation, in the page or in a
 * worker, fails the test.
 */
test.use(SWIFTSHADER);
test.describe.configure({ mode: 'default', timeout: 120_000 });

const RULES = parseHeaders(readFileSync(new URL('../public/_headers', import.meta.url), 'utf8'));
const MANCHESTER = readFileSync(new URL('../tests/fixtures/geocoding/manchester.json', import.meta.url), 'utf8');

/**
 * Serve the Pages headers. In the test only, the policy gets a report-uri, so that every violation,
 * from the page or from a worker, is posted back here and recorded.
 */
async function pagesHeaders(page: Page): Promise<string[]> {
  const reports: string[] = [];
  await page.route(
    (url) => url.hostname === 'localhost' || url.hostname === '127.0.0.1',
    async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === '/__csp') {
        const r = (JSON.parse(route.request().postData() ?? '{}')['csp-report'] ?? {}) as Record<string, string>;
        reports.push(`${r['effective-directive'] ?? r['violated-directive']} ${r['blocked-uri']} from ${r['source-file'] ?? r['document-uri']}`);
        return route.fulfill({ status: 204, body: '' });
      }
      if (url.pathname.startsWith('/winds/')) return route.fallback(); // the fixture winds
      const res = await route.fetch();
      const headers = { ...res.headers(), ...headersFor(RULES, url.pathname) };
      if (headers['content-security-policy']) headers['content-security-policy'] += '; report-uri /__csp';
      await route.fulfill({ response: res, headers });
    },
  );
  return reports;
}

async function geocoding(context: BrowserContext) {
  await context.route('https://geocoding-api.open-meteo.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: MANCHESTER }),
  );
}

test('the page runs under its Content-Security-Policy: start, search, Let go and the live flight, with no violation', async ({ context, page }) => {
  await liveWorld(context);
  await geocoding(context);
  await startAtAlbertSquare(context);
  const seen = await pagesHeaders(page);
  const doc = await page.goto('/');
  expect(doc!.headers()['content-security-policy']).toContain("script-src 'self'");

  // the harness sees a violation when there is one (a host the policy leaves out)
  await page.evaluate(() => fetch('https://example.com/').catch(() => {}));
  await expect.poll(() => seen.length, { timeout: 10_000 }).toBeGreaterThan(0);
  seen.length = 0;

  // the 3D world and its map workers, the place search, Let go and the climb
  await page.waitForFunction(() => document.getElementById('scene')?.dataset.live === '1', null, { timeout: 30_000 });
  await page.getByRole('button', { name: /^From / }).click();
  await page.getByRole('combobox').fill('Manchester');
  await expect(page.getByRole('option').first()).toHaveText('Manchester, England, United Kingdom', { timeout: 20_000 });
  await page.getByRole('button', { name: 'Cancel' }).click();
  await page.waitForTimeout(3000); // the winds and the ground under the start load while the visitor reads
  await page.getByRole('button', { name: 'Let go', exact: true }).click();
  const person = () => page.evaluate(() => (window as unknown as { __live?: { person: string | null } }).__live?.person ?? null);
  await expect.poll(person, { timeout: 20_000 }).toBe('released');
  await page.waitForTimeout(5000);
  expect(seen).toEqual([]);

  // the policy reaches the map workers too (Pages sends it with the worker's script)
  await expect.poll(() => page.workers().length).toBeGreaterThan(0);
  await page.workers()[0].evaluate(() => fetch('https://example.com/').catch(() => {}));
  await expect.poll(() => seen.join('\n'), { timeout: 10_000 }).toMatch(/connect-src https:\/\/example\.com\/? from .*worker/);
});

test('the 2D map runs under the policy too', async ({ context, page }) => {
  await liveWorld(context);
  await startAtAlbertSquare(context);
  await context.addInitScript(() => {
    const get = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, id: string, ...rest: unknown[]) {
      return /webgl/.test(id) ? null : (get as (...a: unknown[]) => unknown).call(this, id, ...rest);
    } as typeof get;
  });
  const seen = await pagesHeaders(page);
  await page.goto('/?fps=1');
  await expect(page.locator('.fps')).toHaveText(/fps/, { timeout: 15_000 });
  await page.getByRole('button', { name: 'Let go', exact: true }).click();
  await expect(page.locator('.map2d')).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(3000);
  expect(seen).toEqual([]);
});
