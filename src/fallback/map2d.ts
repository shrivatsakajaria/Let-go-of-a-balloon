/**
 * The maths of the 2D fallback map (pure: no DOM, no three.js). Web Mercator in world units, x from
 * 0 at 180° W to 1 at 180° E (and on past 1 across the date line, so a route never jumps across the
 * map), y from 0 at the top (85.05° N) to 1 at the bottom. A view places world point (cx, cy) at
 * screen point (ox, oy), `scale` CSS px per world unit.
 *
 * The coastline comes from OpenFreeMap's low-zoom vector tiles (their `water` layer: oceans, seas and
 * lakes; `boundary` for the national borders), at z5 where that is a small download, lower for a route
 * that spans half a continent.
 */
import { VectorTile, classifyRings } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import { clampLat, lonDelta, type LatLon } from '../geo/coords';

export type MapView = { cx: number; cy: number; scale: number; ox: number; oy: number };
/** The part of the screen left free by the chrome, in CSS px. */
export type Band = { left: number; right: number; top: number; bottom: number };
export type Size = { w: number; h: number };
/** One tile to draw: x wrapped into range for the request, tx unwrapped for where it is drawn. */
export type MapTile = { z: number; x: number; y: number; tx: number };
/** Sea and lake polygons (rings of x, y pairs in tile units) and national borders (lines). */
export type Coast = { water: number[][][]; borders: number[][] };

/** The coastline's zoom: z5 at most (the brief's "z5 vector tiles"), never below z2. */
export const MAX_COAST_ZOOM = 5;
const MIN_COAST_ZOOM = 2;
/** At most this many coastline tiles for one map (z5 tiles are 150 to 300 kB each). */
export const MAX_COAST_TILES = 12;
/** The narrowest stretch of land the band shows, as a share of the world's width (about 160 km). */
const MIN_SPAN = 1 / 250;
/** The route keeps this share of the band clear round it. */
const PAD = 0.12;

const D2R = Math.PI / 180;

export const mercX = (lon: number): number => (lon + 180) / 360;

export function mercY(lat: number): number {
  const φ = clampLat(lat) * D2R;
  return (1 - Math.log(Math.tan(φ) + 1 / Math.cos(φ)) / Math.PI) / 2;
}

/** Longitudes made continuous: each step is the short way round from the one before. */
export function unwrapLons(lons: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < lons.length; i++) out.push(i === 0 ? lons[0] : out[i - 1] + lonDelta(lons[i - 1], lons[i]));
  return out;
}

export function toPx(v: MapView, x: number, y: number): { x: number; y: number } {
  return { x: v.ox + (x - v.cx) * v.scale, y: v.oy + (y - v.cy) * v.scale };
}

/** The view that fits every point into the band, centred on them. */
export function fitView(points: LatLon[], band: Band): MapView {
  const xs = unwrapLons(points.map((p) => p.lon)).map(mercX);
  const ys = points.map((p) => mercY(p.lat));
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const bw = Math.max(1, band.right - band.left) * (1 - 2 * PAD);
  const bh = Math.max(1, band.bottom - band.top) * (1 - 2 * PAD);
  // the narrowest span is measured on the ground, so it is wider in world units away from the equator
  const minSpan = MIN_SPAN / Math.max(0.05, Math.cos(((points[0]?.lat ?? 0) * D2R)));
  const scale = Math.min(bw / Math.max(x1 - x0, minSpan), bh / Math.max(y1 - y0, minSpan));
  return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, scale, ox: (band.left + band.right) / 2, oy: (band.top + band.bottom) / 2 };
}

