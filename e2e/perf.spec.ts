import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { liveWorld, startAtAlbertSquare, SWIFTSHADER } from './fixtures';

/**
 * The performance budget (spec 12, the plan's Global Constraints), measured at 390 x 844 with the CPU
 * slowed 4x and the network at DevTools' "Fast 4G", on the fixture winds, map and terrain:
 *  - first paint (the sky and the title) and the 3D world's first frame within 2 s;
 *  - the route ready within 2 s of Let go;
 *  - during 20 s of live flight, under 600,000 triangles and 250 draw calls a frame (renderer.info,
 *    shadow pass included).
 * WebGL runs in software here (SwiftShader), so frame rates mean nothing: `?fps=1` is for a real phone.
 * Each test records its numbers as annotations (and in the log). PERF_CPU=1 and PERF_NET=0 turn the
 * slowdowns off, to see what each one costs.
 *
 * Timings on a shared test machine are noisy (another job's load shows up as a slow route or a late
 * first frame), so the two timing tests get one more try before they count as failed.
 */
test.use(SWIFTSHADER);
test.describe.configure({ mode: 'default', timeout: 150_000 });

const TRIANGLE_CAP = 600_000;
const CALL_CAP = 250;
const BUDGET_MS = 2000;

type Peak = { triangles: number; calls: number; shadowTriangles: number; shadowCalls: number };
type Hook = { state: string; person: string | null; routeMs: number | null; routeError: string | null; triangles: number; calls: number; frames: number; peak: Peak };
const hook = (page: Page) => page.evaluate(() => (window as unknown as { __live?: Hook }).__live ?? null);

/** A mid-range phone on 4G: CPU 4x slower, DevTools' "Fast 4G" (9 Mb/s down, 1.5 Mb/s up, 165 ms). */
async function midRangePhone(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: Number(process.env.PERF_CPU ?? 4) });
  if (process.env.PERF_NET === '0') return;
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 165, downloadThroughput: (9e6 * 0.9) / 8, uploadThroughput: (1.5e6 * 0.9) / 8 });
}

function record(info: TestInfo, name: string, value: number | string) {
  info.annotations.push({ type: name, description: String(value) });
  console.log(`perf: ${name} = ${value}`);
}

/** When the 3D world's first frame lands (ms from navigation start). */
async function watchFirstFrame(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __firstFrameMs?: number };
    new MutationObserver((_, obs) => {
      if (document.getElementById('scene')?.dataset.live === '1') {
        w.__firstFrameMs = performance.now();
        obs.disconnect();
      }
    }).observe(document, { subtree: true, attributes: true, attributeFilter: ['data-live'] });
  });
}

test.describe('timings', () => {
  test.describe.configure({ retries: 1 });

  test('something is on screen within 2 s: the sky and the title, then the 3D world', async ({ context, page }, info) => {
    await liveWorld(context);
    await startAtAlbertSquare(context);
    await watchFirstFrame(page);
    await midRangePhone(page);
    await page.goto('/');
    await page.waitForFunction(() => document.getElementById('scene')?.dataset.live === '1', null, { timeout: 60_000 });
    const t = await page.evaluate(() => ({
      fcp: performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? NaN,
      frame: (window as unknown as { __firstFrameMs?: number }).__firstFrameMs ?? NaN,
    }));
    record(info, 'first contentful paint (ms)', Math.round(t.fcp));
    record(info, '3D first frame (ms)', Math.round(t.frame));
    expect(t.fcp).toBeLessThan(BUDGET_MS);
    // the 3D world's first frame: compiled shaders and the first tiles on a software renderer. The budget is
    // for a phone's GPU; here it is recorded, and held to a loose bound that still catches a regression.
    expect(t.frame).toBeLessThan(BUDGET_MS * 6);
  });

  test('the route is ready within 2 s of Let go', async ({ context, page }, info) => {
    await liveWorld(context);
    await startAtAlbertSquare(context);
    await midRangePhone(page);
    await page.goto('/');
    await page.waitForFunction(() => document.getElementById('scene')?.dataset.live === '1', null, { timeout: 60_000 });
    // the winds and the ground under the start load while the visitor reads (spec 6.1: they load from the
    // moment the start place is known); on the slowed phone that takes a few seconds
    await page.waitForTimeout(5000);
    await page.getByRole('button', { name: 'Let go', exact: true }).click();
    await expect.poll(async () => (await hook(page))?.routeMs ?? (await hook(page))?.routeError ?? null, { timeout: 30_000 }).not.toBeNull();
    const h = (await hook(page))!;
    expect(h.routeError).toBeNull();
    record(info, 'route ready after Let go (ms)', h.routeMs!);
    expect(h.routeMs!).toBeLessThan(BUDGET_MS);
  });
});

test('the hard caps hold during 20 s of live flight (renderer.info)', async ({ context, page }, info) => {
  await liveWorld(context);
  await startAtAlbertSquare(context);
  await page.goto('/');
  await page.waitForFunction(() => document.getElementById('scene')?.dataset.live === '1', null, { timeout: 60_000 });
  await page.waitForTimeout(3000);
  await page.getByRole('button', { name: 'Let go', exact: true }).click();
  const released = async () => {
    const h = await hook(page);
    return h?.routeError ? `error: ${h.routeError}` : h?.person;
  };
  await expect.poll(released, { timeout: 30_000 }).toBe('released');
  // from the hand opening: the street, the climb past the roofs, and the town opening out below
  // (every frame counts through the hook's peaks, the rare shadow redraws included)
  await page.evaluate(() => {
    const p = (window as unknown as { __live: Hook }).__live.peak;
    p.triangles = p.calls = p.shadowTriangles = p.shadowCalls = 0;
  });
  const t0 = Date.now();
  let tris = 0, calls = 0, samples = 0;
  let last = (await hook(page))!.frames;
  while (Date.now() - t0 < 20_000) {
    const h = (await hook(page))!;
    if (h.frames !== last) {
      last = h.frames;
      samples++;
      tris = Math.max(tris, h.triangles);
      calls = Math.max(calls, h.calls);
    }
    await page.waitForTimeout(100);
  }
  const peak = (await hook(page))!.peak;
  tris = Math.max(tris, peak.triangles, peak.shadowTriangles);
  calls = Math.max(calls, peak.calls, peak.shadowCalls);
  record(info, 'frames sampled', samples);
  record(info, 'most triangles in a frame', tris);
  record(info, 'most draw calls in a frame', calls);
  expect(samples).toBeGreaterThan(5);
  // On the fixtures (one dense z14 tile round Albert Square, open land elsewhere). The dense cities on
  // the real map are checked by e2e/perf-cities.spec.ts (opt-in: it needs the network).
  expect.soft(tris).toBeLessThan(TRIANGLE_CAP);
  expect.soft(calls).toBeLessThan(CALL_CAP);
});

test('?fps=1 shows a frame counter on screen', async ({ context, page }) => {
  await liveWorld(context);
  await startAtAlbertSquare(context);
  await page.goto('/?fps=1');
  await expect(page.locator('.fps')).toHaveText(/^\d+ fps · slowest \d+ ms$/, { timeout: 15_000 });
  await expect(page.locator('.fps')).toBeInViewport();
  // and none without it
  await page.goto('/');
  await page.waitForTimeout(500);
  await expect(page.locator('.fps')).toHaveCount(0);
});
