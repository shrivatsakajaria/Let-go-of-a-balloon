/**
 * Where a searched place starts. A place-name search returns a point that can sit inside a
 * building (a town hall, a station); the person must stand outside, so the start moves to the
 * nearest open public space: a park or square first, then a street, then any open ground, all
 * within 150 m. Featured cities have their own launch spots, and "Use my location" is never moved.
 */
import { lonLatToTile, type LatLon } from '../geo/coords';
import { bbox, pointInPolygon, type BBox } from '../world/geom';
import { tileFrame, type TileFrame } from '../world/frame';
import { decodeVectorTile, vectorTileTemplate, vectorTileUrl, type Features, type Polygon } from '../world/vector';

export const OPEN_SPACE_MAX_M = 150;
const STEP_M = 2;
/** Extra metres a candidate "costs", so a park a little further away beats a back yard. */
const COST = { park: 0, street: 8, open: 25 } as const;
const STREET_M = 6;
const OPEN_LANDCOVER = new Set(['grass']);
const OPEN_LANDUSE = new Set(['pitch', 'playground', 'square']);
const NOT_STREETS = new Set(['rail', 'transit', 'ferry', 'aerialway']);

type Shape = { box: BBox; poly: Polygon };

const near = (b: BBox, x: number, z: number, r: number) => x >= b.x0 - r && x <= b.x1 + r && z >= b.z0 - r && z <= b.z1 + r;
const within = (s: Shape, x: number, z: number) => near(s.box, x, z, 0) && pointInPolygon(s.poly, x, z);

function segDist2(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax, dz = bz - az;
  const L = dx * dx + dz * dz;
  const t = L > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / L)) : 0;
  const ex = ax + t * dx - px, ez = az + t * dz - pz;
  return ex * ex + ez * ez;
}

/**
 * `p` unchanged unless it lies inside a building footprint; then the best open point within 150 m
 * (distance plus a small cost for open ground that is not a park, square or street). If nothing
 * open is that close, `p` is returned unchanged. `features` are in the local metres of `frame`.
 */
export function toOpenSpace(p: LatLon, features: Features, frame: TileFrame): LatLon {
  const o = frame.toLocal(p.lat, p.lon);
  const reach = OPEN_SPACE_MAX_M + 10;
  const shapes = (polys: Polygon[]): Shape[] =>
    polys.map((poly) => ({ box: bbox(poly[0]), poly })).filter((s) => near(s.box, o.x, o.z, reach));

  const buildings = shapes(features.building.map((b) => b.polygon));
  if (!buildings.some((s) => within(s, o.x, o.z))) return p;

  const water = shapes(features.water.map((w) => w.polygon));
  const parks = shapes([
    ...features.park.map((a) => a.polygon),
    ...features.landcover.filter((a) => OPEN_LANDCOVER.has(a.cls)).map((a) => a.polygon),
    ...features.landuse.filter((a) => OPEN_LANDUSE.has(a.cls)).map((a) => a.polygon),
  ]);
  const streets: Float64Array[] = features.transportation
    .filter((l) => !NOT_STREETS.has(l.cls))
    .map((l) => l.line)
    .filter((l) => {
      for (let i = 0; i + 3 < l.length; i += 2) if (segDist2(o.x, o.z, l[i], l[i + 1], l[i + 2], l[i + 3]) < reach * reach) return true;
      return false;
    });
  const onStreet = (x: number, z: number) =>
    streets.some((l) => {
      for (let i = 0; i + 3 < l.length; i += 2) if (segDist2(x, z, l[i], l[i + 1], l[i + 2], l[i + 3]) <= STREET_M * STREET_M) return true;
      return false;
    });

  let best: { x: number; z: number; score: number } | null = null;
  for (let r = STEP_M; r <= OPEN_SPACE_MAX_M; r += STEP_M) {
    if (best && r >= best.score) break; // nothing further out can score lower
    const n = Math.max(16, Math.ceil((2 * Math.PI * r) / STEP_M));
    for (let k = 0; k < n; k++) {
      const a = (k / n) * 2 * Math.PI;
      const x = o.x + r * Math.cos(a);
      const z = o.z + r * Math.sin(a);
      if (buildings.some((s) => within(s, x, z)) || water.some((s) => within(s, x, z))) continue;
      const cost = parks.some((s) => within(s, x, z)) ? COST.park : onStreet(x, z) ? COST.street : COST.open;
      const score = r + cost;
      if (!best || score < best.score) best = { x, z, score };
    }
  }
  if (!best) return p;
  return frame.toLatLon(best.x, best.z);
}

/** Zoom of the OpenFreeMap tile read to find open space (its buildings are complete at z14). */
const ZOOM = 14;

/**
 * toOpenSpace with the map tile under `p` fetched from OpenFreeMap. Fails soft: any network or
 * decode error, or the abort signal, gives `p` back unchanged.
 */
export async function openSpaceFor(p: LatLon, signal?: AbortSignal): Promise<LatLon> {
  try {
    const t = lonLatToTile(p.lat, p.lon, ZOOM);
    const x = Math.floor(t.x), y = Math.floor(t.y);
    const tpl = await vectorTileTemplate();
    const res = await fetch(vectorTileUrl(tpl, ZOOM, x, y), { signal });
    if (!res.ok) return p;
    const features = decodeVectorTile(new Uint8Array(await res.arrayBuffer()), ZOOM, x, y);
    return toOpenSpace(p, features, tileFrame(ZOOM, x, y));
  } catch {
    return p;
  }
}
