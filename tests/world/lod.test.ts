import { describe, expect, it } from 'vitest';
import { destination, lonLatToTile, tileBounds, type LatLon } from '../../src/geo/coords';
import { DETAIL_STEPS, DetailBudget, QUICK_FRAME_MS, LOD_LEVELS, MAX_TILES, hazeFarM, tileKey, tilesFor, type LodCamera, type TileKey } from '../../src/world/lod';

const MANCHESTER = { lat: 53.4794, lon: -2.2453 };
const cruise = (p: LatLon, headingDeg = 70, altM = 1500): LodCamera => ({ ...p, altM, headingDeg });

const contains = (t: TileKey, p: LatLon) => {
  const b = tileBounds(t.z, t.x, t.y);
  return p.lat >= b.south && p.lat <= b.north && p.lon >= b.west && p.lon <= b.east;
};
/** The finest tile of the set over a point, or undefined. */
const finestAt = (set: TileKey[], p: LatLon) => set.filter((t) => contains(t, p)).sort((a, b) => b.z - a.z)[0];
const under = (p: LatLon, z: number) => {
  const t = lonLatToTile(p.lat, p.lon, z);
  return { z, x: Math.floor(t.x), y: Math.floor(t.y) };
};

describe('tilesFor', () => {
  it('near tiles are z14 and far tiles z7', () => {
    const cam = cruise(MANCHESTER);
    const set = tilesFor(cam);
    expect(set[0]).toEqual(under(MANCHESTER, 14)); // the most wanted: right under the camera
    expect(finestAt(set, MANCHESTER)!.z).toBe(14);
    expect(finestAt(set, destination(MANCHESTER, 70, 1.2))!.z).toBe(14);
    expect(finestAt(set, destination(MANCHESTER, 70, 4))!.z).toBeGreaterThanOrEqual(13);
    expect(finestAt(set, destination(MANCHESTER, 70, 8))!.z).toBeGreaterThanOrEqual(12);
    expect(finestAt(set, destination(MANCHESTER, 70, 25))!.z).toBeGreaterThanOrEqual(10);
    // land all the way into the haze, with no hole
    for (let km = 0; km < hazeFarM(1500) / 1000; km += 0.5) expect(finestAt(set, destination(MANCHESTER, 70, km))).toBeDefined();
    // past the z10 tiles (40 km, plus a tile), only the coarse z7 land: seen from a wide shot
    const wide = tilesFor(cruise(MANCHESTER, 70, 4000));
    expect(finestAt(wide, destination(MANCHESTER, 70, 85))!.z).toBe(7);
    for (const z of [12, 13, 14]) expect(set.filter((t) => t.z === z).length).toBeGreaterThan(1);
    // every level stays within its distance
    for (const t of set) {
      const lvl = LOD_LEVELS.find((l) => l.z === t.z)!;
      expect(lvl).toBeDefined();
      const b = tileBounds(t.z, t.x, t.y);
      const nearest = { lat: Math.min(b.north, Math.max(b.south, MANCHESTER.lat)), lon: Math.min(b.east, Math.max(b.west, MANCHESTER.lon)) };
      const d = Math.hypot((nearest.lat - MANCHESTER.lat) * 111.32, (nearest.lon - MANCHESTER.lon) * 111.32 * Math.cos((53.48 * Math.PI) / 180));
      expect(d * 1000).toBeLessThanOrEqual(Math.min(lvl.radiusM, hazeFarM(1500) * 1.2) + 1);
    }
  });

  it('covers where the camera looks: the area ahead is finer than the area behind', () => {
    const set = tilesFor(cruise(MANCHESTER, 90));
    const ahead = finestAt(set, destination(MANCHESTER, 90, 1.3))!;
    const behind = finestAt(set, destination(MANCHESTER, 270, 1.3))!;
    expect(ahead.z).toBe(14);
    expect(behind.z).toBeLessThan(14);
    expect(finestAt(set, destination(MANCHESTER, 90, 4.5))!.z).toBe(13);
    expect(finestAt(set, destination(MANCHESTER, 270, 4.5))!.z).toBeLessThan(13);
    // ... and turning round turns the detail round
    const back = tilesFor(cruise(MANCHESTER, 270));
    expect(finestAt(back, destination(MANCHESTER, 270, 1.3))!.z).toBe(14);
  });

  it('tile set across the date line includes x=0 and x=2^z-1', () => {
    for (const lon of [179.995, -179.995]) {
      const set = tilesFor(cruise({ lat: 64.2, lon }, 90));
      for (const z of [14, 13, 12, 10, 7]) {
        const xs = set.filter((t) => t.z === z).map((t) => t.x);
        expect(xs).toContain(0);
        expect(xs).toContain(2 ** z - 1);
        expect(xs.every((x) => x >= 0 && x < 2 ** z)).toBe(true);
      }
    }
  });

  it('budget never exceeds 40 tiles', () => {
    expect(MAX_TILES).toBe(40);
    const places = [MANCHESTER, { lat: 0, lon: 0 }, { lat: 70.5, lon: 25 }, { lat: -33.9, lon: 151.2 }, { lat: 64.2, lon: 179.99 }, { lat: 84, lon: 10 }];
    for (const p of places)
      for (const altM of [30, 450, 1500, 4000, 12000])
        for (let h = 0; h < 360; h += 45) {
          const set = tilesFor(cruise(p, h, altM));
          expect(set.length).toBeLessThanOrEqual(40);
          expect(new Set(set.map(tileKey)).size).toBe(set.length);
          // the coarse land always covers the camera's own spot
          expect(finestAt(set, p)).toBeDefined();
          // a smaller budget is respected too, keeping the coarsest level
          const small = tilesFor(cruise(p, h, altM), 12);
          expect(small.length).toBeLessThanOrEqual(12);
          expect(small.some((t) => t.z === 7 && contains(t, p))).toBe(true);
        }
  });

  it('moving 1 km reuses at least 80% of tiles', () => {
    for (const start of [MANCHESTER, { lat: 51.5, lon: -0.12 }, { lat: 40.7, lon: -74 }, { lat: 1.3, lon: 103.8 }]) {
      for (const heading of [0, 70, 135, 250]) {
        for (const altM of [450, 1500]) {
          const a = tilesFor(cruise(start, heading, altM));
          const b = tilesFor(cruise(destination(start, heading, 1), heading, altM), MAX_TILES, { keep: new Set(a.map(tileKey)) });
          const kept = new Set(b.map(tileKey));
          const reused = a.filter((t) => kept.has(tileKey(t))).length;
          expect(reused / a.length).toBeGreaterThanOrEqual(0.8);
        }
      }
    }
  });

  it('a wide shot from high up drops the street-level tiles', () => {
    const set = tilesFor(cruise(MANCHESTER, 70, 9000));
    expect(set.some((t) => t.z === 14)).toBe(false);
    expect(set.some((t) => t.z === 7)).toBe(true);
    expect(hazeFarM(9000)).toBeGreaterThan(hazeFarM(1500));
  });
});

