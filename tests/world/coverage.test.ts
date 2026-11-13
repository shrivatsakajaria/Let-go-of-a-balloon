import { describe, expect, it } from 'vitest';
import { lonDelta, lonLatToTile, wrapLon } from '../../src/geo/coords';
import { M_PER_DEG } from '../../src/world/frame';
import { CoverageMap, cellAt, coverageFrame, tileCells } from '../../src/world/coverage';

/** Scene metres of a point around an origin (the world stream's projection). */
const scene = (o: { lat: number; lon: number }, p: { lat: number; lon: number }) => ({
  x: lonDelta(o.lon, p.lon) * M_PER_DEG * Math.cos((o.lat * Math.PI) / 180),
  z: -(p.lat - o.lat) * M_PER_DEG,
});

describe('coverage cells', () => {
  for (const o of [{ lat: 53.4794, lon: -2.2453 }, { lat: 70.1, lon: 23.3 }, { lat: -33.9, lon: 151.2 }, { lat: 64.2, lon: 179.95 }]) {
    it(`finds the z14 tile of any point within 65 km of ${o.lat}, ${o.lon}`, () => {
      const f = coverageFrame(o);
      for (let k = 0; k < 400; k++) {
        const p = { lat: o.lat + Math.sin(k * 1.7) * 0.58, lon: wrapLon(o.lon + Math.cos(k * 2.3) * 1.0) };
        const s = scene(o, p);
        const c = cellAt(f, s.x, s.z);
        const t = lonLatToTile(p.lat, p.lon, 14);
        // continuous across the date line: compare modulo the world width
        const dx = (((c.cx + f.ax - t.x) % 16384) + 16384 + 8192) % 16384 - 8192;
        expect(Math.abs(dx)).toBeLessThan(1e-5);
        expect(Math.abs(c.cy + f.ay - t.y)).toBeLessThan(2e-5); // under 2 cm
      }
    });
  }

  it('places tile cells on both sides of the date line next to each other', () => {
    const f = coverageFrame({ lat: 0, lon: 179.99 });
    const east = tileCells(f, { z: 10, x: 0, y: 512 });
    const west = tileCells(f, { z: 10, x: 1023, y: 512 });
    expect(east.x0).toBe(west.x1);
    expect(east.x0).toBeGreaterThan(0);
    expect(east.x0).toBeLessThan(256);
  });

  it('marks the finest zoom per cell and knows when a coarse tile is hidden', () => {
    const cov = new CoverageMap({ lat: 53.4794, lon: -2.2453 });
    const z13 = { z: 13, x: 4044, y: 2650 };
    const children = [0, 1].flatMap((dy) => [0, 1].map((dx) => ({ z: 14, x: 8088 + dx, y: 5300 + dy })));
    cov.rebuild([{ z: 7, x: 63, y: 41 }, z13, ...children.slice(0, 3)]);
    expect(cov.hides(z13)).toBe(false);
    const c = tileCells(cov.frame, children[0]);
    expect(cov.data[c.y0 * cov.n + c.x0]).toBe(14);
    const last = tileCells(cov.frame, children[3]);
    expect(cov.data[last.y0 * cov.n + last.x0]).toBe(13);
    cov.rebuild([{ z: 7, x: 63, y: 41 }, z13, ...children]);
    expect(cov.hides(z13)).toBe(true);
    expect(cov.hides({ z: 7, x: 63, y: 41 })).toBe(false);
    cov.dispose();
  });
});
