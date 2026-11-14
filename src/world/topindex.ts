/**
 * A coarse grid over a tile's tops ([x, z, radius, top] per item, tile-local metres), built once when the
 * tile is applied, so the camera's per-frame "what stands here" lookups scan only the few items near the
 * point instead of every building or tree on the tile. Compressed rows: cell (i, j) holds
 * items[start[k] .. start[k + 1]) with k = j * nx + i; an item is in every cell its circle touches.
 */
export const TOP_CELL_M = 32;

export type TopIndex = { tops: Float32Array; minX: number; minZ: number; nx: number; nz: number; start: Int32Array; items: Int32Array };

export function buildTopIndex(tops: Float32Array, cell = TOP_CELL_M): TopIndex | null {
  const n = tops.length / 4;
  if (n === 0) return null;
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = tops[i * 4], z = tops[i * 4 + 1], r = tops[i * 4 + 2];
    if (!Number.isFinite(x + z + r)) continue;
    minX = Math.min(minX, x - r); maxX = Math.max(maxX, x + r);
    minZ = Math.min(minZ, z - r); maxZ = Math.max(maxZ, z + r);
  }
  if (!Number.isFinite(minX)) return null;
  const nx = Math.max(1, Math.ceil((maxX - minX) / cell) + 1), nz = Math.max(1, Math.ceil((maxZ - minZ) / cell) + 1);
  const count = new Int32Array(nx * nz + 1);
  const span = (i: number, f: (k: number) => void) => {
    const x = tops[i * 4], z = tops[i * 4 + 1], r = tops[i * 4 + 2];
    if (!Number.isFinite(x + z + r)) return;
    const i0 = Math.floor((x - r - minX) / cell), i1 = Math.floor((x + r - minX) / cell);
    const j0 = Math.floor((z - r - minZ) / cell), j1 = Math.floor((z + r - minZ) / cell);
    for (let j = j0; j <= j1; j++) for (let ii = i0; ii <= i1; ii++) f(j * nx + ii);
  };
  for (let i = 0; i < n; i++) span(i, (k) => count[k + 1]++);
  for (let k = 1; k <= nx * nz; k++) count[k] += count[k - 1];
  const start = count;
  const fill = start.slice(0, nx * nz);
  const items = new Int32Array(start[nx * nz]);
  for (let i = 0; i < n; i++) span(i, (k) => { items[fill[k]++] = i; });
  return { tops, minX, minZ, nx, nz, start, items };
}

/** Highest top of the items within r of (x, z) (tile-local), or `best` if none is higher. No allocation. */
export function maxTopNear(ix: TopIndex, x: number, z: number, r: number, best: number): number {
  const { tops, minX, minZ, nx, nz, start, items } = ix;
  const i0 = Math.max(0, Math.floor((x - r - minX) / TOP_CELL_M)), i1 = Math.min(nx - 1, Math.floor((x + r - minX) / TOP_CELL_M));
  const j0 = Math.max(0, Math.floor((z - r - minZ) / TOP_CELL_M)), j1 = Math.min(nz - 1, Math.floor((z + r - minZ) / TOP_CELL_M));
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const k = j * nx + i;
      for (let m = start[k]; m < start[k + 1]; m++) {
        const o = items[m] * 4;
        const dx = tops[o] - x, dz = tops[o + 1] - z, rr = r + tops[o + 2];
        if (dx * dx + dz * dz <= rr * rr && tops[o + 3] > best) best = tops[o + 3];
      }
    }
  }
  return best;
}

/**
 * The item whose circle reaches nearest (x, z) within r (tile-local): its index into tops, or -1. For a
 * tree's crown: the one to step out of. No allocation.
 */
export function nearestNear(ix: TopIndex, x: number, z: number, r: number): number {
  const { tops, minX, minZ, nx, nz, start, items } = ix;
  const i0 = Math.max(0, Math.floor((x - r - minX) / TOP_CELL_M)), i1 = Math.min(nx - 1, Math.floor((x + r - minX) / TOP_CELL_M));
  const j0 = Math.max(0, Math.floor((z - r - minZ) / TOP_CELL_M)), j1 = Math.min(nz - 1, Math.floor((z + r - minZ) / TOP_CELL_M));
  let best = -1, bestGap = Infinity;
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const k = j * nx + i;
      for (let m = start[k]; m < start[k + 1]; m++) {
        const o = items[m] * 4;
        const gap = Math.hypot(tops[o] - x, tops[o + 1] - z) - tops[o + 2];
        if (gap <= r && gap < bestGap) {
          bestGap = gap;
          best = items[m];
        }
      }
    }
  }
  return best;
}
