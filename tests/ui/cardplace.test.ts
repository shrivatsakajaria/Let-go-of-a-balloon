import { describe, expect, test } from 'vitest';
import { CARD_H, CARD_W, costGrid, costUnder, fitName, lineHits, MARGIN, MAX_PLACES, NAME_MAX, NAME_MAX_W, NAME_MIN, overlaps, panelLayout, pickPlaces, placeNames, type Box, type CardFont, type CostGrid, type Pt } from '../../src/ui/cardplace';

/** A stand-in for measureText: about 0.47 em a character bold condensed, wider for the plain face. */
const measure = (text: string, f: CardFont) => [...text].reduce((w, c) => w + f.size * (c === ' ' ? 0.22 : f.weight >= 600 ? 0.47 : 0.42) * (f.condensed ? 1 : 1.25) + (f.spacing ?? 0), 0);

/** A picture: sea (teal) on the left half, land (green) on the right; w x h RGBA. */
function picture(w: number, h: number, land: (x: number, y: number) => boolean): Uint8ClampedArray {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const [r, g, b] = land(x, y) ? [110, 150, 80] : [40, 120, 150];
      px[i] = r;
      px[i + 1] = g;
      px[i + 2] = b;
      px[i + 3] = 255;
    }
  return px;
}

const BOUNDS: Box = { x0: 48, y0: 40, x1: CARD_W - 48, y1: 950 };
const ring = (p: Pt): Box => ({ x0: p.x - 18, y0: p.y - 18, x1: p.x + 18, y1: p.y + 18 });
const balloon = (p: Pt): Box => ({ x0: p.x - 30, y0: p.y - 95, x1: p.x + 30, y1: p.y + 6 });

describe('costGrid', () => {
  test('sea is cheap to cover, land dearer, glare dearest', () => {
    const w = 200, h = 100;
    const px = picture(w, h, (x) => x >= 100);
    // a pale band (haze, sand) along the bottom
    for (let y = 80; y < h; y++) for (let x = 0; x < w; x++) px.set([235, 230, 220, 255], (y * w + x) * 4);
    const g = costGrid(px, w, h, 20);
    const sea = costUnder(g, { x0: 0, y0: 0, x1: 80, y1: 60 });
    const land = costUnder(g, { x0: 120, y0: 0, x1: 200, y1: 60 });
    const pale = costUnder(g, { x0: 0, y0: 80, x1: 200, y1: 100 });
    expect(sea).toBeLessThan(land);
    expect(land).toBeLessThan(pale);
  });
});

describe('placeNames', () => {
  const grid: CostGrid = costGrid(picture(CARD_W, 1000, (x) => x > 700), CARD_W, 1000);
  const start = { x: 760, y: 760 }, landing = { x: 780, y: 300 };
  const route: Pt[] = Array.from({ length: 40 }, (_, i) => ({ x: 760 + 20 * Math.sin(i / 6), y: 760 - (460 * i) / 39 }));
  const inputs = () => ({
    start: { block: fitName('Manchester', 'Let go Mon 9 Nov, 18:48', measure), at: start, clear: ring(start) },
    landing: { block: fitName('Bergen', '', measure), at: landing, clear: balloon(landing) },
  });

  test('both names go over the sea (the cheaper side), never over the route, the markers or each other', () => {
    const p = placeNames({ ...inputs(), route, grid, bounds: BOUNDS });
    for (const n of [p.start!, p.landing!]) {
      expect(lineHits(route, n.box, 14)).toBe(false);
      expect(overlaps(n.box, ring(start), 8)).toBe(false);
      expect(overlaps(n.box, balloon(landing), 8)).toBe(false);
      // over the sea on the left
      expect(n.box.x1).toBeLessThanOrEqual(730);
      expect(n.box.x0).toBeGreaterThanOrEqual(BOUNDS.x0);
      expect(n.box.y1).toBeLessThanOrEqual(BOUNDS.y1);
    }
    expect(overlaps(p.start!.box, p.landing!.box)).toBe(false);
    expect(p.start!.align).toBe('right');
  });

  test('with the sea on the right they move to the right', () => {
    const mirror = (q: Pt) => ({ x: CARD_W - q.x, y: q.y });
    const g2 = costGrid(picture(CARD_W, 1000, (x) => x < CARD_W - 700), CARD_W, 1000);
    const s2 = mirror(start), l2 = mirror(landing);
    const p = placeNames({
      start: { block: fitName('Manchester', 'Let go Mon 9 Nov, 18:48', measure), at: s2, clear: ring(s2) },
      landing: { block: fitName('Bergen', '', measure), at: l2, clear: balloon(l2) },
      route: route.map(mirror),
      grid: g2,
      bounds: BOUNDS,
    });
    expect(p.landing!.box.x0).toBeGreaterThanOrEqual(CARD_W - 730);
    expect(p.start!.box.x0).toBeGreaterThanOrEqual(CARD_W - 730);
  });

  test('a name near the edge slides in rather than running off the card', () => {
    const edge = { x: 70, y: 500 };
    const p = placeNames({ start: null, landing: { block: fitName('Bergen', '', measure), at: edge, clear: balloon(edge) }, route: [], grid, bounds: BOUNDS });
    expect(p.landing!.box.x0).toBeGreaterThanOrEqual(BOUNDS.x0);
    expect(p.landing!.box.x1).toBeLessThanOrEqual(BOUNDS.x1);
    expect(p.start).toBeNull();
  });
});

