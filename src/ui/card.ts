/**
 * The landing card (spec 6.5): a 1080 x 1350 postcard made in the browser, and the ways to pass it on.
 *
 *   top 60%     a high, angled golden-hour view of the landing area looking back along the route,
 *               a 6 px off-white trail and the balloon at the landing point (CardScene draws the view
 *               and projects the trail; with no 3D scene a plain golden-hour sketch of the route)
 *   bottom 40%  the scene fades into ink (no box) under the text:
 *               kicker 32 px, secondary  "Expected to land near" / "Landed near"
 *               headline 120 px condensed bold (88 px at the least), two lines at most, "to" regular
 *               three stats, values 56 px, labels 26 px: distance, time aloft, top speed
 *               the date and time it was let go, with the site address on the same row
 *               the card credit line, 22 px
 *
 * Sharing: the system share sheet with the image, the text and the link where files can be shared,
 * otherwise a download. In-app browsers (LinkedIn, X), where both are unreliable, get the card full
 * screen as an image with "Press and hold to save" and "Open in your browser".
 *
 * The start point only leaves the phone in what the visitor chooses to share (spec 6.6).
 */
import { CARD_H, CARD_W, FLIGHT_HOURS } from '../config';
import type { Route } from '../flight/route';
import { haversineKm, type LatLon } from '../geo/coords';
import { withArticle } from '../geo/places';
import { localTime } from '../geo/time';
import { CARD_CREDIT } from './credits';

/** The card's credit line: the one in credits.ts, where every credit lives. */
export { CARD_CREDIT };
/** The address printed on the card. */
export const CARD_SITE = 'let-go-of-a-balloon.pages.dev';

export type Landing = { name: string; kind: string };

/** A town this close to a "Use my location" start names it; further off, its country does. */
export const START_TOWN_KM = 25;
/** Country names English gives "the". */
const THE_COUNTRY = /^(United\s|Netherlands$|Philippines$|Czech Republic$|Dominican Republic$|Central African Republic$|Democratic Republic|Republic of|Bahamas$|Gambia$|Maldives$|Seychelles$|Solomon Islands$|Marshall Islands$|Comoros$|Faroe Islands$|Cayman Islands$)/;

/**
 * The name a "Use my location" start goes by on the card and in the share text (never "Your
 * location", which reads wrong to whoever it is sent to): the town it is in, else that town's
 * country, else the sea or region, else where it is to a tenth of a degree.
 */
export function startName(p: LatLon, place: { kind: string; name: string; country?: string; distanceKm?: number; generic?: boolean } | null): string {
  if (place?.kind === 'town') {
    if ((place.distanceKm ?? Infinity) <= START_TOWN_KM) return place.name;
    if (place.country) return THE_COUNTRY.test(place.country) ? `the ${place.country}` : place.country;
  } else if (place) return withArticle(place.name, place.kind);
  const lat = `${Math.abs(p.lat).toFixed(1)}° ${p.lat >= 0 ? 'N' : 'S'}`;
  const lon = `${Math.abs(p.lon).toFixed(1)}° ${p.lon >= 0 ? 'E' : 'W'}`;
  return `${lat} ${lon}`;
}

export type CardFacts = {
  /** The start's name ("Manchester"). */
  home: string;
  landing: Landing | null;
  landed: boolean;
  /** The visitor's own balloon, or one from someone else's link. */
  own: boolean;
  releaseMs: number;
  start: LatLon;
  distanceKm: number;
  hoursAloft: number;
  topSpeedKmh: number;
};

export function cardFacts(route: Route, o: { home: string; landing: Landing | null; own: boolean; now: number }): CardFacts {
  const start = route.points[0];
  const last = route.points[route.points.length - 1];
  let top = 0;
  for (const p of route.points) if (Number.isFinite(p.speedMs)) top = Math.max(top, p.speedMs);
  return {
    home: o.home,
    landing: o.landing,
    landed: o.now >= route.release + FLIGHT_HOURS * 3600e3,
    own: o.own,
    releaseMs: route.release,
    start: { lat: start.lat, lon: start.lon },
    distanceKm: haversineKm(start, last),
    hoursAloft: FLIGHT_HOURS,
    topSpeedKmh: top * 3.6,
  };
}