/** The tiles at zoom z that cover the screen. */
export function tilesFor(v: MapView, size: Size, z: number): MapTile[] {
  const n = 2 ** z;
  const wx0 = v.cx - v.ox / v.scale, wx1 = v.cx + (size.w - v.ox) / v.scale;
  const wy0 = Math.max(0, v.cy - v.oy / v.scale), wy1 = Math.min(1, v.cy + (size.h - v.oy) / v.scale);
  const out: MapTile[] = [];
  const ty0 = Math.max(0, Math.floor(wy0 * n)), ty1 = Math.min(n - 1, Math.floor(wy1 * n));
  // a view wider than the world needs each tile once only
  const tx0 = Math.floor(wx0 * n), tx1 = Math.min(Math.floor(wx1 * n), tx0 + n - 1);
  for (let tx = tx0; tx <= tx1; tx++) for (let y = ty0; y <= ty1; y++) out.push({ z, x: ((tx % n) + n) % n, y, tx });
  return out;
}

/** The finest zoom (z5 at most) whose tiles over the screen stay within MAX_COAST_TILES. */
export function pickZoom(v: MapView, size: Size): number {
  for (let z = MAX_COAST_ZOOM; z > MIN_COAST_ZOOM; z--) if (tilesFor(v, size, z).length <= MAX_COAST_TILES) return z;
  return MIN_COAST_ZOOM;
}

/** Where the chrome sits, in CSS px: what freeBand keeps the map's band clear of. */
export type Chrome = {
  w: number;
  h: number;
  /** Bottom of the clock and stats, and bottom of the top shading. */
  hudTop: number;
  shadeTop: number;
  /** Top and right edge of the bottom stack (fact line to small print). */
  stackTop: number;
  stackRight: number;
  /** The bottom shading covers only the stack's column (wide screens), not the full width. */
  narrowShade: boolean;
  /**
   * Where the bottom shading turns dark (its top edge plus its faint first quarter): sized to the stack's
   * text, it can reach well above the stack. Left out, the stack's top is the limit.
   */
  shadeBottomTop?: number;
};

const GAP = 16;
const MIN_BAND = 160;

/**
 * Where the route is drawn: clear of the text and of the dark part of the shading, so the balloon is
 * never dimmed. In portrait, between the top text and the fact line; on a wide landscape screen, the
 * column beside the stack. Where neither has room (a small landscape phone), the space below the top
 * shading.
 */
export function freeBand(c: Chrome): Band {
  const top = Math.max(c.hudTop + GAP, c.shadeTop - 24);
  const above: Band = { left: GAP, right: c.w - GAP, top, bottom: Math.min(c.stackTop, c.narrowShade ? Infinity : c.shadeBottomTop ?? Infinity) - GAP };
  if (above.bottom - above.top >= MIN_BAND) return above;
  const beside: Band = { left: c.stackRight + 24, right: c.w - GAP, top, bottom: c.h - GAP };
  if (c.narrowShade && beside.right - beside.left >= MIN_BAND && beside.bottom - beside.top >= 120) return beside;
  return { left: GAP, right: c.w - GAP, top, bottom: Math.max(top + 120, c.h - GAP) };
}

/** The sea, lakes and national borders of one vector tile, in tile units. An empty tile is all land. */
export function decodeCoast(bytes: Uint8Array): Coast {
  const out: Coast = { water: [], borders: [] };
  if (!bytes.length) return out;
  const tile = new VectorTile(new PbfReader(bytes));
  const water = tile.layers.water;
  if (water) {
    const k = 1 / water.extent;
    for (let i = 0; i < water.length; i++) {
      const f = water.feature(i);
      if (f.properties.brunnel === 'tunnel') continue;
      for (const poly of classifyRings(f.loadGeometry())) out.water.push(poly.map((ring) => ring.flatMap((p) => [p.x * k, p.y * k])));
    }
  }
  const boundary = tile.layers.boundary;
  if (boundary) {
    const k = 1 / boundary.extent;
    for (let i = 0; i < boundary.length; i++) {
      const f = boundary.feature(i);
      if (Number(f.properties.admin_level) !== 2 || Number(f.properties.maritime) === 1) continue;
      for (const line of f.loadGeometry()) if (line.length >= 2) out.borders.push(line.flatMap((p) => [p.x * k, p.y * k]));
    }
  }
  return out;
}
