/**
 * The live flight HUD's sums (spec 7.1, 7.3), kept pure so they can be tested without a page:
 * the string line (progress, ticks at each local midnight along the route), "Day 1 of 3 · 14 h aloft",
 * the stats, the clock, the status-region rules, the canvas label, the backdrop brightness behind the
 * text, and where the balloon is drawn in a world whose ground is finer than the route's.
 */
import tzlookup from '@photostructure/tz-lookup';
import { FLIGHT_HOURS } from '../config';
import type { Route } from '../flight/route';
import type { LatLon } from '../geo/coords';
import { withArticle } from '../geo/places';
import { localTime } from '../geo/time';

const H = 3600e3;
const FLIGHT_MS = FLIGHT_HOURS * H;

/** Share of the 72 hours flown, 0..1. */
export function progress(releaseMs: number, nowMs: number): number {
  const f = (nowMs - releaseMs) / FLIGHT_MS;
  return Number.isFinite(f) ? Math.min(1, Math.max(0, f)) : 0;
}

/** "Day 1 of 3 · 14 h aloft"; minutes in the first hour; "Landed · 72 h aloft" after 72 hours. */
export function dayLine(releaseMs: number, nowMs: number): string {
  const ms = Math.max(0, nowMs - releaseMs);
  if (!Number.isFinite(ms)) return 'Day 1 of 3 · 0 min aloft';
  if (ms >= FLIGHT_MS) return `Landed · ${FLIGHT_HOURS} h aloft`;
  const day = Math.min(3, Math.floor(ms / (24 * H)) + 1);
  const aloft = ms < H ? `${Math.floor(ms / 60e3)} min` : `${Math.floor(ms / H)} h`;
  return `Day ${day} of 3 · ${aloft} aloft`;
}

const dayFormatters = new Map<string, Intl.DateTimeFormat>();
function localParts(utcMs: number, tz: string): { day: string; minutes: number } {
  let f = dayFormatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    dayFormatters.set(tz, f);
  }
  const parts = f.formatToParts(new Date(utcMs));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return { day: `${get('year')}-${get('month')}-${get('day')}`, minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}

/** Ticks closer than this to either end are left out: the knot starts there and the ring ends there. */
const END_GAP = 0.005;
const RING_GAP = 0.015;

/**
 * Where the string line's ticks go (0..1 of the 72 hours): each local midnight under the balloon,
 * in the time zone of wherever it is at that moment, so a flight east meets midnight sooner.
 */
export function midnightTicks(route: Route): number[] {
  const pts = route.points;
  const out: number[] = [];
  let prevDay = '';
  let prevT = route.release;
  for (let i = 0; i < pts.length; i++) {
    const t = route.release + pts[i].tSec * 1000;
    let tz: string;
    try {
      tz = tzlookup(pts[i].lat, pts[i].lon);
    } catch {
      continue;
    }
    const { day, minutes } = localParts(t, tz);
    if (i > 0 && day !== prevDay) {
      const midnight = Math.min(t, Math.max(prevT, t - minutes * 60e3));
      const f = (midnight - route.release) / FLIGHT_MS;
      if (f > END_GAP && f < 1 - RING_GAP) out.push(f);
    }
    prevDay = day;
    prevT = t;
  }
  return out;
}

const grouped = new Intl.NumberFormat('en-GB');

/** Height above the ground: "86 m" while low, to the nearest 10 m from 100 m, "1,510 m". */
export function heightText(m: number): string {
  const v = Math.max(0, Number.isFinite(m) ? m : 0);
  return `${grouped.format(v < 100 ? Math.round(v) : Math.round(v / 10) * 10)} m`;
}

/** Ground speed in km/h. */
export function speedText(ms: number): string {
  return `${Math.round(Math.max(0, Number.isFinite(ms) ? ms : 0) * 3.6)} km/h`;
}

