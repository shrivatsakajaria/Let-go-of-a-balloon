import { CRUISE_CLEARANCE_M } from '../config';
import { windIndex, type WindTile } from './format';
import { wrapLon, type LatLon } from '../geo/coords';

/** One pressure level sampled at a point and time. u, v in m/s, gh in metres. */
export interface LevelSample {
  hpa: number;
  gh: number;
  u: number;
  v: number;
}

/** South-west corner of the tile of size tileDeg containing p. Latitude rows run to latMax. */
export function tileOrigin(p: LatLon, tileDeg: number, latMax: number): { lat0: number; lon0: number } {
  const lon = wrapLon(p.lon);
  const lat0 = Math.max(-90, Math.min(latMax, Math.floor(p.lat / tileDeg) * tileDeg));
  const lon0 = Math.floor((lon + 180) / tileDeg) * tileDeg - 180;
  return { lat0, lon0 };
}

export function tileKey(lat0: number, lon0: number): string {
  return `${lat0}_${lon0}`;
}

/**
 * Sample every level of a tile at (lat, lon) and forecast hour: bilinear in space, linear in time.
 * Hours outside the tile's range are clamped. The point must lie within the tile (edges included).
 */
export function sampleTileLevels(tile: WindTile, forecastHour: number, p: LatLon): LevelSample[] {
  const lon = wrapLon(p.lon);
  let dLon = lon - tile.lon0;
  if (dLon < 0) dLon += 360;
  const fi = Math.max(0, Math.min(tile.nLat - 1, (p.lat - tile.lat0) / tile.res));
  const fj = Math.max(0, Math.min(tile.nLon - 1, dLon / tile.res));
  const i0 = Math.min(Math.floor(fi), tile.nLat - 2);
  const j0 = Math.min(Math.floor(fj), tile.nLon - 2);
  const fy = fi - i0;
  const fx = fj - j0;

  const hrs = tile.hours;
  const h = Math.max(hrs[0], Math.min(hrs[hrs.length - 1], forecastHour));
  let t0 = 0;
  while (t0 < hrs.length - 2 && hrs[t0 + 1] <= h) t0++;
  const t1 = Math.min(t0 + 1, hrs.length - 1);
  const ft = t1 === t0 ? 0 : (h - hrs[t0]) / (hrs[t1] - hrs[t0]);

  const bil = (arr: Int8Array | Int16Array, hi: number, li: number): number => {
    const a = arr[windIndex(tile, hi, li, i0, j0)];
    const b = arr[windIndex(tile, hi, li, i0, j0 + 1)];
    const c = arr[windIndex(tile, hi, li, i0 + 1, j0)];
    const d = arr[windIndex(tile, hi, li, i0 + 1, j0 + 1)];
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
  };
  const timed = (arr: Int8Array | Int16Array, li: number): number => {
    const x = bil(arr, t0, li);
    return t1 === t0 ? x : x * (1 - ft) + bil(arr, t1, li) * ft;
  };

  const out: LevelSample[] = [];
  for (let li = 0; li < tile.nLevels; li++) {
    out.push({
      hpa: tile.levels[li],
      gh: timed(tile.gh, li),
      u: timed(tile.u, li) * tile.scale,
      v: timed(tile.v, li) * tile.scale,
    });
  }
  return out;
}

/**
 * Wind at an altitude from level samples. Levels with gh <= 0 (below ground) are ignored. The two
 * levels bracketing altAslM are blended linearly in height, which is linear in log-pressure when
 * ln p is taken as linear in height between levels. Below the lowest level use the lowest, above
 * the highest use the highest. Returns null if every level is below ground.
 */
export function interpolateAltitude(levels: LevelSample[], altAslM: number): { u: number; v: number } | null {
  const present = levels.filter((l) => l.gh > 0).sort((a, b) => a.gh - b.gh);
  if (present.length === 0) return null;
  const lo = present[0];
  const hi = present[present.length - 1];
  if (altAslM <= lo.gh) return { u: lo.u, v: lo.v };
  if (altAslM >= hi.gh) return { u: hi.u, v: hi.v };
  let k = 0;
  while (present[k + 1].gh <= altAslM) k++;
  const a = present[k];
  const b = present[k + 1];
  const w = (altAslM - a.gh) / (b.gh - a.gh);
  return { u: a.u * (1 - w) + b.u * w, v: a.v * (1 - w) + b.v * w };
}

/**
 * Cruise level rule: 850 hPa if it clears the ground by CRUISE_CLEARANCE_M, else the lowest of
 * 700, 600, 500 that does, else 500. levelHeights maps hPa to geopotential height in metres.
 */
export function cruiseLevel(groundM: number, levelHeights: Record<number, number>): number {
  const need = groundM + CRUISE_CLEARANCE_M;
  for (const hpa of [850, 700, 600]) {
    if (levelHeights[hpa] >= need) return hpa;
  }
  return 500;
}
