import { expect, test, type Page } from '@playwright/test';
import { eastward, linkTo, liveWorld, SWIFTSHADER } from './fixtures';

/**
 * The landing card (spec 6.5) in the real app, on fixture winds, map and terrain (e2e/fixtures.ts),
 * with WebGL on SwiftShader. The card's own 3D frame is rendered from the live scene; the test hook
 * `window.__card` says when it is open and how its headline was set.
 */
test.use(SWIFTSHADER);
test.describe.configure({ mode: 'default', timeout: 120_000 });

type CardHook = { state: string; sentence: string; kicker: string; shareText: string; headline: { size: number; lines: string[]; widths: number[] }; frame: string; bytes: number; inApp: boolean };
const card = (page: Page) => page.evaluate(() => (window as unknown as { __card?: CardHook }).__card ?? null);
const opened = async (page: Page) => {
  await expect.poll(async () => (await card(page))?.state, { timeout: 60_000 }).toBe('open');
  return (await card(page))!;
};

test('a link opened after 72 hours opens on the card: a 1080x1350 postcard of the landing, "Landed near", a headline that fits', async ({ context, page }) => {
  const { external } = await liveWorld(context);
  await page.goto(await linkTo(eastward(80)));
  const c = await opened(page);
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  expect(c.frame).toBe('scene');
  expect(c.kicker).toMatch(/^(Landed near|Landed in|Came down in)$/);
  await expect(dialog).toHaveAccessibleName(c.sentence);
  const img = dialog.locator('img.card-img');
  await expect.poll(() => img.evaluate((i: HTMLImageElement) => [i.naturalWidth, i.naturalHeight])).toEqual([1080, 1350]);
  expect(await img.getAttribute('alt')).toMatch(new RegExp(`^${c.sentence}\\. Manchester to `));
  // headline: at most two lines, every line inside the 72 px margins, at 88 to 120 px
  expect(c.headline.lines.length).toBeLessThanOrEqual(2);
  expect(c.headline.size).toBeGreaterThanOrEqual(88);
  expect(c.headline.size).toBeLessThanOrEqual(120);
  for (const w of c.headline.widths) expect(w).toBeLessThanOrEqual(1080 - 2 * 72 + 0.5);
  expect(c.headline.lines.join(' ')).toMatch(/^Manchester to /);
  // Close returns to the landed balloon, and "Show the card" brings it back
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toHaveCount(0);
  const again = page.getByRole('button', { name: 'Show the card' });
  await expect(again).toBeVisible();
  await again.click();
  await expect(page.getByRole('dialog')).toBeVisible({ timeout: 30_000 });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(again).toBeFocused();
  expect(external).toEqual([]);
});

test('the card shows when a balloon comes down while it is being watched', async ({ context, page }) => {
  await liveWorld(context);
  // released 72 hours ago, less 6 seconds
  const b = eastward(72);
  b.release = Date.now() - 72 * 3600e3 + 6000;
  await page.goto(await linkTo(b));
  await page.waitForFunction(() => document.documentElement.dataset.view === 'flight', null, { timeout: 30_000 });
  expect((await card(page))?.state ?? 'idle').toBe('idle');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const c = await opened(page);
  expect(c.kicker).toMatch(/^(Landed near|Landed in|Came down in)$/);
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
  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text).toMatch(/^http:\/\/localhost:\d+\/#b=/);
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
