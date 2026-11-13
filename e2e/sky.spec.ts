import { readFileSync } from 'node:fs';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';

/**
 * The tile proof under the real sky at four times on 13 November 2026 over Albert Square,
 * Manchester: dawn (sun about -0.3 deg), noon (18 deg), golden hour (3.5 deg) and midnight (-54 deg).
 * The mean luminance of the picture must rise from midnight to dawn to golden hour to noon.
 *
 * No live services: the OpenFreeMap TileJSON and tiles are answered from the committed z14 fixture
 * (the other eight tiles are empty, as over open sea), the terrain is flat (?flat=1), and WebGL runs
 * on SwiftShader.
 */
test.use({ launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] } });

const PBF = readFileSync(new URL('../tests/fixtures/omt_14_8089_5300.pbf', import.meta.url));
const TIMES = {
  midnight: '2026-11-13T00:00:00Z',
  dawn: '2026-11-13T07:35:00Z',
  golden: '2026-11-13T15:40:00Z',
  noon: '2026-11-13T12:10:00Z',
} as const;

async function fixtureTiles(context: BrowserContext) {
  const external: string[] = [];
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') return route.continue();
    if (url.hostname === 'tiles.openfreemap.org' && url.pathname === '/planet')
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tiles: ['https://tiles.openfreemap.org/fixture/{z}/{x}/{y}.pbf'] }) });
    if (url.hostname === 'tiles.openfreemap.org' && url.pathname.startsWith('/fixture/')) {
      if (url.pathname === '/fixture/14/8089/5300.pbf') return route.fulfill({ status: 200, contentType: 'application/x-protobuf', body: PBF });
      return route.fulfill({ status: 204, body: '' });
    }
    external.push(url.href);
    return route.abort('blockedbyclient');
  });
  return external;
}

/** Mean luminance (Rec. 709, 0..255) of a PNG, decoded in the page. */
function meanLuminance(page: Page, png: Buffer): Promise<number> {
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const x = c.getContext('2d')!;
    x.drawImage(img, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    return sum / (d.length / 4);
  }, png.toString('base64'));
}

test('the tile proof under the real sky: midnight < dawn < golden hour < noon', async ({ context, page }, info) => {
  test.setTimeout(240_000);
  const external = await fixtureTiles(context);
  const lum: Record<string, number> = {};
  const sun: Record<string, number> = {};
  for (const [name, utc] of Object.entries(TIMES)) {
    await page.goto(`/tileproof.html?t=0&flat=1&clean=1&utc=${utc}`);
    await page.waitForFunction(() => (window as unknown as { __tileproof?: { done: boolean } }).__tileproof?.done, null, { timeout: 90_000 });
    const hook = await page.evaluate(() => (window as unknown as { __tileproof: { built: number; failed: number; sunEl: number; triangles: number } }).__tileproof);
    expect(hook.built, `${name}: tiles built`).toBe(9);
    expect(hook.failed).toBe(0);
    await page.waitForTimeout(1500); // the tiles fade in from the haze over 1.1 s
    const shot = await page.screenshot({ path: info.outputPath(`sky-${name}.png`) });
    lum[name] = await meanLuminance(page, shot);
    sun[name] = hook.sunEl;
  }
  console.log('sun elevation', JSON.stringify(sun), 'mean luminance', JSON.stringify(lum));
  expect(sun.midnight).toBeLessThan(-18);
  expect(sun.dawn).toBeGreaterThan(-3);
  expect(sun.dawn).toBeLessThan(1);
  expect(sun.golden).toBeGreaterThan(1);
  expect(sun.golden).toBeLessThan(8);
  expect(sun.noon).toBeGreaterThan(15);
  expect(lum.midnight).toBeLessThan(lum.dawn);
  expect(lum.dawn).toBeLessThan(lum.golden);
  expect(lum.golden).toBeLessThan(lum.noon);
  expect(external).toEqual([]);
});