export type CardWords = {
  kicker: string;
  from: string;
  /** The landing place with its article ("Bergen", "the North Sea"); empty when it has no name. */
  to: string;
  /** "Expected to land near Bergen", "Came down in the North Sea". */
  sentence: string;
  shareText: string;
  /** The card as words, for the image's alt text. */
  alt: string;
  stats: { label: string; value: string }[];
  when: string;
  site: string;
  credit: string;
  filename: string;
};

const km = (d: number) => (d < 10 ? `${d.toFixed(1)} km` : `${Math.round(d).toLocaleString('en-GB')} km`);

function whenText(utcMs: number, start: LatLon): string {
  let tz = 'UTC';
  try {
    tz = localTime(utcMs, start).tz;
  } catch {
    /* keep UTC */
  }
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(utcMs));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `Let go on ${get('weekday')} ${get('day')} ${get('month')} at ${get('hour')}:${get('minute')}`;
}

const slug = (s: string) =>
  s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function cardWords(f: CardFacts): CardWords {
  const l = f.landing;
  const to = l ? withArticle(l.name, l.kind) : '';
  let kicker: string;
  let verb: string; // after "My balloon from Manchester ..."
  if (!l) {
    kicker = 'Let go from';
    verb = f.landed ? 'has landed' : 'is on its way';
  } else {
    const prep = l.kind === 'town' ? 'near' : 'in';
    const action = l.kind === 'sea' ? (f.landed ? 'Came down' : 'Expected to come down') : f.landed ? 'Landed' : 'Expected to land';
    kicker = `${action} ${prep}`;
    const v = l.kind === 'sea' ? (f.landed ? 'came down' : 'is expected to come down') : f.landed ? 'landed' : 'is expected to land';
    verb = `${v} ${prep} ${to}`;
  }
  const sentence = l ? `${kicker} ${to}` : `${kicker} ${f.home}`;
  const stats = [
    { label: 'Distance', value: km(f.distanceKm) },
    { label: 'Time aloft', value: `${f.hoursAloft} h` },
    { label: 'Top speed', value: `${f.topSpeedKmh < 9.95 ? f.topSpeedKmh.toFixed(1) : Math.round(f.topSpeedKmh)} km/h` },
  ];
  const from = f.home.charAt(0).toUpperCase() + f.home.slice(1);
  const route = to ? `${from} to ${to}` : `From ${f.home}`;
  return {
    kicker,
    from,
    to,
    sentence,
    shareText: `${f.own ? 'My' : 'A'} balloon from ${f.home} ${verb}.`,
    alt: `${sentence}. ${route}: ${stats[0].value} in ${f.hoursAloft} hours, top speed ${stats[2].value}.`,
    stats,
    when: whenText(f.releaseMs, f.start),
    site: CARD_SITE,
    credit: CARD_CREDIT,
    filename: `balloon-${[slug(f.home), to ? 'to' : '', slug(to.replace(/^the\s/i, ''))].filter(Boolean).join('-') || 'card'}.png`,
  };
}

// ---- layout ----

export type CardFont = { size: number; weight: number; condensed: boolean };
export type Measure = (text: string, font: CardFont) => number;
export type Segment = { text: string; bold: boolean };
export type Headline = { size: number; lines: Segment[][] };

const H_MAX = 120;
/** Two lines are set no larger than this, so the text block starts below the 60% line. */
const H_TWO_MAX = 108;
const H_MIN = 88;
const H_STEP = 4;
const headFont = (size: number, bold: boolean): CardFont => ({ size, weight: bold ? 700 : 400, condensed: true });
const lineWidth = (line: Segment[], size: number, m: Measure) => line.reduce((w, s) => w + m(s.text, headFont(size, s.bold)), 0);

/** Merge neighbours of the same weight; a space belongs to the word before it. */
function toLine(words: Segment[]): Segment[] {
  const out: Segment[] = [];
  words.forEach((w, i) => {
    const text = i < words.length - 1 ? `${w.text} ` : w.text;
    const prev = out[out.length - 1];
    if (prev && prev.bold === w.bold) prev.text += text;
    else out.push({ text, bold: w.bold });
  });
  return out;
}

