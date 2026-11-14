import { describe, expect, it } from 'vitest';
import { CARD_MAX_TILES, cardShot, cardTiles, fromCard, groundHit, poseAt, poseCamera, projectTo, revealStart, ROUTE_BOX, TILT_MAX, TILT_MIN, toCard, MIN_DIST_M, type CardShot } from '../../src/app/cardframe';
import { levelFor } from '../../src/world/lod';
import { haversineKm, lonDelta, wrapLon, type LatLon } from '../../src/geo/coords';

/** A drifting path from a to b: an S-bend about the straight line (as the mock-up's trips). */
function trip(a: LatLon, b: LatLon, wig = 0.1, n = 145): LatLon[] {
  const out: LatLon[] = [];
  const dlat = b.lat - a.lat, dlon = lonDelta(a.lon, b.lon);
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const off = wig * Math.sin(Math.PI * t) * Math.sin(2 * Math.PI * t);
    out.push({ lat: a.lat + dlat * t - off * dlon * 0.5, lon: wrapLon(a.lon + dlon * t + off * dlat) });
  }
  return out;
}

const MANCHESTER = { lat: 53.4794, lon: -2.2453 };
const BERGEN = { lat: 60.3913, lon: 5.3221 };
const LONDON = { lat: 51.5072, lon: -0.1276 };
const BIALYSTOK = { lat: 53.1325, lon: 23.1688 };
const HUDDERSFIELD = { lat: 53.6458, lon: -1.785 };
const LISBON = { lat: 38.72, lon: -9.14 };
const MOSCOW = { lat: 55.75, lon: 37.62 };

/** The route's start, landing and every point on the picture. */
function seen(shot: CardShot, pts: LatLon[]) {
  const cam = poseCamera(shot);
  return pts.map((p) => {
    const l = toCard(shot.landing, p);
    return projectTo(cam, l.x, l.z);
  });
}

describe('cardShot', () => {
  it('Manchester to Bergen: from about 1,600 km up, the start low in the picture and the landing higher', () => {
    const r = trip(MANCHESTER, BERGEN);
    const shot = cardShot(r);
    expect(shot.altM / 1000).toBeGreaterThan(1100);
    expect(shot.altM / 1000).toBeLessThan(2200);
    expect(shot.across).toBe(false);
    const s = seen(shot, r);
    const start = s[0], land = s[s.length - 1];
    expect(start.fy).toBeGreaterThan(land.fy + 0.3);
    expect(start.fy).toBeGreaterThan(0.6);
    expect(land.fy).toBeLessThan(0.4);
  });

  it('keeps the whole route in sight and inside the box', () => {
    for (const [a, b] of [[MANCHESTER, BERGEN], [LONDON, BIALYSTOK], [MANCHESTER, HUDDERSFIELD], [LISBON, MOSCOW]] as const) {
      const r = trip(a, b);
      const s = seen(cardShot(r), r);
      for (const p of s) {
        expect(p.seen).toBe(true);
        expect(p.fx).toBeGreaterThanOrEqual(ROUTE_BOX.left - 0.01);
        expect(p.fx).toBeLessThanOrEqual(ROUTE_BOX.right + 0.01);
        expect(p.fy).toBeGreaterThanOrEqual(ROUTE_BOX.top - 0.01);
        expect(p.fy).toBeLessThanOrEqual(ROUTE_BOX.bottom + 0.01);
      }
    }
  });

  it('fills the box: the route is not lost in the middle of the picture', () => {
    for (const [a, b] of [[MANCHESTER, BERGEN], [LONDON, BIALYSTOK], [LISBON, MOSCOW]] as const) {
      const s = seen(cardShot(trip(a, b)), trip(a, b));
      const ys = s.map((p) => p.fy), xs = s.map((p) => p.fx);
      const h = Math.max(...ys) - Math.min(...ys), w = Math.max(...xs) - Math.min(...xs);
      expect(Math.max(h / (ROUTE_BOX.bottom - ROUTE_BOX.top), w / (ROUTE_BOX.right - ROUTE_BOX.left))).toBeGreaterThan(0.6);
    }
  });

  it('a short trip (36 km) gets a low view of its city region; a very long one a higher view', () => {
    const short = cardShot(trip(MANCHESTER, HUDDERSFIELD));
    expect(haversineKm(MANCHESTER, HUDDERSFIELD)).toBeLessThan(40);
    expect(short.distM).toBeGreaterThanOrEqual(MIN_DIST_M);
    expect(short.altM / 1000).toBeLessThan(150);
    const mid = cardShot(trip(MANCHESTER, BERGEN));
    const long = cardShot(trip(LISBON, MOSCOW));
    expect(haversineKm(LISBON, MOSCOW)).toBeGreaterThan(3000);
    expect(long.altM).toBeGreaterThan(mid.altM * 1.5);
  });

  it('clamps the angle: steeper the longer the trip, never past the limits', () => {
    const short = cardShot(trip(MANCHESTER, HUDDERSFIELD));
    const long = cardShot(trip(LISBON, MOSCOW));
    expect(short.tiltDeg).toBeLessThanOrEqual(TILT_MAX);
    expect(long.tiltDeg).toBeGreaterThanOrEqual(TILT_MIN);
    expect(long.tiltDeg).toBeLessThan(short.tiltDeg);
  });

  it('looks across a route that comes back on itself, so its loop shows', () => {
    // out east 400 km and back to near the start
    const out = trip(MANCHESTER, { lat: 53.9, lon: 3.8 }, 0.05, 73);
    const back = trip({ lat: 53.9, lon: 3.8 }, { lat: 53.2, lon: -1.6 }, 0.05, 73).slice(1);
    const r = [...out, ...back];
    const shot = cardShot(r);
    expect(shot.across).toBe(true);
    const s = seen(shot, r);
    const xs = s.map((p) => p.fx), ys = s.map((p) => p.fy);
    // the loop runs across the picture rather than straight up it
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(Math.max(...ys) - Math.min(...ys));
  });

  it('works across the date line', () => {
    const r = trip({ lat: 52, lon: 175 }, { lat: 55, lon: -170 });
    const shot = cardShot(r);
    expect(shot.altM / 1000).toBeLessThan(3000);
    for (const p of seen(shot, r)) expect(p.seen).toBe(true);
  });
});

