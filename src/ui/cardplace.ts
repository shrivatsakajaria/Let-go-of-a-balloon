/**
 * Where the landing card's words go (spec 6.5, design A). Pure: measuring is passed in.
 *
 *  - The two big place names go where they cover the least land and the least bright ground (prefer
 *    sea, dark sky or the fade into ink), and never over the route or the markers: a few candidate
 *    spots round each marker, the best pair taken (placeNames, over a cost grid made from the picture's
 *    pixels: costGrid).
 *  - A few of the map's country and sea names, the ones that help someone recognise where this is,
 *    in light small caps where they do not crowd the route, the markers or the names (pickPlaces).
 *  - The bottom panel: the kicker and time, the day-progress line, three stats, the comparison line and
 *    the credit line (panelLayout).
 */
export type CardFont = { size: number; weight: number; condensed: boolean; spacing?: number };
export type Measure = (text: string, font: CardFont) => number;
export type Box = { x0: number; y0: number; x1: number; y1: number };
export type Pt = { x: number; y: number };

export const CARD_W = 1080;
export const CARD_H = 1350;
/** The picture above the panel. */
export const PICTURE_H = 1000;
export const MARGIN = 72;

// ---- the cost of covering the picture ----

/** The picture in cells: how much each costs to cover (land, and brightness: off-white text must read). */
export type CostGrid = { cell: number; cols: number; rows: number; cost: Float32Array };

/**
 * From the picture's pixels (RGBA, w x h): water (blue and teal) and dark sky cost little; land costs
 * more; anything bright (pale haze, sand, snow) costs most, since off-white text over it would not read.
 */
export function costGrid(px: Uint8ClampedArray | Uint8Array, w: number, h: number, cell = 20): CostGrid {
  const cols = Math.ceil(w / cell), rows = Math.ceil(h / cell);
  const cost = new Float32Array(cols * rows);
  const n = new Float32Array(cols * rows);
  const step = 3;
  for (let y = 0; y < h; y += step)
    for (let x = 0; x < w; x += step) {
      const i = (y * w + x) * 4;
      const r = px[i] / 255, g = px[i + 1] / 255, b = px[i + 2] / 255;
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      // sea is blue to teal, and stays cool under the haze (grey-green, its blue not under its red); land is warmer
      const water = b >= r - 0.01 && b >= g - 0.12;
      const c = (water ? 0.15 : 1) + Math.max(0, lum - 0.42) * 4;
      const k = Math.floor(y / cell) * cols + Math.floor(x / cell);
      cost[k] += c;
      n[k]++;
    }
  for (let k = 0; k < cost.length; k++) cost[k] = n[k] ? cost[k] / n[k] : 1;
  return { cell, cols, rows, cost };
}

/** The mean cost under a box (outside the grid counts as dear). */
export function costUnder(g: CostGrid, b: Box): number {
  let sum = 0, n = 0;
  for (let y = b.y0; y < b.y1; y += g.cell / 2)
    for (let x = b.x0; x < b.x1; x += g.cell / 2) {
      const c = Math.floor(x / g.cell), r = Math.floor(y / g.cell);
      sum += c < 0 || r < 0 || c >= g.cols || r >= g.rows ? 3 : g.cost[r * g.cols + c];
      n++;
    }
  return n ? sum / n : 0;
}

// ---- geometry ----

export const overlaps = (a: Box, b: Box, pad = 0): boolean => a.x0 < b.x1 + pad && b.x0 < a.x1 + pad && a.y0 < b.y1 + pad && b.y0 < a.y1 + pad;

