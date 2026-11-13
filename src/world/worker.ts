/**
 * Tile mesh worker. Answers
 *   { type: 'build', id?, z, x, y, region, vectorUrl, terrain: { heights, size }, hiddenFootprints, lcSize? }
 * by fetching the vector tile itself (vectorUrl is a resolved URL or a {z}/{x}/{y} template from
 * the OpenFreeMap TileJSON), building the meshes and posting
 *   { type: 'built', id, z, x, y, meshes }   with every buffer transferred, or
 *   { type: 'error', id, z, x, y, message }.
 * A missing tile (404 or 204, e.g. open sea) builds ground and nothing else.
 * { type: 'cancel', id } aborts that build: its download stops and nothing is posted for it.
 *
 * Use: new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }).
 */
import { decodeVectorTile, emptyFeatures, vectorTileUrl } from './vector';
import { buildTileMeshes, packMeshes, transferables, type Detail, type HiddenFootprint, type PackedBuffers, type TileMeshes } from './meshjob';
import type { RegionStyle } from './palette';
import type { MeshBuffers } from './terrain';
import { streamTerrainTile, type TerrainTile } from './terrainsrc';

export type BuildRequest = {
  type: 'build';
  id?: number;
  z: number;
  x: number;
  y: number;
  region: RegionStyle;
  vectorUrl: string;
  /** Elevation for the tile; without it the worker reads it itself (terrainsrc streamTerrainTile). */
  terrain?: { heights: Float32Array; size: number };
  hiddenFootprints?: HiddenFootprint[];
  lcSize?: number;
  detail?: Partial<Detail>;
  skirtM?: number;
  /** Sort buildings, roofs and roads by tile quarter (meshjob splitQuarters). */
  split?: boolean;
  /** Reply with packed buckets (meshjob packBuffers): smaller to send and to upload. */
  pack?: boolean;
};

export type BuildReply =
  | { type: 'built'; id?: number; z: number; x: number; y: number; meshes: TileMeshes<MeshBuffers | PackedBuffers> }
  | { type: 'error'; id?: number; z: number; x: number; y: number; message: string };

export type CancelRequest = { type: 'cancel'; id: number };

const CANCELLED = 'cancelled';

/**
 * Fetch, decode and mesh one tile. Returns the reply and the buffers to transfer with it. An abort
 * of `signal` stops the download and gives an error reply 'cancelled'.
 */
export async function handleBuild(
  req: BuildRequest,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
  terrainImpl: (z: number, x: number, y: number) => Promise<TerrainTile> = streamTerrainTile,
): Promise<{ reply: BuildReply; transfer: ArrayBuffer[] }> {
  const { id, z, x, y } = req;
  try {
    const terrainIn = req.terrain ? Promise.resolve(req.terrain) : terrainImpl(z, x, y);
    terrainIn.catch(() => {}); // awaited below; never unhandled
    const res = await fetchImpl(vectorTileUrl(req.vectorUrl, z, x, y), { signal });
    let features = emptyFeatures();
    if (res.status !== 404 && res.status !== 204) {
      if (!res.ok) throw new Error(`vector tile ${res.status}`);
      const buf = await res.arrayBuffer();
      if (signal?.aborted) throw new Error(CANCELLED);
      if (buf.byteLength) features = decodeVectorTile(buf, z, x, y);
    }
    const { heights, size } = await terrainIn;
    if (heights.length !== size * size) throw new Error('terrain size mismatch');
    if (signal?.aborted) throw new Error(CANCELLED);
    const built = buildTileMeshes(features, heights, z, x, y, req.region, {
      hiddenFootprints: req.hiddenFootprints,
      lcSize: req.lcSize,
      detail: req.detail,
      skirtM: req.skirtM,
      split: req.split,
    });
    const meshes = req.pack ? packMeshes(built) : built;
    return { reply: { type: 'built', id, z, x, y, meshes }, transfer: transferables(meshes) };
  } catch (e) {
    const message = signal?.aborted ? CANCELLED : e instanceof Error ? e.message : String(e);
    return { reply: { type: 'error', id, z, x, y, message }, transfer: [] };
  }
}

// Register only inside a worker, so Node tests can import handleBuild.
const WorkerScope = (globalThis as { WorkerGlobalScope?: abstract new () => unknown }).WorkerGlobalScope;
if (WorkerScope && self instanceof WorkerScope) {
  const running = new Map<number, AbortController>();
  self.onmessage = async (e: MessageEvent<BuildRequest | CancelRequest>) => {
    const d = e.data;
    if (d?.type === 'cancel') {
      running.get(d.id)?.abort();
      return;
    }
    if (d?.type !== 'build') return;
    const ac = new AbortController();
    if (d.id !== undefined) running.set(d.id, ac);
    const { reply, transfer } = await handleBuild(d, fetch, ac.signal);
    if (d.id !== undefined) running.delete(d.id);
    if (ac.signal.aborted) return; // nobody is waiting for it
    self.postMessage(reply, { transfer });
  };
}
