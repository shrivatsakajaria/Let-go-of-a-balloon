/**
 * The landing card (spec 6.5, design A: the owner's decision of 14 November 2026): a 1080 x 1350
 * postcard made in the browser, and the ways to pass it on.
 *
 *   the picture (top 1000 px)  the app's own low-poly world from high up, looking along the route,
 *                              the Earth's curve arcing into a soft haze; graded to the landing's local
 *                              time (golden hour, day, night with the towns lit); the route in orange,
 *                              the start an off-white ring, the landing the balloon on a short string;
 *                              a few country and sea names in light small caps; the two place names
 *                              big, where they cover the least land, never the route or the markers
 *   the panel                  the picture fades into ink (no box); "Landed · Thu 12 Nov, 18:48" (or
 *                              "Expected to land", "Came down at sea"), the day-progress line, three
 *                              big stats (distance, time aloft, top speed), a quiet comparison line
 *                              when one fits, the small credit line with the site's address
 *
 * CardScene draws the picture (cardshot.ts: the card world; mapcard.ts: the 2D map); with neither, a
 * plain map-less sketch. The same painter (paintCard) draws the still and every frame of the reveal,
 * so the reveal ends exactly on the shared image.
 *
 * Sharing: the system share sheet with the image, the text and the link where files can be shared,
 * otherwise a download. In-app browsers (LinkedIn, X), where both are unreliable, get the card full
 * screen as an image with "Press and hold to save" and "Open in your browser".
 *
 * The start point only leaves the phone in what the visitor chooses to share (spec 6.6).
 */
import { CARD_H, CARD_W, FLIGHT_HOURS } from '../config';
import type { Route } from '../flight/route';
import { haversineKm, lonDelta, type LatLon } from '../geo/coords';
import { withArticle } from '../geo/places';
import { localTime } from '../geo/time';
import { compareLine } from './cardcompare';
import {
  costGrid,
  fitName,
  KICKER_FONT,
  MARGIN,
  nameFont,
  panelLayout,
  PICTURE_H,
  PLACE_FONT,
  pickPlaces,
  placeNames,
  statFont,
  subFont,
  type Box,
  type CardFont,
  type Measure,
  type NameBlock,
  type Panel,
  type PickedPlace,
  type PlacedName,
  type Pt,
} from './cardplace';
import { CARD_CREDIT } from './credits';
import { countText, REVEALED, type RevealState } from './revealmath';

export type { CardFont, Measure } from './cardplace';
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
  /** When it comes down (UTC ms). */
  downMs: number;
  /** When the card is made: how much of the trip is flown. */
  nowMs: number;
  start: LatLon;
  end: LatLon;
  distanceKm: number;
  hoursAloft: number;
  topSpeedKmh: number;
  /** The country it was let go in (the comparison line), when known. */
  country: string | null;
};

export function cardFacts(route: Route, o: { home: string; landing: Landing | null; own: boolean; now: number; country?: string | null }): CardFacts {
  const start = route.points[0];
  const last = route.points[route.points.length - 1];
  let top = 0;
  for (const p of route.points) if (Number.isFinite(p.speedMs)) top = Math.max(top, p.speedMs);
  const downMs = route.release + FLIGHT_HOURS * 3600e3;
  return {
    home: o.home,
    landing: o.landing,
    landed: o.now >= downMs,
    own: o.own,
    releaseMs: route.release,
    downMs,
    nowMs: o.now,
    start: { lat: start.lat, lon: start.lon },
    end: { lat: last.lat, lon: last.lon },
    distanceKm: haversineKm(start, last),
    hoursAloft: FLIGHT_HOURS,
    topSpeedKmh: top * 3.6,
    country: o.country ?? null,
  };
}

export type CardStat = { label: string; value: string; num: number; decimals: number; unit: string };

