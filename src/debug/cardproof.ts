/**
 * The landing card's proof page (not for visitors): a made-up trip between two places, the real card
 * pipeline (the card world on its own worker pool, the painter, the card view and its reveal) with no
 * winds. For looking at cards and their reveals by trip, and for screenshots.
 *
 * Query:
 *   trip=bergen|bialystok|huddersfield|sea|night|tokyo   a trip below (default bergen)
 *   reveal=0                                             open the card without its reveal
 *   at=s                                                 hold the reveal at s seconds (window.__revealAt)
 *   flat=1                                               the 2D fallback's card (the flat map, no 3D)
 */
import '../ui/styles.css';
import { routeFromHourly } from '../flight/route';
import type { SavedBalloon } from '../flight/codec';
import { lonDelta, wrapLon, type LatLon } from '../geo/coords';
import { landingPlace } from '../geo/facts';
import { WorkerPool } from '../world/workerpool';
import type { BuildReply, BuildRequest } from '../world/worker';
import { cardScene, farStats } from '../app/cardshot';
import { cardHook, presentCard } from '../app/landingcard';
import type { LiveScene } from '../app/scene';
import { mapScene } from '../app/mapcard';
import { Fallback } from '../fallback/fallback2d';

type Trip = { name: string; a: LatLon; b: LatLon; wig: number[]; landsUtc: string };

/** The trips the card is proved on (landing times chosen for the light: golden hour, day, night). */
const TRIPS: Record<string, Trip> = {
  bergen: { name: 'Manchester', a: { lat: 53.4794, lon: -2.2453 }, b: { lat: 60.3913, lon: 5.3221 }, wig: [0.1, -0.05], landsUtc: '2026-11-12T13:40:00Z' },
  bialystok: { name: 'London', a: { lat: 51.5072, lon: -0.1276 }, b: { lat: 53.1325, lon: 23.1688 }, wig: [-0.06, 0.03], landsUtc: '2026-11-12T10:30:00Z' },
  huddersfield: { name: 'Manchester', a: { lat: 53.4794, lon: -2.2453 }, b: { lat: 53.6458, lon: -1.785 }, wig: [0.25, 0.08], landsUtc: '2026-11-12T12:10:00Z' },
  sea: { name: 'Manchester', a: { lat: 53.4794, lon: -2.2453 }, b: { lat: 55.6, lon: 3.6 }, wig: [0.08, -0.04], landsUtc: '2026-11-12T14:50:00Z' },
  night: { name: 'Paris', a: { lat: 48.8566, lon: 2.3522 }, b: { lat: 52.52, lon: 13.405 }, wig: [0.07, 0.03], landsUtc: '2026-11-12T21:30:00Z' },
  tokyo: { name: 'Tokyo', a: { lat: 35.6762, lon: 139.6503 }, b: { lat: 38.2682, lon: 140.8694 }, wig: [-0.12, 0.05], landsUtc: '2026-11-12T03:00:00Z' },
};

/** A drifting path: an S-bend and a small wobble about the straight line (as the mock-ups'), hourly. */
function hourly(t: Trip, n = 73): LatLon[] {
  const out: LatLon[] = [];
  const dlat = t.b.lat - t.a.lat, dlon = lonDelta(t.a.lon, t.b.lon);
  const L = Math.hypot(dlat, dlon * Math.cos((((t.a.lat + t.b.lat) / 2) * Math.PI) / 180));
  for (let i = 0; i < n; i++) {
    const f = i / (n - 1);
    const s = f + 0.05 * Math.sin(2 * Math.PI * f);
    let lat = t.a.lat + dlat * s, lon = t.a.lon + dlon * s;
    let off = t.wig.reduce((a, w, k) => a + w * Math.sin(Math.PI * f * (k + 1)), 0) * L;
    off += 0.006 * L * Math.sin(f * 31) * Math.sin(Math.PI * f);
    const nx = -dlat, ny = dlon * Math.cos((lat * Math.PI) / 180);
    const nl = Math.hypot(nx, ny) || 1;
    lon += (off * nx) / nl / Math.cos((lat * Math.PI) / 180);
    lat += (off * ny) / nl;
    out.push({ lat, lon: wrapLon(lon) });
  }
  out[0] = { ...t.a };
  out[n - 1] = { ...t.b };
  return out;
}

const q = new URLSearchParams(location.search);
const trip = TRIPS[q.get('trip') ?? 'bergen'] ?? TRIPS.bergen;
const flat = q.get('flat') === '1';
const reveal = q.get('reveal') !== '0' && !flat;
if (q.has('at')) (window as unknown as { __revealAt?: number }).__revealAt = Number(q.get('at'));

async function main() {
  const release = Date.parse(trip.landsUtc) - 72 * 3600e3;
  const hours = hourly(trip);
  const route = await routeFromHourly(hours, release, async () => 0);
  const saved: SavedBalloon = { v: 1, name: trip.name, start: trip.a, release, hourly: hours, runId: 'proof' };
  const pool = new WorkerPool<BuildRequest, BuildReply>(() => new Worker(new URL('../world/worker.ts', import.meta.url), { type: 'module' }), 4, { timeoutMs: 60000 });
  const live = { pool, gone: false } as unknown as LiveScene;
  cardHook.world = farStats;
  // the 2D map's card: its coastline map for this route (Fallback.cardMap reads only the flight)
  const map = { cardMap: (w: number, h: number, b: Parameters<Fallback['cardMap']>[2]) => Fallback.prototype.cardMap.call({ flight: { route } } as unknown as Fallback, w, h, b) };
  await presentCard({ scene: flat ? mapScene(map) : cardScene(live, { reveal }), route, saved, own: true, landing: landingPlace(route).catch(() => null), isCurrent: () => true, reveal });
}
void main();