/** Words into lines, greedily; each line is still a list of words. */
function greedy(words: Segment[], size: number, m: Measure, max: number): Segment[][] {
  const lines: Segment[][] = [];
  let cur: Segment[] = [];
  for (const w of words) {
    if (cur.length && lineWidth(toLine([...cur, w]), size, m) > max) {
      lines.push(cur);
      cur = [w];
    } else cur.push(w);
  }
  if (cur.length) lines.push(cur);
  return lines;
}

function ellipsize(line: Segment[], size: number, m: Measure, max: number): Segment[] {
  const segs = line.map((s) => ({ ...s }));
  const fits = () => lineWidth(segs, size, m) <= max;
  const last = () => segs[segs.length - 1];
  last().text = last().text.trimEnd() + '…';
  while (!fits() && segs.length) {
    const s = last();
    const body = s.text.slice(0, -1).trimEnd();
    if (!body) {
      segs.pop();
      if (segs.length) last().text = last().text.trimEnd() + '…';
      continue;
    }
    s.text = body.slice(0, -1).trimEnd() + '…';
  }
  return segs;
}

/**
 * "Manchester to Bergen" at the largest size from 120 px down to 88 px that fits in two lines of
 * maxWidth: one line if it can, else broken before "to" ("Manchester" / "to Bergen"), else word by
 * word; two lines at 108 px at the most. Past 88 px the second line ends in an ellipsis.
 */
export function fitHeadline(from: string, to: string, m: Measure, maxWidth: number): Headline {
  const split = (s: string, bold: boolean) => s.split(/\s+/).filter(Boolean).map((text) => ({ text, bold }));
  const fromW = split(from, true);
  const toW = to ? [{ text: 'to', bold: false }, ...split(to, true)] : [];
  const all = [...fromW, ...toW];
  const ok = (lines: Segment[][], size: number) => lines.length <= 2 && lines.every((l) => lineWidth(l, size, m) <= maxWidth);
  for (let size = H_MAX; size >= H_MIN; size -= H_STEP) {
    const one = [toLine(all)];
    if (ok(one, size)) return { size, lines: one };
    if (size > H_TWO_MAX) continue;
    if (toW.length) {
      const two = [toLine(fromW), toLine(toW)];
      if (ok(two, size)) return { size, lines: two };
    }
    const g = greedy(all, size, m, maxWidth).map(toLine);
    if (ok(g, size)) return { size, lines: g };
  }
  // still too long at 88 px: the first line as it wraps, everything else on the second, cut short
  const g = greedy(all, H_MIN, m, maxWidth);
  const lines = [g[0], g.slice(1).flat()].filter((l) => l.length).map(toLine);
  return { size: H_MIN, lines: lines.map((l) => (lineWidth(l, H_MIN, m) > maxWidth ? ellipsize(l, H_MIN, m, maxWidth) : l)) };
}

export type CardText = {
  role: 'kicker' | 'headline' | 'stat-value' | 'stat-label' | 'when' | 'site' | 'credit';
  text: string;
  /** Left edge and baseline, card px. */
  x: number;
  y: number;
  width: number;
  size: number;
  weight: number;
  condensed: boolean;
  /** Primary (off-white) or secondary (off-white at 72%). */
  tone: 'primary' | 'secondary';
};

export type CardLayout = {
  width: number;
  height: number;
  /** The 3D view is drawn over 0..sceneBottom. */
  sceneBottom: number;
  /** Where the fade into ink starts and where it is complete. */
  fadeTop: number;
  fadeBottom: number;
  headline: Headline;
  texts: CardText[];
};

export const CARD_MARGIN = 72;
const BOTTOM = 52;
/** The view covers the top of the card; the fade into ink starts high enough to sit under the text. */
export const CARD_SCENE_H = 1000;

