import { EARTH_RADIUS_KM } from '../config';

export type LatLon = { lat: number; lon: number };

/** Web Mercator latitude limit, used only for tile maths. */
const MERCATOR_MAX_LAT = 85.0511;

const toRad = (deg: number): number => (deg * Math.PI) / 180;
const toDeg = (rad: number): number => (rad * 180) / Math.PI;

/** Great-circle distance on a sphere of radius EARTH_RADIUS_KM, in km. */
export function haversineKm(a: LatLon, b: LatLon): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial bearing from a to b, degrees clockwise from north in [0, 360). */
export function bearingDeg(a: LatLon, b: LatLon): number {
  const φ1 = toRad(a.lat);
  const φ2 = toRad(b.lat);
  const dλ = toRad(b.lon - a.lon);
  const y = Math.sin(dλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(dλ);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Great-circle destination from p, travelling km along bearingDeg, on the same sphere. */
export function destination(p: LatLon, bearingDeg: number, km: number): LatLon {
  const δ = km / EARTH_RADIUS_KM;
  const θ = toRad(bearingDeg);
  const φ1 = toRad(p.lat);
  const λ1 = toRad(p.lon);
  const sinφ2 = Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ);
  const φ2 = Math.asin(Math.max(-1, Math.min(1, sinφ2)));
  const λ2 = λ1 + Math.atan2(
    Math.sin(θ) * Math.sin(δ) * Math.cos(φ1),
    Math.cos(δ) - Math.sin(φ1) * sinφ2,
  );
  return { lat: toDeg(φ2), lon: wrapLon(toDeg(λ2)) };
}

/** Wrap a longitude into [-180, 180). */
export function wrapLon(lon: number): number {
  const w = ((((lon + 180) % 360) + 360) % 360) - 180;
  return w === 180 ? -180 : w;
}

/** Shortest signed difference b - a, wrapped into (-180, 180]. */
export function lonDelta(a: number, b: number): number {
  const d = ((((b - a + 180) % 360) + 360) % 360) - 180;
  return d === -180 ? 180 : d;
}

/** Clamp latitude to the Web Mercator range. Tile maths only. */
export function clampLat(lat: number): number {
  return Math.max(-MERCATOR_MAX_LAT, Math.min(MERCATOR_MAX_LAT, lat));
}

/** Fractional standard XYZ tile coordinates (Web Mercator). */
export function lonLatToTile(lat: number, lon: number, z: number): { x: number; y: number } {
  const n = 2 ** z;
  const φ = toRad(clampLat(lat));
  const x = ((wrapLon(lon) + 180) / 360) * n;
  const y = ((1 - Math.log(Math.tan(φ) + 1 / Math.cos(φ)) / Math.PI) / 2) * n;
  return { x, y };
}

/** Geographic bounds of standard XYZ tile (z, x, y). */
export function tileBounds(z: number, x: number, y: number): {
  west: number;
  south: number;
  east: number;
  north: number;
} {
  const n = 2 ** z;
  const west = (x / n) * 360 - 180;
  const east = ((x + 1) / n) * 360 - 180;
  const north = toDeg(Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))));
  const south = toDeg(Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 1)) / n))));
  return { west, south, east, north };
}
