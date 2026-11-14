import { readFileSync } from 'node:fs';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { eastward, linkTo, liveWorld, startAtAlbertSquare, SWIFTSHADER } from './fixtures';
import { offline } from './net';
import { SHADE_FAINT } from '../src/fallback/map2d';

/**
 * The 2D fallback (spec 6.7: no WebGL, or a phone that keeps losing it) and the credits (the plan's
 * Global Constraints). Fixture winds, terrain and map as in live.spec.ts; the coastline's z5 tile over
 * Britain is the committed one, every other z5 tile is empty (land).
 */
// WebGL on the software renderer for the context-loss check; the others take WebGL away entirely
test.use(SWIFTSHADER);
test.describe.configure({ mode: 'default', timeout: 90_000 });

// owner's decision, 14 November 2026 (panel review): said neutrally, not "your phone can't"
const NOTE = 'Showing the map view on this device.';
const Z5 = readFileSync(new URL('../tests/fixtures/omt_5_15_10.pbf', import.meta.url));
const view = (page: Page) => page.evaluate(() => document.documentElement.dataset.view);

/** A browser with no WebGL at all. */
async function noWebGL(context: BrowserContext) {
  await context.addInitScript(() => {
    const get = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, id: string, ...rest: unknown[]) {
      return /webgl/.test(id) ? null : (get as (...a: unknown[]) => unknown).call(this, id, ...rest);
    } as typeof get;
  });
}

/** The coastline tiles (registered after liveWorld, so it answers first). */
async function coast(context: BrowserContext) {
  const asked: string[] = [];
  await context.route(/^https:\/\/tiles\.openfreemap\.org\/fixture\/[0-5]\//, (route) => {
    const path = new URL(route.request().url()).pathname;
    asked.push(path);
    const headers = { 'Access-Control-Allow-Origin': '*' };
    if (path === '/fixture/5/15/10.pbf') return route.fulfill({ status: 200, contentType: 'application/x-protobuf', headers, body: Z5 });
    return route.fulfill({ status: 204, headers, body: '' });
  });
  return asked;
}

/** How many pixels of the route canvas are the balloon's orange. */
const orangePixels = (page: Page) =>
  page.locator('.map2d-route').evaluate((c) => {
    const cv = c as HTMLCanvasElement;
    const d = cv.getContext('2d')!.getImageData(0, 0, cv.width, cv.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] > 230 && d[i + 1] > 70 && d[i + 1] < 110 && d[i + 2] < 50 && d[i + 3] > 200) n++;
    return n;
  });

/** Where the balloon is drawn (the middle of its orange pixels), in CSS px. */
const balloonAt = (page: Page) =>
  page.locator('.map2d-route').evaluate((c) => {
    const cv = c as HTMLCanvasElement;
    const k = cv.width / cv.clientWidth;
    const d = cv.getContext('2d')!.getImageData(0, 0, cv.width, cv.height).data;
    let n = 0, sx = 0, sy = 0;
    for (let i = 0; i < d.length; i += 4)
      if (d[i] > 230 && d[i + 1] > 70 && d[i + 1] < 110 && d[i + 2] < 50 && d[i + 3] > 200) {
        n++;
        sx += (i / 4) % cv.width;
        sy += Math.floor(i / 4 / cv.width);
      }
    return n ? { x: sx / n / k, y: sy / n / k } : null;
  });

