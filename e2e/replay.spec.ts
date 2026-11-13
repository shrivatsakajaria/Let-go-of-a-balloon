import { expect, test, type Page } from '@playwright/test';
import { clockText } from '../src/ui/hudmath';
import { eastward, linkTo, liveWorld, SWIFTSHADER } from './fixtures';

/**
 * "Show me the whole trip" (spec 6.4, 7.1, 7.3, 8) in the real app, on fixture winds, map and terrain
 * (e2e/fixtures.ts), with WebGL on SwiftShader: the forecast route in 20 seconds, its label, its names,
 * the landing, and Back to live at now with nothing of the replay left in the scene.
 *
 * The software renderer can draw very few frames a second on a busy machine, so what the scene shows
 * is read from the page's hook by polling, and what the chrome shows is recorded in the page as it
 * changes; the replay's own length is measured in the page (tap to end). window.__live (the read-only
 * test hook) exists because liveWorld sets window.__lgoabTest before the page loads.
 */
test.use(SWIFTSHADER);
test.describe.configure({ mode: 'default', timeout: 150_000 });

type Hook = { state: string; shot: string; replay: boolean; trail: boolean; now: number; frames: number; camera: number[]; target: number[]; replayMs: number | null };
const hook = (page: Page) => page.evaluate(() => (window as unknown as { __live: Hook }).__live);
const LABEL = 'Forecast route, 72 hours in 20 seconds';
/**
 * How far the time the scene last drew is from now, read in the page (a starved renderer can go a few
 * seconds between frames; the replay's time is hours or days away, so 15 s tells the two apart).
 */
const offNow = (page: Page) => page.evaluate(() => Math.abs((window as unknown as { __live: { now: number } }).__live.now - Date.now()));
const SLOW = { timeout: 30_000, intervals: [250] };

async function openFlight(page: Page, hoursAgo = 30) {
  await page.goto(await linkTo(eastward(hoursAgo)));
  await page.waitForFunction(() => document.getElementById('scene')?.dataset.live === '1', null, { timeout: 30_000 });
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.view), { timeout: 30_000 }).toBe('flight');
  // the live place line is in (the replay's label takes its place, and gives it back)
  await expect(page.locator('.hud .over')).not.toBeEmpty({ timeout: 30_000 });
}

/** Record in the page every text the replay's name slot shows, and the still route's drawing. */
async function record(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __names: string[]; __dash: number; __marks: number };
    w.__names = [];
    w.__dash = 1;
    w.__marks = 0;
    const slot = document.querySelector('.hud .replay-slot')!;
    // read from the records' own elements: at the end the slot is emptied in the same task that wrote it
    const cur = { name: '', when: '' };
    new MutationObserver((records) => {
      for (const r of records) {
        const p = (r.target.nodeType === 1 ? r.target : r.target.parentNode) as Element | null;
        if (!p || p === slot) continue;
        if (p.classList.contains('replay-name')) cur.name = p.textContent ?? '';
        else if (p.classList.contains('replay-when')) cur.when = p.textContent ?? '';
      }
      // one entry per batch: a name and its line are written in the same task
      const t = `${cur.name}|${cur.when}`;
      if (cur.name && w.__names[w.__names.length - 1] !== t) w.__names.push(t);
    }).observe(slot, { subtree: true, childList: true, characterData: true });
    new MutationObserver((records) => {
      for (const r of records) {
        const el = r.target as Element;
        if (r.type === 'attributes' && el.classList?.contains('replay-line')) w.__dash = Math.min(w.__dash, Number(el.getAttribute('stroke-dashoffset')));
        if (r.type === 'attributes' && el.classList?.contains('replay-mark')) w.__marks += el.classList.contains('on') && r.oldValue?.includes('on') !== true ? 1 : 0;
      }
    }).observe(document.getElementById('scene')!, { subtree: true, attributes: true, attributeOldValue: true, attributeFilter: ['stroke-dashoffset', 'class'] });
  });
}

