import { existsSync, readFileSync } from 'node:fs';
import { expect, test, type BrowserContext, type Page, type TestInfo } from '@playwright/test';
import { encodeBalloon, type SavedBalloon } from '../src/flight/codec';
import { destination, type LatLon } from '../src/geo/coords';
import { sunPosition } from '../src/geo/sun';
import { SWIFTSHADER, eastward, linkTo } from './fixtures';

/**
 * The frame budget in the densest launch cities, on the REAL map and terrain (spec 12: under 600,000
 * triangles and 250 draw calls a frame during live flight, shadow redraws included). It needs the
 * network (OpenFreeMap, Mapterhorn), so it only runs when asked:
 *
 *   PERF_CITIES=1 CI=1 E2E_PORT=47522 npx playwright test e2e/perf-cities.spec.ts --workers=1
 *
 * PERF_CITY=paris (or paris,tokyo) runs only those cities; PERF_SHOTS=dir saves a picture after the launch and of each climb view. Winds are the committed fixture run (Europe only), so the launch
 * itself is flown where it covers (London, Manchester, Paris); every city is also seen on its start
 * screen and from links released 2, 5 and 10 minutes before (the climb: about 180 m, 450 m and 900 m
 * up), each in the Film, Ride and Above views. The clock is set to the city's late afternoon with the
 * sun about 10 degrees up: a low sun throws the longest shadow box, the worst case for the shadow pass.
 * Each scene's peaks are recorded as annotations and in the log.
 */
test.skip(!process.env.PERF_CITIES, 'needs the live map: PERF_CITIES=1');
test.use(SWIFTSHADER);
test.describe.configure({ mode: 'default', timeout: 1_200_000 });

const TRIANGLE_CAP = 600_000;
const CALL_CAP = 250;

type City = { id: string; name: string; at: LatLon; headingDeg: number; winds: boolean };
const CITIES: City[] = [
  { id: 'london', name: 'London', at: { lat: 51.5007, lon: -0.1263 }, headingDeg: 70, winds: true },
  { id: 'manchester', name: 'Manchester', at: { lat: 53.47945, lon: -2.2455 }, headingDeg: 101, winds: true },
  { id: 'paris', name: 'Paris', at: { lat: 48.8556, lon: 2.2986 }, headingDeg: 60, winds: true },
  { id: 'tokyo', name: 'Tokyo', at: { lat: 35.659, lon: 139.7006 }, headingDeg: 350, winds: false },
  // from Liberty Island toward Lower Manhattan
  { id: 'new-york', name: 'New York', at: { lat: 40.6906, lon: -74.046 }, headingDeg: 35, winds: false },
  { id: 'dubai', name: 'Dubai', at: { lat: 25.1945, lon: 55.2736 }, headingDeg: 10, winds: false },
];

type Peak = { triangles: number; calls: number; shadowTriangles: number; shadowCalls: number };
type Hook = { state: string; person: string | null; frames: number; peak: Peak; routeError: string | null };
const hook = (page: Page) => page.evaluate(() => (window as unknown as { __live?: Hook }).__live ?? null);

/** Late afternoon at the city on 13 November 2026, the sun about 10 degrees up. */
function lowSun(p: LatLon): number {
  const day = Date.UTC(2026, 10, 13) - (p.lon / 15) * 3600e3; // local midnight, roughly
  let best = day + 15 * 3600e3;
  for (let t = day + 12 * 3600e3; t < day + 20 * 3600e3; t += 5 * 60e3) {
    const e = sunPosition(t, p).elevationDeg;
    if (e < 10) break;
    best = t;
  }
  return best;
}

const WIND = new URL('../tests/fixtures/wind/real/', import.meta.url);

/** The committed wind run (fresh as of `now`), the real map and terrain, nothing else outside. */
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

function log(info: TestInfo, city: string, scene: string, p: Peak) {
  const worst = Math.max(p.triangles, p.shadowTriangles);
  const line = `${city} ${scene}: plain ${p.calls} calls ${Math.round(p.triangles / 1000)}k | shadow frames ${p.shadowCalls} calls ${Math.round(p.shadowTriangles / 1000)}k${worst >= TRIANGLE_CAP || Math.max(p.calls, p.shadowCalls) >= CALL_CAP ? '  OVER' : ''}`;
  info.annotations.push({ type: `${city} ${scene}`, description: line });
  console.log(`perf-cities: ${line}`);
}

/** Zero the peaks, let `ms` pass (in the views given, a share each), and read them. */
async function sample(page: Page, ms: number, views: string[] = []): Promise<Peak> {
  await page.evaluate(() => {
    const p = (window as unknown as { __live: Hook }).__live.peak;
    p.triangles = p.calls = p.shadowTriangles = p.shadowCalls = 0;
  });
  if (!views.length) await page.waitForTimeout(ms);
  for (const v of views) {
    await page.locator(`.view[data-view="${v}"]`).click().catch(() => {});
    await page.waitForTimeout(ms / views.length);
  }
  return { ...(await hook(page))!.peak };
}

const all: { city: string; scene: string; peak: Peak }[] = [];