function wrap(text: string, f: CardFont, m: Measure, max: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (cur && m(next, f) > max) {
      lines.push(cur);
      cur = w;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}

/** The credit line, broken only between credits (the " · " at a break is left out); a credit too long for a line wraps by word. */
function wrapCredits(text: string, f: CardFont, m: Measure, max: number): string[] {
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
  return lines.flatMap((l) => (m(l, f) > max ? wrap(l, f, m, max) : [l]));
}

/** Where every piece of text goes, laid out from the bottom up so the stack always ends at the same place. */
export function cardLayout(w: CardWords, m: Measure): CardLayout {
  const W = CARD_W, H = CARD_H, X = CARD_MARGIN, inner = W - 2 * X;
  const texts: CardText[] = [];
  const put = (role: CardText['role'], text: string, x: number, y: number, f: CardFont, tone: CardText['tone']) => {
    texts.push({ role, text, x, y, width: m(text, f), size: f.size, weight: f.weight, condensed: f.condensed, tone });
  };

  // credits, 22 px, wrapped
  const creditF: CardFont = { size: 22, weight: 450, condensed: false };
  const credit = wrapCredits(w.credit, creditF, m, inner);
  let y = H - BOTTOM - (credit.length - 1) * 30;
  credit.forEach((line, i) => put('credit', line, X, y + i * 30, creditF, 'secondary'));

  // the date and time it was let go, then the site address, each on its own line
  const metaF: CardFont = { size: 26, weight: 500, condensed: false };
  y -= 34;
  put('site', w.site, X, y, metaF, 'secondary');
  y -= 32;
  put('when', w.when, X, y, metaF, 'secondary');
  y -= 19 + 28;

  // stats: value over label, in thirds
  const valF: CardFont = { size: 56, weight: 650, condensed: true };
  const labF: CardFont = { size: 26, weight: 500, condensed: false };
  w.stats.forEach((s, i) => {
    const x = X + (i * inner) / 3;
    put('stat-label', s.label, x, y, labF, 'secondary');
    put('stat-value', s.value, x, y - 26 - 8, valF, 'primary');
  });
  // from the labels' baseline to the headline's: the values (41 px caps) and room for descenders;
  // a one-line headline has the room to stand further off
  const head = fitHeadline(w.from, w.to, m, inner);
  y -= 26 + 8 + 41 + (head.lines.length > 1 ? 34 : 56);

  // headline
  const lh = Math.round(head.size * 0.92);
  const lines = head.lines;
  for (let i = lines.length - 1; i >= 0; i--) {
    let x = X;
    for (const s of lines[i]) {
      const f = headFont(head.size, s.bold);
      put('headline', s.text, x, y, f, 'primary');
      x += m(s.text, f);
    }
    if (i > 0) y -= lh;
  }
  // the kicker sits a little above the headline's cap height
  const capTop = y - head.size * 0.72;
  const kickF: CardFont = { size: 32, weight: 500, condensed: false };
  const ky = Math.round(capTop - 22);
  put('kicker', w.kicker, X, ky, kickF, 'secondary');

  // the fade: complete just above the kicker, starting about 240 px higher
  const fadeBottom = Math.round(ky - 32 - 8);
  const fadeTop = fadeBottom - 240;
  return { width: W, height: H, sceneBottom: CARD_SCENE_H, fadeTop, fadeBottom, headline: head, texts };
}

// ---- the picture ----

/** Warm (rust, clay, orange) ground in the card's picture is held to this saturation. */
const WARM_SAT_MAX = 0.5;

/**
 * Calm the warm colours of the card's picture (RGBA, in place): rust and clay slopes in low golden
 * light come out as saturated as the balloon, which must stay the one bright thing on the card
 * (spec 7). Pixels with a hue between orange-red and amber (about 8 to 45 degrees, feathered to 0
 * and 55) keep their hue and brightness but lose saturation above WARM_SAT_MAX; everything else
 * (greens, sea, the pale sky) is left as it is. The balloon is drawn afterwards.
 */
export function tameWarm(px: Uint8ClampedArray | Uint8Array): void {
  const ramp = (a: number, b: number, x: number) => Math.max(0, Math.min(1, (x - a) / (b - a)));
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i], g = px[i + 1], b = px[i + 2];
    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    const c = mx - mn;
    if (mx === 0 || c / mx <= WARM_SAT_MAX || mx !== r) continue; // warm hues have red on top
    const h = (((g - b) / c) * 60 + 360) % 360;
    const w = Math.min(ramp(0, 8, h), 1 - ramp(45, 55, h));
    if (w <= 0) continue;
    const sat = c / mx;
    const target = sat - (sat - WARM_SAT_MAX) * w;
    // scale every channel's distance from the brightest toward it: hue and brightness stay
    const k = target / sat;
    px[i + 1] = Math.round(mx - (mx - g) * k);
    px[i + 2] = Math.round(mx - (mx - b) * k);
  }
}