test('the whole trip: "Forecast route" label, a high wide camera with a trail, names on the way, the landing, then live again at now within 22 s', async ({ context, page }) => {
  const { external } = await liveWorld(context);
  await openFlight(page);
  const trip = page.getByRole('button', { name: 'Show me the whole trip' });
  await expect(trip).toBeVisible();
  await record(page);
  const rc = () => page.evaluate(() => (window as unknown as { __live: { recentres: number } }).__live.recentres);
  const rc0 = await rc();
  await trip.click();

  // labelled as the forecast route, with Back to live as the main action (and keyboard focus on it)
  await expect(page.locator('.hud .over')).toHaveText(LABEL);
  const back = page.getByRole('button', { name: 'Back to live' });
  await expect(back).toBeVisible();
  await expect(back).toBeFocused();
  await expect(trip).toBeHidden();
  await expect(page.locator('.hud .fact')).toBeHidden();
  await expect(page.locator('.hud .views')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Pause' })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Let go of your own' })).toBeHidden();
  await expect.poll(async () => (await hook(page)).shot, SLOW).toBe('replay');
  expect((await hook(page)).trail).toBe(true);

  // the clock runs with the route (72 hours go by in the travel), seen from tens of kilometres up
  const b = eastward(30);
  await expect.poll(async () => (await hook(page)).now, SLOW).toBeGreaterThan(b.release + 10 * 3600e3);
  const mid = await hook(page);
  expect(mid.replay).toBe(true);
  expect(mid.now).toBeLessThanOrEqual(b.release + 72 * 3600e3);
  await expect.poll(async () => { const h = await hook(page); return h.camera[1] - h.target[1]; }, SLOW).toBeGreaterThan(20_000);
  expect((await page.locator('.hud .day').textContent()) ?? '').toMatch(/^(Day [123] of 3 · \d+ h aloft|Landed · 72 h aloft)$/);

  // the end 20 s after the tap: the landing card opens over the held landing; "Back to live" closes it
  await expect.poll(async () => (await hook(page)).replayMs, { timeout: 60_000, intervals: [250] }).not.toBe(null);
  const ms = (await hook(page)).replayMs!;
  const card = page.getByRole('dialog');
  await expect(card).toBeVisible({ timeout: 60_000 });
  await card.getByRole('button', { name: 'Back to live' }).click();
  await expect(card).toHaveCount(0);
  await expect.poll(async () => (await hook(page)).replay, { timeout: 30_000, intervals: [250] }).toBe(false);
  // the floating origin follows the balloon in 30 km steps in the travel: a few re-centres a second at most
  const perS = ((await rc()) - rc0) / (ms / 1000);
  console.log(`re-centres over the replay: ${perS.toFixed(1)} a second`);
  expect(perS).toBeLessThanOrEqual(12);
  expect(ms).toBeGreaterThan(19_900);
  expect(ms).toBeLessThan(22_000);

  // at most five names on the way, then the landing place, what happens there and when
  const seen = await page.evaluate(() => (window as unknown as { __names: string[] }).__names);
  const landing = seen.filter((s) => /^.+\|Expected to (land|come down) here · \w{3} \d{1,2} \w{3}, \d\d:\d\d$/.test(s));
  expect(landing.length).toBeGreaterThan(0);
  const names = new Set(seen.filter((s) => s.endsWith('|')).map((s) => s.split('|')[0]));
  expect(names.size).toBeLessThanOrEqual(5);

  // live again at now: nothing of the replay left, the HUD back as it was
  // (as "trail frames ms-from-now", so a failure says which part is off)
  await expect.poll(async () => { const h = await hook(page); return `${h.trail} ${h.frames} ${Math.round(await offNow(page))}`; }, { timeout: 60_000, intervals: [500] }).toMatch(/^false \d+ \d{1,4}$/);
  await expect(page.locator('.hud .day')).toHaveText('Day 2 of 3 · 30 h aloft', SLOW);
  await expect(trip).toBeVisible();
  await expect(back).toBeHidden();
  await expect(page.locator('.hud .over')).not.toHaveText(LABEL);
  await expect(page.locator('.hud .fact')).toBeVisible();
  expect((await hook(page)).shot).not.toBe('replay');
  expect(external).toEqual([]);
});

