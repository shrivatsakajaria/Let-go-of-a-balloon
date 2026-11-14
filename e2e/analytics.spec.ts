import { expect, test, type Page } from '@playwright/test';
import { offline } from './net';

/**
 * The anonymous counts (spec 16) leave only from the live site. The build is served here under other
 * names too (a preview's address, and the live address itself as a control that the check can see a
 * count go), with every request to /api/e recorded and answered 204, never passed on.
 */
const PREVIEW = 'https://3f2a9c1b.let-go-of-a-balloon.pages.dev';
const LIVE = 'https://let-go-of-a-balloon.pages.dev';

async function serveAs(page: Page, origin: string, local: string) {
  const counted: string[] = [];
  // every request for /api/e, from whichever address, is recorded
  page.on('request', (r) => {
    if (new URL(r.url()).pathname === '/api/e') counted.push(r.postData() ?? '');
  });
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/e') return route.fulfill({ status: 204 });
    if (url.origin !== origin) return route.fallback();
    const response = await route.fetch({ url: local + url.pathname + url.search });
    return route.fulfill({ response });
  });
  return counted;
}

/** As a visitor's own browser: not driven by a script, so only the address decides. */
const asVisitor = (page: Page) => page.addInitScript(() => Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false }));

async function visit(page: Page, at: string) {
  await page.goto(at + '/');
  await expect(page.getByRole('button', { name: 'Let go', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Let go', exact: true }).click();
  // the page goes away (pagehide: the visit's length would go now)
  await page.goto('about:blank');
}

test('the browser tests send nothing (localhost)', async ({ page, baseURL }) => {
  await offline(page);
  const counted = await serveAs(page, LIVE, baseURL!);
  await asVisitor(page);
  await visit(page, baseURL!);
  await page.waitForTimeout(500);
  expect(counted).toEqual([]);
});

test('a preview address sends nothing', async ({ page, baseURL }) => {
  await offline(page);
  const counted = await serveAs(page, PREVIEW, baseURL!);
  await asVisitor(page);
  await visit(page, PREVIEW);
  await page.waitForTimeout(500);
  expect(counted).toEqual([]);
});

test('the live address counts (the control), and sends nothing with Global Privacy Control on', async ({ page, baseURL }) => {
  await offline(page);
  const counted = await serveAs(page, LIVE, baseURL!);
  await asVisitor(page);
  await visit(page, LIVE);
  await expect.poll(() => counted).toEqual(expect.arrayContaining(['{"e":"start_view"}', '{"e":"let_go","source":"featured","city":"london"}']));
  // London's start is 51.5007, -0.1263: never a coordinate or the place as shown
  for (const body of counted) expect(body).not.toMatch(/51\.5|0\.12|London|"lat"|"lon"/);

  counted.length = 0;
  await page.addInitScript(() => Object.defineProperty(Navigator.prototype, 'globalPrivacyControl', { get: () => true }));
  await visit(page, LIVE);
  await page.waitForTimeout(500);
  expect(counted).toEqual([]);
});
