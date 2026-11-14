import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { liveWorld, SWIFTSHADER } from './fixtures';

/**
 * The launch's smoothness probe (Task 26c): from the tap to Ride settled, the camera every frame (where
 * it is, the way it looks, its field of view), the director's own choices and the drawn balloon, on the
 * fixture world (e2e/fixtures.ts). It only runs when asked, and writes what it saw to LAUNCH_PROBE_OUT:
 *
 *   LAUNCH_PROBE=1 LAUNCH_PROBE_OUT=dir CI=1 E2E_PORT=5188 npx playwright test e2e/launch-probe.spec.ts --workers=1 --trace off
 *
 * The page's clock is taken over (Date.now, performance.now and requestAnimationFrame), so the frames come at
 * a simulated rate whatever the software renderer manages: 30 Hz with a few milliseconds of jitter and a
 * dropped frame now and then (LAUNCH_PROBE_FIXED=1: 30 Hz exactly). LAUNCH_PROBE_REAL=1 runs on the real
 * clock instead, as a phone would, and records the main thread's long tasks for the first 20 s.
 * LAUNCH_PROBE_SHOTS=1 saves a picture a second from the tap, and four a second for the first 4 s.
 * LAUNCH_PROBE_CITY=london (or london,paris) runs only those.
 */
test.skip(!process.env.LAUNCH_PROBE, 'the launch probe: LAUNCH_PROBE=1');
test.use(SWIFTSHADER);
test.describe.configure({ mode: 'default', timeout: 1_800_000 });

const OUT = process.env.LAUNCH_PROBE_OUT ?? 'test-results/launch-probe';
const REAL = !!process.env.LAUNCH_PROBE_REAL;
const FIXED = !!process.env.LAUNCH_PROBE_FIXED;
const SHOTS = !!process.env.LAUNCH_PROBE_SHOTS;
const ONLY = process.env.LAUNCH_PROBE_CITY?.split(',');

type City = { id: string; name: string; lat: number; lon: number; kind: string; cityId?: string };
const CITIES: City[] = [
  { id: 'london', name: 'London', lat: 51.5007, lon: -0.1263, kind: 'default', cityId: 'london' },
  { id: 'manchester', name: 'Manchester', lat: 53.47945, lon: -2.2455, kind: 'search' },
  { id: 'paris', name: 'Paris', lat: 48.8556, lon: 2.2986, kind: 'featured', cityId: 'paris' },
];

/** The page's clock, taken over: frames are stepped from the test, at the times it chooses. */
function clockScript() {
  type Cb = (t: number) => void;
  const w = window as unknown as Record<string, unknown>;
  const perf = performance;
  const realNow = perf.now.bind(perf);
  const realDate = Date.now;
  const realRaf = window.requestAnimationFrame.bind(window);
  const realCancel = window.cancelAnimationFrame.bind(window);
  const P = { on: false, t: 0, off: 0, q: [] as [number, Cb][], id: 1e6, gone: new Set<number>(), realNow, long: [] as number[][], frames: [] as number[][] };
  w.__probe = P;
  perf.now = () => (P.on ? P.t : realNow());
  Date.now = () => (P.on ? Math.round(P.t + P.off) : realDate());
  window.requestAnimationFrame = (cb: FrameRequestCallback) => {
    if (!P.on) return realRaf(cb);
    const id = P.id++;
    P.q.push([id, cb]);
    return id;
  };
  window.cancelAnimationFrame = (id: number) => {
    if (id >= 1e6) P.gone.add(id);
    else realCancel(id);
  };
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) P.long.push([e.startTime, e.duration]);
    }).observe({ type: 'longtask', buffered: true });
  } catch {
    /* no long task timing */
  }
}

type Rec = { t: number; ms: number; cam: number[]; look: number[]; fov: number; target: number[]; shot: string; launchS: number; person: string | null; probe: Record<string, unknown>; slide: number[]; alt: number; agl: number };

/** Step the page's frames by these times (ms each), recording the camera after each. */
async function step(page: Page, dts: number[]): Promise<Rec[]> {
  return page.evaluate(async (dts) => {
    const w = window as unknown as Record<string, unknown>;
    const P = w.__probe as { t: number; q: [number, (t: number) => void][]; gone: Set<number>; realNow: () => number };
    const out: Rec[] = [];
    for (const dt of dts) {
      P.t += dt;
      const q = P.q;
      P.q = [];
      const t0 = P.realNow();
      for (const [id, cb] of q) {
        if (P.gone.delete(id)) continue;
        try {
          cb(P.t);
        } catch (e) {
          console.error(e);
        }
      }
      const ms = P.realNow() - t0;
      const h = w.__live as { camera: number[]; look: number[]; fov: number; target: number[]; shot: string; launchS: number; person: string | null; cam: Record<string, unknown>; slide: number[]; route: { altM: number } | null; aglM: number };
      out.push({ t: P.t, ms, cam: [...h.camera], look: [...h.look], fov: h.fov, target: [...h.target], shot: h.shot, launchS: h.launchS, person: h.person, probe: JSON.parse(JSON.stringify(h.cam)), slide: [...h.slide], alt: h.route?.altM ?? NaN, agl: h.aglM });
      // let the workers' meshes and the network in, as between real frames
      await new Promise((r) => setTimeout(r, 0));
    }
    return out;
    type Rec = { t: number; ms: number; cam: number[]; look: number[]; fov: number; target: number[]; shot: string; launchS: number; person: string | null; probe: Record<string, unknown>; slide: number[]; alt: number; agl: number };
  }, dts);
}

