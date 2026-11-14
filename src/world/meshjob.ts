/**
 * One map tile's features to Contour meshes: ground, water, buildings, roofs, roads, rivers, tree,
 * lamp and boat instances, the night glow of the ground and roads, and labels. Pure (no fetch, DOM or three.js) so it runs in a Worker and in
 * Node tests. Everything is in the tile frame's local metres (see frame.ts).
 */
import { buildGroundMesh, carveGround, cellAt, groundGrid, withSkirts, type MeshBuffers } from './terrain';
import { tileFrame } from './frame';
import type { RegionStyle } from './palette';
import { MeshBuilder } from './geom';
import type { Features } from './vector';
import { placeTrees, rasteriseLandcover, rasteriseLevels, treeLawns, treeZones } from './landcover';
import { buildBuildings, gapFill, type Circle } from './buildings';
import { buildRoads, buildWaterways, placeLamps } from './lines';
import { buildWater, waterLevels } from './water';
import { srgbToLinear } from './color';
import { glowGrid, placeBoats, vertexGlow } from './glow';

/** A circle (from a landmark) whose buildings the map should not draw. */
export type HiddenFootprint = { lat: number; lon: number; radiusM: number };

export type Label = { name: string; en?: string; kind: string; lat: number; lon: number; x: number; z: number; rank?: number };

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
  /** Ships on open water, glow.ts BOAT_STRIDE floats each: x, y, z, heading, length. */
  boats: Float32Array;
  labels: Label[];
  /** The drawn ground's vertex heights, (n+1) x (n+1), row 0 = south (terrain.ts GroundGrid.terr). */
  grid: Float32Array;
  /** [x, z, radius, top] per building and gap-fill house (local metres; top is absolute). */
  tops: Float32Array;
  stats: { buildings: number; gapHouses: number; trees: number; lamps: number; boats: number };
};

/**
 * How much of a tile to build. Far tiles need ground, water and land use only (spec 12).
 *  - buildings: 'full' footprints with pitched roofs on low ones and gap-fill houses (z14);
 *    'lite' flat tops, small low footprints left out; 'none'.
 *  - roads: the lowest road rank drawn (lines.ts: 4 motorway, 3 primary, 2 streets, 0 rail), or
 *    Infinity for none.
 */
export type Detail = {
  buildings: 'full' | 'lite' | 'none';
  roadMinRank: number;
  waterways: boolean;
  trees: boolean;
  lamps: boolean;
  /** Flat water facets across the tile (water.ts buildWater); default 20. */
  waterFacets?: number;
  /** Water in broad patches of one colour (the landing card's region tiles); default false. */
  waterCalm?: boolean;
  /** The odd ship on open water (glow.ts placeBoats); default true. */
  boats?: boolean;
  /** Night glow per ground and road vertex (glow.ts); default true. */
  glow?: boolean;
};
export const FULL_DETAIL: Detail = { buildings: 'full', roadMinRank: 0, waterways: true, trees: true, lamps: true, boats: true, glow: true };
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
   * Sort buildings, roofs and roads by tile cell (splitCells), so a near tile is culled a quarter at
   * a time in view and a sixteenth at a time in the shadow pass.
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
  buildWater(features.water, levels, g, water, detail.waterFacets ?? 20, detail.waterCalm ?? false);

  // landmark circles: their map buildings, gap-fill houses and bridges are left to the landmark
  const hidden: Circle[] = (opts.hiddenFootprints ?? []).map((h) => {
    const p = frame.toLocal(h.lat, h.lon);
    return { x: p.x, z: p.z, r: h.radiusM };
  });
  const roads = new MeshBuilder(16384);
  const roadInfo = buildRoads(Number.isFinite(detail.roadMinRank) ? features.transportation : [], g, z, roads, waterLevelAt, detail.roadMinRank, hidden);
  const waterways = new MeshBuilder(1024);
  if (detail.waterways) buildWaterways(features.waterway, g, z, waterways);

  const walls = new MeshBuilder(16384);
  const roofs = new MeshBuilder(4096);
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
            hidden,
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
    treeLawns(features),
  );
  const lamps = detail.lamps ? placeLamps(features.transportation, g, z, seed) : new Float32Array(0);
  const boats = detail.boats !== false ? placeBoats(features, levels, frame, z, seed) : new Float32Array(0);

  const labels: Label[] = [...features.place, ...features.water_name].map((p) => ({
    name: p.name,
    ...(p.en ? { en: p.en } : {}),
    kind: p.cls,
    lat: p.lat,
    lon: p.lon,
    x: p.x,
    z: p.z,
    ...(p.rank !== undefined ? { rank: p.rank } : {}),
  }));

  const q = (b: MeshBuffers) => (opts.split ? splitCells(b, frame.widthM, frame.heightM) : b);
  const roadMesh: MeshBuffers = q(roads.build());
  if (detail.glow !== false) {
    const glow = glowGrid(features, frame, n);
    ground.glow = vertexGlow(ground.position, glow, n, frame.widthM, frame.heightM);
    roadMesh.glow = vertexGlow(roadMesh.position, glow, n, frame.widthM, frame.heightM);
  }
  return {
    ground,
    water: water.build(),
    buildings: q(walls.build()),
    roofs: q(roofs.build()),
    roads: roadMesh,
    waterways: waterways.build(),
    trees,
    lamps,
    boats,
    labels,
    grid: g.terr,
    tops: Float32Array.from(tops),
    stats: { buildings: built, gapHouses, trees: trees.length / 16, lamps: lamps.length / 3, boats: boats.length / 5 },
  };
}

