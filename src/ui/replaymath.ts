/**
 * The whole-trip replay's sums (spec 6.4, 7.3, 8), kept pure so they can be tested without a page.
 *
 * Timeline over 20 s (other lengths scale every phase):
 *   0-2 s    climb: the camera rises from beside the released balloon to the high, wide view;
 *            the route holds at its start
 *   2-17 s   travel: the 72 hours, slow away from the start, steady in the middle (at most about 1.2x
 *            the average speed, so names and coasts stay readable), slow into the end
 *   17-19 s  descent: the camera comes down to the landing and the balloon settles onto it
 *   19-20 s  hold, then the replay ends (the landing card)
 * Reduced motion: no camera move at all; the route draws in place over 2 s and then holds still long
 * enough to read its names.
 *
 * Place names: at most five, the biggest crossed (towns by population, named seas and regions count
 * as big), never two on screen at once, each on screen for 1.6 s from the moment it is crossed.
 */
import type { LatLon } from '../geo/coords';
import { withArticle } from '../geo/places';
import { localTime } from '../geo/time';

export const PHASES = { climbS: 2, travelS: 15, descentS: 2, holdS: 1 } as const;
const BASE_S = PHASES.climbS + PHASES.travelS + PHASES.descentS + PHASES.holdS;
export const MAX_NAMES = 5;
export const NAME_ON_S = 1.6;
/** Fades at each end of a name's 1.6 s. */
const NAME_IN_S = 0.3;
const NAME_OUT_S = 0.4;
/** Clear space between one name going and the next arriving. */
const NAME_GAP_S = 0.3;
/** Reduced motion: the route draws in over this long, then holds this long. */
export const REDUCED_DRAW_S = 2;
export const REDUCED_TOTAL_S = 6;

/** Share of each end of the travel spent speeding up or slowing down. */
const RAMP = 0.15;

export type ReplayPhase = 'climb' | 'travel' | 'descent' | 'hold' | 'done';
export type ReplayFrame = {
  phase: ReplayPhase;
  /** How far along the 72 hours the balloon is, 0..1. */
  routeFrac: number;
  /** The camera: 0 beside the balloon, 1 the high, wide view. */
  wide: number;
  /** The balloon coming down onto the ground at the end, 0..1. */
  landing: number;
  done: boolean;
};

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
/** Slow in, slow out: physical camera moves (as the director's). */
const inOut = (x: number) => 0.5 - 0.5 * Math.cos(Math.PI * clamp01(x));

/** The interface curve cubic-bezier(0.22, 1, 0.36, 1) (x -> y). */
export function easeOut(x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bez = (a: number, b: number, t: number) => 3 * a * (1 - t) ** 2 * t + 3 * b * (1 - t) * t * t + t ** 3;
  let lo = 0, hi = 1;
  for (let i = 0; i < 32; i++) {
    const m = (lo + hi) / 2;
    if (bez(0.22, 0.36, m) < x) lo = m; else hi = m;
  }
  return bez(1, 1, (lo + hi) / 2);
}

/**
 * Share of the route covered after a share s of the travel time: a speed that rises on a half cosine
 * over the first 15%, holds, and falls the same way over the last 15%.
 */
export function travelFrac(s: number): number {
  const x = clamp01(s);
  const area = 1 - RAMP;
  // integral of the half-cosine ramp from 0 to u (u <= RAMP)
  const ramp = (u: number) => u / 2 - (RAMP / (2 * Math.PI)) * Math.sin((Math.PI * u) / RAMP);
  let d: number;
  if (x < RAMP) d = ramp(x);
  else if (x <= 1 - RAMP) d = RAMP / 2 + (x - RAMP);
  else d = area - ramp(1 - x);
  return Math.min(1, Math.max(0, d / area));
}

/** Where the replay is at tS seconds (of totalS). */
export function replayFrame(tS: number, totalS = BASE_S): ReplayFrame {
  const k = totalS / BASE_S;
  const t = Number.isFinite(tS) ? Math.max(0, tS) / k : 0;
  const a = PHASES.climbS, b = a + PHASES.travelS, c = b + PHASES.descentS;
  if (t < a) return { phase: 'climb', routeFrac: 0, wide: inOut(t / a), landing: 0, done: false };
  if (t < b) return { phase: 'travel', routeFrac: travelFrac((t - a) / PHASES.travelS), wide: 1, landing: 0, done: false };
  if (t < c) {
    const u = inOut((t - b) / PHASES.descentS);
    return { phase: 'descent', routeFrac: 1, wide: 1 - u, landing: u, done: false };
  }
  if (t < BASE_S) return { phase: 'hold', routeFrac: 1, wide: 0, landing: 1, done: false };
  return { phase: 'done', routeFrac: 1, wide: 0, landing: 1, done: true };
}

