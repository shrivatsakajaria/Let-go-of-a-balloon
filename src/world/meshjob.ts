/**
 * One map tile's features to Contour meshes: ground, water, buildings, roofs, roads, rivers, tree
 * and lamp instances, and labels. Pure (no fetch, DOM or three.js) so it runs in a Worker and in
 * Node tests. Everything is in the tile frame's local metres (see frame.ts).
 */
import { buildGroundMesh, carveGround, cellAt, groundGrid, type MeshBuffers } from './terrain';
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

export type TileMeshes = {
  ground: MeshBuffers;
  water: MeshBuffers;
  buildings: MeshBuffers;
  roofs: MeshBuffers;
  roads: MeshBuffers;
  waterways: MeshBuffers;
  /** Tree instance matrices, 16 floats each (column-major, three.js order). */
  trees: Float32Array;
  /** Street-lamp positions, [x, y, z] each, y on the ground. */
  lamps: Float32Array;
  labels: Label[];
  stats: { buildings: number; gapHouses: number; trees: number; lamps: number };
};

export type BuildOptions = { hiddenFootprints?: HiddenFootprint[]; lcSize?: number };

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
  const seed = (Math.imul(x, 7919) ^ Math.imul(y, 104729) ^ z) | 0;

  const landcover = rasteriseLandcover(features, frame, n);
  const g = groundGrid(heights, size, frame, n);
  // flat water (sea, lakes) sits at its level; the ground under it is lowered so it shows
  const levels = waterLevels(features.water, g);
  const cellLevel = rasteriseLevels(features.water.map((w) => w.polygon), levels, frame, n);
  carveGround(g, cellLevel);
  const waterLevelAt = (px: number, pz: number) => cellLevel[cellAt(g, px, pz)];
  const ground = buildGroundMesh(g, landcover.grid);

  const water = new MeshBuilder(4096);
  buildWater(features.water, levels, g, water);

  const roads = new MeshBuilder(16384);
  const roadInfo = buildRoads(features.transportation, g, z, roads, waterLevelAt);
  const waterways = new MeshBuilder(1024);
  buildWaterways(features.waterway, g, z, waterways);

  const walls = new MeshBuilder(16384);
  const roofs = new MeshBuilder(4096);
  const hidden: Circle[] = (opts.hiddenFootprints ?? []).map((h) => {
    const p = frame.toLocal(h.lat, h.lon);
    return { x: p.x, z: p.z, r: h.radiusM };
  });
  const { built, boxes } = buildBuildings(features.building, { ground: g, region, hidden }, walls, roofs);
  const gapHouses =
    z >= 14
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
          },
          walls,
          roofs,
        )
      : 0;

  const trees = placeTrees(
    treeZones(features),
    g,
    seed,
    z >= 14 ? 14 : z === 13 ? 24 : 40,
    undefined,
    features.building.map((b) => b.polygon),
  );
  const lamps = placeLamps(features.transportation, g, z, seed);

  const labels: Label[] = [...features.place, ...features.water_name].map((p) => ({
    name: p.name,
    kind: p.cls,
    lat: p.lat,
    lon: p.lon,
    x: p.x,
    z: p.z,
    ...(p.rank !== undefined ? { rank: p.rank } : {}),
  }));

  return {
    ground,
    water: water.build(),
    buildings: walls.build(),
    roofs: roofs.build(),
    roads: roads.build(),
    waterways: waterways.build(),
    trees,
    lamps,
    labels,
    stats: { buildings: built, gapHouses, trees: trees.length / 16, lamps: lamps.length / 3 },
  };
}

/**
 * A bucket packed for the GPU and for transfer: positions as they are, normals as signed bytes and
 * colours as linear bytes, both with a fourth padding component (4-byte aligned attributes).
 */
export type PackedBuffers = { position: Float32Array; normal: Int8Array; color: Uint8Array };

/** Pack a bucket (colours from sRGB to linear). */
export function packBuffers(b: MeshBuffers): PackedBuffers {
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
  return { position: b.position, normal, color };
}

/** Every ArrayBuffer in a TileMeshes, for postMessage transfer. */
export function transferables(m: TileMeshes): ArrayBuffer[] {
  const set = new Set<ArrayBuffer>();
  for (const b of [m.ground, m.water, m.buildings, m.roofs, m.roads, m.waterways])
    for (const a of [b.position, b.normal, b.color]) set.add(a.buffer as ArrayBuffer);
  set.add(m.trees.buffer as ArrayBuffer);
  set.add(m.lamps.buffer as ArrayBuffer);
  return [...set];
}
