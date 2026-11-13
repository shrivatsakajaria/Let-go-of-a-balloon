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
  // all chrome but the clock goes in 300 ms: a clean frame for recordings (polled: a loaded test machine
  // can be a frame or two late)
  expect(await page.locator('.start .bottom').evaluate((el) => getComputedStyle(el).transitionDuration)).toMatch(/^0\.3s/);
  await expect.poll(() => opacity(page, '.start .bottom'), { timeout: 5000 }).toBe(0);
  await expect.poll(() => opacity(page, '.start .top'), { timeout: 5000 }).toBe(0);
  await expect.poll(() => opacity(page, '.hud-top .clock'), { timeout: 5000 }).toBe(1);
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
  expect(await page.locator('.hud-bottom').evaluate((el) => getComputedStyle(el).transitionDuration)).toMatch(/^0\.6s/);
  await expect.poll(() => opacity(page, '.hud-bottom'), { timeout: 8000 }).toBe(1);
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

test('HUD text reaches 4.5:1 over snow, noon and sand with the shading at its brightest-scene strength', async ({ context, page }) => {
  await liveWorld(context);
  await page.goto(await linkTo(eastward(14)));
  await expect.poll(() => view(page), { timeout: 30_000 }).toBe('flight');
  await expect(page.locator('.hud .fact')).not.toBeEmpty({ timeout: 20_000 });
  // hold the fact line still (Pause stops its rotation), so no shot lands mid-crossfade
  await page.getByRole('button', { name: 'Pause' }).click();
  await expect.poll(() => opacity(page, '.hud .fact')).toBe(1);
  for (const [name, colour] of [['snow', '#f4f6f8'], ['noon', '#d6e8f0'], ['sand', '#e6d6a2']]) {
    // the worst case behind the text: a flat bright scene, and the shading darkened as the page does over one
    await page.addStyleTag({ content: `.scene .world { visibility: hidden !important; } #scene { background: ${colour} !important; } :root { --boost: 0.15 !important; }` });
    await page.waitForTimeout(200);
    const targets = await page.evaluate(() => {
      const out: { what: string; color: string; alpha: number; rects: { x: number; y: number; w: number; h: number }[]; need: number }[] = [];
      for (const el of [...document.querySelectorAll<HTMLElement>('.hud *')]) {
        if (!el.checkVisibility({ visibilityProperty: true, opacityProperty: true })) continue;
        let alpha = 1;
        for (let a: HTMLElement | null = el; a; a = a.parentElement) alpha *= Number(getComputedStyle(a).opacity);
        const rects: { x: number; y: number; w: number; h: number }[] = [];
        for (const node of el.childNodes) {
          if (node.nodeType !== Node.TEXT_NODE || !node.textContent?.trim()) continue;
          const range = document.createRange();
          range.selectNodeContents(node);
          for (const r of range.getClientRects()) if (r.width > 0 && r.height > 0) rects.push({ x: r.left, y: r.top, w: r.width, h: r.height });
        }
        if (!rects.length || el.closest('.sr')) continue;
        const cs = getComputedStyle(el);
        const size = parseFloat(cs.fontSize);
        const large = size >= 24 || (size >= 18.66 && Number(cs.fontWeight) >= 700);
        out.push({ what: `${el.className}: ${el.textContent?.trim().slice(0, 24)}`, color: cs.color, alpha, rects, need: large ? 3 : 4.5 });
      }
      return out;
    });
    expect(targets.length).toBeGreaterThan(10);
    const style = await page.addStyleTag({ content: '.hud * { color: transparent !important; text-decoration-color: transparent !important; }' });
    const shot = (await page.screenshot()).toString('base64');
    await style.evaluate((s) => (s as Element).remove());
    const results = await page.evaluate(async ({ shot, targets }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${shot}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const g = c.getContext('2d')!;
      g.drawImage(img, 0, 0);
      const lin = (v: number) => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
      const lum = (r: number, gg: number, b: number) => 0.2126 * lin(r) + 0.7152 * lin(gg) + 0.0722 * lin(b);
      return targets.map((t) => {
        const [r, gg, b, a0 = 1] = t.color.match(/[\d.]+/g)!.map(Number);
        const a = a0 * t.alpha;
        let worst = 1e9;
        for (const rc of t.rects) {
          const d = g.getImageData(Math.floor(rc.x), Math.floor(rc.y), Math.max(1, Math.ceil(rc.w)), Math.max(1, Math.ceil(rc.h))).data;
          for (let i = 0; i < d.length; i += 4) {
            const fg = [r * a + d[i] * (1 - a), gg * a + d[i + 1] * (1 - a), b * a + d[i + 2] * (1 - a)];
            const L1 = lum(fg[0], fg[1], fg[2]), L2 = lum(d[i], d[i + 1], d[i + 2]);
            worst = Math.min(worst, (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05));
          }
        }
        return { what: t.what, ratio: Math.round(worst * 100) / 100, need: t.need };
      });
    }, { shot, targets });
    console.log(name, JSON.stringify(results.map((r) => `${r.what.slice(0, 18)} ${r.ratio}`)));
    for (const r of results) expect(r.ratio, `${name}: ${r.what}`).toBeGreaterThanOrEqual(r.need);
  }
});

