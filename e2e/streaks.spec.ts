import { expect, test, type Page } from '@playwright/test';
import { eastward, linkTo, liveWorld, startAtAlbertSquare, SWIFTSHADER } from './fixtures';

/**
 * Wind streaks (Task 25, owner's decision, 14 November 2026): none on the start screen or in the
 * launch, there at cruise in every view, none with reduced motion. On fixture winds, map and terrain
 * (e2e/fixtures.ts), with WebGL on SwiftShader.
 */
test.use(SWIFTSHADER);
test.describe.configure({ mode: 'default', timeout: 120_000 });

type Hook = { state: string; shot: string; aglM: number; streaks: number; streaksOnScreen: number; replay: boolean; calls: number };
const hook = (page: Page) => page.evaluate(() => (window as unknown as { __live?: Hook }).__live ?? null);
const view = (page: Page) => page.evaluate(() => document.documentElement.dataset.view);

async function ready(page: Page) {
  await page.waitForFunction(() => document.getElementById('scene')?.dataset.live === '1', null, { timeout: 30_000 });
}

test('no streaks on the start screen or in the launch', async ({ context, page }) => {
  const { external } = await liveWorld(context);
  await startAtAlbertSquare(context);
  await page.goto('/');
  await ready(page);
  await page.waitForTimeout(3000);
  expect((await hook(page))!.streaks).toBe(0);
  await page.getByRole('button', { name: 'Let go', exact: true }).click();
  // through the hold, the release and the crane shot's climb
  const t0 = Date.now();
  while (Date.now() - t0 < 12_000) {
    const h = (await hook(page))!;
    expect(h.shot).toBe('launch');
    expect(h.streaks, `at ${h.aglM.toFixed(0)} m in the ${h.state}`).toBe(0);
    await page.waitForTimeout(500);
  }
  expect(external).toEqual([]);
});

async function cruise(page: Page) {
  await page.goto(await linkTo(eastward(14)));
  await ready(page);
  await expect.poll(() => view(page), { timeout: 30_000 }).toBe('flight');
  expect((await hook(page))!.aglM).toBeGreaterThan(600);
  await expect.poll(async () => (await hook(page))!.streaks, { timeout: 30_000 }).toBeGreaterThan(0.9);
}

/** Over `ms`, every sample of the hook passes `check`. */
async function throughout(page: Page, ms: number, check: (h: Hook) => void) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    check((await hook(page))!);
    await page.waitForTimeout(400);
  }
}

test('streaks fade in at cruise and stay on screen in Ride, Above and Side-on, and while paused', async ({ context, page }) => {
  const { external } = await liveWorld(context);
  await cruise(page);
  for (const name of ['Ride', 'Above', 'Side-on']) {
    await page.getByRole('button', { name, exact: true }).click();
    await page.waitForTimeout(1500);
    const h = (await hook(page))!;
    console.log(`${name}: opacity ${h.streaks.toFixed(2)}, ${h.streaksOnScreen} on screen`);
    expect(h.streaks, name).toBeGreaterThan(0.9);
    // drawn where the camera looks, whatever the view
    expect(h.streaksOnScreen, name).toBeGreaterThan(100);
  }
  // Pause holds them still but keeps them (spec 7.3; the hold itself is a unit test)
  await page.getByRole('button', { name: 'Pause' }).click();
  await throughout(page, 3000, (h) => expect(h.streaks).toBeGreaterThan(0.9));
  expect(external).toEqual([]);
});

test('none while the whole-trip replay plays; back to live they fade in again', async ({ context, page }) => {
  const { external } = await liveWorld(context);
  await cruise(page);
  await page.getByRole('button', { name: 'Show me the whole trip' }).click();
  await expect.poll(async () => (await hook(page))!.replay, { timeout: 10_000 }).toBe(true);
  await throughout(page, 6000, (h) => {
    if (!h.replay) return; // it may end on a fast machine
    expect(h.streaks).toBe(0);
    expect(h.streaksOnScreen).toBe(0);
  });
  await page.getByRole('button', { name: 'Back to live' }).first().click();
  await expect.poll(async () => (await hook(page))!.replay, { timeout: 10_000 }).toBe(false);
  await expect.poll(async () => (await hook(page))!.streaks, { timeout: 30_000 }).toBeGreaterThan(0.5);
  expect(external).toEqual([]);
});

test('back to the start screen from cruise ("Let go of your own"): the streaks go at once', async ({ context, page }) => {
  const { external } = await liveWorld(context);
  await cruise(page);
  await page.getByRole('button', { name: 'Let go of your own' }).click();
  await expect(page.getByRole('button', { name: 'Let go', exact: true })).toBeVisible();
  await throughout(page, 4000, (h) => {
    expect(h.streaks).toBe(0);
    expect(h.streaksOnScreen).toBe(0);
  });
  expect(external).toEqual([]);
});

test('reduced motion: no streaks at cruise', async ({ context, page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const { external } = await liveWorld(context);
  await page.goto(await linkTo(eastward(14)));
  await ready(page);
  await expect.poll(() => view(page), { timeout: 30_000 }).toBe('flight');
  await page.waitForTimeout(5000);
  const h = (await hook(page))!;
  expect(h.aglM).toBeGreaterThan(600);
  expect(h.streaks).toBe(0);
  expect(external).toEqual([]);
});
