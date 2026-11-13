import { expect, test, type Page } from '@playwright/test';
import { eastward, linkTo, liveWorld, startAtAlbertSquare, SWIFTSHADER } from './fixtures';

/**
 * Wind streaks (Task 25, owner's decision, 14 November 2026): none on the start screen or in the
 * launch, there at cruise in every view, none with reduced motion. On fixture winds, map and terrain
 * (e2e/fixtures.ts), with WebGL on SwiftShader.
 */
test.use(SWIFTSHADER);
test.describe.configure({ mode: 'default', timeout: 120_000 });

type Hook = { state: string; shot: string; aglM: number; streaks: number; calls: number };
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

test('streaks fade in at cruise and stay in Ride, Above and Side-on', async ({ context, page }) => {
  const { external } = await liveWorld(context);
  await page.goto(await linkTo(eastward(14)));
  await ready(page);
  await expect.poll(() => view(page), { timeout: 30_000 }).toBe('flight');
  expect((await hook(page))!.aglM).toBeGreaterThan(600);
  await expect.poll(async () => (await hook(page))!.streaks, { timeout: 30_000 }).toBeGreaterThan(0.9);
  for (const name of ['Ride', 'Above', 'Side-on']) {
    await page.getByRole('button', { name, exact: true }).click();
    await page.waitForTimeout(1500);
    expect((await hook(page))!.streaks, name).toBeGreaterThan(0.9);
  }
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