/** The replay time (s, of totalS) at which the travel reaches a share f of the route. */
export function wallAtFrac(f: number, totalS = BASE_S): number {
  const target = clamp01(f);
  let lo = 0, hi = 1;
  for (let i = 0; i < 40; i++) {
    const m = (lo + hi) / 2;
    if (travelFrac(m) < target) lo = m; else hi = m;
  }
  return (PHASES.climbS + ((lo + hi) / 2) * PHASES.travelS) * (totalS / BASE_S);
}

/** Reduced motion: the route drawing in place (on the interface curve), then still. */
export function reducedFrame(tS: number): { routeFrac: number; done: boolean } {
  const t = Number.isFinite(tS) ? Math.max(0, tS) : 0;
  return { routeFrac: t >= REDUCED_DRAW_S ? 1 : easeOut(t / REDUCED_DRAW_S), done: t >= REDUCED_TOTAL_S };
}

export type NameCandidate = {
  name: string;
  kind: 'town' | 'sea' | 'region';
  population?: number;
  /** Not a real name ("open sea"). */
  generic?: boolean;
  /** Route time when the balloon is closest to it, s after release. */
  tSec: number;
};
export type ReplayName = {
  /** As written on screen: "Leeds", "the North Sea". */
  name: string;
  /** Replay time (s) it appears. */
  atS: number;
  /** Where along the route (0..1) it is crossed. */
  frac: number;
};

/** Named seas and regions are big things to cross: they rank with large cities. */
const SEA_SIZE = 3e6;
const REGION_SIZE = 1.5e6;
/** Towns smaller than this are not worth a name in 20 seconds. */
const MIN_TOWN = 20000;

/**
 * The names shown on the way: the biggest crossed, at most five, none overlapping another or the
 * climb and the descent, in route order. `exclude`: the start and the landing (said elsewhere).
 */
export function pickNames(cands: NameCandidate[], opts: { exclude: string[]; flightSec: number; totalS?: number }): ReplayName[] {
  const totalS = opts.totalS ?? BASE_S;
  const k = totalS / BASE_S;
  const first = PHASES.climbS * k;
  const last = (PHASES.climbS + PHASES.travelS) * k - NAME_ON_S;
  const skip = new Set(opts.exclude.map((s) => s.toLowerCase()));
  const size = (c: NameCandidate) => (c.kind === 'sea' ? SEA_SIZE : c.kind === 'region' ? REGION_SIZE : c.population ?? 0);
  const seen = new Set<string>();
  const ranked = cands
    .filter((c) => c.name && !c.generic && !skip.has(c.name.toLowerCase()) && Number.isFinite(c.tSec) && (c.kind !== 'town' || size(c) >= MIN_TOWN))
    .sort((a, b) => size(b) - size(a) || a.tSec - b.tSec)
    .filter((c) => {
      // the same place crossed twice: shown once, the first time it is crossed among the biggest
      const key = c.name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  const out: ReplayName[] = [];
  for (const c of ranked) {
    if (out.length >= MAX_NAMES) break;
    const frac = clamp01(c.tSec / opts.flightSec);
    const atS = Math.min(last, Math.max(first, wallAtFrac(frac, totalS)));
    if (out.some((n) => Math.abs(n.atS - atS) < NAME_ON_S + NAME_GAP_S)) continue;
    out.push({ name: withArticle(c.name, c.kind), atS, frac });
  }
  return out.sort((a, b) => a.atS - b.atS);
}

/** How visible a name that appears at atS is at tS (0..1): in over 0.3 s, out over the last 0.4 s. */
export function nameOpacity(tS: number, atS: number): number {
  const u = tS - atS;
  if (!(u > 0) || u >= NAME_ON_S) return 0;
  if (u < NAME_IN_S) return easeOut(u / NAME_IN_S);
  if (u > NAME_ON_S - NAME_OUT_S) return 1 - easeOut((u - (NAME_ON_S - NAME_OUT_S)) / NAME_OUT_S);
  return 1;
}

/** "Expected to land near" / "Bergen" / "Sun 15 Nov, 14:20" (the local day and time where it comes down). */
export function landingLines(place: { name: string; kind: string }, at: LatLon, utcMs: number, landed: boolean): { kicker: string; name: string; when: string } {
  const sea = place.kind === 'sea';
  const kicker = landed ? (sea ? 'Came down in' : 'Landed near') : sea ? 'Expected to come down in' : 'Expected to land near';
  const { tz, label } = localTime(utcMs, at);
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short' }).formatToParts(new Date(utcMs));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return { kicker, name: withArticle(place.name, place.kind), when: `${get('weekday')} ${get('day')} ${get('month')}, ${label.split(' ').pop()}` };
}
