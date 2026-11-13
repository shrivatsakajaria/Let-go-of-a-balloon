/**
 * The one local frame of a map tile, shared by the ground, the vector features and everything
 * placed on them, so they all line up. No three.js: this runs in a Web Worker.
 *
 * Local metres from the tile's south-west corner, three.js convention: x east, y up, z = -north.
 * Longitude maps linearly to x and latitude linearly to z, using metres per degree at the tile's
 * centre latitude (the same as the ground has always used). Vector pixels and terrain rows are
 * Web Mercator, so a pixel goes to lat/lon through the exact Mercator inverse first.
 */
import { lonDelta, tileBounds } from '../geo/coords';

/** Metres per degree of latitude (and of longitude at the equator). */
export const M_PER_DEG = 111320;

export type Bounds = { west: number; south: number; east: number; north: number };

export type TileFrame = {
  bounds: Bounds;
  widthM: number;
  heightM: number;
  /** Local metres of a geographic point. */
  toLocal(lat: number, lon: number): { x: number; z: number };
  /** Geographic point of local metres. */
  toLatLon(x: number, z: number): { lat: number; lon: number };
  /** Local metres of a vector-tile pixel (0,0 = north-west corner, extent = east / south edge). */
  pixelToLocal(px: number, py: number, extent: number): { x: number; z: number };
  /** Local metres of a fraction across the tile in Mercator: fx 0..1 west to east, fy 0..1 north to south. */
  fracToLocal(fx: number, fy: number): { x: number; z: number };
  /** Inverse of fracToLocal. */
  localToFrac(x: number, z: number): { fx: number; fy: number };
};

const D2R = Math.PI / 180;
const mercY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * D2R) / 2));
const invMercY = (m: number) => (2 * Math.atan(Math.exp(m)) - Math.PI / 2) / D2R;

/** Frame over any lon/lat rectangle, treated as a Web Mercator rectangle. */
export function frameFromBounds(bounds: Bounds): TileFrame {
  const { west, south, east, north } = bounds;
  const midLat = (south + north) / 2;
  const mLon = M_PER_DEG * Math.cos(midLat * D2R);
  const widthM = (east - west) * mLon;
  const heightM = (north - south) * M_PER_DEG;
  const yN = mercY(north);
  const yS = mercY(south);
  const dLon = east - west;

  const fracToLocal = (fx: number, fy: number) => {
    const lat = invMercY(yN + fy * (yS - yN));
    return { x: fx * dLon * mLon, z: -(lat - south) * M_PER_DEG };
  };
  return {
    bounds,
    widthM,
    heightM,
    toLocal: (lat, lon) => ({ x: lonDelta(west, lon) * mLon, z: -(lat - south) * M_PER_DEG }),
    toLatLon: (x, z) => ({ lat: south - z / M_PER_DEG, lon: west + x / mLon }),
    pixelToLocal: (px, py, extent) => fracToLocal(px / extent, py / extent),
    fracToLocal,
    localToFrac: (x, z) => ({ fx: x / widthM, fy: (mercY(south - z / M_PER_DEG) - yN) / (yS - yN) }),
  };
}

/** Frame of standard XYZ tile (z, x, y). */
export function tileFrame(z: number, x: number, y: number): TileFrame {
  return frameFromBounds(tileBounds(z, x, y));
}