for (const size of [{ width: 390, height: 844 }, { width: 844, height: 390 }, { width: 667, height: 375 }]) {
  test(`at ${size.width}x${size.height} the balloon is drawn clear of the text and the dark shading`, async ({ context, page }) => {
    await page.setViewportSize(size);
    await liveWorld(context);
    await coast(context);
    await noWebGL(context);
    await page.goto(await linkTo(eastward(30)));
    await expect.poll(() => view(page), { timeout: 15_000 }).toBe('flight');
    await page.waitForTimeout(800); // the HUD has come in and the map is laid out round it
    await expect.poll(() => balloonAt(page)).not.toBeNull();
    const b = (await balloonAt(page))!;
    const box = async (sel: string) => (await page.locator(sel).boundingBox())!;
    const shadeTop = await box('.shade-top');
    const shadeBottom = await box('.hud-shade');
    const stack = await box('.hud-bottom');
    const top = await box('.hud-top');
    // below the dark part of the top shading and the clock
    expect(b.y).toBeGreaterThan(Math.max(top.y + top.height, shadeTop.y + shadeTop.height - 30));
    // and not under the dark part of the bottom shading (below its faint top: SHADE_FAINT) or the stack
    const underBottom = b.y > shadeBottom.y + SHADE_FAINT * shadeBottom.height && b.x < shadeBottom.x + shadeBottom.width - 30;
    expect(underBottom).toBe(false);
    expect(b.y < stack.y || b.x > stack.x + stack.width).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`fallback-${size.width}x${size.height}.png`) });
  });
}

test('at 640x360 the HUD fits without scrolling: the credit runs as wide as the column, its links 24 px, the fact clear of "Over ..."', async ({ context, page }) => {
  await page.setViewportSize({ width: 640, height: 360 });
  await liveWorld(context);
  await coast(context);
  await noWebGL(context);
  await page.goto(await linkTo(eastward(30)));
  await expect.poll(() => view(page), { timeout: 15_000 }).toBe('flight');
  await page.waitForTimeout(800);
  const m = await page.evaluate(() => {
    const hud = document.getElementById('hud')!;
    const box = (s: string) => hud.querySelector(s)!.getBoundingClientRect();
    return {
      scroll: hud.scrollHeight - hud.clientHeight,
      links: [...hud.querySelectorAll('.map-credit a')].map((a) => a.getBoundingClientRect().height),
      gap: box('.fact').top - box('.over').bottom,
    };
  });
  expect(m.scroll).toBeLessThanOrEqual(0);
  expect(m.links).toHaveLength(3);
  for (const h of m.links) expect(h).toBeGreaterThanOrEqual(24);
  expect(m.gap).toBeGreaterThanOrEqual(4);
});

