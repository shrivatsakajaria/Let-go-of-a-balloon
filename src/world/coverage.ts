/**
 * Which level of detail covers each part of the ground, so a coarse tile never shows where a finer
 * one is drawn (no z-fighting, nothing poking through). A square window of z14 tile cells around
 * the scene origin holds, per cell, the finest zoom that is fully in; a coarse tile's fragment is
 * discarded where the cell holds a finer zoom than its own (see materials.ts, CONTOUR_CLIP).
 *
 * Every tile edge of every zoom lies on the z14 grid, and in scene metres tile edges are straight
 * lines (x from longitude, z from latitude), so the cell of a scene point can be computed exactly in
 * the shader: x is linear; y is Web Mercator, expanded as a short series in the latitude offset from
 * the origin (exact to well under a millimetre within a few hundred kilometres).
 */
import * as THREE from 'three';
import { lonLatToTile, type LatLon } from '../geo/coords';
import { M_PER_DEG } from './frame';

/** Cells per side of the window, and the zoom of a cell. */
export const COV_N = 256;
export const COV_ZOOM = 14;
const N14 = 2 ** COV_ZOOM;

export type CoverageFrame = {
  /** z14 tile of the window's first cell. */
  ax: number;
  ay: number;
  /** Fractional cell of the scene origin. */
  ox: number;
  oy: number;
  /** Cells per scene metre east. */
  kx: number;
  /** Radians of latitude per scene metre (scene z is -north). */
  invR: number;
  /** Mercator series in the latitude offset (radians), already in cells: dy = d(c0 + d(c1 + d(c2 + d c3))). */
  merc: [number, number, number, number];
};

export function coverageFrame(origin: LatLon, n = COV_N): CoverageFrame {
  const t = lonLatToTile(origin.lat, origin.lon, COV_ZOOM);
  const ax = Math.floor(t.x) - n / 2, ay = Math.floor(t.y) - n / 2;
  const phi = (origin.lat * Math.PI) / 180;
  const sec = 1 / Math.cos(phi), tan = Math.tan(phi), t2 = tan * tan;
  // tile y = n/2 * (1 - mercY/pi): d(tile y)/d(mercY) = -N14 / (2 pi)
  const s = -N14 / (2 * Math.PI);
  return {
    ax,
    ay,
    ox: t.x - ax,
    oy: t.y - ay,
    kx: N14 / (360 * M_PER_DEG * Math.cos(phi)),
    invR: Math.PI / (180 * M_PER_DEG),
    merc: [sec * s, (sec * tan * s) / 2, (sec * (1 + 2 * t2) * s) / 6, (sec * tan * (5 + 6 * t2) * s) / 24],
  };
}

/** The (fractional) window cell of a scene point; the CPU twin of the shader. */
export function cellAt(f: CoverageFrame, x: number, z: number): { cx: number; cy: number } {
  const d = -z * f.invR;
  const [c0, c1, c2, c3] = f.merc;
  return { cx: f.ox + x * f.kx, cy: f.oy + d * (c0 + d * (c1 + d * (c2 + d * c3))) };
}

/** Window cell range [x0, x1) x [y0, y1) of tile (z, x, y), unclipped, continuous across the date line. */
export function tileCells(f: CoverageFrame, t: { z: number; x: number; y: number }): { x0: number; x1: number; y0: number; y1: number } {
  const s = 2 ** (COV_ZOOM - t.z);
  let x0 = t.x * s - f.ax;
  // the window sits around the origin: pick the copy of the tile nearest to it
  if (x0 - f.ox > N14 / 2) x0 -= N14;
  else if (x0 + s - f.ox < -N14 / 2) x0 += N14;
  const y0 = t.y * s - f.ay;
  return { x0, x1: x0 + s, y0, y1: y0 + s };
}

export type CoverageUniforms = {
  uCoverage: { value: THREE.DataTexture };
  /** (ox, oy, kx, invR) */
  uCovO: { value: THREE.Vector4 };
  uMerc: { value: THREE.Vector4 };
};

export class CoverageMap {
  readonly n: number;
  readonly data: Uint8Array;
  readonly texture: THREE.DataTexture;
  readonly uniforms: CoverageUniforms;
  frame: CoverageFrame;

  constructor(origin: LatLon, n = COV_N) {
    this.n = n;
    this.data = new Uint8Array(n * n);
    this.texture = new THREE.DataTexture(this.data, n, n, THREE.RedFormat, THREE.UnsignedByteType);
    this.texture.minFilter = this.texture.magFilter = THREE.NearestFilter;
    this.texture.generateMipmaps = false;
    this.texture.needsUpdate = true;
    this.frame = coverageFrame(origin, n);
    this.uniforms = { uCoverage: { value: this.texture }, uCovO: { value: new THREE.Vector4() }, uMerc: { value: new THREE.Vector4() } };
    this.syncUniforms();
  }

  /** Re-anchor the window on a new scene origin (call rebuild after). */
  setOrigin(origin: LatLon): void {
    this.frame = coverageFrame(origin, this.n);
    this.syncUniforms();
  }

  /** Mark each cell with the finest zoom among `tiles` (tiles fully in and drawn). */
  rebuild(tiles: Iterable<{ z: number; x: number; y: number }>): void {
    const { data, n } = this;
    data.fill(0);
    for (const t of tiles) {
      const c = tileCells(this.frame, t);
      const x0 = Math.max(0, c.x0), x1 = Math.min(n, c.x1), y0 = Math.max(0, c.y0), y1 = Math.min(n, c.y1);
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (data[y * n + x] < t.z) data[y * n + x] = t.z;
    }
    this.texture.needsUpdate = true;
  }

  /** True when every cell of the tile (inside the window) holds a finer zoom: nothing of it would show. */
  hides(t: { z: number; x: number; y: number }): boolean {
    const { data, n } = this;
    const c = tileCells(this.frame, t);
    const x0 = Math.max(0, c.x0), x1 = Math.min(n, c.x1), y0 = Math.max(0, c.y0), y1 = Math.min(n, c.y1);
    if (x0 !== c.x0 || x1 !== c.x1 || y0 !== c.y0 || y1 !== c.y1) return false; // partly outside the window
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (data[y * n + x] <= t.z) return false;
    return true;
  }

  dispose(): void {
    this.texture.dispose();
  }

  private syncUniforms(): void {
    const f = this.frame;
    this.uniforms.uCovO.value.set(f.ox, f.oy, f.kx, f.invR);
    this.uniforms.uMerc.value.set(...f.merc);
  }
}