/** A seeded generator, so a jittered run is the same every time. */
function rng(seed = 7) {
  return () => (seed = (seed * 16807) % 2147483647) / 2147483647;
}

for (const c of CITIES) {
  test(`launch probe: ${c.name}`, async ({ context, page }) => {
    test.skip(!!ONLY && !ONLY.includes(c.id), 'not asked for');
    mkdirSync(OUT, { recursive: true });
    await liveWorld(context);
    await context.addInitScript((p) => localStorage.setItem('lgoab.lastPlace.v1', p), JSON.stringify({ name: c.name, lat: c.lat, lon: c.lon, kind: c.kind, cityId: c.cityId }));
    await context.addInitScript(clockScript);
    await page.goto('/');
    await page.waitForFunction(() => document.getElementById('scene')?.dataset.live === '1', null, { timeout: 120_000 });
    const tag = `${c.id}-${REAL ? 'real' : FIXED ? 'fixed' : 'jitter'}`;
    const shot = (name: string) => (SHOTS ? page.screenshot({ path: join(OUT, `${tag}-${name}.png`), timeout: 300_000 }) : Promise.resolve());

    if (REAL) {
      // the real clock: what a slow device sees, frame times and long tasks included
      await page.waitForTimeout(8000);
      await page.evaluate(() => {
        const P = (window as unknown as { __probe: { realNow: () => number; frames: unknown[]; long: unknown[]; rec: unknown[]; t0: number } }).__probe;
        P.long = [];
        P.rec = [];
        P.t0 = P.realNow();
        const loop = () => {
          const h = (window as unknown as { __live: { camera: number[]; look: number[]; fov: number; target: number[]; shot: string; launchS: number; person: string | null; cam: unknown; slide: number[] } }).__live;
          P.rec.push({ t: P.realNow(), cam: [...h.camera], look: [...h.look], fov: h.fov, target: [...h.target], shot: h.shot, launchS: h.launchS, person: h.person, probe: JSON.parse(JSON.stringify(h.cam)), slide: [...h.slide] });
          requestAnimationFrame(loop);
        };
        requestAnimationFrame(loop);
      });
      await page.getByRole('button', { name: 'Let go', exact: true }).click();
      const t0 = Date.now();
      await expect.poll(() => page.evaluate(() => document.documentElement.dataset.view), { timeout: 600_000, intervals: [500] }).toBe('flight');
      const settleS = (Date.now() - t0) / 1000;
      await page.waitForTimeout(3000);
      const data = await page.evaluate(() => {
        const P = (window as unknown as { __probe: { long: number[][]; rec: unknown[]; t0: number } }).__probe;
        return { long: P.long, rec: P.rec, t0: P.t0 };
      });
      writeFileSync(join(OUT, `${tag}.json`), JSON.stringify({ city: c.id, mode: 'real', settleS, ...data }));
      return;
    }

    // the clock taken over: 6 s of the start screen at 30 Hz (the world streams in meanwhile), then the tap
    await page.evaluate(() => {
      const P = (window as unknown as { __probe: { on: boolean; t: number; off: number; realNow: () => number } }).__probe;
      P.t = P.realNow();
      P.off = Date.now() - P.t;
      P.on = true;
    });
    const r = rng();
    const dtAt = (i: number) => (FIXED ? 1000 / 30 : i % 67 === 40 ? 2000 / 30 : 1000 / 30 + (r() - 0.5) * 6);
    for (let k = 0; k < 6; k++) await step(page, Array.from({ length: 30 }, () => 1000 / 30));
    await shot('start');
    await page.getByRole('button', { name: 'Let go', exact: true }).click();
    const recs: Rec[] = [];
    let i = 0;
    let settledAt = Number.NaN;
    // pictures: four a second for the first 4 s, then one a second
    let next = 0.25;
    const tTap = (await page.evaluate(() => (window as unknown as { __probe: { t: number } }).__probe.t)) / 1000;
    while (i < 50 * 30) {
      const batch: number[] = [];
      let tb = recs.length ? recs[recs.length - 1].t / 1000 - tTap : 0;
      while (tb < next - 1e-6) {
        const dt = dtAt(i++);
        batch.push(dt);
        tb += dt / 1000;
      }
      recs.push(...(await step(page, batch)));
      const now = recs[recs.length - 1];
      await shot(`t${(tb).toFixed(2).padStart(5, '0')}`);
      next += tb < 4 - 1e-6 ? 0.25 : 1;
      if (Number.isNaN(settledAt) && now.shot !== 'launch' && now.person === 'released') settledAt = tb;
      if (!Number.isNaN(settledAt) && tb > settledAt + 4) break;
    }
    writeFileSync(join(OUT, `${tag}.json`), JSON.stringify({ city: c.id, mode: FIXED ? 'fixed' : 'jitter', tTap, settledAt, recs }));
    expect(settledAt).toBeGreaterThan(0);
  });
}
