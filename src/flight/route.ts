import {
  CLIMB_RATE_MS,
  CRUISE_ASL_M,
  CRUISE_CLEARANCE_M,
  FLIGHT_HOURS,
  LINK_POINTS,
  ROUTE_STEP_MIN,
} from '../config';
import { bearingDeg, destination, haversineKm, lonDelta, wrapLon, type LatLon } from '../geo/coords';
import { TileNotReadyError, type WindField } from '../wind/loader';
import { altitudeAt } from './ascent';

export type RoutePoint = {
  tSec: number;
  lat: number;
  lon: number;
  altM: number;
  groundM: number;
  speedMs: number;
  headingDeg: number;
};
export type Route = { points: RoutePoint[]; hourly: LatLon[]; release: number; runId: string };

const STEP_S = ROUTE_STEP_MIN * 60;
const STEPS = (FLIGHT_HOURS * 3600) / STEP_S; // 432
const HOURLY_EVERY = 3600 / STEP_S; // 6
const RAD = Math.PI / 180;

/** Run fn, preparing the tiles around p for [utcMs, utcMs + step] and retrying once if they are missing. */
async function withTiles<T>(wind: WindField, p: LatLon, utcMs: number, fn: () => T): Promise<T> {
  try {
    return fn();
  } catch (e) {
    if (!(e instanceof TileNotReadyError)) throw e;
    await wind.prepare(p, [utcMs, utcMs + STEP_S * 1000], { radius: 0 });
    return fn();
  }
}

/**
 * Ground height under the route. `peek`, when present, answers synchronously once the terrain for a
 * point is already loaded (and returns undefined otherwise); it must agree with the async call.
 */
export type RouteGround = ((p: LatLon) => Promise<number>) & { peek?: (p: LatLon) => number | undefined };

/** Scouting passes before falling back to awaiting the ground at every step (bounds retries of failing tiles). */
const SCOUT_PASSES = 8;

/**
 * Integrate a 72 h route (RK2 midpoint, 10-minute steps) through the forecast winds.
 *
 * Awaiting the ground at every step would fetch each terrain tile only when the route reaches it,
 * one after another. With a peekable ground the route is instead scouted: a pass runs with the
 * ground heights already loaded (0 m where unknown) and starts loading every tile it touched, all
 * at once; once they arrive the next pass runs. A pass that needed no unknown ground is exactly the
 * route the step-by-step version computes, and is returned. Wind tiles still load on demand.
 */
export async function computeRoute(
  start: LatLon,
  releaseUtcMs: number,
  wind: WindField,
  ground: RouteGround,
): Promise<Route> {
  const p0: LatLon = { lat: start.lat, lon: wrapLon(start.lon) };
  const peek = ground.peek;
  if (peek) {
    for (let pass = 0; pass < SCOUT_PASSES; pass++) {
      const pending: Promise<unknown>[] = [];
      const route = await integrate(p0, releaseUtcMs, wind, (p) => {
        const g = peek(p);
        if (g !== undefined) return g;
        pending.push(ground(p).catch(() => undefined)); // a failure surfaces in the final pass
        return 0;
      });
      if (pending.length === 0) return route;
      await Promise.all(pending);
    }
  }
  return integrate(p0, releaseUtcMs, wind, ground);
}

async function integrate(
  start: LatLon,
  releaseUtcMs: number,
  wind: WindField,
  ground: (p: LatLon) => number | Promise<number>,
): Promise<Route> {
  const points: RoutePoint[] = [];
  let p: LatLon = start;
  const ground0 = await ground(p);
  let climbing = true;
  let alt = 0;
  let target = 0;

  for (let i = 0; i < STEPS; i++) {
    const tSec = i * STEP_S;
    const utc = releaseUtcMs + tSec * 1000;
    const groundM = i === 0 ? ground0 : await ground(p);
    target = (await withTiles(wind, p, utc, () => wind.cruiseLevelHeight(p, utc, groundM))).heightM;
    if (climbing) {
      alt = altitudeAt(tSec, ground0, target);
      if (alt >= target) climbing = false;
    } else {
      const maxStep = CLIMB_RATE_MS * STEP_S;
      alt = Math.max(Math.min(target, alt + maxStep), alt - maxStep, groundM + CRUISE_CLEARANCE_M);
    }
    const midAlt = climbing ? altitudeAt(tSec + STEP_S / 2, ground0, target) : alt;
    const w1 = await withTiles(wind, p, utc, () => wind.sample(p, alt, utc));
    const half = destination(p, (Math.atan2(w1.u, w1.v) / RAD + 360) % 360, (Math.hypot(w1.u, w1.v) * STEP_S) / 2000);
    const utcMid = utc + (STEP_S / 2) * 1000;
    const w2 = await withTiles(wind, half, utcMid, () => wind.sample(half, midAlt, utcMid));
    const speedMs = Math.hypot(w2.u, w2.v);
    const headingDeg = (Math.atan2(w2.u, w2.v) / RAD + 360) % 360;
    points.push({ tSec, lat: p.lat, lon: p.lon, altM: alt, groundM, speedMs, headingDeg });
    p = destination(p, headingDeg, (speedMs * STEP_S) / 1000);
  }

  // Final point: no step follows, so reuse the last step's target rather than reading a window past 72 h.
  const groundEnd = await ground(p);
  const maxStep = CLIMB_RATE_MS * STEP_S;
  const altEnd = climbing
    ? Math.min(target, alt + maxStep)
    : Math.max(Math.min(target, alt + maxStep), alt - maxStep, groundEnd + CRUISE_CLEARANCE_M);
  const last = points[points.length - 1];
  points.push({ tSec: STEPS * STEP_S, lat: p.lat, lon: p.lon, altM: altEnd, groundM: groundEnd, speedMs: last.speedMs, headingDeg: last.headingDeg });

  return { points, hourly: hourlyOf(points), release: releaseUtcMs, runId: wind.runId };
}

