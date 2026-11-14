import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { decodeBalloon } from '../src/flight/codec';
import { isFontsGoogle, offline } from './net';

type Choice = { name: string; lat: number; lon: number; kind: string; cityId?: string };

const LAST_PLACE = 'lgoab.lastPlace.v1';

/**
 * Tap Let go and read the place it let go from: Let go remembers it as the last place used (the next
 * visit starts there), which is the same choice the page hands to the flight.
 */
async function letGo(page: Page): Promise<Choice> {
  await page.evaluate((k) => localStorage.removeItem(k), LAST_PLACE);
  await page.getByRole('button', { name: 'Let go', exact: true }).click();
  await expect.poll(() => page.evaluate((k) => localStorage.getItem(k), LAST_PLACE)).not.toBeNull();
  return JSON.parse((await page.evaluate((k) => localStorage.getItem(k), LAST_PLACE))!) as Choice;
}

const fromButton = (page: Page) => page.getByRole('button', { name: /^From / });

test.describe('start screen', () => {
  test('first visit shows "From London" and Let go works without searching', async ({ page }) => {
    const net = await offline(page);
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Let go of a balloon');
    await expect(page.getByText("Pick a place, let go, and follow it on today’s real winds for three days")).toBeVisible();
    await expect(fromButton(page)).toHaveText('From London');
    const c = await letGo(page);
    expect(c).toEqual({ name: 'London', lat: 51.5007, lon: -0.1263, kind: 'default', cityId: 'london' });
    expect(net.searches).toHaveLength(0);
  });

  test('the simulation notice and the map credit are on screen', async ({ page }) => {
    await offline(page);
    await page.goto('/');
    // the start screen's own copy (the HUD has one too, hidden, once the live flight has loaded)
    await expect(page.locator('#app').getByText('A simulation using forecast winds, not a real balloon. Real party balloons climb higher and pop; this one floats at about 1.5 km so you can see the ground.')).toBeInViewport();
    const credit = page.locator('.start .map-credit');
    await expect(credit).toHaveText('OpenFreeMap © OpenMapTiles Data from OpenStreetMap © Mapterhorn');
    await expect(credit).toBeInViewport();
    await expect(credit.getByRole('link')).toHaveCount(4);
  });

  test('the notice and the map credit share one row of small print', async ({ page }) => {
    await offline(page);
    await page.goto('/');
    await page.evaluate(() => document.fonts.ready);
    const n = (await page.locator('.start .notice').boundingBox())!;
    const c = (await page.locator('.start .map-credit').boundingBox())!;
    expect(n.x + n.width).toBeLessThanOrEqual(c.x);
    expect(Math.min(n.y + n.height, c.y + c.height)).toBeGreaterThan(Math.max(n.y, c.y));
    expect(Math.abs(n.y + n.height - (c.y + c.height))).toBeLessThan(2);
    for (const sel of ['.start .notice', '.start .map-credit']) {
      const px = await page.locator(sel).evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
      expect(px).toBeLessThanOrEqual(11);
      expect(px).toBeGreaterThanOrEqual(10);
    }
  });

  test('at 360x640 the notice and the map credit are still one row', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await offline(page);
    await page.goto('/');
    await page.evaluate(() => document.fonts.ready);
    const n = (await page.locator('.start .notice').boundingBox())!;
    const c = (await page.locator('.start .map-credit').boundingBox())!;
    expect(n.x + n.width).toBeLessThanOrEqual(c.x);
    expect(Math.min(n.y + n.height, c.y + c.height)).toBeGreaterThan(Math.max(n.y, c.y));
    expect(Math.abs(n.y + n.height - (c.y + c.height))).toBeLessThan(2);
  });

  test('at 320 px the small print stays inside the gutters with no horizontal overflow', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await offline(page);
    await page.goto('/');
    await page.evaluate(() => document.fonts.ready);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    for (const sel of ['.start .notice', '.start .map-credit']) {
      const b = (await page.locator(sel).boundingBox())!;
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width).toBeLessThanOrEqual(320);
    }
    for (const a of await page.locator('.start .map-credit a').all()) {
      const b = (await a.boundingBox())!;
      expect(b.x + b.width).toBeLessThanOrEqual(320 - 16 + 1);
    }
    const n = (await page.locator('.start .notice').boundingBox())!;
    const c = (await page.locator('.start .map-credit').boundingBox())!;
    expect(n.x + n.width).toBeLessThanOrEqual(c.x);
  });

  test('credits list every source and "A Still Signal build", and close with Escape', async ({ page }) => {
    await offline(page);
    await page.goto('/');
    await page.getByRole('button', { name: 'Credits' }).click();
    const dialog = page.getByRole('dialog', { name: 'Credits' });
    await expect(dialog).toBeVisible();
    for (const t of ['NOAA GFS', 'Place search: Open-Meteo.com (GeoNames, CC BY 4.0)', 'Place names: GeoNames', '© DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved.', 'A Still Signal build']) {
      await expect(dialog).toContainText(t);
    }
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });

  test('the last place used is where the next visit starts', async ({ page }) => {
    await offline(page);
    await page.goto('/');
    await page.getByRole('button', { name: 'Tokyo', exact: true }).click();
    await expect(fromButton(page)).toHaveText('From Tokyo');
    expect(await letGo(page)).toEqual({ name: 'Tokyo', lat: 35.659, lon: 139.7006, kind: 'featured', cityId: 'tokyo' });
    await page.reload();
    await expect(fromButton(page)).toHaveText('From Tokyo');
    await expect(page.getByRole('button', { name: 'Tokyo', exact: true })).toHaveAttribute('aria-pressed', 'true');
  });

  test('works with storage blocked', async ({ page }) => {
    await offline(page);
    await page.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('denied', 'SecurityError'); } });
    });
    await page.goto('/');
    await expect(fromButton(page)).toHaveText('From London');
    await page.getByRole('button', { name: 'Paris', exact: true }).click();
    await expect(fromButton(page)).toHaveText('From Paris');
    // Let go still goes, with nowhere to remember the place (offline here, so the winds cannot load)
    await page.getByRole('button', { name: 'Let go', exact: true }).click();
    await expect(page.getByText("We can’t get today’s winds right now. Try again in a few minutes.")).toBeVisible({ timeout: 10_000 });
  });
});

