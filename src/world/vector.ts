/**
 * OpenFreeMap vector tiles (OpenMapTiles schema) decoded into local metres of the tile frame.
 * Pure apart from vectorTileTemplate (one fetch of the TileJSON). No three.js, no DOM.
 */
import { PbfReader } from 'pbf';
import { VectorTile, classifyRings, type VectorTileLayer, type VectorTileFeature } from '@mapbox/vector-tile';
import { OPENFREEMAP_TILEJSON } from '../config';
import { tileFrame, type TileFrame } from './frame';
import { clipLineToBox, clipRingToBox, dedupe, ringArea, type Polygon } from './geom';

export type { Polygon, Ring } from './geom';

type Props = Record<string, number | string | boolean>;

/** A polygon area (water, landuse, landcover, park), clipped to the tile. */
export type AreaFeature = { cls: string; subclass: string; polygon: Polygon };
/**
 * A line (transportation, waterway): flat [x0, z0, x1, z1, ...]. Kept out into the tile buffer
 * (LINE_BUFFER of the extent) so ribbons can be built whole and cut exactly at the tile border.
 */
export type LineFeature = { cls: string; subclass: string; brunnel: string; line: Float64Array };
/** A building footprint whose centroid lies in this tile (not clipped). Heights in metres. */
export type BuildingFeature = { height: number; minHeight: number; polygon: Polygon };
/** A named point (place, water_name) inside the tile. */
export type PointFeature = { name: string; cls: string; rank?: number; lat: number; lon: number; x: number; z: number };

/** Map features of one tile, in local metres (x east, z = -north from the south-west corner). */
export type Features = {
  water: AreaFeature[];
  waterway: LineFeature[];
  landuse: AreaFeature[];
  landcover: AreaFeature[];
  park: AreaFeature[];
  transportation: LineFeature[];
  building: BuildingFeature[];
  place: PointFeature[];
  water_name: PointFeature[];
};

export function emptyFeatures(): Features {
  return { water: [], waterway: [], landuse: [], landcover: [], park: [], transportation: [], building: [], place: [], water_name: [] };
}

/** How far past the tile edge lines are kept, as a fraction of the extent (OpenFreeMap's buffer is 1/64). */
export const LINE_BUFFER = 1 / 64;

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

function toLocal(frame: TileFrame, pts: number[], extent: number): Float64Array {
  const out = new Float64Array(pts.length);
  for (let i = 0; i < pts.length; i += 2) {
    const p = frame.pixelToLocal(pts[i], pts[i + 1], extent);
    out[i] = p.x;
    out[i + 1] = p.z;
  }
  return out;
}

function flatPoints(ring: { x: number; y: number }[]): number[] {
  const out = new Array<number>(ring.length * 2);
  for (let i = 0; i < ring.length; i++) {
    out[i * 2] = ring[i].x;
    out[i * 2 + 1] = ring[i].y;
  }
  return out;
}

/** Polygons of a layer feature in pixels, each ring deduped; clipped to the tile if `clip`. */
function pixelPolygons(geom: ReturnType<VectorTileFeature['loadGeometry']>, extent: number, clip: boolean): number[][][] {
  const out: number[][][] = [];
  for (const poly of classifyRings(geom)) {
    const rings: number[][] = [];
    for (let k = 0; k < poly.length; k++) {
      let r = dedupe(flatPoints(poly[k]));
      if (clip) r = clipRingToBox(r, extent);
      if (r.length < 6 || Math.abs(ringArea(r)) < 1e-6) {
        if (k === 0) break; // outer ring gone: the polygon is outside the tile
        continue;
      }
      rings.push(r);
    }
    if (rings.length) out.push(rings);
  }
  return out;
}

function areas(layer: VectorTileLayer | undefined, frame: TileFrame, skip?: (p: Props) => boolean): AreaFeature[] {
  const out: AreaFeature[] = [];
  if (!layer) return out;
  for (let i = 0; i < layer.length; i++) {
    const f = layer.feature(i);
    if (f.type !== 3 || skip?.(f.properties)) continue;
    const cls = str(f.properties.class), subclass = str(f.properties.subclass);
    for (const rings of pixelPolygons(f.loadGeometry(), layer.extent, true))
      out.push({ cls, subclass, polygon: rings.map((r) => toLocal(frame, r, layer.extent)) });
  }
  return out;
}