/** The clock: local 24-hour time where the balloon is, with no day or time-of-day word. */
export function clockText(utcMs: number, p: LatLon): string {
  return localTime(utcMs, p).label.split(' ').pop() ?? '';
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Where to draw the balloon (scene y, metres above sea level). The route's heights stand on coarse
 * ground (spec 11), the drawn world on fine ground, and the two can differ by tens of metres. Low down
 * the balloon keeps the route's height above the drawn ground, so it leaves the street and rises past
 * the roofs; from 150 m to 600 m up it blends onto the route's own height (a pressure level), so at
 * cruise it does not bob over every hill. It never goes into the drawn ground.
 */
export function sceneAltitude(routeAltM: number, routeGroundM: number, drawnGroundM: number): number {
  const agl = Number.isFinite(routeAltM) && Number.isFinite(routeGroundM) ? Math.max(0, routeAltM - routeGroundM) : 1.5;
  const alt = Number.isFinite(routeAltM) ? routeAltM : drawnGroundM + agl;
  const low = drawnGroundM + agl;
  const w = smooth(150, 600, agl);
  const y = low * (1 - w) + alt * w;
  return Math.max(y, drawnGroundM + Math.min(agl, 30));
}

export type Landing = { name: string; kind: string };
export type AnnounceState = {
  phase: 'flying' | 'landed';
  home: string;
  /** The country under the balloon now; null over the sea or where unknown. */
  country: string | null;
  /** The last country it was known to be over (kept across the sea). */
  lastCountry?: string | null;
  landing: Landing | null;
  /** The visitor's own balloon (launched here or saved), or one opened from someone's link. */
  own: boolean;
};

const whose = (own: boolean) => (own ? 'Your balloon' : 'This balloon');

function landedWords(l: Landing | null): string {
  if (!l) return 'landed';
  if (l.kind === 'sea') return `came down in ${withArticle(l.name, 'sea')}`;
  return l.kind === 'town' ? `landed near ${l.name}` : `landed in ${withArticle(l.name, l.kind)}`;
}

/** The line under the clock once it is down: "Landed near Bergen", "Came down in the North Sea". */
export function landedOver(l: Landing | null): string {
  const w = landedWords(l);
  return w.charAt(0).toUpperCase() + w.slice(1);
}

/**
 * What the polite status region says (spec 7.3): only the launch, a change of country and the landing.
 * Null when there is nothing to say. `prev` is null for the first state of a flight.
 */
export function announcement(prev: AnnounceState | null, next: AnnounceState): string | null {
  if (next.phase === 'landed') {
    return prev?.phase === 'landed' ? null : `${whose(next.own)} ${landedWords(next.landing)}`;
  }
  if (!prev) return next.own ? `${whose(true)} is on its way from ${next.home}` : null;
  const ref = prev.country ?? prev.lastCountry ?? null;
  if (next.country && ref && next.country !== ref) return `${whose(next.own)} is over ${next.country} now`;
  return null;
}

/** The 3D canvas's label: "Your balloon is over the North Sea, 412 km from Manchester". */
export function sceneLabel(s: { own: boolean; over: string; km: number; home: string; landed: string | null }): string {
  const km = s.km < 10 ? s.km.toFixed(1) : String(Math.round(s.km));
  const where = s.landed ? s.landed.charAt(0).toLowerCase() + s.landed.slice(1) : `is over ${s.over}`;
  return `${whose(s.own)} ${where}, ${km} km from ${s.home}`;
}

/**
 * How bright the scene is behind a band of text (WCAG relative luminance, 0..1), from RGBA pixels
 * read off the frame: the 90th percentile, since the brightest patches limit the contrast.
 */
export function brightLuminance(rgba: Uint8Array): number {
  const n = Math.floor(rgba.length / 4);
  if (n === 0) return 0;
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const L = new Float32Array(n);
  for (let i = 0; i < n; i++) L[i] = 0.2126 * lin(rgba[i * 4]) + 0.7152 * lin(rgba[i * 4 + 1]) + 0.0722 * lin(rgba[i * 4 + 2]);
  L.sort();
  return L[Math.min(n - 1, Math.floor(n * 0.9))];
}

export const FLIGHT_MS_TOTAL = FLIGHT_MS;