test.describe('layout on a phone inside an in-app browser (390 x 660)', () => {
  test.use({ viewport: { width: 390, height: 660 } });

  test('controls are at least 44 px tall and none sits in the bottom 40 px', async ({ page }) => {
    await offline(page);
    await page.goto('/');
    await page.evaluate(() => document.fonts.ready);
    const boxes = await page.locator('.start button:visible').evaluateAll((els) =>
      els.map((el) => ({ text: el.textContent?.trim(), ...el.getBoundingClientRect().toJSON() })));
    expect(boxes.length).toBeGreaterThanOrEqual(10);
    for (const b of boxes) {
      expect(b.height, b.text).toBeGreaterThanOrEqual(44);
      expect(b.bottom, b.text).toBeLessThanOrEqual(660 - 40);
    }
    const letGo = boxes.find((b) => b.text === 'Let go')!;
    expect(await page.locator('.letgo').evaluate((el) => {
      const s = getComputedStyle(el);
      return { size: parseFloat(s.fontSize), weight: Number(s.fontWeight), bg: s.backgroundColor };
    })).toEqual({ size: 19, weight: 700, bg: 'rgb(255, 90, 18)' });
    expect(letGo.width).toBeGreaterThan(150);
  });

  test('interactive text is 15 px at weight 600 (spec 7.1 buttons)', async ({ page }) => {
    await offline(page);
    await page.goto('/');
    const styles = await page.locator('.from, .from .place, .locate, .city').evaluateAll((els) =>
      els.map((el) => { const s = getComputedStyle(el); return `${s.fontSize} ${s.fontWeight}`; }));
    expect(new Set(styles)).toEqual(new Set(['15px 600']));
  });

  test('orange appears only on Let go', async ({ page }) => {
    await offline(page);
    await page.goto('/');
    const orange = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('body *')]
      .filter((el) => {
        const s = getComputedStyle(el);
        return [s.color, s.backgroundColor, s.borderTopColor, s.textDecorationColor].some((c) => c === 'rgb(255, 90, 18)');
      })
      .map((el) => el.className));
    expect(orange).toEqual(['letgo']);
  });

  test('keyboard focus shows the off-white ring with an ink outer ring', async ({ page }) => {
    await offline(page);
    await page.goto('/');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    const ring = await page.evaluate(() => getComputedStyle(document.activeElement!).boxShadow);
    expect(ring).toBe('rgb(247, 243, 236) 0px 0px 0px 2px, rgb(10, 14, 28) 0px 0px 0px 4px');
  });
});