describe('tilesFor with a smaller detail scale', () => {
  it('pulls the buildings levels (z14, z13) in and leaves the rest', () => {
    const cam = cruise(MANCHESTER, 70, 450);
    const full = tilesFor(cam);
    const less = tilesFor(cam, MAX_TILES, { scale: 0.5 });
    const count = (set: TileKey[], z: number) => set.filter((t) => t.z === z).length;
    expect(count(less, 14)).toBeLessThan(count(full, 14));
    expect(count(less, 13)).toBeLessThan(count(full, 13));
    expect(count(less, 14)).toBeGreaterThan(0);
    // land everywhere still: the coarser levels cover what the finer ones gave up
    for (let km = 0; km < 12; km += 0.25) expect(finestAt(less, destination(MANCHESTER, 70, km))).toBeDefined();
    expect(finestAt(less, destination(MANCHESTER, 70, 3.5))!.z).toBeLessThanOrEqual(12);
  });

  it('the first step down sends alive tiles away too (their keep slack shrinks with the reach)', () => {
    const cam = cruise(MANCHESTER, 70, 450);
    const alive = new Set(tilesFor(cam).map(tileKey));
    const count = (set: TileKey[], z: number) => set.filter((t) => t.z === z).length;
    const kept = tilesFor(cam, MAX_TILES, { keep: alive });
    const stepped = tilesFor(cam, MAX_TILES, { keep: alive, scale: DETAIL_STEPS[1] });
    expect(count(stepped, 13)).toBeLessThan(count(kept, 13));
    expect(count(stepped, 13) + count(stepped, 14)).toBeLessThan(count(kept, 13) + count(kept, 14));
  });
});

/** Feed `d` the same view every `every` ms from t0 to t1; returns t1. */
function feed(d: DetailBudget, view: number, t0: number, t1: number, o: { every?: number; frameMs?: number; settled?: boolean } = {}): number {
  for (let t = t0; t < t1; t += o.every ?? 100) d.update(view, t, o.frameMs, o.settled ?? true);
  return t1;
}