test('with the world live, the HUD never takes taps meant for the start screen (Credits on start, error and broken views)', async ({ context, page }) => {
  await liveWorld(context, { windsDown: true });
  await startAtAlbertSquare(context);
  const credits = async () => {
    await page.getByRole('button', { name: 'Credits' }).click({ timeout: 5000 });
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
  };
  await page.goto('/');
  await ready(page);
  await credits(); // start
  await page.getByRole('button', { name: 'Let go', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible({ timeout: 15_000 });
  await credits(); // the winds error
  await page.goto('/#b=AWkBlv4BCk1hbmNoZXN0ZXIKMjAy');
  await expect(page.getByText('This balloon link is broken.')).toBeVisible();
  await ready(page);
  await credits(); // the broken link
});

test('the winds manifest, the terrain header and the start ground are asked for at page load, before the 3D world arrives', async ({ context, page }) => {
  const { winds } = await liveWorld(context);
  await startAtAlbertSquare(context);
  const terrain: string[] = [];
  page.on('request', (r) => { if (r.url().includes('mapterhorn.com/planet.pmtiles')) terrain.push(r.url()); });
  // the world's chunks (and three.js) never arrive: the warm-up must not wait for them
  await context.route(/\/assets\/(live|sky)-[^/]*\.js$/, (r) => r.abort('failed'));
  await page.goto('/');
  await expect.poll(() => winds.includes('/winds/manifest.json'), { timeout: 10_000 }).toBe(true);
  await expect.poll(() => terrain.length, { timeout: 10_000 }).toBeGreaterThan(0);
});

test('with no WebGL the page says the 3D world cannot show here (not that the winds failed); Cancel clears the link', async ({ context, page }) => {
  await liveWorld(context);
  await context.addInitScript(() => {
    const get = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, id: string, ...rest: unknown[]) {
      return /webgl/.test(id) ? null : (get as (...a: unknown[]) => unknown).call(this, id, ...rest);
    } as typeof get;
  });
  await page.goto(await linkTo(eastward(10)));
  await expect(page.getByText("Your browser can't show the 3D world, so the balloon can't fly here.")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("We can't get today's winds right now. Try again in a few minutes.")).toBeHidden();
  await page.getByRole('button', { name: 'Cancel' }).click();
  expect(new URL(page.url()).hash).toBe('');
  await expect(page.getByRole('button', { name: 'Let go', exact: true })).toBeVisible();
});

test('if the world cannot be fetched, Let go says so and offers Try again', async ({ context, page }) => {
  await liveWorld(context);
  await context.route(/\/assets\/live-[^/]*\.js$/, (r) => r.abort('failed'));
  await page.goto('/');
  await page.getByRole('button', { name: 'Let go', exact: true }).click();
  await expect(page.getByText("The balloon didn't load. Check your connection and try again.")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('button', { name: 'Let go', exact: true })).toBeVisible();
});

test('clearing the address on the broken-link screen goes back to the start screen', async ({ context, page }) => {
  await liveWorld(context);
  await page.goto('/#b=AWkBlv4BCk1hbmNoZXN0ZXIKMjAy');
  await expect(page.getByText('This balloon link is broken.')).toBeVisible();
  await expect.poll(() => view(page)).toBe('broken');
  await page.waitForTimeout(1000); // the start chrome has finished hiding
  await page.evaluate(() => (location.hash = ''));
  await expect.poll(() => view(page)).toBe('start');
  await expect(page.getByRole('button', { name: 'Let go', exact: true })).toBeVisible();
  await expect(page.getByText('This balloon link is broken.')).toBeHidden();
});

test('a link opened while a launch is waiting for its route takes over: the launch never lets go', async ({ context, page }) => {
  await liveWorld(context, { windDelayMs: 3000 });
  await startAtAlbertSquare(context);
  await page.goto('/');
  await ready(page);
  await page.getByRole('button', { name: 'Let go', exact: true }).click();
  await page.waitForTimeout(800);
  const link = await linkTo(eastward(14));
  await page.evaluate((h) => (location.hash = h), link.slice(1));
  await expect.poll(() => view(page), { timeout: 30_000 }).toBe('flight');
  await expect(page.locator('.hud .day')).toHaveText('Day 1 of 3 · 14 h aloft');
  await page.waitForTimeout(8000); // past when the launch's route would have arrived
  await expect(page.locator('.hud .day')).toHaveText('Day 1 of 3 · 14 h aloft');
  expect(new URL(page.url()).hash).toBe(link.slice(1));
  expect(await page.evaluate(() => localStorage.getItem('lgoab.balloons.v1'))).toBeNull();
});

test('the page keeps no test hook unless a test asks for one', async ({ context, page }) => {
  await context.route('**/*', (r) => (/^https?:\/\/(localhost|127\.0\.0\.1)/.test(r.request().url()) ? r.continue() : r.abort('blockedbyclient')));
  await page.goto('/');
  await ready(page);
  expect(await page.evaluate(() => '__lgoabTest' in window || '__live' in window)).toBe(false);
});

test('disposing the live flight stops drawing and frees the scene, the HUD and the listeners', async ({ context, page }) => {
  await liveWorld(context);
  await startAtAlbertSquare(context);
  await page.goto('/');
  await ready(page);
  await expect.poll(async () => (await hook(page))!.frames, { timeout: 10_000 }).toBeGreaterThan(5);
  const left = await page.evaluate(() => (window as unknown as { __liveDispose: () => number }).__liveDispose());
  expect(left).toBe(0); // nothing left in the 3D scene
  const f0 = (await hook(page))!.frames;
  await page.waitForTimeout(1500);
  expect((await hook(page))!.frames).toBe(f0);
  expect(await page.locator('canvas.world').count()).toBe(0);
  expect(await page.locator('#hud').evaluate((e) => e.childElementCount)).toBe(0);
  await page.setViewportSize({ width: 400, height: 700 }); // a resize after dispose throws nothing
  await page.waitForTimeout(300);
});
