/**
 * Every landmark the app knows, found by file (types.ts): the sites (`src/landmarks/sites/*.ts`,
 * each exporting `sites`) are read up front; each model (`src/landmarks/models/<id>.ts`, exporting
 * `model`) is imported lazily, by id, the first time the balloon comes near it, and kept.
 *
 * Nothing here needs editing to add a landmark.
 */
import { haversineKm, lonDelta, type LatLon } from '../geo/coords';
import { M_PER_DEG } from '../world/frame';
import type { HiddenFootprint } from '../world/meshjob';
import type { Landmark, LandmarkModel, LandmarkSite } from './types';

const D2R = Math.PI / 180;

const SITE_FILES = import.meta.glob<LandmarkSite[]>('./sites/*.ts', { eager: true, import: 'sites' });
const MODEL_FILES = import.meta.glob<LandmarkModel>('./models/*.ts', { import: 'model' });

const baseName = (path: string) => path.replace(/^.*\//, '').replace(/\.ts$/, '');

/** Every landmark site, in file order. */
export const SITES: LandmarkSite[] = Object.values(SITE_FILES).flat();

/** Model loaders by landmark id (the model file's name). */
export const MODELS: Record<string, () => Promise<LandmarkModel>> = Object.fromEntries(
  Object.entries(MODEL_FILES).map(([path, load]) => [baseName(path), load]),
);

export function siteById(id: string, sites: LandmarkSite[] = SITES): LandmarkSite | undefined {
  return sites.find((s) => s.id === id);
}

/** Sites whose footprint comes within km of p, nearest first. No model is loaded. */
export function sitesNear(p: LatLon, km: number, sites: LandmarkSite[] = SITES): LandmarkSite[] {
  return sites
    .map((s) => ({ s, d: haversineKm(p, s.at) - s.footprintRadiusM / 1000 }))
    .filter((o) => o.d <= km)
    .sort((a, b) => a.d - b.d)
    .map((o) => o.s);
}

const loaded = new Map<string, Promise<Landmark>>();

/** A site with its model's code (imported once, then kept). */
export function loadLandmark(site: LandmarkSite, models: Record<string, () => Promise<LandmarkModel>> = MODELS): Promise<Landmark> {
  let p = loaded.get(site.id);
  if (!p) {
    const load = models[site.id];
    if (!load) return Promise.reject(new Error(`no model for landmark ${site.id}`));
    p = load().then((m) => ({ ...site, build: m.build, animate: m.animate }));
    // a failed import (offline) may be tried again later
    p.catch(() => loaded.delete(site.id));
    loaded.set(site.id, p);
  }
  return p;
}

/** The landmarks within km of p, nearest first, their models imported lazily by id. */
export function landmarksNear(p: LatLon, km: number, sites: LandmarkSite[] = SITES, models = MODELS): Promise<Landmark[]> {
  return Promise.all(sitesNear(p, km, sites).map((s) => loadLandmark(s, models)));
}

/**
 * A point in a site's model frame (metres; -z toward headingDeg, +x to its right) as lat/lon.
 * Flat-earth, good to centimetres over a landmark's few hundred metres.
 */
export function modelToLatLon(site: Pick<LandmarkSite, 'at' | 'headingDeg'>, x: number, z: number): LatLon {
  const h = site.headingDeg * D2R;
  const east = x * Math.cos(h) - z * Math.sin(h);
  const south = x * Math.sin(h) + z * Math.cos(h);
  return { lat: site.at.lat - south / M_PER_DEG, lon: site.at.lon + east / (M_PER_DEG * Math.cos(site.at.lat * D2R)) };
}

/** A lat/lon in a site's model frame (the inverse of modelToLatLon). */
export function latLonToModel(site: Pick<LandmarkSite, 'at' | 'headingDeg'>, p: LatLon): { x: number; z: number } {
  const h = site.headingDeg * D2R;
  const east = lonDelta(site.at.lon, p.lon) * M_PER_DEG * Math.cos(site.at.lat * D2R);
  const south = -(p.lat - site.at.lat) * M_PER_DEG;
  return { x: east * Math.cos(h) + south * Math.sin(h), z: -east * Math.sin(h) + south * Math.cos(h) };
}

/** The circles whose map buildings a site replaces: its `hides`, else its footprint circle. */
export function siteFootprints(site: LandmarkSite): HiddenFootprint[] {
  if (!site.hides?.length) return [{ lat: site.at.lat, lon: site.at.lon, radiusM: site.footprintRadiusM }];
  return site.hides.map((c) => ({ ...modelToLatLon(site, c.x, c.z), radiusM: c.r }));
}

/** Every site's hiding circles, for the map stream (it sends each tile only those that touch it). */
export function hiddenFootprints(sites: LandmarkSite[] = SITES): HiddenFootprint[] {
  return sites.flatMap(siteFootprints);
}
