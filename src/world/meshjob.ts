/**
 * One map tile's features to Contour meshes: ground, water, buildings, roofs, roads, rivers, tree
 * and lamp instances, and labels. Pure (no fetch, DOM or three.js) so it runs in a Worker and in
 * Node tests. Everything is in the tile frame's local metres (see frame.ts).
 */
import { buildGroundMesh, carveGround, cellAt, groundGrid, withSkirts, type MeshBuffers } from './terrain';
import { tileFrame } from './frame';
import type { RegionStyle } from './palette';
import { MeshBuilder } from './geom';
import type { Features } from './vector';
import { placeTrees, rasteriseLandcover, rasteriseLevels, treeZones } from './landcover';
import { buildBuildings, gapFill, type Circle } from './buildings';
import { buildRoads, buildWaterways, placeLamps } from './lines';
import { buildWater, waterLevels } from './water';
import { srgbToLinear } from './color';

/** A circle (from a landmark) whose buildings the map should not draw. */
export type HiddenFootprint = { lat: number; lon: number; radiusM: number };

export type Label = { name: string; kind: string; lat: number; lon: number; x: number; z: number; rank?: number };

export type TileMeshes<B = MeshBuffers> = {
  ground: B;
  water: B;
  buildings: B;
  roofs: B;
  roads: B;
  waterways: B;
  /** Tree instance matrices, 16 floats each (column-major, three.js order). */
  trees: Float32Array;
  /** Street-lamp positions, [x, y, z] each, y on the ground. */
  lamps: Float32Array;
  labels: Label[];
  /** The drawn ground's vertex heights, (n+1) x (n+1), row 0 = south (terrain.ts GroundGrid.terr). */
  grid: Float32Array;
  /** [x, z, radius, top] per building and gap-fill house (local metres; top is absolute). */
  tops: Float32Array;
  stats: { buildings: number; gapHouses: number; trees: number; lamps: number };
};

/**
 * How much of a tile to build. Far tiles need ground, water and land use only (spec 12).
 *  - buildings: 'full' footprints with pitched roofs on low ones and gap-fill houses (z14);
 *    'lite' flat tops, small low footprints left out; 'none'.
 *  - roads: the lowest road rank drawn (lines.ts: 4 motorway, 3 primary, 2 streets, 0 rail), or
 *    Infinity for none.
 */
export type Detail = { buildings: 'full' | 'lite' | 'none'; roadMinRank: number; waterways: boolean; trees: boolean; lamps: boolean };
export const FULL_DETAIL: Detail = { buildings: 'full', roadMinRank: 0, waterways: true, trees: true, lamps: true };
/** 'lite' buildings: footprints under this many m2 are left out unless at least LITE_KEEP_M tall. */
export const LITE_MIN_AREA_M2 = 120;
export const LITE_KEEP_M = 12;
/** 'lite' footprints are simplified to this tolerance (about half a pixel at 3 km on a phone). */
export const LITE_SIMPLIFY_M = 2;

export type BuildOptions = {
  hiddenFootprints?: HiddenFootprint[];
  lcSize?: number;
  detail?: Partial<Detail>;
  /** Skirts this deep on the ground's edges (terrain.ts withSkirts); none by default. */
  skirtM?: number;
  /**
   * Sort buildings, roofs and roads into the tile's four quarters (splitQuarters), so a near tile
   * is culled a quarter at a time, in view and in the shadow pass.
   */
  split?: boolean;
};

/** Ground and land-cover cells per tile side by zoom. */
export const lcSizeFor = (z: number) => (z >= 14 ? 64 : z === 13 ? 48 : 32);

/**
 * Build all meshes for tile (z, x, y). `heights` is the terrain tile (square, row 0 = north, in
 * metres); its side is taken from its length.
 */
