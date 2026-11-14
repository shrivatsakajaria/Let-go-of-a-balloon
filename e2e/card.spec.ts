import { expect, test, type Page } from '@playwright/test';
import { eastward, linkTo, liveWorld, SWIFTSHADER } from './fixtures';

/**
 * The landing card (spec 6.5) in the real app, on fixture winds, map and terrain (e2e/fixtures.ts),
 * with WebGL on SwiftShader. The card's own 3D frame is rendered from the live scene; the test hook
 * `window.__card` says when it is open and how its headline was set.
 */
test.use(SWIFTSHADER);
test.describe.configure({ mode: 'default', timeout: 360_000 });

type CardHook = { renders: number; startedAt: number; state: string; sentence: string; kicker: string; when: string; shareText: string; names: { text: string; box: number[]; size: number }[]; reveal: string; revealed: boolean; frame: string; bytes: number; inApp: boolean };
const card = (page: Page) => page.evaluate(() => (window as unknown as { __card?: CardHook }).__card ?? null);
/** The card is open and in: its reveal (if it plays one) has ended and its buttons are up. */
const opened = async (page: Page, timeout = 120_000) => {
  await expect.poll(async () => (await card(page))?.state, { timeout }).toBe('open');
  await expect.poll(async () => (await card(page))?.revealed, { timeout: 60_000 }).toBe(true);
  return (await card(page))!;
};

test('a link opened after 72 hours opens on the card (design A) with its reveal: a 1080x1350 postcard, "Landed", the two names placed inside it', async ({ context, page }) => {
  const { external } = await liveWorld(context);
  await page.goto(await linkTo(eastward(80)));
  const c = await opened(page);
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  expect(c.frame).toBe('scene');
  expect(c.kicker).toMatch(/^(Landed|Came down at sea)$/);
  expect(c.when).toMatch(/^\w{3} \d{1,2} \w{3}, \d\d:\d\d$/);
  await expect(dialog).toHaveAccessibleName(c.sentence);
  // the trip's end: the reveal plays in the card's frame, then the still and its buttons
  await expect.poll(async () => (await card(page))!.revealed, { timeout: 60_000 }).toBe(true);
  // (test pages give the reveal's tiles 30 s: a software renderer on a busy machine is slow)
  expect((await card(page))!.reveal).toBe('played');
  await expect(dialog.locator('canvas.card-reveal')).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Save image' })).toBeVisible();
  const img = dialog.locator('img.card-img');
  await expect(img).toBeVisible();
  await expect.poll(() => img.evaluate((i: HTMLImageElement) => [i.naturalWidth, i.naturalHeight])).toEqual([1080, 1350]);
  expect(await img.getAttribute('alt')).toMatch(new RegExp(`^${c.sentence}, .+\\. Manchester to `));
  // the two big names, each inside the picture and its margins, at 72 px or more
  expect(c.names.map((n) => n.text)[0]).toBe('Manchester');
  for (const n of c.names) {
    expect(n.size).toBeGreaterThanOrEqual(72);
    expect(n.box[0]).toBeGreaterThanOrEqual(40);
    expect(n.box[2]).toBeLessThanOrEqual(1040);
    expect(n.box[3]).toBeLessThan(1000);
  }
  // Close returns to the landed balloon, and "Show the card" brings it back
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toHaveCount(0);
  // the card opened by itself: focus comes back to its way back, not to the top of the page (2.4.3)
  const again = page.getByRole('button', { name: 'Show the card' });
  await expect(again).toBeFocused();
  await expect(again).toBeVisible();
  // made once per landed route: it reopens at once, without a new render
  await again.click();
  await expect(page.getByRole('dialog')).toBeVisible({ timeout: 2000 });
  expect((await card(page))!.renders).toBe(1);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(again).toBeFocused();
  expect(external).toEqual([]);
});