// ---- drawing ----

/** What a 3D view of the landing area gives the card: the picture, and the trail projected onto it. */
export type CardFrame = {
  image: CanvasImageSource;
  /** Polylines in frame px; `a` is how clear each point is through the haze (0..1). */
  trail: { x: number; y: number; a: number }[][];
  /** The landing point on the ground, frame px. */
  landing: { x: number; y: number } | null;
  /** The start, when it is in the picture (a small route knot, as on the string line). */
  start?: { x: number; y: number; a: number } | null;
};

/** `alive` says whether the card is still wanted (a long render stops early when it is not). */
export type CardScene = { cardFrame(route: Route, w: number, h: number, alive?: () => boolean): CardFrame | null | Promise<CardFrame | null> };

const PAPER = '247, 243, 236';
const INK = '10, 14, 28';
const ORANGE = '#ff5a12';

function setFont(ctx: CanvasRenderingContext2D, f: CardFont): void {
  ctx.font = `${f.weight} ${f.size}px Archivo, ui-sans-serif, system-ui, sans-serif`;
  const c = ctx as CanvasRenderingContext2D & { fontStretch?: string };
  if ('fontStretch' in c) c.fontStretch = f.condensed ? 'extra-condensed' : 'normal';
}

export function canvasMeasure(ctx: CanvasRenderingContext2D): Measure {
  return (text, f) => {
    setFont(ctx, f);
    return ctx.measureText(text).width;
  };
}

/** Wait for the card's faces (one variable file: weight 400-700, width 62-100). */
async function fontsReady(): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return;
  try {
    await Promise.all(['700 120px Archivo', '400 120px Archivo', '500 32px Archivo'].map((f) => document.fonts.load(f)));
  } catch {
    /* the fallback face draws it */
  }
}

/** No 3D view (the 2D fallback, or no WebGL): a golden-hour sky over the route drawn as a sketch. */
function sketchFrame(route: Route, w: number, h: number): CardFrame {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  const horizon = h * 0.2;
  const sky = g.createLinearGradient(0, 0, 0, horizon);
  sky.addColorStop(0, '#8292b4');
  sky.addColorStop(1, '#f1c592');
  g.fillStyle = sky;
  g.fillRect(0, 0, w, horizon);
  const land = g.createLinearGradient(0, horizon, 0, h);
  land.addColorStop(0, '#cdbd8e');
  land.addColorStop(0.5, '#a9bd78');
  land.addColorStop(1, '#7f9f63');
  g.fillStyle = land;
  g.fillRect(0, horizon, w, h - horizon);
  // the route in an oblique view: the landing near, the start toward the horizon
  const last = route.points[route.points.length - 1];
  const cos = Math.cos((last.lat * Math.PI) / 180);
  const pts = route.points.map((p) => ({ e: (p.lon - last.lon) * cos, n: p.lat - last.lat }));
  const back = pts[0];
  const ang = Math.atan2(back.e, back.n);
  const span = Math.max(1e-6, ...pts.map((p) => Math.hypot(p.e, p.n)));
  const out = pts.map((p) => {
    // rotate so the start lies straight ahead, then squash with depth
    const fwd = (p.e * Math.sin(ang) + p.n * Math.cos(ang)) / span;
    const side = (p.e * Math.cos(ang) - p.n * Math.sin(ang)) / span;
    const depth = 1 + 3 * Math.max(0, fwd);
    return { x: w / 2 + (side * w * 0.45) / depth, y: horizon + (h * 0.42 - horizon) / depth, a: 1 - 0.6 * Math.max(0, fwd) };
  });
  return { image: c, trail: [out], landing: out[out.length - 1], start: out[0] };
}