export type CardWords = {
  /** The panel's first word: "Landed", "Expected to land", "Came down at sea", "Expected to come down at sea". */
  kicker: string;
  /** When it comes down, local time there: "Thu 12 Nov, 18:48". */
  when: string;
  /** The start's name, big ("Manchester"). */
  from: string;
  /** Under it: "Let go Mon 9 Nov, 18:48" (local time there). */
  fromLine: string;
  /** The landing place with its article ("Bergen", "the North Sea"); empty when it has no name. */
  to: string;
  /** The landing's name as the map shows it, big ("Bergen", "North Sea"); empty when it has none. */
  toName: string;
  /** "Expected to land near Bergen", "Came down in the North Sea" (the card's title and alt text). */
  sentence: string;
  shareText: string;
  /** The card as words, for the image's alt text. */
  alt: string;
  stats: CardStat[];
  /** "About the length of Britain", or null. */
  compare: string | null;
  site: string;
  credit: string;
  /** The small print: the site's address and the credits. */
  creditLine: string;
  filename: string;
  /** The day-progress line: local midnights as shares of the 72 hours, and how much is flown (0..1). */
  ticks: number[];
  flown: number;
  landed: boolean;
};

const tzOf = (p: LatLon) => {
  try {
    return localTime(0, p).tz;
  } catch {
    return 'UTC';
  }
};