test('a reveal whose world is not ready in time gives way to the cross-fade: the finished card, never holes', async ({ context, page }) => {
  await liveWorld(context);
  // no time at all for the reveal's own tiles once the card's are in
  await context.addInitScript(() => ((window as unknown as { __lgoabRevealWaitMs: number }).__lgoabRevealWaitMs = 0));
  await page.goto(await linkTo(eastward(80)));
  const c = await opened(page);
  expect(c.reveal).toBe('faded');
  const dialog = page.getByRole('dialog');
  await expect(dialog.locator('canvas.card-reveal')).toHaveCount(0);
  await expect(dialog.locator('img.card-img')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Save image' })).toBeVisible();
});

test('with reduced motion there is no reveal: the card cross-fades in', async ({ context, page }) => {
  await liveWorld(context);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(await linkTo(eastward(80)));
  const c = await opened(page);
  expect(c.reveal).toBe('faded');
  await expect(page.getByRole('dialog').locator('canvas.card-reveal')).toHaveCount(0);
});

test('the card shows when a balloon comes down while it is being watched', async ({ context, page }) => {
  await liveWorld(context);
  // released 72 hours ago, less 75 seconds: the flight view must be up well before it lands, even on
  // the software renderer on a busy machine (it can take 20-30 s to open)
  // (a link keeps the release time to the minute, so the landing is put on a whole minute too)
  const b = eastward(72);
  const landsAt = Math.ceil((Date.now() + 75_000) / 60_000) * 60_000;
  b.release = landsAt - 72 * 3600e3;
  await page.goto(await linkTo(b));
  await page.waitForFunction(() => document.documentElement.dataset.view === 'flight', null, { timeout: 60_000 });
  // still in the air: no card yet
  expect(Date.now()).toBeLessThan(landsAt - 2000);
  expect((await card(page))?.state ?? 'idle').toBe('idle');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  // and no way to a card that is not there yet
  await expect(page.getByRole('button', { name: 'Show the card' })).toBeHidden();
  // the landing is up to 135 s off, and a long route's card world takes up to 20 s more to draw
  const c = await opened(page, 260_000);
  // made a moment after touchdown, not on it
  expect(c.startedAt).toBeGreaterThanOrEqual(landsAt + 1400);
  expect(c.kicker).toMatch(/^(Landed|Came down at sea)$/);
});

test('"Show the card" while the card is still being made waits for that one: one card world, one render', async ({ context, page }) => {
  await liveWorld(context);
  await page.goto(await linkTo(eastward(80)));
  await expect.poll(async () => (await card(page))?.state, { timeout: 60_000 }).toBe('waiting');
  await page.getByRole('button', { name: 'Show the card' }).click();
  const c = await opened(page);
  expect(c.renders).toBe(1);
  await expect(page.getByRole('dialog')).toHaveCount(1);
});

test('leaving while the card is being made stops it: it never opens over the start screen', async ({ context, page }) => {
  await liveWorld(context);
  // the card world's region map tiles (z5 to z7) come slowly, so it is still being made when the visitor leaves
  await context.route(/^https:\/\/tiles\.openfreemap\.org\/fixture\/[567]\//, async (route) => {
    await new Promise((r) => setTimeout(r, 15_000));
    await route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*' }, body: '' }).catch(() => {});
  });
  await page.goto(await linkTo(eastward(80)));
  await expect.poll(async () => (await card(page))?.state, { timeout: 60_000 }).toBe('waiting');
  await page.getByRole('button', { name: 'Let go of your own' }).click();
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.view), { timeout: 10_000 }).toBe('start');
  // the card world gives up within a step (well inside its 20 s), and nothing opens
  await expect.poll(async () => (await card(page))?.state, { timeout: 15_000 }).toBe('idle');
  await page.waitForTimeout(3000);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect((await card(page))!.renders).toBe(0);
});

test('share falls back to download when canShare is false: Save image is the main action and downloads the PNG', async ({ context, page }) => {
  await liveWorld(context);
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'canShare', { value: () => false, configurable: true });
  });
  await page.goto(await linkTo(eastward(80)));
  await opened(page);
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'Share card' })).toBeHidden();
  const save = dialog.getByRole('button', { name: 'Save image' });
  await expect(save).toHaveClass(/main-action/);
  await expect(save).toBeFocused();
  const [download] = await Promise.all([page.waitForEvent('download'), save.click()]);
  expect(download.suggestedFilename()).toMatch(/^balloon-manchester-to-[a-z0-9-]+\.png$/);
});