function drawTrail(ctx: CanvasRenderingContext2D, frame: CardFrame): void {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const raw of frame.trail) {
    // far points crowd together near the horizon: keep one per 1.5 px
    const line = raw.filter((p, i) => i === 0 || i === raw.length - 1 || Math.hypot(p.x - raw[i - 1].x, p.y - raw[i - 1].y) >= 1.5 || p.a > 0.9);
    if (line.length < 2) continue;
    // one path per line (overlapping segments would build up), shaded from its haziest to its clearest point
    const near = line.reduce((p, q) => (q.a > p.a ? q : p));
    const far = line.reduce((p, q) => (q.a < p.a ? q : p));
    const along = Math.hypot(near.x - far.x, near.y - far.y) > 1;
    const paint = (rgb: string, alpha: (a: number) => number) => {
      if (!along) return `rgba(${rgb}, ${alpha(near.a).toFixed(3)})`;
      const g = ctx.createLinearGradient(far.x, far.y, near.x, near.y);
      for (const t of [0, 0.25, 0.5, 0.75, 1]) g.addColorStop(t, `rgba(${rgb}, ${alpha(far.a + (near.a - far.a) * t).toFixed(3)})`);
      return g;
    };
    ctx.beginPath();
    ctx.moveTo(line[0].x, line[0].y);
    for (let i = 1; i < line.length; i++) ctx.lineTo(line[i].x, line[i].y);
    // a faint ink edge keeps the line clear over chalk and sand, only where it is clear itself
    ctx.strokeStyle = paint(INK, (a) => 0.16 * a ** 4);
    ctx.lineWidth = 8;
    ctx.stroke();
    ctx.strokeStyle = paint(PAPER, (a) => a);
    ctx.lineWidth = 6;
    ctx.stroke();
  }
  ctx.restore();
}

/** The balloon at the landing point: the one bright thing on the card. */
function drawBalloon(ctx: CanvasRenderingContext2D, at: { x: number; y: number }): void {
  const r = 15, lift = 40;
  const cx = at.x, cy = at.y - lift;
  ctx.save();
  // string
  ctx.strokeStyle = `rgba(${PAPER}, 0.9)`;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx, cy + r + 4);
  ctx.quadraticCurveTo(cx + 5, at.y - lift / 2, at.x, at.y);
  ctx.stroke();
  // knot
  ctx.fillStyle = '#e04a08';
  ctx.beginPath();
  ctx.moveTo(cx - 3.5, cy + r + 5);
  ctx.lineTo(cx + 3.5, cy + r + 5);
  ctx.lineTo(cx, cy + r - 1);
  ctx.fill();
  // body, lit from the low sun
  const body = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.1, cx, cy, r * 1.1);
  body.addColorStop(0, '#ff9a62');
  body.addColorStop(0.45, ORANGE);
  body.addColorStop(1, '#d94706');
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.ellipse(cx, cy, r * 0.92, r, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** The fade into ink: eased stops, so no edge shows. */
function drawFade(ctx: CanvasRenderingContext2D, L: CardLayout): void {
  const g = ctx.createLinearGradient(0, L.fadeTop, 0, L.fadeBottom);
  const stops: [number, number][] = [[0, 0], [0.18, 0.08], [0.4, 0.3], [0.62, 0.62], [0.82, 0.88], [1, 1]];
  for (const [t, a] of stops) g.addColorStop(t, `rgba(${INK}, ${a})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, L.fadeTop, L.width, L.fadeBottom - L.fadeTop);
  ctx.fillStyle = `rgb(${INK})`;
  ctx.fillRect(0, L.fadeBottom, L.width, L.height - L.fadeBottom);
}

export type DrawnCard = { canvas: HTMLCanvasElement; layout: CardLayout; frame: 'scene' | 'sketch' };

/** Draw the card onto a new canvas (not yet encoded). */
export async function drawCard(route: Route, scene: CardScene | null, words: CardWords, alive?: () => boolean): Promise<DrawnCard> {
  await fontsReady();
  const canvas = document.createElement('canvas');
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext('2d')!;
  const L = cardLayout(words, canvasMeasure(ctx));

  ctx.fillStyle = `rgb(${INK})`;
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  let frame: CardFrame | null = null;
  try {
    frame = (await scene?.cardFrame(route, CARD_W, CARD_SCENE_H, alive)) ?? null;
  } catch {
    frame = null;
  }
  const kind = frame ? 'scene' : 'sketch';
  frame ??= sketchFrame(route, CARD_W, CARD_SCENE_H);
  ctx.drawImage(frame.image, 0, 0, CARD_W, CARD_SCENE_H);
  drawTrail(ctx, frame);
  if (frame.start) {
    ctx.fillStyle = `rgba(${PAPER}, ${Math.max(0.35, frame.start.a).toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(frame.start.x, frame.start.y, 6, 0, Math.PI * 2);
    ctx.fill();
  }
  if (frame.landing) drawBalloon(ctx, frame.landing);
  drawFade(ctx, L);

  ctx.textBaseline = 'alphabetic';
  for (const t of L.texts) {
    setFont(ctx, t);
    ctx.fillStyle = t.tone === 'primary' ? `rgb(${PAPER})` : `rgba(${PAPER}, 0.74)`;
    ctx.fillText(t.text, t.x, t.y);
  }
  return { canvas, layout: L, frame: kind };
}

export function toPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('the card could not be encoded'))), 'image/png'));
}