test.describe('without WebGL', () => {
  test('Let go draws the route on a 2D map with the coastline, under the live HUD and facts', async ({ context, page }) => {
    const { external } = await liveWorld(context);
    const tiles = await coast(context);
    await noWebGL(context);
    await startAtAlbertSquare(context);
    await page.goto('/');
    await page.getByRole('button', { name: 'Let go', exact: true }).click();
    await expect.poll(() => view(page), { timeout: 15_000 }).toBe('flight');

    // the map, not the winds error and not a 3D canvas
    await expect(page.getByText(NOTE)).toBeVisible();
    await expect(page.getByText("We can’t get today’s winds right now. Try again in a few minutes.")).toHaveCount(0);
    await expect(page.locator('canvas.world')).toHaveCount(0);
    const map = page.locator('.map2d');
    await expect(map).toBeVisible();
    await expect(map).toHaveAttribute('role', 'img');
    // the coastline from the z5 vector tiles, and the route with the balloon on it
    await expect(map).toHaveAttribute('data-coast', /^[1-9]\d*$/, { timeout: 15_000 });
    expect(tiles).toContain('/fixture/5/15/10.pbf');
    expect(tiles.every((t) => /^\/fixture\/[2-5]\//.test(t))).toBe(true);
    await expect.poll(() => orangePixels(page)).toBeGreaterThan(40);

    // the same HUD and facts as the 3D flight; no camera views
    await expect(page.locator('.hud .clock')).toHaveText(/\d\d:\d\d/);
    await expect(page.locator('.hud .day')).toHaveText(/^Day 1 of 3 · \d+ min aloft$/);
    await expect(page.locator('.hud .fact')).not.toBeEmpty({ timeout: 20_000 });
    await expect(page.locator('.hud .over')).toHaveText(/^Over /, { timeout: 20_000 });
    await expect(page.locator('.hud .status')).toHaveText('Your balloon is on its way from Manchester', { timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Film' })).toHaveCount(0);
    await expect(page.locator('.hud .map-credit')).toBeInViewport();
    await expect(map).toHaveAttribute('aria-label', /^Your balloon is over .+, [\d.]+ km from Manchester$/, { timeout: 20_000 });

    // the link and "Your balloons", as in 3D
    await expect.poll(() => page.evaluate(() => location.hash), { timeout: 10_000 }).toMatch(/^#b=[A-Za-z0-9_-]+$/);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('lgoab.balloons.v1') ?? '[]').length)).toBe(1);

    // and back to the start
    await page.getByRole('button', { name: 'Let go of another' }).click();
    await expect(page.getByRole('button', { name: 'Let go', exact: true })).toBeVisible();
    await expect(map).toBeHidden();
    expect(new URL(page.url()).hash).toBe('');
    expect(external).toEqual([]);
  });

  test('a link opened after 72 hours shows the whole route, landed', async ({ context, page }) => {
    await liveWorld(context);
    await coast(context);
    await noWebGL(context);
    await page.goto(await linkTo(eastward(80)));
    await expect.poll(() => view(page), { timeout: 15_000 }).toBe('flight');
    await expect(page.locator('.hud .over')).toHaveText(/^(Landed near|Landed in|Came down in) /, { timeout: 20_000 });
    await expect(page.locator('.hud .day')).toHaveText('Landed · 72 h aloft');
    // the landing card opens over the map (its own test is below; the chrome steps back under it, and it can
    // be up before anything here looks); closed, the landed map is there with its note
    await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click({ timeout: 30_000 });
    await expect(page.getByText(NOTE)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Let go of your own' })).toBeVisible();
    await expect.poll(() => orangePixels(page)).toBeGreaterThan(40);
    // nothing left to put in a calendar
    await expect(page.getByRole('button', { name: 'Add to calendar' })).toBeHidden();
  });

  test('Add to calendar saves the landing as a text/calendar event with this balloon\'s own link (owner\'s decision, 14 November 2026)', async ({ context, page }) => {
    await liveWorld(context);
    await coast(context);
    await noWebGL(context);
    const b = eastward(14);
    await page.goto(await linkTo(b));
    await expect.poll(() => view(page), { timeout: 15_000 }).toBe('flight');
    const cal = page.getByRole('button', { name: 'Add to calendar' });
    await expect(cal).toBeVisible();
    const [dl] = await Promise.all([page.waitForEvent('download'), cal.click()]);
    expect(dl.suggestedFilename()).toBe('balloon-landing.ics');
    const ics = readFileSync((await dl.path())!, 'utf8');
    const lines = ics.replace(/\r\n /g, '').split('\r\n');
    const at = new Date(b.release + 72 * 3600e3);
    const stamp = at.toISOString().replace(/[-:]/g, '').slice(0, 13) + '00Z';
    expect(lines).toContain(`DTSTART:${stamp}`);
    expect(lines).toContain('TRIGGER:-PT15M');
    // someone else's balloon (opened from a link): "A balloon from Manchester lands"
    expect(lines).toContain('SUMMARY:A balloon from Manchester lands');
    const href = await page.evaluate(() => location.href);
    expect(href).toMatch(/#b=/);
    expect(lines).toContain(`URL:${href}`);
  });

  test('the winds error still says so plainly, with Try again', async ({ context, page }) => {
    await liveWorld(context, { windsDown: true });
    await noWebGL(context);
    await startAtAlbertSquare(context);
    await page.goto('/');
    await page.getByRole('button', { name: 'Let go', exact: true }).click();
    await expect(page.getByText("We can’t get today’s winds right now. Try again in a few minutes.")).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('button', { name: 'Let go', exact: true })).toBeVisible();
  });

  test('"Show the card" on the map while the card is being made shows that card (one render)', async ({ context, page }) => {
    await liveWorld(context);
    await coast(context);
    await noWebGL(context);
    // the coastline comes slowly, so the card's map picture is still being made when the visitor taps
    await context.route(/^https:\/\/tiles\.openfreemap\.org\/fixture\/[0-5]\//, async (route) => {
      await new Promise((r) => setTimeout(r, 4000));
      await route.fallback();
    });
    await page.goto(await linkTo(eastward(80)));
    await expect.poll(() => page.evaluate(() => (window as unknown as { __card?: { state: string } }).__card?.state), { timeout: 20_000 }).toBe('waiting');
    await page.getByRole('button', { name: 'Show the card' }).click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 20_000 });
    expect(await page.evaluate(() => (window as unknown as { __card: { renders: number; state: string } }).__card.renders)).toBe(1);
  });

  test('the landing card shows on the map: a 1080x1350 postcard with the map as its picture, and no 3D world loaded', async ({ context, page }) => {
    await liveWorld(context);
    await coast(context);
    await noWebGL(context);
    const scripts: string[] = [];
    page.on('request', (r) => {
      if (r.resourceType() === 'script') scripts.push(new URL(r.url()).pathname);
    });
    await page.goto(await linkTo(eastward(80)));
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 30_000 });
    const hook = await page.evaluate(() => (window as unknown as { __card: { state: string; kicker: string; frame: string; renders: number } }).__card);
    expect(hook.state).toBe('open');
    expect(hook.kicker).toMatch(/^(Landed near|Landed in|Came down in)$/);
    expect(hook.frame).toBe('scene'); // the map's picture, not the plain sketch
    const img = dialog.locator('img.card-img');
    await expect.poll(() => img.evaluate((i: HTMLImageElement) => [i.naturalWidth, i.naturalHeight])).toEqual([1080, 1350]);
    await expect(dialog.getByRole('button', { name: 'Copy link' })).toBeVisible();
    // the map's own HUD reopens it
    await dialog.getByRole('button', { name: 'Close' }).click();
    await page.getByRole('button', { name: 'Show the card' }).click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 10_000 });
    expect(await page.evaluate(() => (window as unknown as { __card: { renders: number } }).__card.renders)).toBe(1);
    // the 3D world (three.js) never came
    expect(scripts.some((p) => /\/(live|sky|three)[-.]/.test(p))).toBe(false);
  });
});

