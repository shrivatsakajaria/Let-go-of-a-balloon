import { describe, expect, it } from 'vitest';
import { destination, lonLatToTile, tileBounds, type LatLon } from '../../src/geo/coords';
import { DETAIL_STEPS, DetailBudget, LOD_LEVELS, MAX_TILES, hazeFarM, tileKey, tilesFor, type LodCamera, type TileKey } from '../../src/world/lod';

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
});

describe('DetailBudget', () => {
  it('steps the detail down at once when the view draws too much, a step at a time', () => {
    const d = new DetailBudget({ high: 400 });
    expect(d.update(300, 0)).toBe(1);
    expect(d.update(500, 100)).toBe(DETAIL_STEPS[1]);
    // the tiles need a moment to go: no second step straight away
    expect(d.update(500, 200)).toBe(DETAIL_STEPS[1]);
    expect(d.update(500, 1000)).toBe(DETAIL_STEPS[2]);
    for (let t = 2000; t < 10000; t += 1000) d.update(900, t);
    expect(d.scale).toBe(DETAIL_STEPS[DETAIL_STEPS.length - 1]);
  });

  it('steps back up only after a quiet spell, and only when the finer step would still fit', () => {
    const d = new DetailBudget({ high: 400 });
    d.update(500, 0);
    expect(d.scale).toBe(DETAIL_STEPS[1]);
    // would come back to 300 * (1 / 0.8)^2 = 469 > 400 * 0.85: stays
    for (let t = 1000; t < 20000; t += 500) d.update(300, t);
    expect(d.scale).toBe(DETAIL_STEPS[1]);
    // the view emptied (the balloon left the city): back to full detail after a few seconds
    d.update(100, 20000);
    expect(d.update(100, 21000)).toBe(DETAIL_STEPS[1]);
    expect(d.update(100, 25000)).toBe(1);
  });
});