function dayTime(utcMs: number, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(utcMs));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('weekday')} ${get('day')} ${get('month')}, ${get('hour')}:${get('minute')}`;
}

/** Local midnights at `p` between from and to, as shares of the span (the string line's ticks). */
export function midnights(fromMs: number, toMs: number, p: LatLon): number[] {
  const tz = tzOf(p);
  const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: tz, day: 'numeric' });
  const out: number[] = [];
  const step = 15 * 60e3;
  let day = fmt.format(new Date(fromMs));
  for (let t = fromMs + step; t <= toMs; t += step) {
    const d = fmt.format(new Date(t));
    if (d !== day) out.push((t - fromMs) / (toMs - fromMs));
    day = d;
  }
  return out;
}

const slug = (s: string) =>
  s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const kmStat = (d: number): CardStat => {
  const decimals = d < 10 ? 1 : 0;
  const num = decimals ? Math.round(d * 10) / 10 : Math.round(d);
  return { label: 'Distance', value: `${num.toLocaleString('en-GB', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })} km`, num, decimals, unit: 'km' };
};

export function cardWords(f: CardFacts): CardWords {
  const l = f.landing;
  const to = l ? withArticle(l.name, l.kind) : '';
  const sea = l?.kind === 'sea';
  // the panel: R56 at sea; otherwise as the string line says it
  const kicker = sea ? (f.landed ? 'Came down at sea' : 'Expected to come down at sea') : f.landed ? 'Landed' : 'Expected to land';
  let verb: string; // after "My balloon from Manchester ..."
  let sentence: string;
  if (!l) {
    verb = f.landed ? 'has landed' : 'is on its way';
    sentence = `${f.landed ? 'Landed' : 'On its way'} · let go from ${f.home}`;
  } else {
    const prep = l.kind === 'town' ? 'near' : 'in';
    const action = sea ? (f.landed ? 'Came down' : 'Expected to come down') : f.landed ? 'Landed' : 'Expected to land';
    sentence = `${action} ${prep} ${to}`;
    const v = sea ? (f.landed ? 'came down' : 'is expected to come down') : f.landed ? 'landed' : 'is expected to land';
    verb = `${v} ${prep} ${to}`;
  }
  const top = f.topSpeedKmh;
  const topDec = top < 9.95 ? 1 : 0;
  const topNum = topDec ? Math.round(top * 10) / 10 : Math.round(top);
  const stats: CardStat[] = [
    kmStat(f.distanceKm),
    { label: 'Time aloft', value: `${f.hoursAloft} h`, num: f.hoursAloft, decimals: 0, unit: 'h' },
    { label: 'Top speed', value: `${topNum.toFixed(topDec)} km/h`, num: topNum, decimals: topDec, unit: 'km/h' },
  ];
  const from = f.home.charAt(0).toUpperCase() + f.home.slice(1);
  const route = to ? `${from} to ${to}` : `From ${f.home}`;
  const when = dayTime(f.downMs, tzOf(f.end));
  const compare = compareLine(f.distanceKm, f.country);
  return {
    kicker,
    when,
    from,
    fromLine: `Let go ${dayTime(f.releaseMs, tzOf(f.start))}`,
    to,
    toName: l ? (sea ? l.name.replace(/^the\s/i, '') : l.name) : '',
    sentence,
    shareText: `${f.own ? 'My' : 'A'} balloon from ${f.home} ${verb}.`,
    alt: `${sentence}, ${when}. ${route}: ${stats[0].value} in ${f.hoursAloft} hours, top speed ${stats[2].value}.${compare ? ` ${compare}.` : ''}`,
    stats,
    compare,
    site: CARD_SITE,
    credit: CARD_CREDIT,
    creditLine: `${CARD_SITE} · ${CARD_CREDIT}`,
    filename: `balloon-${[slug(f.home), to ? 'to' : '', slug(to.replace(/^the\s/i, ''))].filter(Boolean).join('-') || 'card'}.png`,
    ticks: midnights(f.releaseMs, f.downMs, f.start),
    flown: Math.max(0, Math.min(1, (f.nowMs - f.releaseMs) / (f.downMs - f.releaseMs))),
    landed: f.landed,
  };
}

// ---- the picture ----

/** Warm (rust, clay, orange) ground in the card's picture is held to this saturation. */
const WARM_SAT_MAX = 0.5;

/**
 * Calm the warm colours of the card's picture (RGBA, in place): rust and clay slopes in low golden
 * light come out as saturated as the balloon, which must stay the one bright thing on the card
 * (spec 7). Pixels with a hue between orange-red and amber (about 8 to 45 degrees, feathered to 0
 * and 55) keep their hue and brightness but lose saturation above WARM_SAT_MAX; everything else
 * (greens, sea, the pale sky) is left as it is. The route and the balloon are drawn afterwards.
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

/**
 * What a scene gives the card: the picture (1080 x 1000; its sky clear where the sky is painted under
 * it) and, in picture pixels, what is drawn over it.
 */
export type CardPicture = {
  image: CanvasImageSource | null;
  /** The sky's colours (painted under a picture whose sky is clear), and how dark the night is (0..1). */
  sky: { top: string; horizon: string; night: number };
  /** The route, start to landing, each point with whether it is in sight and its time (s from release). */
  route: { x: number; y: number; seen: boolean }[];
  routeSec: number[];
  start: Pt | null;
  landing: Pt | null;
  horizon: Pt[];
  places: { text: string; kind: 'country' | 'sea'; rank: number; x: number; y: number }[];
  towns: { x: number; y: number; rank: number }[];
};

/**
 * `alive` says whether the card is still wanted (a long render stops early when it is not); `gate`,
 * when given, holds the picture itself back until it resolves (the land can load meanwhile).
 */
export type CardScene = {
  cardPicture(route: Route, alive?: () => boolean, gate?: Promise<void>): CardPicture | null | Promise<CardPicture | null>;
};

// ---- the plan: where the words go, worked out once from the finished picture ----

export type CardPlan = {
  start: { block: NameBlock; at: PlacedName } | null;
  landing: { block: NameBlock; at: PlacedName } | null;
  places: PickedPlace[];
  panel: Panel;
};

const PAPER = '247, 243, 236';
const INK = '10, 14, 28';
const ORANGE = '#ff5a12';
const BALLOON_R = 22;
const BALLOON_LIFT = 58;

/** The start ring's box and the balloon's, in picture pixels (the big names keep clear of them). */
const ringBox = (p: Pt): Box => ({ x0: p.x - 20, y0: p.y - 20, x1: p.x + 20, y1: p.y + 20 });
const balloonBox = (p: Pt, s = 1): Box => ({ x0: p.x - (BALLOON_R + 8) * s, y0: p.y - (BALLOON_LIFT + BALLOON_R + 6) * s, x1: p.x + (BALLOON_R + 8) * s, y1: p.y + 8 });

/** The seen points of the route, as one or more polylines. */
function routeLines(pic: CardPicture, share = 1): Pt[][] {
  const out: Pt[][] = [];
  let cur: Pt[] = [];
  const n = pic.route.length;
  const last = share >= 1 ? n - 1 : Math.floor(share * (n - 1));
  for (let i = 0; i <= last && i < n; i++) {
    const p = pic.route[i];
    if (!p.seen) {
      if (cur.length > 1) out.push(cur);
      cur = [];
      continue;
    }
    cur.push({ x: p.x, y: p.y });
  }
  // the part of the segment still to come
  if (share < 1 && last + 1 < n && pic.route[last + 1].seen && cur.length) {
    const f = share * (n - 1) - last;
    const a = pic.route[last], b = pic.route[last + 1];
    cur.push({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f });
  }
  if (cur.length > 1) out.push(cur);
  return out;
}

/** Where everything goes on the finished card: the names by the picture's pixels, the map's names, the panel. */
export function planCard(pic: CardPicture, words: CardWords, m: Measure, pixels: Uint8ClampedArray | null): CardPlan {
  const grid = pixels ? costGrid(pixels, CARD_W, PICTURE_H) : costGrid(new Uint8ClampedArray(CARD_W * PICTURE_H * 4), CARD_W, PICTURE_H);
  const line = routeLines(pic).flat();
  const bounds: Box = { x0: 44, y0: 36, x1: CARD_W - 44, y1: 0 };
  const panel = panelLayout({ kicker: words.kicker, when: words.when, stats: words.stats.map((s) => ({ label: s.label, num: s.value.replace(/\s.*$/, ''), unit: s.unit })), compare: words.compare, credit: words.creditLine, ticks: words.ticks }, m);
  bounds.y1 = panel.fadeBottom - 4;
  const sBlock = pic.start ? fitName(words.from, words.fromLine, m) : null;
  const lBlock = pic.landing && words.toName ? fitName(words.toName, '', m) : null;
  const placed = placeNames({
    start: sBlock && pic.start ? { block: sBlock, at: pic.start, clear: ringBox(pic.start) } : null,
    landing: lBlock && pic.landing ? { block: lBlock, at: pic.landing, clear: balloonBox(pic.landing) } : null,
    route: line,
    grid,
    bounds,
  });
  const avoid = [placed.start?.box, placed.landing?.box, pic.start && ringBox(pic.start), pic.landing && balloonBox(pic.landing)].filter((b): b is Box => !!b);
  const skyY = pic.horizon.length ? Math.max(...pic.horizon.map((p) => p.y)) : undefined;
  const places = pickPlaces({ places: pic.places, route: line, avoid, m, bounds: { x0: 44, y0: 36, x1: CARD_W - 44, y1: panel.fadeTop + 60 }, skyY, exclude: [words.toName, words.from] });
  return {
    start: sBlock && placed.start ? { block: sBlock, at: placed.start } : null,
    landing: lBlock && placed.landing ? { block: lBlock, at: placed.landing } : null,
    places,
    panel,
  };
}

// ---- painting ----

function setFont(ctx: CanvasRenderingContext2D, f: CardFont): void {
  ctx.font = `${f.weight} ${f.size}px Archivo, ui-sans-serif, system-ui, sans-serif`;
  const c = ctx as CanvasRenderingContext2D & { fontStretch?: string };
  if ('fontStretch' in c) c.fontStretch = f.condensed ? 'extra-condensed' : 'normal';
}

/** Text with extra space between the letters (small caps), drawn letter by letter (any browser). */
function spaced(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, spacing: number): void {
  let cx = x;
  for (const ch of text) {
    ctx.fillText(ch, cx, y);
    cx += ctx.measureText(ch).width + spacing;
  }
}

export function canvasMeasure(ctx: CanvasRenderingContext2D): Measure {
  return (text, f) => {
    setFont(ctx, f);
    if (!f.spacing) return ctx.measureText(text).width;
    let w = 0;
    for (const ch of text) w += ctx.measureText(ch).width + f.spacing;
    return w - f.spacing;
  };
}

/** Wait for the card's faces (one variable file: weight 400-700, width 62-100). */
export async function fontsReady(): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return;
  try {
    await Promise.all(['700 120px Archivo', '450 32px Archivo', '600 22px Archivo'].map((f) => document.fonts.load(f)));
  } catch {
    /* the fallback face draws it */
  }
}

/**
 * The sky behind the picture: deep overhead, the haze at the curved horizon; under the horizon the
 * haze's own colour, so far land that is not drawn reads as haze, never as sky.
 */
function paintSky(ctx: CanvasRenderingContext2D, pic: CardPicture): void {
  if (!pic.horizon.length) {
    ctx.fillStyle = pic.sky.horizon;
    ctx.fillRect(0, 0, CARD_W, PICTURE_H);
    return;
  }
  const hy = Math.max(...pic.horizon.map((p) => p.y));
  const g = ctx.createLinearGradient(0, 0, 0, Math.max(40, hy));
  g.addColorStop(0, pic.sky.top);
  g.addColorStop(0.6, mix(pic.sky.top, pic.sky.horizon, 0.4));
  g.addColorStop(1, pic.sky.horizon);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, CARD_W, PICTURE_H);
  ctx.fillStyle = pic.sky.horizon;
  ctx.beginPath();
  pic.horizon.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.lineTo(pic.horizon[pic.horizon.length - 1].x, PICTURE_H);
  ctx.lineTo(pic.horizon[0].x, PICTURE_H);
  ctx.closePath();
  ctx.fill();
  if (pic.sky.night > 0.4) {
    // a few stars above the horizon (always the same ones)
    let s = 7;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    ctx.fillStyle = `rgba(${PAPER}, ${(0.55 * pic.sky.night).toFixed(3)})`;
    for (let i = 0; i < 70; i++) {
      const x = rnd() * CARD_W, y = rnd() * hy * 0.9;
      ctx.fillRect(x, y, 1.6, 1.6);
    }
  }
}

/** A soft band of haze along the curved horizon, over the picture's edge (the land fades into it). */
function paintLimb(ctx: CanvasRenderingContext2D, pic: CardPicture): void {
  if (pic.horizon.length < 2) return;
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  pic.horizon.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  // many faint strokes, each wider: brightest on the line, fading smoothly either side
  ctx.strokeStyle = withAlpha(lighten(pic.sky.horizon, 0.3), 0.035 * (1 - 0.6 * pic.sky.night));
  for (let i = 1; i <= 24; i++) {
    ctx.lineWidth = i * 5;
    ctx.stroke();
  }
  ctx.restore();
}

/** At night, the towns lit: warm points with a soft halo, the big ones brighter. */
function paintLights(ctx: CanvasRenderingContext2D, pic: CardPicture, alpha: number): void {
  const k = Math.max(0, (pic.sky.night - 0.35) / 0.65) * alpha;
  if (k <= 0.01) return;
  ctx.save();
  for (const t of pic.towns.slice(0, 140)) {
    if (t.y < 0 || t.y > PICTURE_H || t.x < 0 || t.x > CARD_W) continue;
    const big = Math.max(0, 7 - t.rank) / 6; // rank 1 (capital) .. 7+
    const r = 5 + 11 * big;
    const g = ctx.createRadialGradient(t.x, t.y, 0, t.x, t.y, r);
    g.addColorStop(0, `rgba(255, 214, 150, ${(0.55 * k).toFixed(3)})`);
    g.addColorStop(1, 'rgba(255, 214, 150, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(t.x - r, t.y - r, 2 * r, 2 * r);
    ctx.fillStyle = `rgba(255, 242, 216, ${(0.95 * k).toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(t.x, t.y, 1.3 + 1.4 * big, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** The route in orange: flown solid, still to come (a forecast) dashed; a faint ink edge so it reads over pale ground. */
function paintRoute(ctx: CanvasRenderingContext2D, pic: CardPicture, words: CardWords, share: number): void {
  const flownSec = words.landed ? Infinity : words.flown * FLIGHT_HOURS * 3600;
  const lines = routeLines(pic, share);
  if (!lines.length) return;
  // the index where the forecast starts
  let cut = pic.routeSec.findIndex((s) => s > flownSec);
  if (cut < 0) cut = pic.route.length;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const stroke = (pts: Pt[], dash: boolean) => {
    if (pts.length < 2) return;
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.setLineDash(dash ? [14, 12] : []);
    ctx.strokeStyle = `rgba(${INK}, 0.28)`;
    ctx.lineWidth = 10;
    ctx.stroke();
    ctx.strokeStyle = ORANGE;
    ctx.lineWidth = 6;
    ctx.stroke();
  };
  if (cut >= pic.route.length) for (const l of lines) stroke(l, false);
  else {
    // split by time: the route's own points, flown then forecast
    const all = routeLines({ ...pic, route: pic.route.map((p, i) => ({ ...p, seen: p.seen && i <= cut })) }, share);
    const rest = routeLines({ ...pic, route: pic.route.map((p, i) => ({ ...p, seen: p.seen && i >= cut })) }, share);
    for (const l of all) stroke(l, false);
    for (const l of rest) stroke(l, true);
  }
  ctx.restore();
}

/** The start: an off-white ring. */
function paintStart(ctx: CanvasRenderingContext2D, p: Pt): void {
  ctx.save();
  ctx.fillStyle = `rgba(${INK}, 0.45)`;
  ctx.beginPath();
  ctx.arc(p.x, p.y, 12, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = `rgb(${PAPER})`;
  ctx.lineWidth = 5;
  ctx.stroke();
  ctx.fillStyle = `rgb(${PAPER})`;
  ctx.beginPath();
  ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** The balloon at the landing on a short string: the one bright thing on the card. `s` scales it (the reveal's close-up). */
export function paintBalloon(ctx: CanvasRenderingContext2D, at: Pt, s = 1): void {
  const r = BALLOON_R * s, lift = BALLOON_LIFT * s;
  const cx = at.x, cy = at.y - lift;
  ctx.save();
  ctx.strokeStyle = `rgba(${PAPER}, 0.92)`;
  ctx.lineWidth = Math.max(2, 2.4 * Math.sqrt(s));
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx, cy + r + 4 * s);
  ctx.bezierCurveTo(cx + 7 * s, cy + r + lift * 0.3, at.x - 6 * s, at.y - lift * 0.3, at.x, at.y);
  ctx.stroke();
  ctx.fillStyle = `rgb(${PAPER})`;
  ctx.beginPath();
  ctx.arc(at.x, at.y, 3.2 * Math.sqrt(s), 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#e04a08';
  ctx.beginPath();
  ctx.moveTo(cx - 4 * s, cy + r + 5 * s);
  ctx.lineTo(cx + 4 * s, cy + r + 5 * s);
  ctx.lineTo(cx, cy + r - 1 * s);
  ctx.fill();
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

function paintFade(ctx: CanvasRenderingContext2D, top: number, bottom: number): void {
  const g = ctx.createLinearGradient(0, top, 0, bottom);
  const stops: [number, number][] = [[0, 0], [0.18, 0.08], [0.4, 0.3], [0.62, 0.62], [0.82, 0.88], [1, 1]];
  for (const [t, a] of stops) g.addColorStop(t, `rgba(${INK}, ${a})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, top, CARD_W, bottom - top);
  ctx.fillStyle = `rgb(${INK})`;
  ctx.fillRect(0, bottom, CARD_W, CARD_H - bottom);
}

function paintName(ctx: CanvasRenderingContext2D, n: { block: NameBlock; at: PlacedName }, alpha: number): void {
  const { block: b, at } = n;
  const xFor = (w: number) => (at.align === 'left' ? at.box.x0 : at.align === 'right' ? at.box.x1 - w : (at.box.x0 + at.box.x1) / 2 - w / 2);
  setFont(ctx, nameFont(b.size));
  ctx.fillStyle = `rgba(${PAPER}, ${alpha.toFixed(3)})`;
  ctx.fillText(b.text, xFor(b.nameW), at.baseline);
  if (b.sub) {
    setFont(ctx, subFont);
    ctx.fillStyle = `rgba(${PAPER}, ${(0.86 * alpha).toFixed(3)})`;
    ctx.fillText(b.sub, xFor(b.subW), at.baseline + 16 + subFont.size);
  }
}

function paintPlaces(ctx: CanvasRenderingContext2D, places: PickedPlace[], alpha: number): void {
  if (alpha <= 0) return;
  setFont(ctx, PLACE_FONT);
  ctx.fillStyle = `rgba(${PAPER}, ${(0.82 * alpha).toFixed(3)})`;
  for (const p of places) spaced(ctx, p.text, p.box.x0, p.box.y1 - 4, PLACE_FONT.spacing ?? 0);
}

function paintPanel(ctx: CanvasRenderingContext2D, words: CardWords, P: Panel, st: RevealState): void {
  const a = st.names;
  if (a <= 0) return;
  // the day-progress line: the track, the flown part in orange, the local midnights, a knot at the end
  const L = P.line;
  const fill = L.x0 + (L.x1 - L.x0) * (words.landed ? 1 : words.flown);
  ctx.save();
  ctx.globalAlpha = a;
  ctx.fillStyle = `rgba(${PAPER}, 0.3)`;
  ctx.fillRect(L.x0, L.y - 1, L.x1 - L.x0, 2);
  ctx.fillStyle = ORANGE;
  ctx.fillRect(L.x0, L.y - 1.5, fill - L.x0, 3);
  ctx.fillStyle = `rgba(${PAPER}, 0.75)`;
  for (const t of L.ticks) ctx.fillRect(L.x0 + (L.x1 - L.x0) * t - 1, L.y - 9, 2, 18);
  if (words.landed) {
    ctx.fillStyle = ORANGE;
    ctx.beginPath();
    ctx.arc(L.x1, L.y, 8, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.fillStyle = ORANGE;
    ctx.beginPath();
    ctx.arc(fill, L.y, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = `rgb(${PAPER})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(L.x1, L.y, 8, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
  for (const t of P.texts) {
    let text = t.text;
    let x = t.x;
    let alpha = a;
    if (t.role === 'stat-value' && t.stat !== undefined) {
      // the numbers count up, right-aligned to where the final number ends (the unit never moves)
      const s = words.stats[t.stat];
      if (st.count <= 0) continue;
      text = countText(s.num, s.decimals, st.count);
      setFont(ctx, t.font);
      x = P.statRight[t.stat] - ctx.measureText(text).width;
    }
    if (t.role === 'stat-unit' && st.count <= 0) alpha = 0;
    if (alpha <= 0) continue;
    setFont(ctx, t.font);
    ctx.fillStyle = t.tone === 'primary' ? `rgba(${PAPER}, ${alpha.toFixed(3)})` : `rgba(${PAPER}, ${(0.74 * alpha).toFixed(3)})`;
    ctx.fillText(text, x, t.y);
  }
}

/**
 * Paint the card (or a frame of its reveal) onto a 1080 x 1350 context: the sky, the picture, the
 * horizon's haze, the town lights, the route, the markers, the map's names, the fade into ink, the
 * big names and the panel. `balloonScale` draws the balloon larger (the reveal's start, close to it).
 */
export function paintCard(ctx: CanvasRenderingContext2D, pic: CardPicture, words: CardWords, plan: CardPlan, st: RevealState = REVEALED, balloonScale = 1): void {
  ctx.save();
  ctx.fillStyle = `rgb(${INK})`;
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  ctx.beginPath();
  ctx.rect(0, 0, CARD_W, PICTURE_H);
  ctx.clip();
  paintSky(ctx, pic);
  if (pic.image) ctx.drawImage(pic.image, 0, 0, CARD_W, PICTURE_H);
  paintLimb(ctx, pic);
  paintLights(ctx, pic, 1);
  paintRoute(ctx, pic, words, st.route);
  if (pic.start && st.route > 0) paintStart(ctx, pic.start);
  paintPlaces(ctx, plan.places, st.places);
  if (pic.landing) paintBalloon(ctx, pic.landing, balloonScale);
  ctx.restore();
  paintFade(ctx, plan.panel.fadeTop, plan.panel.fadeBottom);
  ctx.textBaseline = 'alphabetic';
  if (st.names > 0) {
    if (plan.start) paintName(ctx, plan.start, st.names);
    if (plan.landing) paintName(ctx, plan.landing, st.names);
  }
  paintPanel(ctx, words, plan.panel, st);
}

/** The picture's pixels with the route and markers on (for placing the names over what shows). */
function picturePixels(pic: CardPicture, words: CardWords): Uint8ClampedArray | null {
  const c = document.createElement('canvas');
  c.width = CARD_W;
  c.height = PICTURE_H;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  paintSky(ctx, pic);
  if (pic.image) ctx.drawImage(pic.image, 0, 0, CARD_W, PICTURE_H);
  paintLimb(ctx, pic);
  paintLights(ctx, pic, 1);
  paintRoute(ctx, pic, words, 1);
  return ctx.getImageData(0, 0, CARD_W, PICTURE_H).data;
}

/** No picture at all (no scene): a plain dusk-blue ground under the route, laid out as a flat map. */
export function sketchPicture(route: Route): CardPicture {
  const pts = route.points;
  const last = pts[pts.length - 1];
  // a flat map round the route (longitude wrapped across the date line), the route kept in the picture's middle
  const cos = Math.cos((((pts[0].lat + last.lat) / 2) * Math.PI) / 180);
  const local = pts.map((p) => ({ e: lonDelta(pts[0].lon, p.lon) * cos, n: p.lat - pts[0].lat }));
  const e0 = Math.min(...local.map((p) => p.e)), e1 = Math.max(...local.map((p) => p.e));
  const n0 = Math.min(...local.map((p) => p.n)), n1 = Math.max(...local.map((p) => p.n));
  const box = { x0: 200, x1: CARD_W - 200, y0: 260, y1: 740 };
  const k = Math.min((box.x1 - box.x0) / Math.max(1e-6, e1 - e0), (box.y1 - box.y0) / Math.max(1e-6, n1 - n0));
  const cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2;
  const px = local.map((p) => ({ x: cx + (p.e - (e0 + e1) / 2) * k, y: cy - (p.n - (n0 + n1) / 2) * k, seen: true }));
  return {
    image: null,
    sky: { top: '#1d2a44', horizon: '#3a4d6c', night: 0 },
    route: px,
    routeSec: pts.map((p) => p.tSec),
    start: px[0],
    landing: px[px.length - 1],
    horizon: [],
    places: [],
    towns: [],
  };
}

export type DrawnCard = { canvas: HTMLCanvasElement; plan: CardPlan; picture: CardPicture; frame: 'scene' | 'sketch' };

/** Draw the card onto a new canvas (not yet encoded). */
export async function drawCard(route: Route, scene: CardScene | null, words: CardWords, alive?: () => boolean, gate?: Promise<void>): Promise<DrawnCard> {
  await fontsReady();
  const canvas = document.createElement('canvas');
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext('2d')!;
  let pic: CardPicture | null = null;
  try {
    pic = (await scene?.cardPicture(route, alive, gate)) ?? null;
  } catch (e) {
    console.warn('the card picture could not be made', e);
    pic = null;
  }
  const frame = pic ? 'scene' : 'sketch';
  pic ??= sketchPicture(route);
  const plan = planCard(pic, words, canvasMeasure(ctx), picturePixels(pic, words));
  paintCard(ctx, pic, words, plan);
  return { canvas, plan, picture: pic, frame };
}

export function toPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('the card could not be encoded'))), 'image/png'));
}

// ---- colours ----

function hexRgb(h: string): [number, number, number] {
  const s = h.replace('#', '');
  const n = parseInt(s.length === 3 ? s.replace(/./g, (c) => c + c) : s, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function mix(a: string, b: string, t: number): string {
  const x = hexRgb(a), y = hexRgb(b);
  return `#${x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
}
const lighten = (h: string, t: number) => mix(h, '#ffffff', t);
const withAlpha = (h: string, a: number) => {
  const [r, g, b] = hexRgb(h);
  return `rgba(${r}, ${g}, ${b}, ${a.toFixed(3)})`;
};

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
export async function shareCard(blob: Blob, w: Pick<CardWords, 'filename' | 'shareText'>, link: string, env: ShareEnv): Promise<'shared' | 'downloaded' | 'cancelled'> {
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

export { KICKER_FONT, MARGIN, statFont };