test('the About sheet lists every source and ends with "A Still Signal build"', async ({ page }) => {
  await offline(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'About' }).click();
  const footer = page.getByRole('dialog', { name: 'About' }).locator('footer');
  await expect(footer).toBeVisible();
  const text = (await footer.innerText()).replace(/\s+/g, ' ');
  for (const want of [
    'Map: OpenFreeMap © OpenMapTiles Data from OpenStreetMap',
    'Terrain: © Mapterhorn',
    '© DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved.',
    'Winds: NOAA GFS',
    'Place search: Open-Meteo.com (GeoNames, CC BY 4.0)',
    'Place names: GeoNames',
  ])
    expect(text).toContain(want);
  await expect(footer.locator('.sig')).toHaveText('A Still Signal build');
  // the map corner credit is the one line over the scene, linked
  await expect(page.locator('.start .map-credit')).toHaveText('© OpenStreetMap · OpenMapTiles · Mapterhorn');
});

test.describe('WebGL context loss', () => {
  test.describe.configure({ timeout: 150_000 });

  test('lost once, the 3D world comes back; lost twice, the flight carries on on the 2D map', async ({ context, page }) => {
    await liveWorld(context);
    await coast(context);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(await linkTo(eastward(14)));
    await page.waitForFunction(() => document.getElementById('scene')?.dataset.live === '1', null, { timeout: 30_000 });
    await expect.poll(() => view(page), { timeout: 30_000 }).toBe('flight');
    type H = { frames: number; contextLosses: number };
    const hook = () => page.evaluate(() => (window as unknown as { __live?: H }).__live ?? null);

    /** Take the 3D canvas's context away, as a phone under memory pressure does; give it back after 300 ms. */
    const lose = () =>
      page.evaluate(() => {
        const c = document.querySelector('canvas.world') as HTMLCanvasElement;
        const ext = c.getContext('webgl2')!.getExtension('WEBGL_lose_context')!;
        c.addEventListener('webglcontextlost', () => setTimeout(() => ext.restoreContext(), 300), { once: true });
        ext.loseContext();
      });

    // the first loss: the context comes back and the world is built again, on with the same flight
    const before = await page.locator('canvas.world').elementHandle();
    await lose();
    await expect.poll(() => before!.evaluate((c) => c.isConnected), { timeout: 15_000 }).toBe(false);
    await expect(page.locator('canvas.world')).toHaveCount(1);
    await page.waitForFunction(() => document.getElementById('scene')?.dataset.live === '1', null, { timeout: 30_000 });
    await expect.poll(async () => (await hook())?.contextLosses).toBe(1);
    await expect.poll(async () => (await hook())?.frames ?? 0, { timeout: 30_000 }).toBeGreaterThan(3);
    await expect(page.locator('canvas.world')).toBeVisible();
    await expect(page.locator('.map2d')).toHaveCount(0);
    expect(await view(page)).toBe('flight');
    await expect(page.locator('.hud .day')).toHaveText('Day 1 of 3 · 14 h aloft');
    expect(errors).toEqual([]);

    // the second: the 2D map takes over the same flight
    await lose();
    await expect(page.locator('.map2d')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('canvas.world')).toHaveCount(0);
    await expect(page.getByText(NOTE)).toBeVisible();
    expect(await view(page)).toBe('flight');
    await expect(page.locator('.hud .day')).toHaveText('Day 1 of 3 · 14 h aloft');
    await expect.poll(() => orangePixels(page)).toBeGreaterThan(40);
    expect(await page.evaluate(() => '__live' in window)).toBe(false);
    expect(errors).toEqual([]);
  });

  test('a lost context leaves the broken-link notice where it is', async ({ context, page }) => {
    await liveWorld(context);
    await page.goto('/#b=AWkBlv4BCk1hbmNoZXN0ZXIKMjAy');
    await page.waitForFunction(() => document.getElementById('scene')?.dataset.live === '1', null, { timeout: 30_000 });
    const notice = page.getByText('This balloon link is broken.');
    await expect(notice).toBeVisible();
    const lose = () =>
      page.evaluate(() => {
        const c = document.querySelector('canvas.world') as HTMLCanvasElement;
        const ext = c.getContext('webgl2')!.getExtension('WEBGL_lose_context')!;
        c.addEventListener('webglcontextlost', () => setTimeout(() => ext.restoreContext(), 300), { once: true });
        ext.loseContext();
      });
    // rebuilt once
    const before = await page.locator('canvas.world').elementHandle();
    await lose();
    await expect.poll(() => before!.evaluate((c) => c.isConnected), { timeout: 15_000 }).toBe(false);
    await page.waitForFunction(() => document.getElementById('scene')?.dataset.live === '1', null, { timeout: 30_000 });
    await expect(notice).toBeVisible();
    expect(await view(page)).toBe('broken');
    // then the map
    await lose();
    await expect(page.locator('.map2d')).toHaveCount(1, { timeout: 15_000 });
    await expect(notice).toBeVisible();
    expect(await view(page)).toBe('broken');
    await page.getByRole('button', { name: 'Let go of a new one' }).click();
    await expect(page.getByRole('button', { name: 'Let go', exact: true })).toBeVisible();
  });
});
