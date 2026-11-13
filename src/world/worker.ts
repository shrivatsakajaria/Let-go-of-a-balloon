/**
 * Tile mesh worker. Answers
 *   { type: 'build', id?, z, x, y, region, vectorUrl, terrain: { heights, size }, hiddenFootprints, lcSize? }
 * by fetching the vector tile itself (vectorUrl is a resolved URL or a {z}/{x}/{y} template from
 * the OpenFreeMap TileJSON), building the meshes and posting
 *   { type: 'built', id, z, x, y, meshes }   with every buffer transferred, or
 *   { type: 'error', id, z, x, y, message }.
 * A missing tile (404 or 204, e.g. open sea) builds ground and nothing else.
 *
 * Use: new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }).
 */
import { decodeVectorTile, emptyFeatures, vectorTileUrl } from './vector';
import { buildTileMeshes, transferables, type HiddenFootprint, type TileMeshes } from './meshjob';
import type { RegionStyle } from './palette';

export type BuildRequest = {
  type: 'build';
  id?: number;
  z: number;
  x: number;
  y: number;
  region: RegionStyle;
  vectorUrl: string;
  terrain: { heights: Float32Array; size: number };
  hiddenFootprints?: HiddenFootprint[];
  lcSize?: number;
};

export type BuildReply =
  | { type: 'built'; id?: number; z: number; x: number; y: number; meshes: TileMeshes }
  | { type: 'error'; id?: number; z: number; x: number; y: number; message: string };

/** Fetch, decode and mesh one tile. Returns the reply and the buffers to transfer with it. */
export async function handleBuild(req: BuildRequest, fetchImpl: typeof fetch = fetch): Promise<{ reply: BuildReply; transfer: ArrayBuffer[] }> {
  const { id, z, x, y } = req;
  try {
    const { heights, size } = req.terrain;
    if (heights.length !== size * size) throw new Error('terrain size mismatch');
    const res = await fetchImpl(vectorTileUrl(req.vectorUrl, z, x, y));
    let features = emptyFeatures();
    if (res.status !== 404 && res.status !== 204) {
      if (!res.ok) throw new Error(`vector tile ${res.status}`);
      const buf = await res.arrayBuffer();
      if (buf.byteLength) features = decodeVectorTile(buf, z, x, y);
    }
    const meshes = buildTileMeshes(features, heights, z, x, y, req.region, {
      hiddenFootprints: req.hiddenFootprints,
      lcSize: req.lcSize,
    });
    return { reply: { type: 'built', id, z, x, y, meshes }, transfer: transferables(meshes) };
  } catch (e) {
    return { reply: { type: 'error', id, z, x, y, message: e instanceof Error ? e.message : String(e) }, transfer: [] };
  }
}

// Register only inside a worker, so Node tests can import handleBuild.
const WorkerScope = (globalThis as { WorkerGlobalScope?: abstract new () => unknown }).WorkerGlobalScope;
if (WorkerScope && self instanceof WorkerScope) {
  self.onmessage = async (e: MessageEvent<BuildRequest>) => {
    if (e.data?.type !== 'build') return;
    const { reply, transfer } = await handleBuild(e.data);
    self.postMessage(reply, { transfer });
  };
}