function lines(layer: VectorTileLayer | undefined, frame: TileFrame): LineFeature[] {
  const out: LineFeature[] = [];
  if (!layer) return out;
  for (let i = 0; i < layer.length; i++) {
    const f = layer.feature(i);
    if (f.type !== 2) continue;
    const cls = str(f.properties.class), subclass = str(f.properties.subclass), brunnel = str(f.properties.brunnel);
    for (const l of f.loadGeometry())
      for (const piece of clipLineToBox(flatPoints(l), layer.extent * (1 + LINE_BUFFER), -layer.extent * LINE_BUFFER))
        out.push({ cls, subclass, brunnel, line: toLocal(frame, piece, layer.extent) });
  }
  return out;
}

function points(layer: VectorTileLayer | undefined, frame: TileFrame): PointFeature[] {
  const out: PointFeature[] = [];
  if (!layer) return out;
  for (let i = 0; i < layer.length; i++) {
    const f = layer.feature(i);
    if (f.type !== 1) continue;
    const p = f.properties;
    const name = str(p.name) || str(p['name:latin']) || str(p.name_en);
    const pt = f.loadGeometry()[0]?.[0];
    if (!name || !pt || pt.x < 0 || pt.y < 0 || pt.x >= layer.extent || pt.y >= layer.extent) continue;
    const { x, z } = frame.pixelToLocal(pt.x, pt.y, layer.extent);
    const { lat, lon } = frame.toLatLon(x, z);
    out.push({ name, cls: str(p.class), rank: typeof p.rank === 'number' ? p.rank : undefined, lat, lon, x, z });
  }
  return out;
}

function buildings(layer: VectorTileLayer | undefined, frame: TileFrame): BuildingFeature[] {
  const out: BuildingFeature[] = [];
  if (!layer) return out;
  const e = layer.extent;
  for (let i = 0; i < layer.length; i++) {
    const f = layer.feature(i);
    const p = f.properties;
    if (f.type !== 3 || p.hide_3d === true) continue; // hide_3d: drawn by its building:parts instead
    const height = typeof p.render_height === 'number' ? p.render_height : 5;
    const minHeight = typeof p.render_min_height === 'number' ? p.render_min_height : 0;
    if (height <= minHeight) continue;
    for (const rings of pixelPolygons(f.loadGeometry(), e, false)) {
      // a building in a neighbour's buffer belongs to the neighbour: keep it where its centroid is
      const o = rings[0];
      let sx = 0, sy = 0;
      for (let k = 0; k < o.length; k += 2) { sx += o[k]; sy += o[k + 1]; }
      const cx = sx / (o.length / 2), cy = sy / (o.length / 2);
      if (cx < 0 || cy < 0 || cx >= e || cy >= e) continue;
      out.push({ height, minHeight, polygon: rings.map((r) => toLocal(frame, r, e)) });
    }
  }
  return out;
}

/** Decode an OpenMapTiles vector tile into local metres of tile (z, x, y). */
export function decodeVectorTile(buf: ArrayBuffer | Uint8Array, z: number, x: number, y: number): Features {
  const frame = tileFrame(z, x, y);
  const vt = new VectorTile(new PbfReader(buf));
  const L = vt.layers;
  return {
    water: areas(L.water, frame, (p) => p.brunnel === 'tunnel'),
    waterway: lines(L.waterway, frame).filter((l) => l.brunnel !== 'tunnel'),
    landuse: areas(L.landuse, frame),
    landcover: areas(L.landcover, frame),
    park: areas(L.park, frame),
    transportation: lines(L.transportation, frame).filter((l) => l.brunnel !== 'tunnel'),
    building: buildings(L.building, frame),
    place: points(L.place, frame),
    water_name: points(L.water_name, frame),
  };
}

// ---- where the tiles are ----

let template: Promise<string> | null = null;

/** The OpenFreeMap tile URL template ({z}/{x}/{y}), read once from the versioned TileJSON. */
export function vectorTileTemplate(tilejson = OPENFREEMAP_TILEJSON): Promise<string> {
  template ??= fetch(tilejson)
    .then((r) => {
      if (!r.ok) throw new Error(`tilejson ${r.status}`);
      return r.json() as Promise<{ tiles?: string[] }>;
    })
    .then((j) => {
      const t = j.tiles?.[0];
      if (!t) throw new Error('tilejson has no tiles');
      return t;
    });
  template.catch(() => (template = null));
  return template;
}

/** One vector tile's bytes (null when the server has none). The single place vector tiles are requested. */
export async function fetchVectorTile(tpl: string, z: number, x: number, y: number, signal?: AbortSignal): Promise<Uint8Array | null> {
  const res = await fetch(vectorTileUrl(tpl, z, x, y), { signal });
  return res.ok ? new Uint8Array(await res.arrayBuffer()) : null;
}

/** Fill a {z}/{x}/{y} template (a URL without placeholders is returned as is). */
export function vectorTileUrl(tpl: string, z: number, x: number, y: number): string {
  return tpl.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
}
