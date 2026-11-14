import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { encodeBalloon, type SavedBalloon } from '../src/flight/codec';
import { destination, type LatLon } from '../src/geo/coords';
import { sunPosition } from '../src/geo/sun';
import { SWIFTSHADER } from './fixtures';

/**
 * The hand-back pictures for docs/for-sk/handback.md: 1080 x 1920 phone screenshots (a 360 x 640 screen
 * at 3x, as a phone takes them; the 3D world itself is drawn at the site's 1.5x pixel cap, as on a phone).
 * Winds are the committed fixture run; the map and terrain are the real ones, because the fixture map only
 * covers Albert Square and London has to look like London. So it needs the network and only runs when asked:
 *
 *   HANDBACK_SHOTS=docs/for-sk/img CI=1 E2E_PORT=5190 npx playwright test e2e/handback-shots.spec.ts --workers=1 --trace off
 *
 * Each scene is saved at a few moments or views; pick the best by eye and copy it to docs/for-sk/img/
 * (london-launch.png is london-climb-film, moors-ride.png is moors-ride-c). On a busy software renderer the
 * launch-moment pictures (london-launch-a/b) can take minutes each and may time out; the link-opened scenes
 * are the dependable ones.
 */
const OUT = process.env.HANDBACK_SHOTS ?? '';
test.skip(!OUT, 'needs the live map: HANDBACK_SHOTS=<folder>');
test.use({ ...SWIFTSHADER, viewport: { width: 360, height: 640 }, deviceScaleFactor: 3 });
test.describe.configure({ mode: 'default', timeout: 600_000 });

const WIND = new URL('../tests/fixtures/wind/real/', import.meta.url);
const LONDON: LatLon = { lat: 51.5007, lon: -0.1263 }; // Parliament Square, the first balloon's start
const ALBERT_SQUARE: LatLon = { lat: 53.47945, lon: -2.2455 };

/** The fixture winds (fresh as of `now`), the real map and terrain, nothing else outside. */
async function realWorld(context: BrowserContext, now: number) {
  await context.addInitScript(() => ((window as unknown as { __lgoabTest: boolean }).__lgoabTest = true));
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    if (local && url.pathname.startsWith('/winds/')) {
      if (url.pathname === '/winds/manifest.json') {
        const m = JSON.parse(readFileSync(new URL('manifest.json', WIND), 'utf8'));
        m.runs[0].issued = new Date(now - 5 * 3600e3).toISOString();
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(m) });
      }
      const cruise = url.pathname.match(/^\/winds\/cruise\/(\d+)\/(-?\d+)_(-?\d+)_\d+\.bin\.gz$/);
      if (cruise) {
        const f = new URL(`cruise/${cruise[1]}/${cruise[2]}_${cruise[3]}_0.bin.gz`, WIND);
        if (existsSync(f)) return route.fulfill({ status: 200, contentType: 'application/octet-stream', body: readFileSync(f) });
      }
      return route.fulfill({ status: 404, body: 'not found' });
    }
    if (local || ['tiles.openfreemap.org', 'download.mapterhorn.com', 'tiles.mapterhorn.com', 's3.amazonaws.com'].includes(url.hostname)) return route.continue();
    return route.abort('blockedbyclient');
  });
}

/** The afternoon of 13 November 2026 at `p`: the last moment the sun is still `deg` degrees up (golden hour for a few degrees). */
function goldenHour(p: LatLon, deg: number): number {
  const day = Date.UTC(2026, 10, 13) - (p.lon / 15) * 3600e3;
  let best = day + 14 * 3600e3;
  for (let t = day + 12 * 3600e3; t < day + 20 * 3600e3; t += 60e3) {
    if (sunPosition(t, p).elevationDeg < deg) break;
    best = t;
  }
  return best;
}

const live = (page: Page) => page.waitForFunction(() => document.getElementById('scene')?.dataset.live === '1', null, { timeout: 180_000 });
const shot = (page: Page, name: string) => page.screenshot({ path: `${OUT}/${name}.png`, timeout: 300_000 }); // a busy software renderer can take minutes at 3x

test.beforeAll(() => {
  if (OUT) mkdirSync(OUT, { recursive: true });
});

test('London: the launch at golden hour, Big Ben behind the person', async ({ context, page }) => {
  const now = goldenHour(LONDON, 5);
  await page.clock.setSystemTime(now);
  await realWorld(context, now);
  const place = JSON.stringify({ name: 'London', lat: LONDON.lat, lon: LONDON.lon, kind: 'featured', cityId: 'london' });
  await context.addInitScript((c) => localStorage.setItem('lgoab.lastPlace.v1', c), place);
  await page.goto('/');
  await live(page);
  await page.waitForTimeout(25_000); // the streets, the terrain and Big Ben come in
  await shot(page, 'london-start');
  await page.getByRole('button', { name: 'Let go', exact: true }).click();
  // the hand opens and the balloon rises past the roofs: a few moments, to choose from
  for (const [i, wait] of [4_000, 6_000].entries()) {
    await page.waitForTimeout(wait);
    await shot(page, `london-launch-${'ab'[i]}`);
  }
});

test('London: the climb past Big Ben at golden hour, from a link released a minute before', async ({ context, page }) => {
  const now = goldenHour(LONDON, 5);
  await page.clock.setSystemTime(now);
  await realWorld(context, now);
  // east-north-east, over Big Ben (120 m east of the start) and on down the Thames
  const hourly = Array.from({ length: 73 }, (_, i) => destination(LONDON, 75, i * 15));
  // (the page's clock runs on from `now` while the world loads, so the balloon is a little higher by then)
  const b: SavedBalloon = { v: 1, name: 'London', start: { ...LONDON }, release: now - 40e3, hourly, runId: '2026111218' };
  await page.goto(`/#b=${await encodeBalloon(b)}`);
  await live(page);
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.view), { timeout: 180_000 }).toBe('flight');
  await page.waitForTimeout(20_000); // the streets and Big Ben come in
  for (const v of ['film', 'side', 'ride']) {
    await page.locator(`.view[data-view="${v}"]`).click();
    await page.waitForTimeout(6_000);
    await shot(page, `london-climb-${v}`);
  }
});

test('Manchester: the Ride view over the Pennine moors', async ({ context, page }) => {
  const now = goldenHour(ALBERT_SQUARE, 14); // early afternoon: the moors in clear light
  await page.clock.setSystemTime(now);
  await realWorld(context, now);
  // from Albert Square, east-north-east at 18 km/h: 90 minutes in it is near Black Hill and Holme Moss, cruising at about 1.5 km
  const hourly = Array.from({ length: 73 }, (_, i) => destination(ALBERT_SQUARE, 70, i * 18));
  const b: SavedBalloon = { v: 1, name: 'Manchester', start: { ...ALBERT_SQUARE }, release: now - 90 * 60e3, hourly, runId: '2026111218' };
  await page.goto(`/#b=${await encodeBalloon(b)}`);
  await live(page);
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.view), { timeout: 180_000 }).toBe('flight');
  await page.getByRole('button', { name: 'Ride' }).click();
  for (const [i, wait] of [20_000, 6_000, 6_000].entries()) {
    await page.waitForTimeout(wait);
    await shot(page, `moors-ride-${'abc'[i]}`);
  }
});