/** Whether a segment crosses a box (Liang-Barsky). */
function segHits(a: Pt, b: Pt, r: Box): boolean {
  let t0 = 0, t1 = 1;
  const dx = b.x - a.x, dy = b.y - a.y;
  const clip = (p: number, q: number) => {
    if (p === 0) return q >= 0;
    const t = q / p;
    if (p < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
    return true;
  };
  return clip(-dx, a.x - r.x0) && clip(dx, r.x1 - a.x) && clip(-dy, a.y - r.y0) && clip(dy, r.y1 - a.y);
}

/** Whether a polyline passes within `pad` of a box. */
export function lineHits(line: Pt[], b: Box, pad = 0): boolean {
  const r = { x0: b.x0 - pad, y0: b.y0 - pad, x1: b.x1 + pad, y1: b.y1 + pad };
  for (let i = 1; i < line.length; i++) if (segHits(line[i - 1], line[i], r)) return true;
  return line.length === 1 && line[0].x >= r.x0 && line[0].x <= r.x1 && line[0].y >= r.y0 && line[0].y <= r.y1;
}

// ---- the two big names ----

export const NAME_MAX = 128;
export const NAME_MIN = 72;
/** A name is never wider than this. */
export const NAME_MAX_W = 600;
export const SUB_SIZE = 30;
export const nameFont = (size: number): CardFont => ({ size, weight: 700, condensed: true });
export const subFont: CardFont = { size: SUB_SIZE, weight: 500, condensed: false };

/** A name and its small line, measured: the block it takes. */
export type NameBlock = { text: string; sub: string; size: number; w: number; h: number; nameW: number; subW: number };

/** The name at the largest size from NAME_MAX down to NAME_MIN that fits NAME_MAX_W (else cut short with an ellipsis). */
export function fitName(text: string, sub: string, m: Measure, maxW = NAME_MAX_W, maxSize = NAME_MAX): NameBlock {
  let size = Math.max(NAME_MIN, Math.min(NAME_MAX, maxSize));
  while (size > NAME_MIN && m(text, nameFont(size)) > maxW) size -= 4;
  let t = text;
  if (m(t, nameFont(size)) > maxW) {
    while (t.length > 1 && m(`${t}…`, nameFont(size)) > maxW) t = t.slice(0, -1).trimEnd();
    t = `${t}…`;
  }
  const nameW = m(t, nameFont(size));
  const subW = sub ? m(sub, subFont) : 0;
  // cap height about 0.72 em; the small line 14 px under the name's baseline plus its own size
  const h = Math.round(size * 0.74 + (sub ? 16 + SUB_SIZE : 0));
  return { text: t, sub, size, w: Math.max(nameW, subW), h, nameW, subW };
}

export type Align = 'left' | 'right' | 'center';
/** A placed name: its box, how its lines align in it, and its baseline. */
export type PlacedName = { box: Box; align: Align; baseline: number; spot: string };

type Spot = { name: string; place: (a: Pt, b: NameBlock, clear: Box) => { box: Box; align: Align } };

/** Candidate spots round a marker (whose own box is `clear`): beside it, above, below and the corners. */
const SPOTS: Spot[] = [
  { name: 'right', place: (a, b, c) => ({ box: { x0: c.x1 + 22, y0: a.y - b.h * 0.62, x1: c.x1 + 22 + b.w, y1: a.y + b.h * 0.38 }, align: 'left' }) },
  { name: 'left', place: (a, b, c) => ({ box: { x0: c.x0 - 22 - b.w, y0: a.y - b.h * 0.62, x1: c.x0 - 22, y1: a.y + b.h * 0.38 }, align: 'right' }) },
  { name: 'above', place: (a, b, c) => ({ box: { x0: a.x - b.w / 2, y0: c.y0 - 18 - b.h, x1: a.x + b.w / 2, y1: c.y0 - 18 }, align: 'center' }) },
  { name: 'below', place: (a, b, c) => ({ box: { x0: a.x - b.w / 2, y0: c.y1 + 18, x1: a.x + b.w / 2, y1: c.y1 + 18 + b.h }, align: 'center' }) },
  { name: 'above-right', place: (_a, b, c) => ({ box: { x0: c.x1 + 6, y0: c.y0 - 10 - b.h, x1: c.x1 + 6 + b.w, y1: c.y0 - 10 }, align: 'left' }) },
  { name: 'above-left', place: (_a, b, c) => ({ box: { x0: c.x0 - 6 - b.w, y0: c.y0 - 10 - b.h, x1: c.x0 - 6, y1: c.y0 - 10 }, align: 'right' }) },
  { name: 'below-right', place: (_a, b, c) => ({ box: { x0: c.x1 + 6, y0: c.y1 + 10, x1: c.x1 + 6 + b.w, y1: c.y1 + 10 + b.h }, align: 'left' }) },
  { name: 'below-left', place: (_a, b, c) => ({ box: { x0: c.x0 - 6 - b.w, y0: c.y1 + 10, x1: c.x0 - 6, y1: c.y1 + 10 + b.h }, align: 'right' }) },
];

/** Slide a box into bounds (as little as it needs). */
function inside(b: Box, bounds: Box): Box {
  const dx = b.x0 < bounds.x0 ? bounds.x0 - b.x0 : b.x1 > bounds.x1 ? bounds.x1 - b.x1 : 0;
  const dy = b.y0 < bounds.y0 ? bounds.y0 - b.y0 : b.y1 > bounds.y1 ? bounds.y1 - b.y1 : 0;
  return { x0: b.x0 + dx, y0: b.y0 + dy, x1: b.x1 + dx, y1: b.y1 + dy };
}

export type NameInput = { block: NameBlock; at: Pt; clear: Box };

/** The last placement's candidates and their scores (for checks). */
export const lastSpots: string[] = [];

/** The sizes tried, largest first, when every spot at a size covers the route or a marker. */
export const NAME_STEPS = [NAME_MAX, 112, 96, 84, NAME_MIN];

/**
 * The names at the largest size at which neither has to cover the route or a marker (down to NAME_MIN,
 * where the least bad spot is taken anyway). `block(size)` measures a name at that largest size.
 */
export function placeNamesFitting(o: {
  start: ((size: number) => NameInput) | null;
  landing: ((size: number) => NameInput) | null;
  route: Pt[];
  grid: CostGrid;
  bounds: Box;
}): { start: PlacedName | null; landing: PlacedName | null; hit: boolean; startIn: NameInput | null; landingIn: NameInput | null } {
  let last: ReturnType<typeof placeNames> | null = null;
  let si: NameInput | null = null, li: NameInput | null = null;
  for (const size of NAME_STEPS) {
    si = o.start?.(size) ?? null;
    li = o.landing?.(size) ?? null;
    last = placeNames({ start: si, landing: li, route: o.route, grid: o.grid, bounds: o.bounds });
    if (!last.hit) break;
  }
  return { ...last!, startIn: si, landingIn: li };
}

/** The penalty for a name over something it must never cover (it is chosen only if nothing else fits). */
const HIT = 100;

function candidates(n: NameInput, bounds: Box): { box: Box; align: Align; spot: string; slid: number }[] {
  return SPOTS.map((s) => {
    const p = s.place(n.at, n.block, n.clear);
    const box = inside(p.box, bounds);
    // a name slid far from its marker has lost it
    return { ...p, box, spot: s.name, slid: Math.abs(box.x0 - p.box.x0) + Math.abs(box.y0 - p.box.y0) };
  });
}

/**
 * The best spots for the start's name and the landing's (either may be absent): least land and glare
 * covered, nothing it must not cover (the route, both markers, each other), near its own marker.
 */
export function placeNames(o: { start: NameInput | null; landing: NameInput | null; route: Pt[]; grid: CostGrid; bounds: Box }): { start: PlacedName | null; landing: PlacedName | null; hit: boolean } {
  const markers = [o.start?.clear, o.landing?.clear].filter((b): b is Box => !!b);
  const score = (c: { box: Box; slid: number }) => {
    let s = costUnder(o.grid, c.box) + c.slid / 120;
    if (lineHits(o.route, c.box, 14)) s += HIT;
    for (const m of markers) if (overlaps(c.box, m, 8)) s += HIT;
    return s;
  };
  const cs = o.start ? candidates(o.start, o.bounds).map((c) => ({ ...c, s: score(c) })) : [null];
  const cl = o.landing ? candidates(o.landing, o.bounds).map((c) => ({ ...c, s: score(c) })) : [null];
  lastSpots.length = 0;
  for (const [who, list] of [['start', cs], ['landing', cl]] as const) for (const c of list) if (c) lastSpots.push(`${who}:${c.spot}:${c.s.toFixed(2)}`);
  let best: { a: (typeof cs)[number]; b: (typeof cl)[number]; s: number } | null = null;
  for (const a of cs)
    for (const b of cl) {
      // the landing's name is the payoff: its spot weighs a little more
      let s = (a?.s ?? 0) + 1.2 * (b?.s ?? 0);
      if (a && b && overlaps(a.box, b.box, 18)) s += HIT;
      if (!best || s < best.s) best = { a, b, s };
    }
  const placed = (c: { box: Box; align: Align; spot: string } | null, n: NameInput | null): PlacedName | null =>
    c && n ? { box: c.box, align: c.align, spot: c.spot, baseline: Math.round(c.box.y0 + n.block.size * 0.74) } : null;
  return { start: placed(best!.a, o.start), landing: placed(best!.b, o.landing), hit: best!.s >= HIT };
}

// ---- the map's names ----

export const PLACE_FONT: CardFont = { size: 22, weight: 600, condensed: false, spacing: 5 };
/** Where a name may go if its own spot is taken: a little above, below or to the side. */
const NUDGES: [number, number][] = [[0, 0], [0, -36], [0, 36], [-80, 0], [80, 0], [0, -72], [0, 72], [-80, -36], [80, 36]];
/** At most this many country and sea names. */
export const MAX_PLACES = 4;

export type PlaceCandidate = { text: string; kind: 'country' | 'sea'; rank: number; x: number; y: number };
export type PickedPlace = { text: string; kind: 'country' | 'sea'; x: number; y: number; box: Box };

/**
 * A few of the map's country and sea names: the most important first (the seas the route crosses, the
 * biggest countries), each where the map puts it, kept only where it crowds nothing (the route, the
 * markers, the big names, another name) and well inside the picture, below the horizon.
 */
export function pickPlaces(o: { places: PlaceCandidate[]; route: Pt[]; avoid: Box[]; m: Measure; bounds: Box; skyY?: number; exclude?: string[] }): PickedPlace[] {
  const near = (p: Pt) => {
    let d = Infinity;
    for (const q of o.route) d = Math.min(d, Math.hypot(p.x - q.x, p.y - q.y));
    return d;
  };
  const ex = new Set((o.exclude ?? []).map((s) => s.toLowerCase()));
  const seen = new Set<string>();
  const ranked = o.places
    .filter((p) => !ex.has(p.text.toLowerCase()) && !seen.has(p.text) && seen.add(p.text))
    .map((p) => ({ p, s: p.rank + (p.kind === 'sea' ? -0.5 : 0) + Math.min(3, near(p) / 250) }))
    .sort((a, b) => a.s - b.s);
  const out: PickedPlace[] = [];
  for (const { p } of ranked) {
    if (out.length >= MAX_PLACES) break;
    const text = p.text.toUpperCase();
    const w = o.m(text, PLACE_FONT);
    const b = o.bounds;
    // where the map puts it, else a little way off (a sea or a country is an area, not a point)
    for (const [dx, dy] of NUDGES) {
      const x = p.x + dx, y = p.y + dy;
      const box = { x0: x - w / 2, y0: y - 18, x1: x + w / 2, y1: y + 4 };
      if (box.x0 < b.x0 || box.x1 > b.x1 || box.y0 < b.y0 || box.y1 > b.y1) continue;
      if (o.skyY !== undefined && box.y0 < o.skyY + 40) continue;
      if (lineHits(o.route, box, 16)) continue;
      if (o.avoid.some((a) => overlaps(box, a, 14))) continue;
      if (out.some((q) => overlaps(box, q.box, 24))) continue;
      out.push({ text, kind: p.kind, x, y, box });
      break;
    }
  }
  return out;
}

// ---- the panel ----

export type PanelText = { role: 'kicker' | 'kicker-when' | 'stat-value' | 'stat-unit' | 'stat-label' | 'compare' | 'credit'; text: string; x: number; y: number; width: number; font: CardFont; tone: 'primary' | 'secondary'; stat?: number };
export type Panel = {
  texts: PanelText[];
  /** The day-progress line: from x0 to x1 at y, ticks at local midnights (fractions), a dot at its end. */
  line: { x0: number; x1: number; y: number; ticks: number[] };
  /** Where each stat's number ends (its digits are set right-aligned to it, so a count-up never moves the unit). */
  statRight: number[];
  /** Where the fade into ink starts and where it is complete. */
  fadeTop: number;
  fadeBottom: number;
};

export const STAT_MAX = 112;
const STAT_MIN = 72;
export const statFont = (size: number): CardFont => ({ size, weight: 700, condensed: true });
export const unitFont = (size: number): CardFont => ({ size: Math.round(size * 0.46), weight: 650, condensed: true });
export const LABEL_FONT: CardFont = { size: 30, weight: 500, condensed: false };
export const KICKER_FONT: CardFont = { size: 34, weight: 650, condensed: false };
export const WHEN_FONT: CardFont = { size: 34, weight: 450, condensed: false };
export const COMPARE_FONT: CardFont = { size: 28, weight: 450, condensed: false };
export const CREDIT_FONT: CardFont = { size: 18, weight: 450, condensed: false };

/** The credit line, broken only between credits (the " · " at a break is left out). */
export function wrapCredits(text: string, f: CardFont, m: Measure, max: number): string[] {
  const lines: string[] = [];
  let cur = '';
  for (const part of text.split(' · ')) {
    const next = cur ? `${cur} · ${part}` : part;
    if (cur && m(next, f) > max) {
      lines.push(cur);
      cur = part;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}

export type PanelWords = {
  kicker: string;
  when: string;
  stats: { label: string; num: string; unit: string }[];
  compare: string | null;
  credit: string;
  ticks: number[];
};

/** The panel, laid out from the bottom up so it always ends at the same place. */
export function panelLayout(w: PanelWords, m: Measure): Panel {
  const X = MARGIN, inner = CARD_W - 2 * X;
  const texts: PanelText[] = [];
  const put = (role: PanelText['role'], text: string, x: number, y: number, font: CardFont, tone: PanelText['tone'], stat?: number) =>
    texts.push({ role, text, x, y, width: m(text, font), font, tone, ...(stat !== undefined ? { stat } : {}) });

  const credit = wrapCredits(w.credit, CREDIT_FONT, m, inner);
  let y = CARD_H - 44 - (credit.length - 1) * 24;
  credit.forEach((line, i) => put('credit', line, X, y + i * 24, CREDIT_FONT, 'secondary'));
  y -= 46;
  if (w.compare) {
    put('compare', w.compare, X, y, COMPARE_FONT, 'secondary');
    y -= 50;
  } else y -= 12;

  // stats: a big number, its unit beside it, the label under; in thirds, one size for all three
  const col = inner / 3;
  let size = STAT_MAX;
  const fits = (s: number) => w.stats.every((st) => m(st.num, statFont(s)) + 10 + m(st.unit, unitFont(s)) <= col - 24);
  while (size > STAT_MIN && !fits(size)) size -= 4;
  const labelY = y;
  const valueY = labelY - LABEL_FONT.size - 22;
  const statRight: number[] = [];
  w.stats.forEach((st, i) => {
    const x = X + i * col;
    put('stat-label', st.label, x, labelY, LABEL_FONT, 'secondary', i);
    const nw = m(st.num, statFont(size));
    put('stat-value', st.num, x, valueY, statFont(size), 'primary', i);
    put('stat-unit', st.unit, x + nw + 10, valueY, unitFont(size), 'primary', i);
    statRight.push(x + nw);
  });
  // the day-progress line above the stats, the kicker above it
  const lineY = Math.round(valueY - size * 0.74 - 46);
  const ky = lineY - 38;
  put('kicker', w.kicker, X, ky, KICKER_FONT, 'primary');
  const kw = m(w.kicker, KICKER_FONT);
  put('kicker-when', ` · ${w.when}`, X + kw, ky, WHEN_FONT, 'secondary');
  const fadeBottom = ky - KICKER_FONT.size - 24;
  return { texts, line: { x0: X, x1: CARD_W - X, y: lineY, ticks: w.ticks }, statRight, fadeTop: fadeBottom - 180, fadeBottom };
}