/**
 * The card for a route as a 1080 x 1350 PNG: a fresh frame of the landing area at golden hour from
 * `scene` (or a sketch when there is none), then the text laid out in 2D.
 */
export async function renderCard(route: Route, scene: CardScene | null, info: { home: string; landing: Landing | null; own: boolean; now?: number }): Promise<Blob> {
  const words = cardWords(cardFacts(route, { ...info, now: info.now ?? Date.now() }));
  return toPng((await drawCard(route, scene, words)).canvas);
}

// ---- passing it on ----

/** LinkedIn's and X's in-app browsers (and Facebook's and Instagram's, which behave the same way). */
export function isInAppBrowser(ua: string): boolean {
  return /LinkedInApp|Twitter|FBA[NV]\/|FB_IAB|Instagram/i.test(ua);
}

/** A link that leaves the in-app browser for the phone's own: an intent on Android, Safari's scheme on iOS. */
export function openInBrowserHref(url: string, ua: string): string {
  if (!isInAppBrowser(ua)) return url;
  const u = new URL(url);
  if (/Android/i.test(ua)) return `intent://${u.host}${u.pathname}${u.search}${u.hash}#Intent;scheme=https;action=android.intent.action.VIEW;S.browser_fallback_url=${encodeURIComponent(url)};end`;
  if (/iPhone|iPad|iPod/i.test(ua)) return `x-safari-https://${u.host}${u.pathname}${u.search}${u.hash}`;
  return url;
}

export type ShareEnv = {
  nav: { canShare?: (d?: ShareData) => boolean; share?: (d: ShareData) => Promise<void> };
  download(blob: Blob, filename: string): void;
};

/** Whether this browser can hand image files to the system share sheet. */
export function canShareFiles(nav: ShareEnv['nav']): boolean {
  try {
    const probe = new File([new Uint8Array(1)], 'card.png', { type: 'image/png' });
    return !!nav.share && !!nav.canShare?.({ files: [probe] });
  } catch {
    return false;
  }
}

/** Share card: the system share sheet with the image, the text and the link where it can; otherwise a download. */
export async function shareCard(blob: Blob, w: CardWords, link: string, env: ShareEnv): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const file = new File([blob], w.filename, { type: 'image/png' });
  const data: ShareData = { files: [file], text: w.shareText, url: link };
  let ok = false;
  try {
    ok = !!env.nav.share && !!env.nav.canShare?.(data);
  } catch {
    ok = false;
  }
  if (ok) {
    try {
      await env.nav.share!(data);
      return 'shared';
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return 'cancelled';
    }
  }
  env.download(blob, w.filename);
  return 'downloaded';
}

/** Save image: a download of the PNG. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
