import { expect, test, type Page } from '@playwright/test';
import { offline } from './net';

/**
 * Spec 7.1: text reaches 4.5:1 over noon, snow and sand scenes. Each case paints a solid
 * worst-case backdrop behind the chrome (?backdrop=), screenshots the page with the text made
 * transparent, and compares every text colour with the brightest pixel behind its glyph boxes.
 * The Let go label is large bold text on its own orange: 3:1 applies there.
 */
type Sample = { what: string; ratio: number; need: number };

async function measure(page: Page): Promise<Sample[]> {
  const targets = await page.evaluate(() => {
    const vw = innerWidth;
    const out: { what: string; color: string; rects: { x: number; y: number; w: number; h: number }[]; need: number }[] = [];
    // every visible element of the start screen with text of its own, measured per text node
    const root = document.querySelector('.start') ?? document.body;
    for (const el of [root, ...root.querySelectorAll<HTMLElement>('*')] as HTMLElement[]) {
      if (!el.checkVisibility({ visibilityProperty: true, opacityProperty: true })) continue;
      const cs = getComputedStyle(el);
      // a scrolling row fades its last 28 px into the shading only while the mask applies (not on wide screens)
      const faded = (el.closest('.cities, .mine') && getComputedStyle(el.closest('.cities, .mine')!).maskImage !== 'none') ? 28 : 0;
      const rects: { x: number; y: number; w: number; h: number }[] = [];
      for (const node of el.childNodes) {
        if (node.nodeType !== Node.TEXT_NODE || !node.textContent?.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const r of range.getClientRects()) {
          if (r.width <= 0 || r.height <= 0) continue;
          if (r.right > vw - faded || r.left < 0 || r.bottom <= 0 || r.top >= innerHeight) { rects.length = 0; break; }
          rects.push({ x: r.left, y: r.top, w: r.width, h: r.height });
        }
      }
      if (!rects.length) continue;
      const size = parseFloat(cs.fontSize);
      const large = size >= 24 || (size >= 18.66 && Number(cs.fontWeight) >= 700);
      out.push({
        what: `${el.className}: ${el.textContent?.trim().slice(0, 24)}`,
        color: cs.color,
        rects,
        need: large ? 3 : 4.5,
      });
    }
    return out;
  });
  expect(targets.length).toBeGreaterThan(8);

  await page.addStyleTag({ content: '* { color: transparent !important; text-decoration-color: transparent !important; } .letgo { color: transparent !important; }' });
  const shot = (await page.screenshot()).toString('base64');
  return page.evaluate(async ({ shot, targets }) => {
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
      const [r, gg, b, a = 1] = t.color.match(/[\d.]+/g)!.map(Number);
      let worst = 1e9;
      for (const rc of t.rects) {
        const d = g.getImageData(Math.floor(rc.x), Math.floor(rc.y), Math.max(1, Math.ceil(rc.w)), Math.max(1, Math.ceil(rc.h))).data;
        for (let i = 0; i < d.length; i += 4) {
          const bg = [d[i], d[i + 1], d[i + 2]];
          const fg = [r * a + bg[0] * (1 - a), gg * a + bg[1] * (1 - a), b * a + bg[2] * (1 - a)];
          const L1 = lum(fg[0], fg[1], fg[2]);
          const L2 = lum(bg[0], bg[1], bg[2]);
          const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
          if (ratio < worst) worst = ratio;
        }
      }
      return { what: t.what, ratio: Math.round(worst * 100) / 100, need: t.need };
    });
  }, { shot, targets });
}

for (const size of [{ width: 390, height: 660 }, { width: 390, height: 844 }, { width: 1440, height: 900 }]) {
  for (const backdrop of ['noon', 'snow', 'sand']) {
    test(`text contrast over ${backdrop} is at least 4.5:1 at ${size.width}x${size.height} (pixels behind each text box)`, async ({ page }) => {
      await page.setViewportSize(size);
      await offline(page);
      await page.addInitScript(() => {
        const hourly = Array.from({ length: 73 }, (_, h) => ({ lat: 38.72 + h * 0.05, lon: -9.14 + h * 0.2 }));
        const b = { v: 1, name: 'Lisbon', start: hourly[0], release: Date.now() - 14.5 * 3600e3, hourly, runId: '1731403800' };
        try { localStorage.setItem('lgoab.balloons.v1', JSON.stringify([b])); } catch { /* none */ }
      });
      await page.goto(`/?backdrop=${backdrop}`);
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(700); // shading transition
      const samples = await measure(page);
      const low = samples.filter((s) => s.ratio < s.need);
      const body = samples.filter((s) => s.need === 4.5);
      console.log(`${backdrop} ${size.width}x${size.height}: text min ${Math.min(...body.map((s) => s.ratio))} over ${body.length} (${[...body].sort((a, b) => a.ratio - b.ratio)[0].what}); large text min ${Math.min(...samples.filter((s) => s.need === 3).map((s) => s.ratio))}`);
      expect(low, JSON.stringify(low)).toEqual([]);
    });
  }
}