for (const city of CITIES) {
  if (process.env.PERF_CITY && !process.env.PERF_CITY.split(',').includes(city.id)) continue;

  test(`${city.name}: the frame budget holds on the real map`, async ({ context, page }, info) => {
    const now = lowSun(city.at);
    await page.clock.setSystemTime(now);
    await realWorld(context, now);
    const place = JSON.stringify({ name: city.name, lat: city.at.lat, lon: city.at.lon, kind: 'featured', cityId: city.id });
    await context.addInitScript((c) => localStorage.setItem('lgoab.lastPlace.v1', c), place);
    const record = (scene: string, p: Peak) => {
      log(info, city.name, scene, p);
      all.push({ city: city.name, scene, peak: p });
      expect.soft(Math.max(p.triangles, p.shadowTriangles), `${scene}: triangles`).toBeLessThan(TRIANGLE_CAP);
      expect.soft(Math.max(p.calls, p.shadowCalls), `${scene}: draw calls`).toBeLessThan(CALL_CAP);
    };

    // the start screen: the person holds the balloon in the street
    await page.goto('/');
    await page.waitForFunction(() => document.getElementById('scene')?.dataset.live === '1', null, { timeout: 120_000 });
    await page.waitForTimeout(15_000);
    record('start screen', await sample(page, 10_000));

    if (city.winds) {
      await page.getByRole('button', { name: 'Let go', exact: true }).click();
      record('launch and first 40 s', await sample(page, 40_000));
      if (process.env.PERF_SHOTS) await page.screenshot({ path: `${process.env.PERF_SHOTS}/${city.id}-launch.png`, timeout: 120_000 });
    }

    // the climb, from links: 2, 5 and 10 minutes after release
    for (const min of [2, 5, 10]) {
      const release = now - min * 60e3;
      const hourly = Array.from({ length: 73 }, (_, i) => destination(city.at, city.headingDeg, i * 12));
      const b: SavedBalloon = { v: 1, name: city.name, start: { ...city.at }, release, hourly, runId: '2026111218' };
      await page.goto('about:blank');
      await page.goto(`/#b=${await encodeBalloon(b)}`);
      await page.waitForFunction(() => document.getElementById('scene')?.dataset.live === '1', null, { timeout: 120_000 });
      await expect.poll(async () => (await hook(page))?.state, { timeout: 60_000 }).toBe('flight');
      await page.waitForTimeout(12_000);
      record(`${min} min up`, await sample(page, 24_000, ['film', 'ride', 'above']));
      // PERF_SHOTS=dir: a picture of each view after the sample (to look for holes by the camera)
      if (process.env.PERF_SHOTS) {
        for (const v of ['film', 'ride', 'above']) {
          await page.locator(`.view[data-view="${v}"]`).click().catch(() => {});
          await page.waitForTimeout(4000);
          await page.screenshot({ path: `${process.env.PERF_SHOTS}/${city.id}-${min}min-${v}.png`, timeout: 120_000 });
        }
      }
    }
  });
}

/** A mid-range phone on 4G: CPU 4x slower, DevTools' "Fast 4G" (as e2e/perf.spec.ts). */
async function midRangePhone(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: Number(process.env.PERF_CPU ?? 4) });
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 165, downloadThroughput: (9e6 * 0.9) / 8, uploadThroughput: (1.5e6 * 0.9) / 8 });
}

type CardWorld = { tiles: number; settled: number; failed: number; ms: number; readyAt: number; compiledAt: number; gateAt: number };

test('the card world on a mid-range phone: made while the replay plays, on the real coarse land', async ({ context, page }, info) => {
  test.skip(!!process.env.PERF_CITY && !process.env.PERF_CITY.split(',').includes('card'), 'PERF_CITY leaves it out (add card)');
  await realWorld(context, Date.now());
  await midRangePhone(page);
  // a balloon 30 h along, eastward from Manchester over the North Sea: a long route, its own card world
  await page.goto(await linkTo(eastward(30)));
  await page.waitForFunction(() => document.getElementById('scene')?.dataset.live === '1', null, { timeout: 120_000 });
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.view), { timeout: 120_000 }).toBe('flight');
  await page.waitForTimeout(10_000);
  const t0 = await page.evaluate(() => Date.now());
  await page.getByRole('button', { name: 'Show me the whole trip' }).click();
  await expect(page.getByRole('dialog')).toBeVisible({ timeout: 300_000 });
  const c = await page.evaluate(() => (window as unknown as { __card: { startedAt: number; openedAt: number; world: CardWorld } }).__card);
  const replayMs = await page.evaluate(() => (window as unknown as { __live: { replayMs: number | null } }).__live.replayMs);
  const w = c.world;
  const line = `card world: ${w.tiles} tiles wanted, ${w.settled} in, ${w.failed} failed; its land ${w.readyAt ? 'ready' : 'not ready'} ${w.readyAt && w.gateAt ? `${((w.readyAt - w.gateAt) / 1000).toFixed(1)} s from the replay's end` : ''}; replay ${replayMs} ms; card asked ${((c.startedAt - t0) / 1000).toFixed(1)} s and up ${((c.openedAt - t0) / 1000).toFixed(1)} s after the tap`;
  info.annotations.push({ type: 'card world', description: line });
  console.log(`perf-cities: ${line}`);
  expect(w.tiles).toBeGreaterThan(0);
  if (process.env.PERF_SHOT) await page.screenshot({ path: process.env.PERF_SHOT, timeout: 120_000 });
});

test.afterAll(() => {
  if (!all.length) return;
  console.log('perf-cities summary');
  for (const r of all) {
    const p = r.peak;
    console.log(`  ${r.city.padEnd(10)} ${r.scene.padEnd(22)} plain ${String(p.calls).padStart(3)} / ${String(Math.round(p.triangles / 1000)).padStart(4)}k   shadow ${String(p.shadowCalls).padStart(3)} / ${String(Math.round(p.shadowTriangles / 1000)).padStart(4)}k`);
  }
});