test.describe('featured cities', () => {
  test('one sideways row of six plain text links, launch batch first', async ({ page }) => {
    await offline(page);
    await page.goto('/');
    const row = page.getByRole('list', { name: 'Featured cities' });
    const items = row.getByRole('button');
    await expect(items).toHaveText(['Paris', 'New York', 'Tokyo', 'Sydney', 'Rio de Janeiro', 'Cappadocia']);
    // one row: every item shares a top edge; plain text: no fill, border or rounded box
    const boxes = await items.evaluateAll((els) => els.map((el) => {
      const s = getComputedStyle(el);
      return { top: el.getBoundingClientRect().top, bg: s.backgroundColor, border: s.borderTopWidth, radius: s.borderTopLeftRadius };
    }));
    for (const b of boxes) {
      expect(b.top).toBe(boxes[0].top);
      expect(b.bg).toBe('rgba(0, 0, 0, 0)');
      expect(b.border).toBe('0px');
      expect(b.radius).toBe('0px');
    }
    expect(await row.evaluate((el) => getComputedStyle(el).overflowX)).toBe('auto');
  });
});

test.describe('town search', () => {
  test('search input follows the combobox pattern (role, aria-expanded, aria-activedescendant)', async ({ page }) => {
    const net = await offline(page);
    await page.goto('/');
    await fromButton(page).click();
    const box = page.getByRole('combobox', { name: 'Search for a town' });
    await expect(box).toBeFocused();
    await expect(box).toHaveAttribute('placeholder', 'Search for a town');
    await expect(box).toHaveAttribute('aria-expanded', 'false');
    const listId = await box.getAttribute('aria-controls');
    await box.pressSequentially('Winder', { delay: 30 });
    const list = page.locator(`#${listId}`);
    await expect(list).toHaveAttribute('role', 'listbox');
    await expect(box).toHaveAttribute('aria-expanded', 'true');
    const options = list.getByRole('option');
    await expect(options).toHaveCount(8);
    await expect(options.nth(1)).toHaveText('Windermere, England, United Kingdom');
    // debounced: one request for the whole word, not one per letter
    expect(net.searches).toEqual(['?name=Winder&count=8&language=en']);
    await expect(box).not.toHaveAttribute('aria-activedescendant');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    const active = await box.getAttribute('aria-activedescendant');
    await expect(options.nth(1)).toHaveAttribute('id', active!);
    await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ArrowUp');
    await expect(options.nth(0)).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Escape');
    await expect(box).toHaveAttribute('aria-expanded', 'false');
    await expect(box).toBeVisible();
    await page.keyboard.press('ArrowDown');
    await expect(box).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(box).toBeHidden();
    await expect(fromButton(page)).toHaveText('From Windermere');
    const c = await letGo(page);
    expect(c).toMatchObject({ name: 'Windermere', kind: 'search' });
    // the map tile for the open-space check is blocked here, so the start stays at the search point
    expect(c.lat).toBeCloseTo(54.38, 1);
    expect(c.lon).toBeCloseTo(-2.9, 1);
  });

  test('"Searching" shows inline while the answer is on its way', async ({ page }) => {
    await offline(page, { searchDelayMs: 800 });
    await page.goto('/');
    await fromButton(page).click();
    await page.getByRole('combobox').fill('Manchester');
    await expect(page.getByRole('status').filter({ hasText: 'Searching' })).toBeVisible();
    await expect(page.getByRole('option').first()).toHaveText('Manchester, England, United Kingdom');
    await expect(page.getByText('Searching')).toBeHidden();
  });

  test('no results shows "No places found. Try a nearby town."', async ({ page }) => {
    await offline(page);
    await page.goto('/');
    await fromButton(page).click();
    await page.getByRole('combobox').fill('Xqzzyplorf');
    await expect(page.getByText('No places found. Try a nearby town.')).toBeVisible();
    await expect(page.getByRole('combobox')).toHaveAttribute('aria-expanded', 'false');
  });

  test('a failed search says so plainly', async ({ page }) => {
    await offline(page, { searchFails: true });
    await page.goto('/');
    await fromButton(page).click();
    await page.getByRole('combobox').fill('Leeds');
    await expect(page.getByText("We can’t search right now. Try again in a moment.")).toBeVisible();
  });

  test('Let go still works when the open-space code cannot load', async ({ page }) => {
    await offline(page);
    await page.route('**/assets/startspot-*.js', (r) => r.abort('failed'));
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/');
    await fromButton(page).click();
    await page.getByRole('combobox').fill('Windermere');
    await page.getByRole('option', { name: 'Windermere, England, United Kingdom' }).click();
    const first = await letGo(page);
    expect(first).toEqual({ name: 'Windermere', lat: 54.38086, lon: -2.90709, kind: 'search' });
    await expect(page.locator('.letgo')).not.toHaveAttribute('aria-busy');
    // and again: the button is not left dead (offline, the winds cannot load: Cancel goes back to the start)
    await page.getByRole('button', { name: 'Cancel' }).click();
    expect((await letGo(page)).name).toBe('Windermere');
    expect(errors).toEqual([]);
  });

  test('Escape from the Cancel button closes the search', async ({ page }) => {
    await offline(page);
    await page.goto('/');
    await fromButton(page).click();
    await page.getByRole('button', { name: 'Cancel' }).focus();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('combobox')).toBeHidden();
    await expect(fromButton(page)).toBeFocused();
  });

  test('the search field shows focus as its full-strength 3 px underline, not a ring box (R54)', async ({ page }) => {
    await offline(page);
    await page.goto('/');
    await fromButton(page).click();
    expect(await page.getByRole('combobox').evaluate((el) => getComputedStyle(el).boxShadow)).toBe('none');
    const bar = await page.locator('.search-bar').evaluate((el) => {
      const s = getComputedStyle(el);
      return { line: s.borderBottomColor, shadow: s.boxShadow };
    });
    // (the 1.5 px border itself is drawn at whole device pixels)
    expect(bar).toEqual({ line: 'rgb(247, 243, 236)', shadow: 'rgb(247, 243, 236) 0px 1.5px 0px 0px' });
  });

  test('the search is a modal dialog: Tab stays inside it, and Escape closes it wherever focus is', async ({ page }) => {
    await offline(page);
    await page.goto('/');
    await fromButton(page).click();
    const layer = page.getByRole('dialog', { name: 'Search for a town' });
    await expect(layer).toBeVisible();
    await expect(layer).toHaveAttribute('aria-modal', 'true');
    await expect(page.getByRole('combobox')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await page.keyboard.press('Tab'); // wraps to the input, never out to the page
    await expect(page.getByRole('combobox')).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(page.getByRole('button', { name: 'Cancel' })).toBeFocused();
    // focus lost to the page (a click on the veil): Escape still closes it
    await page.evaluate(() => (document.activeElement as HTMLElement).blur());
    await page.keyboard.press('Escape');
    await expect(page.getByRole('combobox')).toBeHidden();
    await expect(fromButton(page)).toBeFocused();
  });

  test('Cancel and Escape return to the start screen unchanged', async ({ page }) => {
    await offline(page);
    await page.goto('/');
    await fromButton(page).click();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(fromButton(page)).toBeFocused();
    await fromButton(page).click();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('combobox')).toBeHidden();
    await expect(fromButton(page)).toHaveText('From London');
  });
});