describe('fitName', () => {
  test('a short name is set big; a long one smaller; a very long one is cut short to fit', () => {
    expect(fitName('Bergen', '', measure).size).toBe(NAME_MAX);
    const long = fitName('Newcastle upon Tyne', '', measure);
    expect(long.size).toBeLessThan(NAME_MAX);
    expect(long.nameW).toBeLessThanOrEqual(NAME_MAX_W);
    const huge = fitName('Santa Cruz de la Sierra in the Department of Santa Cruz', '', measure);
    expect(huge.size).toBe(NAME_MIN);
    expect(huge.text.endsWith('…')).toBe(true);
    expect(huge.nameW).toBeLessThanOrEqual(NAME_MAX_W);
  });
});

describe('pickPlaces', () => {
  const route: Pt[] = [{ x: 540, y: 800 }, { x: 540, y: 300 }];
  test('keeps a few names, clear of the route and the names, below the horizon, the important first', () => {
    const places = [
      { text: 'North Sea', kind: 'sea' as const, rank: 1, x: 700, y: 560 },
      { text: 'Norway', kind: 'country' as const, rank: 2, x: 760, y: 250 },
      { text: 'Denmark', kind: 'country' as const, rank: 2, x: 850, y: 450 },
      { text: 'Ireland', kind: 'country' as const, rank: 2, x: 200, y: 820 },
      { text: 'Germany', kind: 'country' as const, rank: 1, x: 900, y: 700 },
      { text: 'Sweden', kind: 'country' as const, rank: 2, x: 950, y: 120 }, // in the sky
      { text: 'Middle', kind: 'country' as const, rank: 1, x: 545, y: 500 }, // on the route
      { text: 'Covered', kind: 'country' as const, rank: 1, x: 200, y: 400 }, // under a big name
      { text: 'Faroe Islands', kind: 'country' as const, rank: 5, x: 300, y: 600 },
    ];
    const got = pickPlaces({ places, route, avoid: [{ x0: 100, y0: 330, x1: 400, y1: 460 }], m: measure, bounds: BOUNDS, skyY: 150 });
    const names = got.map((p) => p.text);
    expect(got.length).toBeLessThanOrEqual(MAX_PLACES);
    expect(names[0]).toBe('NORTH SEA');
    expect(names).not.toContain('SWEDEN');
    // a name whose own spot is on the route or under a big name moves a little way off, or is left out
    for (const p of got) {
      expect(lineHits(route, p.box, 16)).toBe(false);
      expect(overlaps(p.box, { x0: 100, y0: 330, x1: 400, y1: 460 }, 14)).toBe(false);
    }
    for (const a of got) for (const b of got) if (a !== b) expect(overlaps(a.box, b.box)).toBe(false);
  });

  test('leaves out the landing\'s own name when the map has it too', () => {
    const got = pickPlaces({ places: [{ text: 'North Sea', kind: 'sea', rank: 1, x: 700, y: 560 }], route, avoid: [], m: measure, bounds: BOUNDS, exclude: ['North Sea'] });
    expect(got).toEqual([]);
  });
});

describe('panelLayout', () => {
  const words = {
    kicker: 'Landed',
    when: 'Thu 12 Nov, 18:48',
    stats: [
      { label: 'Distance', num: '894', unit: 'km' },
      { label: 'Time aloft', num: '72', unit: 'h' },
      { label: 'Top speed', num: '14', unit: 'km/h' },
    ],
    compare: 'About the length of Britain',
    credit: 'let-go-of-a-balloon.pages.dev · Winds: NOAA GFS · Map: © OpenMapTiles © OpenStreetMap contributors · Natural Earth · Terrain: © Mapterhorn · A Still Signal build',
    ticks: [0.2, 0.53, 0.86],
  };

  test('everything inside the margins, in order from the kicker down to the credit line, under the picture\'s fade', () => {
    const P = panelLayout(words, measure);
    for (const t of P.texts) {
      expect(t.x).toBeGreaterThanOrEqual(MARGIN - 0.5);
      expect(t.x + t.width).toBeLessThanOrEqual(CARD_W - MARGIN + 0.5);
      expect(t.y).toBeLessThanOrEqual(CARD_H - 30);
    }
    const y = (r: string) => P.texts.find((t) => t.role === r)!.y;
    expect(y('kicker')).toBeLessThan(P.line.y);
    expect(P.line.y).toBeLessThan(y('stat-value'));
    expect(y('stat-value')).toBeLessThan(y('stat-label'));
    expect(y('stat-label')).toBeLessThan(y('compare'));
    expect(y('compare')).toBeLessThan(y('credit'));
    expect(P.fadeBottom).toBeLessThan(y('kicker') - 30);
    expect(P.fadeTop).toBeGreaterThan(700);
    // the credit line breaks between credits only
    const credit = P.texts.filter((t) => t.role === 'credit').map((t) => t.text);
    expect(credit.join(' · ')).toBe(words.credit);
    // big stats
    expect(P.texts.find((t) => t.role === 'stat-value')!.font.size).toBeGreaterThanOrEqual(88);
  });

  test('a long distance shrinks all three numbers together to fit their columns; no comparison line leaves no gap for one', () => {
    const P = panelLayout({ ...words, compare: null, stats: [{ label: 'Distance', num: '12,345', unit: 'km' }, words.stats[1], words.stats[2]] }, measure);
    const vals = P.texts.filter((t) => t.role === 'stat-value');
    expect(new Set(vals.map((v) => v.font.size)).size).toBe(1);
    const unit0 = P.texts.find((t) => t.role === 'stat-unit' && t.stat === 0)!;
    expect(unit0.x + unit0.width).toBeLessThan(P.texts.find((t) => t.role === 'stat-value' && t.stat === 1)!.x);
    expect(P.texts.some((t) => t.role === 'compare')).toBe(false);
  });
});
