import { expect, test } from 'vitest';
import { haversineKm } from '../../src/geo/coords';
import { modelToLatLon, siteById, siteFootprints } from '../../src/landmarks/registry';
import { heightGrid } from '../../src/landmarks/layer';
import { model } from '../../src/landmarks/models/bristol-clifton-suspension-bridge';
import { regionStyle } from '../../src/world/palette';

test('the camera keeps above the deck and the towers, not under columns of chain', () => {
  const g = model.build(regionStyle({ lat: 51.455, lon: -2.627 }));
  const t = heightGrid(g);
  const top = (x: number, z: number) => t.h[Math.floor((z - t.minZ) / 6) * t.nx + Math.floor((x - t.minX) / 6)];
  // the towers (26 m over the road) count
  expect(top(-23.5, 0)).toBeGreaterThan(24);
  expect(top(-236.5, 0)).toBeGreaterThan(24);
  // over the span the deck counts (road level, -0.5 m), the chains over it do not
  for (const x of [-200, -130, -60]) {
    expect(top(x, 0), `x ${x}`).toBeGreaterThan(-1.5);
    for (const z of [0, -6.4, 6.4]) expect(top(x, z), `x ${x} z ${z}`).toBeLessThan(2);
  }
  // nor do the backstays over the approach roads behind the towers
  for (const z of [-6.4, 6.4]) {
    expect(top(-5, z)).toBeLessThan(2);
    expect(top(-255, z)).toBeLessThan(2);
  }
});

test('the Clifton Suspension Bridge: its hiding circles cover the deck, so the OSM bridge road is not draped down the gorge', () => {
  const site = siteById('bristol-clifton-suspension-bridge')!;
  const circles = siteFootprints(site);
  // the deck (10 m wide) from tower face to tower face
  for (let x = -240; x <= -20; x += 2) {
    for (const z of [-5, 0, 5]) {
      const p = modelToLatLon(site, x, z);
      expect(circles.some((c) => haversineKm(c, p) * 1000 <= c.radiusM), `deck at x ${x}, z ${z}`).toBe(true);
    }
  }
  // and not the gorge's sides beyond the deck (up and down the gorge)
  for (const z of [-40, 40]) {
    const p = modelToLatLon(site, -130, z);
    expect(circles.some((c) => haversineKm(c, p) * 1000 <= c.radiusM)).toBe(false);
  }
});