test.describe('my location', () => {
  test('Use my location starts the route at the exact GPS position', async ({ browser }) => {
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      permissions: ['geolocation'],
      geolocation: { latitude: 54.598765432, longitude: -5.928765432 },
    });
    const page = await ctx.newPage();
    await offline(page);
    await page.goto('/');
    await page.getByRole('button', { name: 'Use my location' }).click();
    await expect(fromButton(page)).toHaveText('From your location');
    const c = await letGo(page);
    expect(c).toEqual({ name: 'Your location', lat: 54.598765432, lon: -5.928765432, kind: 'gps' });
    await ctx.close();
  });

  test('the link reads "Finding you" while waiting', async ({ page }) => {
    await offline(page);
    await page.addInitScript(() => {
      navigator.geolocation.getCurrentPosition = () => {}; // never answers
    });
    await page.goto('/');
    const link = page.locator('.locate');
    await link.click();
    await expect(link).toHaveText('Finding you');
  });

  test('location refused falls back to search with no repeat prompt', async ({ page }) => {
    await offline(page);
    await page.addInitScript(() => {
      (window as unknown as { geoCalls: number }).geoCalls = 0;
      navigator.geolocation.getCurrentPosition = (_ok, fail) => {
        (window as unknown as { geoCalls: number }).geoCalls++;
        setTimeout(() => fail?.({ code: 1, message: 'denied', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 } as GeolocationPositionError), 50);
      };
    });
    await page.goto('/');
    await page.getByRole('button', { name: 'Use my location' }).click();
    const box = page.getByRole('combobox', { name: 'Search for a town' });
    await expect(box).toBeFocused();
    await expect(page.getByText('Location is off. Search for your town instead.')).toBeVisible();
    // tied to the input so it is read out with it, and in a live region
    await expect(box).toHaveAccessibleDescription('Location is off. Search for your town instead.');
    await expect(page.getByRole('status').filter({ hasText: 'Location is off' })).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('button', { name: 'Use my location' }).click();
    await expect(box).toBeVisible();
    await expect(page.getByText('Location is off. Search for your town instead.')).toBeHidden();
    expect(await page.evaluate(() => (window as unknown as { geoCalls: number }).geoCalls)).toBe(1);
  });

  test('a location timeout says so differently, and the next tap asks again', async ({ page }) => {
    await offline(page);
    await page.addInitScript(() => {
      (window as unknown as { geoCalls: number }).geoCalls = 0;
      navigator.geolocation.getCurrentPosition = (_ok, fail) => {
        (window as unknown as { geoCalls: number }).geoCalls++;
        setTimeout(() => fail?.({ code: 3, message: 'timeout', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 } as GeolocationPositionError), 50);
      };
    });
    await page.goto('/');
    await page.getByRole('button', { name: 'Use my location' }).click();
    await expect(page.getByText("We couldn’t find you. Try again, or search for your town.")).toBeVisible();
    await expect(page.getByText('Location is off. Search for your town instead.')).toBeHidden();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('button', { name: 'Use my location' }).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { geoCalls: number }).geoCalls)).toBe(2);
  });
});