/**
 * Buffers sorted by cell of a 4 x 4 grid over the tile, the four cells of each quarter together
 * (quarters SW, SE, NW, NE; the same order inside each). Vertices parts[i] .. parts[i + 1] lie in
 * cell i, so quarter q is parts[4q] .. parts[4q + 4].
 */
export type Quartered = { parts?: Uint32Array };

/** Cell index (0..15) of a point in local metres: quarter * 4 + the cell inside the quarter. */
export function cellIndex(x: number, z: number, widthM: number, heightM: number): number {
  const c = Math.min(3, Math.max(0, Math.floor((x / widthM) * 4)));
  const r = Math.min(3, Math.max(0, Math.floor((-z / heightM) * 4))); // 0 = south
  return ((c >> 1) + 2 * (r >> 1)) * 4 + (c & 1) + 2 * (r & 1);
}

/**
 * Reorder whole triangles by the cell their centre falls in (cellIndex), keeping their order
 * within a cell. Returns new buffers with `parts` (17 vertex offsets).
 */
export function splitCells(b: MeshBuffers, widthM: number, heightM: number): MeshBuffers & Quartered {
  const tris = b.position.length / 9;
  const cell = new Uint8Array(tris);
  const count = new Uint32Array(16);
  const p = b.position;
  for (let t = 0; t < tris; t++) {
    const o = t * 9;
    const k = cellIndex((p[o] + p[o + 3] + p[o + 6]) / 3, (p[o + 2] + p[o + 5] + p[o + 8]) / 3, widthM, heightM);
    cell[t] = k;
    count[k]++;
  }
  const parts = new Uint32Array(17);
  for (let k = 0; k < 16; k++) parts[k + 1] = parts[k] + count[k] * 3;
  const at = Array.from(parts.subarray(0, 16), (v) => v / 3);
  const out = { position: new Float32Array(p.length), normal: new Float32Array(p.length), color: new Float32Array(p.length), parts };
  for (let t = 0; t < tris; t++) {
    const d = at[cell[t]]++ * 9, o = t * 9;
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
export type PackedBuffers = {
  position: Float32Array;
  normal: Int8Array;
  color: Uint8Array;
  /** Night glow per vertex, 0..255 (ground and roads only). */
  glow?: Uint8Array;
  /**
   * Bounding boxes, 6 floats each (min x, y, z, max x, y, z): one per cell when `parts` is set (an
   * empty cell has min > max), else one for the whole bucket. Worked out here so the main thread
   * does not walk every vertex of an arriving tile.
   */
  bounds: Float32Array;
} & Quartered;

/** Bounding boxes of the vertex ranges parts[i] .. parts[i + 1] (or of everything). */
export function rangeBounds(position: Float32Array, parts?: Uint32Array): Float32Array {
  const edges = parts ?? Uint32Array.of(0, position.length / 3);
  const out = new Float32Array((edges.length - 1) * 6);
  for (let r = 0; r + 1 < edges.length; r++) {
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (let i = edges[r] * 3; i < edges[r + 1] * 3; i += 3) {
      const x = position[i], y = position[i + 1], z = position[i + 2];
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      if (z < z0) z0 = z;
      if (z > z1) z1 = z;
    }
    out.set([x0, y0, z0, x1, y1, z1], r * 6);
  }
  return out;
}

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
  const bounds = rangeBounds(b.position, b.parts);
  const out: PackedBuffers = { position: b.position, normal, color, bounds };
  if (b.parts) out.parts = b.parts;
  if (b.glow) out.glow = b.glow;
  return out;
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
    for (const a of [b.position, b.normal, b.color, b.glow, (b as Quartered).parts, (b as Partial<PackedBuffers>).bounds]) if (a) set.add(a.buffer as ArrayBuffer);
  for (const a of [m.trees, m.lamps, m.boats, m.grid, m.tops]) set.add(a.buffer as ArrayBuffer);
  return [...set];
}
