import { expect, test, type Page } from '@playwright/test';
import { midnightTicks } from '../src/ui/hudmath';
import { routeFromHourly } from '../src/flight/route';
import { eastward, linkTo, liveWorld, startAtAlbertSquare, SWIFTSHADER } from './fixtures';

/**
 * The live flight in the real app (spec 6.2, 6.3, 6.6, 7.1-7.4, 8), on fixture winds, map and terrain
 * (e2e/fixtures.ts), with WebGL on SwiftShader.
 */
test.use(SWIFTSHADER);
// one at a time: the software renderer shares the machine's cores with the other spec files
test.describe.configure({ mode: 'default', timeout: 120_000 });

type Hook = { state: string; person: string | null; aglM: number; shot: string; camera: number[]; target: number[]; fact: string; over: string; frames: number; subjectPx: [number, number] | null };
const hook = (page: Page) => page.evaluate(() => (window as unknown as { __live?: Hook }).__live ?? null);
const opacity = (page: Page, sel: string) => page.locator(sel).first().evaluate((el) => Number(getComputedStyle(el).opacity));
const view = (page: Page) => page.evaluate(() => document.documentElement.dataset.view);

async function ready(page: Page) {
  await page.waitForFunction(() => document.getElementById('scene')?.dataset.live === '1', null, { timeout: 30_000 });
}

