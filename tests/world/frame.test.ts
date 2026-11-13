import { test, expect } from 'vitest';
import { tileFrame, frameFromBounds } from '../../src/world/frame';
import { lonLatToTile, tileBounds } from '../../src/geo/coords';

const [Z, X, Y] = [14, 8089, 5300];

test('tile frame: corners map to the tile rectangle in local metres', () => {
  const f = tileFrame(Z, X, Y);
  const b = tileBounds(Z, X, Y);
  expect(f.widthM).toBeGreaterThan(1400);
  expect(f.widthM).toBeLessThan(1500);
  const sw = f.toLocal(b.south, b.west);
  const ne = f.toLocal(b.north, b.east);
  expect(sw.x).toBeCloseTo(0, 6);
  expect(sw.z).toBeCloseTo(0, 6);
  expect(ne.x).toBeCloseTo(f.widthM, 6);
  expect(ne.z).toBeCloseTo(-f.heightM, 6);
  // vector pixel (0,0) is the north-west corner; (extent, extent) the south-east
  const nw = f.pixelToLocal(0, 0, 4096);
  const se = f.pixelToLocal(4096, 4096, 4096);
  expect(nw.x).toBeCloseTo(0, 6);
  expect(nw.z).toBeCloseTo(-f.heightM, 6);
  expect(se.x).toBeCloseTo(f.widthM, 6);
  expect(se.z).toBeCloseTo(0, 6);
});

test('tile frame: lat/lon round trip and Mercator-exact pixels', () => {
  const f = tileFrame(Z, X, Y);
  for (const [lat, lon] of [[53.4794, -2.2453], [53.4801, -2.2401], [53.4752, -2.2489]]) {
    const p = f.toLocal(lat, lon);
    const back = f.toLatLon(p.x, p.z);
    expect(back.lat).toBeCloseTo(lat, 9);
    expect(back.lon).toBeCloseTo(lon, 9);
    // the vector pixel of this lat/lon (Web Mercator) lands on the same local point
    const t = lonLatToTile(lat, lon, Z);
    const px = (t.x - X) * 4096, py = (t.y - Y) * 4096;
    const q = f.pixelToLocal(px, py, 4096);
    expect(Math.abs(q.x - p.x)).toBeLessThan(1e-3);
    expect(Math.abs(q.z - p.z)).toBeLessThan(1e-3);
    // and back to the tile fraction
    const fr = f.localToFrac(p.x, p.z);
    expect(fr.fx).toBeCloseTo(px / 4096, 9);
    expect(fr.fy).toBeCloseTo(py / 4096, 9);
  }
});

test('tile frame: the Mercator row spacing is not linear in latitude (exact inverse is used)', () => {
  const f = tileFrame(4, 7, 4); // a big tile, where the difference is large
  const mid = f.pixelToLocal(2048, 2048, 4096);
  const linear = -f.heightM / 2;
  expect(Math.abs(mid.z - linear)).toBeGreaterThan(1000);
  const b = tileBounds(4, 7, 4);
  const g = frameFromBounds(b);
  expect(g.pixelToLocal(2048, 2048, 4096).z).toBeCloseTo(mid.z, 6);
});
