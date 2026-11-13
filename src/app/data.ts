/**
 * The data a flight needs, fetched as early as it can be: the wind manifest and the wind tiles round
 * the start (one WindField shared by the warm-up and the route), the coarse route ground under the
 * start (so the route's first pass does not guess 0 m, ruling R28), and the PMTiles header that comes
 * with it. Nothing here sends the visitor's position anywhere but the wind and terrain files the page
 * already reads (spec 6.6).
 */
import { FLIGHT_HOURS } from '../config';
import { computeRoute, routeFromHourly, type Route } from '../flight/route';
import type { SavedBalloon } from '../flight/codec';
import type { LatLon } from '../geo/coords';
import { loadManifest, WindField } from '../wind/loader';
import { routeGround } from '../world/terrainsrc';

/** A manifest older than this is read again before the next release. */
const MANIFEST_TTL_MS = 20 * 60e3;
const H = 3600e3;

let field: { at: number; p: Promise<WindField> } | null = null;

/** The wind field of the newest usable run (cached; a failure is forgotten so Try again asks again). */
export function windField(now = Date.now()): Promise<WindField> {
  if (!field || now - field.at > MANIFEST_TTL_MS) {
    const p = loadManifest(undefined, undefined, now).then((m) => new WindField(m));
    const mine = { at: now, p };
    field = mine;
    p.catch(() => {
      if (field === mine) field = null;
    });
  }
  return field.p;
}

/** Start loading what a release from p will need: the start's ground and the winds round it. */
export function warm(p: LatLon, now = Date.now()): void {
  routeGround(p).catch(() => {});
  windField(now)
    .then((w) => w.prepare(p, [now, now + 3 * H]))
    .catch(() => {});
}

/**
 * The wind the balloon would feel at the moment of release (1.5 m over the coarse ground at p), for
 * the person's stance and the street camera before the route exists. Null when it is not known.
 */
export async function surfaceWind(p: LatLon, now = Date.now()): Promise<{ speedMs: number; headingDeg: number } | null> {
  try {
    const w = await windField(now);
    await w.prepare(p, [now, now + H], { radius: 0 });
    const g = await routeGround(p);
    const s = w.sample(p, g + 1.5, now);
    return { speedMs: Math.hypot(s.u, s.v), headingDeg: ((Math.atan2(s.u, s.v) * 180) / Math.PI + 360) % 360 };
  } catch {
    return null;
  }
}

/** The 72-hour route from p, released at releaseMs, from the latest winds (spec 6.3). */
export async function releaseRoute(p: LatLon, releaseMs: number): Promise<Route> {
  const w = await windField();
  return computeRoute(p, releaseMs, w, routeGround);
}

/**
 * A shared or saved balloon's drawable route, rebuilt from its 73 hourly points. The ground tiles
 * along it are asked for together first (the rebuild then reads them from the cache), and a terrain
 * failure counts as sea level, so a link always opens.
 */
export async function linkRoute(b: SavedBalloon): Promise<Route> {
  const ground = (p: LatLon) => routeGround(p).catch(() => 0);
  await Promise.all(b.hourly.map(ground));
  const r = await routeFromHourly(b.hourly, b.release, ground);
  return { ...r, runId: b.runId };
}

/** Landed: 72 hours after release. */
export const landedAt = (route: Route): number => route.release + FLIGHT_HOURS * H;