export function buildTileMeshes(
  features: Features,
  heights: Float32Array,
  z: number,
  x: number,
  y: number,
  region: RegionStyle,
  opts: BuildOptions = {},
): TileMeshes {
  const size = Math.round(Math.sqrt(heights.length));
  if (size * size !== heights.length || size < 2) throw new Error('terrain must be a square grid');
  const frame = tileFrame(z, x, y);
  const n = opts.lcSize ?? lcSizeFor(z);
  const detail: Detail = { ...FULL_DETAIL, ...opts.detail };
  const seed = (Math.imul(x, 7919) ^ Math.imul(y, 104729) ^ z) | 0;

  const landcover = rasteriseLandcover(features, frame, n);
  const g = groundGrid(heights, size, frame, n);
  // flat water (sea, lakes) sits at its level; the ground under it is lowered so it shows
  const levels = waterLevels(features.water, g);
  const cellLevel = rasteriseLevels(features.water.map((w) => w.polygon), levels, frame, n);
  carveGround(g, cellLevel);
  const waterLevelAt = (px: number, pz: number) => cellLevel[cellAt(g, px, pz)];
  const flatGround = buildGroundMesh(g, landcover.grid);
  const ground = opts.skirtM ? withSkirts(g, flatGround, opts.skirtM) : flatGround;

  const water = new MeshBuilder(4096);
  buildWater(features.water, levels, g, water);

  const roads = new MeshBuilder(16384);
  const roadInfo = buildRoads(Number.isFinite(detail.roadMinRank) ? features.transportation : [], g, z, roads, waterLevelAt, detail.roadMinRank);
  const waterways = new MeshBuilder(1024);
  if (detail.waterways) buildWaterways(features.waterway, g, z, waterways);

  const walls = new MeshBuilder(16384);
  const roofs = new MeshBuilder(4096);
  const hidden: Circle[] = (opts.hiddenFootprints ?? []).map((h) => {
    const p = frame.toLocal(h.lat, h.lon);
    return { x: p.x, z: p.z, r: h.radiusM };
  });
  const tops: number[] = [];
  const lite = detail.buildings === 'lite';
  const { built, boxes } = buildBuildings(
    detail.buildings === 'none' ? [] : features.building,
    { ground: g, region, hidden, tops, flat: lite, minAreaM2: lite ? LITE_MIN_AREA_M2 : 0, keepTallerM: LITE_KEEP_M, simplifyM: lite ? LITE_SIMPLIFY_M : 0 },
    walls,
    roofs,
  );
  const gapHouses =
    z >= 14 && detail.buildings === 'full'
      ? gapFill(
          {
            ground: g,
            landcover,
            region,
            boxes,
            residentialAreas: features.landuse.filter((a) => a.cls === 'residential').map((a) => a.polygon),
            roadCells: roadInfo.cells,
            roadAngle: roadInfo.angle,
            seed,
            tops,
          },
          walls,
          roofs,
        )
      : 0;

  const trees = !detail.trees ? new Float32Array(0) : placeTrees(
    treeZones(features),
    g,
    seed,
    z >= 14 ? 14 : z === 13 ? 24 : 40,
    undefined,
    features.building.map((b) => b.polygon),
  );
  const lamps = detail.lamps ? placeLamps(features.transportation, g, z, seed) : new Float32Array(0);

  const labels: Label[] = [...features.place, ...features.water_name].map((p) => ({
    name: p.name,
    kind: p.cls,
    lat: p.lat,
    lon: p.lon,
    x: p.x,
    z: p.z,
    ...(p.rank !== undefined ? { rank: p.rank } : {}),
  }));

  const q = (b: MeshBuffers) => (opts.split ? splitQuarters(b, frame.widthM, frame.heightM) : b);
  return {
    ground,
    water: water.build(),
    buildings: q(walls.build()),
    roofs: q(roofs.build()),
    roads: q(roads.build()),
    waterways: waterways.build(),
    trees,
    lamps,
    labels,
    grid: g.terr,
    tops: Float32Array.from(tops),
    stats: { buildings: built, gapHouses, trees: trees.length / 16, lamps: lamps.length / 3 },
  };
}