test('the replay ends on the landing card ("Expected to land near ..." over the held landing) within 22 s of the tap; Escape is the card\'s; Back to live returns to live at now', async ({ context, page }) => {
  await liveWorld(context);
  await openFlight(page, 30);
  const trip = page.getByRole('button', { name: 'Show me the whole trip' });
  await trip.click();
  const t0 = Date.now();
  const card = page.getByRole('dialog');
  // the replay itself is 20 s; the card is made from the held landing (a long route's card world is quick on fixtures)
  await expect(card).toBeVisible({ timeout: 60_000 });
  const c = await page.evaluate(() => (window as unknown as { __card: { kicker: string; startedAt: number } }).__card);
  const ms = (await hook(page)).replayMs!;
  expect(ms).toBeLessThan(22_000);
  expect(c.startedAt - t0).toBeLessThan(22_000);
  expect(c.kicker).toMatch(/^Expected to (land near|land in|come down in)$/);
  // still the replay behind it, holding on the landing
  expect((await hook(page)).replay).toBe(true);
  await expect(card.getByRole('button', { name: 'Back to live' })).toBeVisible();
  await expect(card.getByRole('button', { name: 'Close' })).toHaveCount(0);
  // Escape belongs to the card now: it closes the card, and the card's close is Back to live
  await page.keyboard.press('Escape');
  await expect(card).toHaveCount(0);
  await expect.poll(async () => (await hook(page)).replay, { timeout: 30_000, intervals: [250] }).toBe(false);
  await expect.poll(() => offNow(page), { timeout: 60_000, intervals: [500] }).toBeLessThan(15_000);
  // the HUD's clock is now's again
  // (the clock is local time where the balloon is now: about 30 h along the eastward route)
  const at = { lat: 53.4794 + 0.01 * 30.5, lon: -2.2453 + 0.25 * 30.5 };
  await expect.poll(async () => {
    const shown = await page.locator('.hud .clock-time').textContent();
    return [clockText(Date.now() - 60_000, at), clockText(Date.now(), at)].includes(shown ?? '');
  }, { timeout: 30_000, intervals: [500] }).toBe(true);
  await expect(trip).toBeVisible();
  // one filled main action at a time: the whole trip (the card's way back is a quiet link once landed)
  expect(await page.locator('.hud .actions .main-action:not([hidden])').count()).toBe(1);
});

test('Back to live during the replay returns to the live view at now, and the trail is gone; Escape does the same', async ({ context, page }) => {
  await liveWorld(context);
  await openFlight(page, 30);
  const trip = page.getByRole('button', { name: 'Show me the whole trip' });
  await trip.click();
  await expect(page.locator('.hud .over')).toHaveText(LABEL);
  await expect.poll(async () => (await hook(page)).trail, SLOW).toBe(true);
  await page.getByRole('button', { name: 'Back to live' }).click();
  await expect(page.locator('.hud .over')).not.toHaveText(LABEL);
  await expect(trip).toBeFocused();
  await expect.poll(async () => { const h = await hook(page); return h.replay || h.trail || (await offNow(page)) > 15_000; }, SLOW).toBe(false);
  await expect(page.locator('.hud .day')).toHaveText('Day 2 of 3 · 30 h aloft', SLOW);
  await expect(page.locator('.hud .fact')).toBeVisible();

  // again, then Escape
  await trip.click();
  await expect.poll(async () => (await hook(page)).trail, SLOW).toBe(true);
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await hook(page)).trail, SLOW).toBe(false);
  await expect(page.locator('.hud .over')).not.toHaveText(LABEL);
});

test('reduced motion: no fly-through; the route is drawn in place over 2 s and held, labelled "Forecast route"', async ({ context, page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await liveWorld(context);
  await openFlight(page, 30);
  await record(page);
  await page.getByRole('button', { name: 'Show me the whole trip' }).click();
  await expect(page.locator('.hud .over')).toHaveText('Forecast route');
  await expect(page.locator('.replay-map svg')).toBeVisible();
  await expect(page.locator('.replay-balloon')).toBeVisible();
  const h = await hook(page);
  expect(h.trail).toBe(false); // the 3D scene stays live
  expect(h.shot).not.toBe('replay');
  await expect(page.getByRole('button', { name: 'Let go of your own' })).toBeHidden();
  // drawn in full, every mark shown, then (by default) back to live
  await expect.poll(async () => (await hook(page)).replay, SLOW).toBe(true);
  await expect.poll(async () => (await hook(page)).replay, SLOW).toBe(false);
  const drawn = await page.evaluate(() => {
    const w = window as unknown as { __dash: number; __marks: number };
    return { dash: w.__dash, marks: w.__marks };
  });
  expect(drawn.dash).toBeCloseTo(0, 3);
  expect(drawn.marks).toBeGreaterThanOrEqual(2); // the start and the landing at least
  expect((await hook(page)).replayMs!).toBeGreaterThan(5_900);
  await expect(page.locator('.replay-map')).toHaveCount(0);
});