describe('poseAt: the reveal’s move', () => {
  const shot = cardShot(trip(MANCHESTER, BERGEN));
  const from = revealStart(shot);

  it('starts exactly on the balloon and ends exactly on the card framing', () => {
    expect(poseAt(from, shot, 0)).toEqual(from);
    const end = poseAt(from, shot, 1);
    expect(end.distM).toBe(shot.distM);
    expect(end.target).toEqual(shot.target);
    expect(end.tiltDeg).toBe(shot.tiltDeg);
  });

  it('rises steadily (the distance only grows) and keeps the balloon in the middle while near', () => {
    let last = 0;
    for (let k = 0; k <= 1.0001; k += 0.05) {
      const p = poseAt(from, shot, k);
      expect(p.distM).toBeGreaterThanOrEqual(last);
      last = p.distM;
    }
    const early = poseAt(from, shot, 0.3);
    const cam = poseCamera(early);
    const b = projectTo(cam, 0, 0);
    expect(b.seen).toBe(true);
    expect(Math.abs(b.fx - 0.5)).toBeLessThan(0.1);
    expect(Math.abs(b.fy - 0.5)).toBeLessThan(0.15);
  });
});

describe('cardTiles: the map tiles of the card world', () => {
  const tileOf = (p: LatLon, z: number) => {
    const n = 2 ** z;
    const lat = (p.lat * Math.PI) / 180;
    return { z, x: Math.floor(((p.lon + 180) / 360) * n), y: Math.floor(((1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2) * n) };
  };
  const has = (ts: { z: number; x: number; y: number }[], p: LatLon) => ts.some((t) => {
    const k = tileOf(p, t.z);
    return k.x === t.x && k.y === t.y;
  });

  it('Manchester to Bergen from high up: whole-region tiles (z5, z6), both ends included, within the cap', () => {
    const r = trip(MANCHESTER, BERGEN);
    const shot = cardShot(r);
    const ts = cardTiles(shot.landing, [shot], r);
    expect(ts.length).toBeLessThanOrEqual(CARD_MAX_TILES);
    expect(ts.length).toBeGreaterThan(8);
    for (const t of ts) expect(() => levelFor(t.z)).not.toThrow();
    expect(new Set(ts.map((t) => t.z))).toEqual(new Set([5, 6]));
    expect(has(ts, BERGEN)).toBe(true);
    expect(has(ts, MANCHESTER)).toBe(true);
    expect(has(ts, { lat: 57, lon: 2 })).toBe(true); // the North Sea between
  });

  it('the reveal’s start on the balloon adds fine tiles round the landing', () => {
    const r = trip(MANCHESTER, BERGEN);
    const shot = cardShot(r);
    const ts = cardTiles(shot.landing, [revealStart(shot), shot], r);
    const fine = ts.filter((t) => t.z >= 10);
    expect(fine.length).toBeGreaterThan(0);
    expect(fine.some((t) => { const k = tileOf(BERGEN, t.z); return k.x === t.x && k.y === t.y; })).toBe(true);
    expect(ts.length).toBeLessThanOrEqual(CARD_MAX_TILES);
  });

  it('a short trip is drawn in finer tiles (its city region from 60 km up)', () => {
    const r = trip(MANCHESTER, HUDDERSFIELD);
    const shot = cardShot(r);
    const ts = cardTiles(shot.landing, [shot], r);
    expect(ts.some((t) => t.z >= 10)).toBe(true);
    expect(ts.every((t) => t.z >= 6)).toBe(true);
  });

  it('groundHit finds the bent ground under the middle of the picture and misses it in the sky', () => {
    const shot = cardShot(trip(MANCHESTER, BERGEN));
    const cam = poseCamera(shot);
    const hit = groundHit(cam, 0.5, 0.5)!;
    expect(hit).not.toBeNull();
    expect(Math.hypot(hit.x - shot.target.x, hit.z - shot.target.z)).toBeLessThan(20_000);
    const back = fromCard(shot.landing, hit.x, hit.z);
    expect(back.lat).toBeGreaterThan(50);
    expect(groundHit(cam, 0.5, 0)).toBeNull(); // the top of the picture is sky, above the curved horizon
  });
});