describe('DetailBudget', () => {
  it('steps down at once when over, and again only once the stream has settled (or after 4 s)', () => {
    const d = new DetailBudget({ high: 400 });
    expect(d.update(300, 0)).toBe(1);
    expect(d.update(500, 100, undefined, false)).toBe(DETAIL_STEPS[1]);
    // still over while the tiles the step sent away are leaving: no second step yet
    feed(d, 500, 200, 2000, { settled: false });
    expect(d.scale).toBe(DETAIL_STEPS[1]);
    // settled: the step had its effect and the view is still over: the next step
    d.update(500, 2100, undefined, true);
    expect(d.scale).toBe(DETAIL_STEPS[2]);
    // a stream that never settles still steps after 4 s
    const e = new DetailBudget({ high: 400 });
    e.update(500, 0, undefined, false);
    feed(e, 500, 100, 4000, { settled: false });
    expect(e.scale).toBe(DETAIL_STEPS[1]);
    e.update(500, 4200, undefined, false);
    expect(e.scale).toBe(DETAIL_STEPS[2]);
  });

  it('a view just over the limit (Manchester start, 437k of 430k) goes one step down, never to x0.5', () => {
    const d = new DetailBudget();
    d.update(437_000, 0, undefined, false);
    expect(d.scale).toBe(DETAIL_STEPS[1]);
    // one step down the view is 340k: under the limit, so no further step; above 3/4 of it, so no flip back up
    feed(d, 340_000, 100, 60_000);
    expect(d.scale).toBe(DETAIL_STEPS[1]);
  });

  it('recovers in a real city: a view measured well under the limit at this step, for a quiet spell, steps back up', () => {
    const d = new DetailBudget({ high: 400_000 });
    d.update(500_000, 0);
    feed(d, 500_000, 100, 1000);
    expect(d.scale).toBe(DETAIL_STEPS[2]);
    // the balloon has left the dense centre: the view at x0.5 is 280k (a city's view, not just ground and water)
    let t = feed(d, 280_000, 1000, 4500);
    expect(d.scale).toBe(DETAIL_STEPS[2]); // not yet: 4 s of quiet
    // the step up comes at 5 s; its tiles then keep the stream busy until 12 s
    t = feed(d, 280_000, t, 12000, { settled: false });
    expect(d.scale).toBe(DETAIL_STEPS[1]); // not while the step's tiles are still coming in
    t = feed(d, 280_000, t, 16000);
    expect(d.scale).toBe(DETAIL_STEPS[1]); // quiet counts from when it settled
    t = feed(d, 280_000, t, 16200);
    expect(d.scale).toBe(1);
  });

  it('a step up that has to be undone makes the next one wait twice as long (no flip-flop)', () => {
    const d = new DetailBudget({ high: 400_000 });
    d.update(500_000, 0);
    let t = feed(d, 280_000, 100, 5000);
    expect(d.scale).toBe(1); // up after 4 s of quiet
    // full reach is over again: down, and the next step up waits 8 s
    t = feed(d, 450_000, t, 5200);
    expect(d.scale).toBe(DETAIL_STEPS[1]);
    expect(d.upWaitMs).toBe(8000);
    t = feed(d, 280_000, t, 5200 + 7000);
    expect(d.scale).toBe(DETAIL_STEPS[1]);
    t = feed(d, 280_000, t, 5200 + 9000);
    expect(d.scale).toBe(1);
  });
});

describe('DetailBudget and frame time', () => {
  it('a phone that stays slow (frames over 50 ms for seconds) gets less detail too; a short hitch does not', () => {
    const d = new DetailBudget({ high: 400 });
    // a one-second hitch at 80 ms a frame
    let t = 0;
    for (; t < 1000; t += 80) d.update(100, t, 80);
    for (; t < 3000; t += 16) d.update(100, t, 16);
    expect(d.scale).toBe(1);
    // slow for good
    for (; t < 8000; t += 70) d.update(100, t, 70);
    expect(d.scale).toBeLessThan(1);
    // and no step back up while it is still slow
    const s = d.scale;
    for (; t < 20000; t += 70) d.update(10, t, 70);
    expect(d.scale).toBeLessThanOrEqual(s);
  });

  it('a 30 Hz phone (frames of about 33.3 ms, some 34-36 ms) is quick enough to step back up', () => {
    expect(QUICK_FRAME_MS).toBeGreaterThanOrEqual(40);
    // a 30 Hz phone's frames as the clock sees them: 33.3 ms on average, jittered, some late
    const JITTER = [33, 31, 34, 33, 36, 32, 33, 35, 31, 34, 32, 35.6];
    const mean = JITTER.reduce((a, b) => a + b, 0) / JITTER.length;
    expect(mean).toBeCloseTo(33.3, 1);
    expect(JITTER.filter((ms) => ms >= 34).length).toBeGreaterThanOrEqual(3);
    const d = new DetailBudget({ high: 400 });
    let t = 0, k = 0;
    const frame = (view: number) => {
      const ms = JITTER[k++ % JITTER.length];
      d.update(view, (t += ms), ms);
    };
    while (t < 500) frame(500);
    expect(d.scale).toBe(DETAIL_STEPS[1]);
    while (t < 6000) frame(100);
    expect(d.scale).toBe(1);
  });
});