test('Let go from Albert Square: the chrome fades, the person lets go, the balloon climbs, the link and "Your balloons" are written, the HUD comes in at about 20 s', async ({ context, page }) => {
  const { external } = await liveWorld(context);
  await startAtAlbertSquare(context);
  await page.goto('/');
  await ready(page);
  expect((await hook(page))?.person).toBe('idle');
  await page.waitForTimeout(3000); // the winds and the ground under the start load while the visitor reads

  await page.getByRole('button', { name: 'Let go', exact: true }).click();
  const t0 = Date.now();
  // all chrome but the clock goes in 300 ms: a clean frame for recordings
  await page.waitForTimeout(600);
  expect(await opacity(page, '.start .bottom')).toBe(0);
  expect(await opacity(page, '.start .top')).toBe(0);
  expect(await opacity(page, '.hud-top .clock')).toBe(1);
  expect(await opacity(page, '.hud-bottom')).toBe(0);
  expect(await page.locator('.hud-top .clock').innerText()).toMatch(/\d\d:\d\d/);

  // the hand opens, the balloon rises past the roofs
  await expect.poll(async () => (await hook(page))?.person, { timeout: 15_000 }).toBe('released');
  const a = (await hook(page))!.aglM;
  await expect.poll(async () => (await hook(page))!.aglM, { timeout: 10_000 }).toBeGreaterThan(a + 1);
  expect(Date.now() - t0).toBeLessThan(20_000);
  await expect(page.locator('.hud .height')).toHaveText(/^\d+ m$/);

  // the link holds the balloon (in the fragment, never sent to a server), and it is saved
  await expect.poll(() => page.evaluate(() => location.hash), { timeout: 10_000 }).toMatch(/^#b=[A-Za-z0-9_-]+$/);
  expect(page.url()).toMatch(/\/#b=/);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('lgoab.balloons.v1') ?? '[]'));
  expect(saved).toHaveLength(1);
  expect(saved[0].name).toBe('Manchester');
  // the launch is announced in the polite status region
  await expect(page.locator('.hud .status')).toHaveText('Your balloon is on its way from Manchester', { timeout: 15_000 });

  // at 20 s Ride settles and the HUD comes in over 600 ms
  await expect.poll(() => view(page), { timeout: 60_000, intervals: [250] }).toBe('flight');
  expect(Date.now() - t0).toBeGreaterThan(19_500);
  await page.waitForTimeout(800);
  expect(await opacity(page, '.hud-bottom')).toBe(1);
  expect((await hook(page))!.shot).toBe('ride');
  await expect(page.locator('.hud .day')).toHaveText(/^Day 1 of 3 · \d+ min aloft$/);
  await expect(page.getByRole('button', { name: 'Film' })).toHaveAttribute('aria-pressed', 'true');
  // "Show me the whole trip" waits for Task 18: no dead button on screen
  await expect(page.getByRole('button', { name: 'Show me the whole trip' })).toBeHidden();
  expect(external).toEqual([]);
});

test('route not ready at 1.2 s: the person holds on, then the winds error after 6 s; Try again and Cancel', async ({ context, page }) => {
  await liveWorld(context, { windDelayMs: 20_000 });
  await startAtAlbertSquare(context);
  await page.goto('/');
  await ready(page);
  await page.getByRole('button', { name: 'Let go', exact: true }).click();
  const t0 = Date.now();
  await page.waitForTimeout(2500);
  expect((await hook(page))!.person).toBe('holding'); // no spinner: the person keeps holding it
  const msg = page.getByText("We can't get today's winds right now. Try again in a few minutes.");
  await expect(msg).toBeVisible({ timeout: 20_000 });
  expect(Date.now() - t0).toBeGreaterThan(5500);
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  expect((await hook(page))!.person).toBe('idle'); // holding the balloon again, ready for another go
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('button', { name: 'Let go', exact: true })).toBeVisible();
  await expect(msg).toBeHidden();
  expect(await view(page)).toBe('start');
});

test('winds unavailable says so plainly, with Try again', async ({ context, page }) => {
  await liveWorld(context, { windsDown: true });
  await startAtAlbertSquare(context);
  await page.goto('/');
  await ready(page);
  await page.getByRole('button', { name: 'Let go', exact: true }).click();
  await expect(page.getByText("We can't get today's winds right now. Try again in a few minutes.")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('alert')).toBeVisible();
  await page.getByRole('button', { name: 'Try again' }).click();
  // it tries again (and the person holds on again) rather than staying stuck
  await expect.poll(async () => (await hook(page))?.state).toBe('launch');
});

test('a shared link opens the live flight: string line, "Day 1 of 3", ticks at local midnight, "Let go of your own"; facts are not live', async ({ context, page }) => {
  await liveWorld(context);
  const b = eastward(14);
  await page.goto(await linkTo(b));
  await ready(page);
  await expect.poll(() => view(page), { timeout: 30_000 }).toBe('flight');
  await expect(page.locator('.hud .day')).toHaveText('Day 1 of 3 · 14 h aloft');
  // ticks where the local midnights fall, worked out here from the same hourly points
  const route = await routeFromHourly(b.hourly, b.release, async () => 0);
  const want = midnightTicks(route);
  expect(want.length).toBeGreaterThanOrEqual(2);
  const lefts = await page.locator('.string .ticks i').evaluateAll((els) => els.map((e) => parseFloat((e as HTMLElement).style.left)));
  expect(lefts.length).toBe(want.length);
  lefts.forEach((l, i) => expect(l / 100).toBeCloseTo(want[i], 4));
  const fill = await page.locator('.string .fill').evaluate((e) => parseFloat((e as HTMLElement).style.width));
  expect(fill / 100).toBeCloseTo(14 / 72, 2);
  await expect(page.getByRole('button', { name: 'Let go of your own' })).toBeVisible();
  // accessibility: facts are not read out as they change; a status region is
  await expect(page.locator('.hud .fact')).toHaveAttribute('aria-live', 'off');
  await expect(page.locator('.hud [role=status]')).toHaveAttribute('aria-live', 'polite');
  await expect(page.locator('.hud .fact')).not.toBeEmpty({ timeout: 20_000 });
  // a shared balloon opened mid-flight is no launch: nothing is announced
  await page.waitForTimeout(1500);
  await expect(page.locator('.hud .status')).toHaveText('');
  // the canvas is an image with a label that follows the flight
  await expect(page.locator('canvas.world')).toHaveAttribute('role', 'img');
  await expect(page.locator('canvas.world')).toHaveAttribute('aria-label', /^This balloon is over .+, \d+ km from Manchester$/, { timeout: 20_000 });
  // "Let go of your own" goes to the start screen, and the address loses the link
  await page.getByRole('button', { name: 'Let go of your own' }).click();
  await expect(page.getByRole('button', { name: 'Let go', exact: true })).toBeVisible();
  expect(new URL(page.url()).hash).toBe('');
});

test('Pause stops the camera choreography and the fact rotation; Resume starts them again', async ({ context, page }) => {
  await liveWorld(context);
  await page.goto(await linkTo(eastward(30)));
  await ready(page);
  await expect.poll(() => view(page), { timeout: 30_000 }).toBe('flight');
  await expect(page.locator('.hud .fact')).not.toBeEmpty({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Pause' }).click();
  await expect(page.getByRole('button', { name: 'Resume' })).toBeVisible();
  await page.waitForTimeout(500);
  const rel = (h: Hook) => h.camera.map((c, i) => c - h.target[i]);
  const h0 = (await hook(page))!;
  await page.waitForTimeout(7000); // longer than a fact lasts
  const h1 = (await hook(page))!;
  expect(h1.frames).toBeGreaterThan(h0.frames); // still drawing
  expect(h1.fact).toBe(h0.fact);
  rel(h1).forEach((v, i) => expect(Math.abs(v - rel(h0)[i])).toBeLessThan(0.15)); // the camera hangs still from the balloon
  await page.getByRole('button', { name: 'Resume' }).click();
  await expect.poll(async () => (await hook(page))!.fact, { timeout: 15_000 }).not.toBe(h1.fact);
});

test('a link opened after 72 hours shows the balloon landed', async ({ context, page }) => {
  await liveWorld(context);
  await page.goto(await linkTo(eastward(80)));
  await ready(page);
  await expect.poll(() => view(page), { timeout: 30_000 }).toBe('flight');
  await expect(page.locator('.hud .over')).toHaveText(/^(Landed near|Landed in|Came down in) /, { timeout: 20_000 });
  await expect(page.locator('.hud .day')).toHaveText('Landed · 72 h aloft');
  await expect(page.locator('.hud .status')).toHaveText(/^This balloon (landed|came down) /, { timeout: 10_000 });
  expect(await page.locator('.string .fill').evaluate((e) => parseFloat((e as HTMLElement).style.width))).toBe(100);
});

test('the older ?b= link form opens too', async ({ context, page }) => {
  await liveWorld(context);
  const link = await linkTo(eastward(5));
  await page.goto(`/?b=${link.split('#b=')[1]}`);
  await expect.poll(() => view(page), { timeout: 30_000 }).toBe('flight');
  await expect(page.locator('.hud .day')).toHaveText('Day 1 of 3 · 5 h aloft');
});

test('a broken link says so, with a way to a new balloon (never a blank screen)', async ({ context, page }) => {
  await liveWorld(context);
  await page.goto('/#b=AWkBlv4BCk1hbmNoZXN0ZXIKMjAy');
  await expect(page.getByText('This balloon link is broken.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Let go of a balloon' })).toBeVisible();
  await page.getByRole('button', { name: 'Let go of a new one' }).click();
  await expect(page.getByRole('button', { name: 'Let go', exact: true })).toBeVisible();
  await expect(page.getByText('This balloon link is broken.')).toBeHidden();
  expect(new URL(page.url()).hash).toBe('');
});

test('at 390x660 with "Your balloons", the middle third stays clear for the person and the balloon', async ({ context, page }) => {
  await page.setViewportSize({ width: 390, height: 660 });
  await liveWorld(context);
  const b = eastward(10);
  await context.addInitScript((v) => localStorage.setItem('lgoab.balloons.v1', v), JSON.stringify([b, { ...eastward(90, 'Lisbon') }]));
  await startAtAlbertSquare(context);
  await page.goto('/');
  await expect(page.getByRole('group', { name: 'Your balloons' })).toBeVisible();
  await ready(page);
  // the camera frames the person and the held balloon in the band the chrome leaves free: nothing on top of them
  await expect.poll(async () => (await hook(page))?.subjectPx ?? null, { timeout: 30_000 }).not.toBeNull();
  await page.waitForTimeout(1500);
  const [top, feet] = (await hook(page))!.subjectPx!;
  const head = (await page.locator('.start .top').boundingBox())!;
  const stack = (await page.locator('.start .bottom').boundingBox())!;
  expect(top).toBeGreaterThan(head.y + head.height);
  expect(feet).toBeLessThan(stack.y);
  // and they sit about the middle third of the screen
  expect((top + feet) / 2).toBeGreaterThan(660 / 3);
  expect((top + feet) / 2).toBeLessThan((2 * 660) / 3);
  expect(feet - top).toBeGreaterThan(80);
});
