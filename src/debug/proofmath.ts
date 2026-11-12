import { haversineKm, lonDelta, type LatLon } from '../geo/coords';
import type { Route } from '../flight/route';

/** Turn wrapped longitudes into a continuous run: each step is the short way round, so 179 then -179 becomes 179 then 181. */
export function unwrapLons(lons: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < lons.length; i++) {
    out.push(i === 0 ? lons[0] : out[i - 1] + lonDelta(lons[i - 1], lons[i]));
  }
  return out;
}

/** Web Mercator in "world turns": x is 0.5 at lon 0 and runs past [0,1] when unwrapped, y is 0 at the north edge. */
export function mercator(lat: number, lonUnwrapped: number): { x: number; y: number } {
  const φ = (Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI) / 180;
  return {
    x: lonUnwrapped / 360 + 0.5,
    y: (1 - Math.log(Math.tan(φ) + 1 / Math.cos(φ)) / Math.PI) / 2,
  };
}

export type View = { scale: number; ox: number; oy: number };

/** Fit mercator points into a w by h box with padding. Screen = (m * scale + o). */
export function fitView(pts: { x: number; y: number }[], w: number, h: number, pad: number, minSpan = 0.02): View {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of pts) {
    x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x);
    y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
  }
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const sx = Math.max(x1 - x0, minSpan), sy = Math.max(y1 - y0, minSpan);
  const scale = Math.min((w - 2 * pad) / sx, (h - 2 * pad) / sy);
  return { scale, ox: w / 2 - cx * scale, oy: h / 2 - cy * scale };
}

export const project = (v: View, m: { x: number; y: number }): { x: number; y: number } => ({
  x: m.x * v.scale + v.ox,
  y: m.y * v.scale + v.oy,
});

export type TileRef = { z: number; x: number; y: number; shift: number };

/** Choose the highest zoom (3 to 6) whose tiles covering the box number at most maxTiles; tiles carry a whole-world shift for unwrapped longitudes. */
export function tilesFor(
  box: { x0: number; x1: number; y0: number; y1: number },
  maxTiles = 12,
): TileRef[] {
  for (let z = 6; z >= 2; z--) {
    const n = 2 ** z;
    const xa = Math.floor(box.x0 * n), xb = Math.floor(box.x1 * n);
    const ya = Math.max(0, Math.floor(box.y0 * n)), yb = Math.min(n - 1, Math.floor(box.y1 * n));
    const count = (xb - xa + 1) * (yb - ya + 1);
    if (count <= maxTiles || z === 2) {
      const out: TileRef[] = [];
      for (let xi = xa; xi <= xb; xi++) {
        const shift = Math.floor(xi / n);
        for (let y = ya; y <= yb; y++) out.push({ z, x: xi - shift * n, y, shift });
      }
      return out;
    }
  }
  return [];
}

export type Summary = { distanceKm: number; topSpeedKmh: number; landing: LatLon };

/** Great-circle distance along the 10-minute path, top speed over the whole flight, and the landing point. */
export function summarise(route: Route): Summary {
  const pts = route.points;
  let d = 0;
  let top = 0;
  for (let i = 0; i < pts.length; i++) {
    top = Math.max(top, pts[i].speedMs * 3.6);
    if (i > 0) d += haversineKm(pts[i - 1], pts[i]);
  }
  const last = pts[pts.length - 1];
  return { distanceKm: d, topSpeedKmh: top, landing: { lat: last.lat, lon: last.lon } };
}

export type Place = { name: string; lat: number; lon: number };

/** Nearest named place within maxKm, or null (the page then says "open sea"). */
export function nearestPlace(places: Place[], p: LatLon, maxKm = 100): (Place & { km: number }) | null {
  let best: (Place & { km: number }) | null = null;
  for (const pl of places) {
    const km = haversineKm(p, pl);
    if (km <= maxKm && (!best || km < best.km)) best = { ...pl, km };
  }
  return best;
}

export function ageText(ms: number): string {
  const h = Math.floor(ms / 3.6e6);
  const m = Math.floor((ms % 3.6e6) / 6e4);
  return h > 0 ? `${h} h ${m} min old` : `${m} min old`;
}