test.describe('your balloons', () => {
  test('listed only when there are some, and open on tap', async ({ page }) => {
    await offline(page);
    await page.goto('/');
    await expect(page.getByText('Your balloons')).toHaveCount(0);
    await page.evaluate(() => {
      const hourly = Array.from({ length: 73 }, (_, h) => ({ lat: 38.72 + h * 0.05, lon: -9.14 + h * 0.2 }));
      const b = { v: 1, name: 'Lisbon', start: hourly[0], release: Date.now() - 14.5 * 3600e3, hourly, runId: '1731403800' };
      localStorage.setItem('lgoab.balloons.v1', JSON.stringify([b]));
    });
    await page.reload();
    const group = page.getByRole('group', { name: 'Your balloons' });
    await expect(group.getByRole('button')).toHaveText('Lisbon · 14 h aloft');
    await group.getByRole('button').click();
    // the balloon opens: its link is in the address (here on the 2D map, as these checks run without WebGL)
    await expect.poll(() => page.evaluate(() => location.hash), { timeout: 10_000 }).toMatch(/^#b=/);
    const opened = await decodeBalloon(await page.evaluate(() => location.hash.slice(3)));
    expect(opened.name).toBe('Lisbon');
  });
});

test.describe('page shell', () => {
  test('index.html has Open Graph and X card tags and a 1200x627 preview image', async ({ page, request }) => {
    await offline(page);
    await page.goto('/');
    const meta = (sel: string) => page.locator(sel).getAttribute('content');
    expect(await meta('meta[property="og:title"]')).toBe('Let go of a balloon');
    expect(await meta('meta[property="og:description"]')).toBe("Pick a place, let go, and follow it on today’s real winds for three days");
    expect(await meta('meta[property="og:image"]')).toBe('https://let-go-of-a-balloon.pages.dev/og.png');
    expect(await meta('meta[property="og:image:width"]')).toBe('1200');
    expect(await meta('meta[property="og:image:height"]')).toBe('627');
    expect(await meta('meta[name="twitter:card"]')).toBe('summary_large_image');
    expect(await page.locator('link[rel="icon"]').getAttribute('href')).toBe('/favicon.svg');
    const png = await (await request.get('/og.png')).body();
    expect(png.subarray(1, 4).toString()).toBe('PNG');
    expect(png.readUInt32BE(16)).toBe(1200);
    expect(png.readUInt32BE(20)).toBe(627);
    expect((await request.get('/favicon.svg')).ok()).toBe(true);
  });

  test('no request goes to fonts.googleapis.com; Archivo comes from this site', async ({ page }) => {
    const google: string[] = [];
    page.on('request', (r) => { if (isFontsGoogle(r)) google.push(r.url()); });
    const fonts: string[] = [];
    page.on('response', (r) => { if (r.url().endsWith('.woff2')) fonts.push(new URL(r.url()).pathname); });
    await offline(page);
    await page.goto('/');
    await page.evaluate(() => document.fonts.ready);
    expect(await page.evaluate(() => document.fonts.check('700 40px Archivo'))).toBe(true);
    expect(google).toEqual([]);
    expect(fonts).toContain('/fonts/archivo-subset.woff2');
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    expect(html).not.toMatch(/fonts\.googleapis|fonts\.gstatic/);
  });
});
