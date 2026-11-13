import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import * as THREE from 'three';
import cities from '../../data/cities.json';
import { haversineKm } from '../../src/geo/coords';
import { MODELS, SITES, hiddenFootprints, landmarksNear, latLonToModel, siteById, siteFootprints } from '../../src/landmarks/registry';
import { contourColours, countTriangles, Kit } from '../../src/landmarks/kit';
import { regionStyle } from '../../src/world/palette';
import { buildTileMeshes } from '../../src/world/meshjob';
import { tileFrame } from '../../src/world/frame';
import { emptyFeatures, type BuildingFeature } from '../../src/world/vector';
import { lonLatToTile } from '../../src/geo/coords';

const london = (cities as { id: string; launch: { lat: number; lon: number } }[]).find((c) => c.id === 'london')!.launch;
const PARLIAMENT_SQUARE = { lat: london.lat, lon: london.lon };

test('Elizabeth Tower is returned within 1 km of Parliament Square', async () => {
  const near = await landmarksNear(PARLIAMENT_SQUARE, 1);
  const tower = near.find((l) => l.id === 'london-elizabeth-tower');
  expect(tower).toBeDefined();
  expect(tower!.cityId).toBe('london');
  expect(haversineKm(PARLIAMENT_SQUARE, tower!.at)).toBeLessThan(0.3);
  expect(typeof tower!.build).toBe('function');
  expect(near.some((l) => l.id === 'london-palace-of-westminster')).toBe(true);
  // and nothing of London's from Manchester
  expect((await landmarksNear({ lat: 53.4794, lon: -2.2453 }, 20)).some((l) => l.cityId === 'london')).toBe(false);
});

/** A small square building with its centroid at lat/lon, in tile frame metres. */
function squareAt(frame: ReturnType<typeof tileFrame>, lat: number, lon: number, half = 3): BuildingFeature {
  const c = frame.toLocal(lat, lon);
  const ring = Float64Array.from([c.x - half, c.z + half, c.x + half, c.z + half, c.x + half, c.z - half, c.x - half, c.z - half]);
  return { height: 20, minHeight: 0, polygon: [ring] };
}

test('OSM buildings inside the footprint are hidden', () => {
  const tower = siteById('london-elizabeth-tower')!;
  const palace = siteById('london-palace-of-westminster')!;
  const t = lonLatToTile(tower.at.lat, tower.at.lon, 14);
  const X = Math.floor(t.x), Y = Math.floor(t.y);
  const frame = tileFrame(14, X, Y);
  const flat = new Float32Array(16 * 16).fill(5);
  const f = emptyFeatures();
  const at = (x: number, z: number) => {
    // a model-frame point of the palace as lat/lon
    const h = (palace.headingDeg * Math.PI) / 180;
    const east = x * Math.cos(h) - z * Math.sin(h), south = x * Math.sin(h) + z * Math.cos(h);
    return { lat: palace.at.lat - south / 111320, lon: palace.at.lon + east / (111320 * Math.cos((palace.at.lat * Math.PI) / 180)) };
  };
  const inside = [tower.at, at(0, 135) /* Victoria Tower */, at(19, 11) /* Central Tower */, at(-36, -32) /* Westminster Hall */, at(65, 0) /* river front */];
  // Westminster Abbey, Portcullis House, the Supreme Court: not the palace
  const outside = [{ lat: 51.49933, lon: -0.12731 }, { lat: 51.50165, lon: -0.12487 }, { lat: 51.50048, lon: -0.12876 }];
  for (const p of [...inside, ...outside]) f.building.push(squareAt(frame, p.lat, p.lon));
  const kept = buildTileMeshes(f, flat, 14, X, Y, regionStyle(tower.at), { hiddenFootprints: hiddenFootprints() });
  const all = buildTileMeshes(f, flat, 14, X, Y, regionStyle(tower.at), { hiddenFootprints: [] });
  expect(all.stats.buildings).toBe(inside.length + outside.length);
  expect(kept.stats.buildings).toBe(outside.length);
  // each hidden one sits in some circle
  for (const p of inside) {
    expect(hiddenFootprints().some((c) => haversineKm(c, p) * 1000 <= c.radiusM)).toBe(true);
  }
  // the palace hides with its own circles (its footprint circle would take in the Abbey)
  expect(siteFootprints(palace).length).toBeGreaterThan(1);
  expect(latLonToModel(palace, tower.at).z).toBeLessThan(-120);
});

describe('every model', () => {
  test('every site has a model module, and ids are unique', () => {
    const ids = SITES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(MODELS[id], id).toBeDefined();
    for (const s of SITES) expect(s.id.startsWith(`${s.cityId}-`), s.id).toBe(true);
  });

  test('every model is under 4,000 triangles, Contour colours only, and its module under 30 KB gzipped', async () => {
    expect(SITES.length).toBeGreaterThanOrEqual(2);
    const kitColours = new Set<string>();
    // record every colour any Kit is given while the models build
    const tri = Kit.prototype.tri;
    const seen: string[] = [];
    Kit.prototype.tri = function (this: Kit, b, colour, ...rest) {
      seen.push(colour.toLowerCase());
      return tri.call(this, b, colour, ...rest);
    } as typeof tri;
    try {
      for (const site of SITES) {
        const [l] = (await landmarksNear(site.at, 0.01)).filter((x) => x.id === site.id);
        const style = regionStyle(site.at);
        seen.length = 0;
        const g = l.build(style);
        expect(g).toBeInstanceOf(THREE.Group);
        const n = countTriangles(g);
        expect(n, site.id).toBeGreaterThan(50);
        expect(n, site.id).toBeLessThan(4000);
        const allowed = new Set(contourColours(style));
        for (const c of seen) expect(allowed.has(c), `${site.id} uses ${c}`).toBe(true);
        seen.forEach((c) => kitColours.add(c));
        // every mesh has a bucket the layer knows
        g.traverse((o) => {
          if ((o as THREE.Mesh).isMesh) expect(['walls', 'plain', 'glow']).toContain(o.userData.bucket);
        });
        // it fits its footprint radius and stands on the ground
        const box = new THREE.Box3().setFromObject(g);
        expect(Math.max(-box.min.x, box.max.x, -box.min.z, box.max.z), site.id).toBeLessThanOrEqual(site.footprintRadiusM + 1);
        expect(box.min.y, site.id).toBeLessThanOrEqual(0);
        const src = readFileSync(new URL(`../../src/landmarks/models/${site.id}.ts`, import.meta.url));
        expect(gzipSync(src).length, site.id).toBeLessThan(30 * 1024);
      }
    } finally {
      Kit.prototype.tri = tri;
    }
    expect(kitColours.size).toBeGreaterThan(2);
  });
});
