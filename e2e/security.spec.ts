import { readFileSync } from 'node:fs';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { headersFor, parseHeaders } from '../scripts/pages-headers';
import { eastward, linkTo, liveWorld, startAtAlbertSquare, SWIFTSHADER } from './fixtures';

/**
 * The Content-Security-Policy in public/_headers, enforced on the built site. `vite preview` does not
 * read _headers, so every response from the local server is given the headers Cloudflare Pages would
 * send for its path (the page, its scripts, the map workers). Any violation, in the page or in a
 * worker, fails the test.
 */
test.use(SWIFTSHADER);
// The visitor here is in Manchester: search ranks results from the visitor's own country first (Task 29),
// so the browser says so, as a British visitor's would.
test.use({ locale: 'en-GB', timezoneId: 'Europe/London' });
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

test('the landing card runs under the policy: its picture, the image (blob:) and Save image', async ({ context, page }) => {
  await liveWorld(context);
  const seen = await pagesHeaders(page);
  await page.goto(await linkTo(eastward(80)));
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 90_000 });
  const img = dialog.locator('img.card-img');
  expect(await img.getAttribute('src')).toMatch(/^blob:/);
  await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(1080);
  const [download] = await Promise.all([page.waitForEvent('download'), dialog.getByRole('button', { name: 'Save image' }).click()]);
  expect(download.suggestedFilename()).toMatch(/\.png$/);
  await page.waitForTimeout(1000);
  expect(seen).toEqual([]);
});

test.describe('in an in-app browser', () => {
  test.use({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [LinkedInApp]/9.29.8' });

  test('the full-screen card (a data: image) runs under the policy', async ({ context, page }) => {
    await liveWorld(context);
    const seen = await pagesHeaders(page);
    await page.goto(await linkTo(eastward(80)));
    const img = page.getByRole('dialog').locator('img.card-img');
    await expect(img).toBeVisible({ timeout: 90_000 });
    expect(await img.getAttribute('src')).toMatch(/^data:image\/png;base64,/);
    await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(1080);
    await page.waitForTimeout(1000);
    expect(seen).toEqual([]);
  });
});

test('the whole-trip replay runs under the policy too, and its still route view (reduced motion)', async ({ context, page }) => {
  await liveWorld(context);
  const seen = await pagesHeaders(page);
  await page.goto(await linkTo(eastward(30)));
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.view), { timeout: 30_000 }).toBe('flight');
  await page.getByRole('button', { name: 'Show me the whole trip' }).click();
  await expect(page.locator('.hud .over')).toHaveText('Forecast route, 72 hours in 20 seconds');
  await expect.poll(() => page.evaluate(() => (window as unknown as { __live: { trail: boolean } }).__live.trail), { timeout: 30_000 }).toBe(true);
  await page.waitForTimeout(6000);
  await page.getByRole('button', { name: 'Back to live' }).click();
  // the still route view writes an SVG with a style attribute
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload();
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.view), { timeout: 30_000 }).toBe('flight');
  await page.getByRole('button', { name: 'Show me the whole trip' }).click();
  await expect(page.locator('.replay-map svg')).toBeVisible();
  await page.waitForTimeout(3000);
  expect(seen).toEqual([]);
});
