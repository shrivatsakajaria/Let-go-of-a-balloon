import { expect, test } from 'vitest';
import { haversineKm } from '../../src/geo/coords';
import { modelToLatLon, siteById, siteFootprints } from '../../src/landmarks/registry';

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