test('Share card hands the system share sheet the image, the text and the link', async ({ context, page }) => {
  await liveWorld(context);
  await context.addInitScript(() => {
    const w = window as unknown as { __shared?: unknown };
    Object.defineProperty(navigator, 'canShare', { value: (d?: ShareData) => !!d?.files?.length, configurable: true });
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async (d: ShareData) => {
        w.__shared = { text: d.text, url: d.url, files: (d.files ?? []).map((f) => ({ name: f.name, type: f.type, size: f.size })) };
      },
    });
  });
  await page.goto(await linkTo(eastward(80)));
  const c = await opened(page);
  await page.getByRole('dialog').getByRole('button', { name: 'Share card' }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __shared?: unknown }).__shared ?? null)).not.toBeNull();
  const shared = (await page.evaluate(() => (window as unknown as { __shared: { text: string; url: string; files: { name: string; type: string; size: number }[] } }).__shared))!;
  // someone else's balloon (opened from a link, not in "Your balloons")
  expect(shared.text).toBe(c.shareText);
  expect(shared.text).toMatch(/^A balloon from Manchester (landed near|landed in|came down in) .+\.$/);
  expect(shared.url).toMatch(/^http:\/\/localhost:\d+\/#b=/);
  expect(shared.files).toEqual([{ name: expect.stringMatching(/^balloon-manchester-to-.+\.png$/), type: 'image/png', size: c.bytes }]);
});

test('Copy link copies this balloon\'s link and says "Link copied"', async ({ context, page }) => {
  await liveWorld(context);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const link = await linkTo(eastward(80));
  await page.goto(link);
  await opened(page);
  const copy = page.getByRole('dialog').getByRole('button', { name: 'Copy link' });
  await copy.click();
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Link copied' })).toBeVisible();
  // and said in the polite status region too
  await expect(page.getByRole('dialog').getByRole('status')).toHaveText('Link copied');
  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text).toMatch(/^http:\/\/localhost:\d+\/#b=/);
});

test('when the link cannot be copied it says so and shows the link to copy by hand', async ({ context, page }) => {
  await liveWorld(context);
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.reject(new Error('denied')) } });
    document.execCommand = () => false;
  });
  await page.goto(await linkTo(eastward(80)));
  await opened(page);
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Copy link' }).click();
  await expect(dialog.getByText("Couldn't copy the link. Select it below to copy it.")).toBeVisible();
  const field = dialog.getByRole('textbox', { name: 'Link to this balloon' });
  await expect(field).toHaveValue(/^http:\/\/localhost:\d+\/#b=/);
  await expect(dialog.getByRole('button', { name: 'Link copied' })).toHaveCount(0);
});

test.describe('in an in-app browser', () => {
  test.use({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [LinkedInApp]/9.29.8' });

  test('in the LinkedIn or X in-app browser the card opens full screen with "Press and hold to save" and "Open in your browser"', async ({ context, page }) => {
    await liveWorld(context);
    await page.goto(await linkTo(eastward(80)));
    const c = await opened(page);
    expect(c.inApp).toBe(true);
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Press and hold to save')).toBeVisible();
    const open = dialog.getByRole('link', { name: 'Open in your browser' });
    await expect(open).toHaveAttribute('href', /^x-safari-https:\/\/localhost:\d+\/#b=/);
    await expect(dialog.getByRole('button', { name: 'Share card' })).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Save image' })).toHaveCount(0);
    // a plain image the phone can save: a data URL, as wide as the screen allows
    const img = dialog.locator('img.card-img');
    expect(await img.getAttribute('src')).toMatch(/^data:image\/png;base64,/);
    const box = (await img.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(390 - 2 * 16 - 1);
  });
});