/** Buffers sorted by quarter: vertices parts[i] .. parts[i + 1] lie in quarter i (SW, SE, NW, NE). */
export type Quartered = { parts?: Uint32Array };

/**
 * Reorder whole triangles by the quarter of the tile their centre falls in (x east of width / 2,
 * z north of -height / 2), keeping their order within a quarter. Returns new buffers with `parts`.
 */
export function splitQuarters(b: MeshBuffers, widthM: number, heightM: number): MeshBuffers & Quartered {
  const tris = b.position.length / 9;
  const quarter = new Uint8Array(tris);
  const count = [0, 0, 0, 0];
  const p = b.position;
  for (let t = 0; t < tris; t++) {
    const o = t * 9;
    const cx = (p[o] + p[o + 3] + p[o + 6]) / 3, cz = (p[o + 2] + p[o + 5] + p[o + 8]) / 3;
    const q = (cx > widthM / 2 ? 1 : 0) + (cz < -heightM / 2 ? 2 : 0);
    quarter[t] = q;
    count[q]++;
  }
  const parts = new Uint32Array(5);
  for (let q = 0; q < 4; q++) parts[q + 1] = parts[q] + count[q] * 3;
  const at = [parts[0] / 3, parts[1] / 3, parts[2] / 3, parts[3] / 3];
  const out = { position: new Float32Array(p.length), normal: new Float32Array(p.length), color: new Float32Array(p.length), parts };
  for (let t = 0; t < tris; t++) {
    const d = at[quarter[t]]++ * 9, o = t * 9;
    out.position.set(p.subarray(o, o + 9), d);
    out.normal.set(b.normal.subarray(o, o + 9), d);
    out.color.set(b.color.subarray(o, o + 9), d);
  }
  return out;
}

/**
 * A bucket packed for the GPU and for transfer: positions as they are, normals as signed bytes and
 * colours as linear bytes, both with a fourth padding component (4-byte aligned attributes).
 */
export type PackedBuffers = { position: Float32Array; normal: Int8Array; color: Uint8Array } & Quartered;

/** Pack a bucket (colours from sRGB to linear). */
export function packBuffers(b: MeshBuffers & Quartered): PackedBuffers {
  const n = b.position.length / 3;
  const normal = new Int8Array(n * 4);
  const color = new Uint8Array(n * 4);
  // colours repeat per face: convert each distinct value once
  const lut = new Map<number, number>();
  const lin = (c: number) => {
    let v = lut.get(c);
    if (v === undefined) lut.set(c, (v = Math.round(srgbToLinear(Math.min(1, Math.max(0, c))) * 255)));
    return v;
  };
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 3; k++) {
      normal[i * 4 + k] = Math.round(Math.max(-1, Math.min(1, b.normal[i * 3 + k])) * 127);
      color[i * 4 + k] = lin(b.color[i * 3 + k]);
    }
    color[i * 4 + 3] = 255;
  }
  return b.parts ? { position: b.position, normal, color, parts: b.parts } : { position: b.position, normal, color };
}

/** A tile with every bucket packed (packBuffers). */
export function packMeshes(m: TileMeshes): TileMeshes<PackedBuffers> {
  return {
    ...m,
    ground: packBuffers(m.ground),
    water: packBuffers(m.water),
    buildings: packBuffers(m.buildings),
    roofs: packBuffers(m.roofs),
    roads: packBuffers(m.roads),
    waterways: packBuffers(m.waterways),
  };
}

/** Every ArrayBuffer in a TileMeshes, for postMessage transfer. */
export function transferables(m: TileMeshes<MeshBuffers | PackedBuffers>): ArrayBuffer[] {
  const set = new Set<ArrayBuffer>();
  for (const b of [m.ground, m.water, m.buildings, m.roofs, m.roads, m.waterways])
    for (const a of [b.position, b.normal, b.color, (b as Quartered).parts]) if (a) set.add(a.buffer as ArrayBuffer);
  for (const a of [m.trees, m.lamps, m.grid, m.tops]) set.add(a.buffer as ArrayBuffer);
  return [...set];
}
