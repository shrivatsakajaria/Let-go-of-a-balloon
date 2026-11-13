/**
 * Worker mesh buffers to three.js geometry, and the faceted tree cone. Small and pure so they are
 * unit-tested in Node.
 */
import { BufferAttribute, BufferGeometry, ConeGeometry } from 'three';
import type { MeshBuffers } from '../world/terrain';

/** One sRGB channel (0..1) to linear light, the space three.js expects vertex colours in. */
export function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/**
 * Flat, non-indexed buffers to a BufferGeometry, or null when there are no triangles. Positions
 * and normals are used as they are (normals are already per face); colours arrive as sRGB and are
 * converted to linear in place, so the buffers must not be reused afterwards.
 */
export function toGeometry(b: MeshBuffers): BufferGeometry | null {
  const n = b.position.length / 3;
  if (n < 3) return null;
  if (b.normal.length !== b.position.length || b.color.length !== b.position.length) throw new Error('mesh buffers differ in length');
  const col = b.color;
  for (let i = 0; i < col.length; i++) col[i] = srgbToLinear(col[i]);
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(b.position, 3));
  g.setAttribute('normal', new BufferAttribute(b.normal, 3));
  g.setAttribute('color', new BufferAttribute(col, 3));
  g.computeBoundingSphere();
  return g;
}

/** Triangles in a non-indexed geometry (or indexed, by index count). */
export const triangleCount = (g: BufferGeometry): number => (g.index ? g.index.count : g.getAttribute('position').count) / 3;

/**
 * The Contour tree: a faceted cone standing on y = 0, sized in metres for the instance matrices
 * from placeTrees (scale about 1). Non-indexed so every facet is flat.
 */
export function treeGeometry(height = 11, radius = 3.4, facets = 7): BufferGeometry {
  const g = new ConeGeometry(radius, height, facets, 1, true);
  g.translate(0, height / 2, 0);
  const flat = g.toNonIndexed();
  g.dispose();
  flat.computeVertexNormals();
  return flat;
}