function hourlyOf(points: RoutePoint[]): LatLon[] {
  const out: LatLon[] = [];
  for (let k = 0; k < LINK_POINTS; k++) out.push({ lat: points[k * HOURLY_EVERY].lat, lon: points[k * HOURLY_EVERY].lon });
  return out;
}

const lerp = (a: number, b: number, f: number): number => a + (b - a) * f;

/** Position at a wall-clock time: clamped to the ends, interpolated between 10-minute points. */
export function positionAt(route: Route, utcMs: number): RoutePoint {
  const pts = route.points;
  const idx = (utcMs - route.release) / (STEP_S * 1000);
  if (idx <= 0) return pts[0];
  if (idx >= pts.length - 1) return pts[pts.length - 1];
  const i = Math.floor(idx);
  const f = idx - i;
  const a = pts[i];
  const b = pts[i + 1];
  const dh = ((((b.headingDeg - a.headingDeg + 180) % 360) + 360) % 360) - 180;
  return {
    tSec: lerp(a.tSec, b.tSec, f),
    lat: lerp(a.lat, b.lat, f),
    lon: wrapLon(a.lon + lonDelta(a.lon, b.lon) * f),
    altM: lerp(a.altM, b.altM, f),
    groundM: lerp(a.groundM, b.groundM, f),
    speedMs: lerp(a.speedMs, b.speedMs, f),
    headingDeg: (((a.headingDeg + dh * f) % 360) + 360) % 360,
  };
}

/** Uniform Catmull-Rom through four points at parameter s in [0, 1] between p1 and p2. */
function catmull(p0: number, p1: number, p2: number, p3: number, s: number): number {
  const s2 = s * s;
  const s3 = s2 * s;
  return 0.5 * (2 * p1 + (-p0 + p2) * s + (2 * p0 - 5 * p1 + 4 * p2 - p3) * s2 + (-p0 + 3 * p1 - 3 * p2 + p3) * s3);
}

/** Rebuild a drawable route from the 73 hourly link points (used when opening a shared link). */
export async function routeFromHourly(
  hourly: LatLon[],
  releaseUtcMs: number,
  ground: (p: LatLon) => Promise<number>,
): Promise<Route> {
  const n = hourly.length;
  const lat: number[] = [hourly[0].lat];
  const lon: number[] = [hourly[0].lon]; // unwrapped
  for (let i = 1; i < n; i++) {
    lat.push(hourly[i].lat);
    lon.push(lon[i - 1] + lonDelta(hourly[i - 1].lon, hourly[i].lon));
  }
  const at = (arr: number[], i: number): number =>
    i < 0 ? 2 * arr[0] - arr[1] : i >= n ? 2 * arr[n - 1] - arr[n - 2] : arr[i];

  const ll: LatLon[] = [];
  for (let i = 0; i < n - 1; i++) {
    for (let k = 0; k < HOURLY_EVERY; k++) {
      const s = k / HOURLY_EVERY;
      ll.push({
        lat: Math.max(-90, Math.min(90, catmull(at(lat, i - 1), lat[i], lat[i + 1], at(lat, i + 2), s))),
        lon: wrapLon(catmull(at(lon, i - 1), lon[i], lon[i + 1], at(lon, i + 2), s)),
      });
    }
  }
  ll.push({ lat: lat[n - 1], lon: wrapLon(lon[n - 1]) });

  const g0 = await ground(ll[0]);
  const target0 = Math.max(CRUISE_ASL_M, g0 + CRUISE_CLEARANCE_M);
  const climbEnd = (target0 - g0 - CLIMB_RATE_MS) / CLIMB_RATE_MS;
  const points: RoutePoint[] = [];
  for (let i = 0; i < ll.length; i++) {
    const tSec = i * STEP_S;
    const groundM = i === 0 ? g0 : await ground(ll[i]);
    const altM = tSec < climbEnd ? altitudeAt(tSec, g0, target0) : Math.max(CRUISE_ASL_M, groundM + CRUISE_CLEARANCE_M);
    const j = Math.min(i, ll.length - 2);
    const speedMs = (haversineKm(ll[j], ll[j + 1]) * 1000) / STEP_S;
    points.push({ tSec, lat: ll[i].lat, lon: ll[i].lon, altM, groundM, speedMs, headingDeg: bearingDeg(ll[j], ll[j + 1]) });
  }
  return { points, hourly: hourly.map((h) => ({ ...h })), release: releaseUtcMs, runId: '' };
}
