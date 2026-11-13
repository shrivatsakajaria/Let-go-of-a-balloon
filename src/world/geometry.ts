/**
 * Worker mesh buffers to three.js geometry, and the faceted tree cone. Small and pure so they are
 * unit-tested in Node.
 */
import { Box3, BufferAttribute, BufferGeometry, ConeGeometry, Sphere, Vector3 } from 'three';
import type { MeshBuffers } from './terrain';
import type { PackedBuffers } from './meshjob';
import { srgbToLinear } from './color';

export { srgbToLinear };

const isPacked = (b: MeshBuffers | PackedBuffers): b is PackedBuffers => b.color instanceof Uint8Array;

/**
 * Flat, non-indexed buffers to a BufferGeometry, or null when there are no triangles. Positions and
 * normals are used as they are (normals are already per face).
 *  - Float buffers (the mesh job's own output): colours arrive as sRGB and are converted to linear
 *    in place, so the buffers must not be reused afterwards.
 *  - Packed buffers (the worker's `pack` option): 4-byte normals and linear 4-byte colours, already
 *    converted in the worker, used as they are.
 * With `slot`, every vertex also gets that `aSlot` (materials.ts); a `glow` buffer becomes `aGlow`.
 */
export function toGeometry(b: MeshBuffers | PackedBuffers, slot?: number): BufferGeometry | null {
  const n = b.position.length / 3;
  if (n < 3) return null;
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(b.position, 3));
  if (isPacked(b)) {
    if (b.normal.length !== n * 4 || b.color.length !== n * 4) throw new Error('mesh buffers differ in length');
    g.setAttribute('normal', new BufferAttribute(b.normal, 4, true));
    g.setAttribute('color', new BufferAttribute(b.color, 4, true));
  } else {
    if (b.normal.length !== b.position.length || b.color.length !== b.position.length) throw new Error('mesh buffers differ in length');
    const col = b.color;
    for (let i = 0; i < col.length; i++) col[i] = srgbToLinear(col[i]);
    g.setAttribute('normal', new BufferAttribute(b.normal, 3));
    g.setAttribute('color', new BufferAttribute(col, 3));
  }
  if (b.glow) {
    if (b.glow.length !== n) throw new Error('glow differs in length');
    g.setAttribute('aGlow', new BufferAttribute(b.glow, 1, true));
  }
  if (slot !== undefined) g.setAttribute('aSlot', new BufferAttribute(new Uint8Array(n).fill(slot), 1));
  const whole = isPacked(b) && b.bounds ? unionBox(b.bounds) : null;
  if (whole && !whole.isEmpty()) {
    // the worker measured it: no walk over every vertex here
    g.boundingBox = whole;
    g.boundingSphere = sphereOfBox(whole);
  } else g.computeBoundingSphere();
  return g;
}

/** The union of 6-float boxes (rangeBounds), skipping empty ones. */
export function unionBox(bounds: Float32Array, from = 0, to = bounds.length / 6, out = new Box3()): Box3 {
  out.makeEmpty();
  for (let k = from; k < to; k++) {
    const o = k * 6;
    if (!(bounds[o] <= bounds[o + 3])) continue;
    out.expandByPoint(new Vector3(bounds[o], bounds[o + 1], bounds[o + 2]));
    out.expandByPoint(new Vector3(bounds[o + 3], bounds[o + 4], bounds[o + 5]));
  }
  return out;
}

/** The sphere around a box (centre, half its diagonal). */
export function sphereOfBox(b: Box3): Sphere {
  const s = new Sphere();
  b.getCenter(s.center);
  s.radius = b.min.distanceTo(b.max) / 2;
  return s;
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

/**
 * Let three.js drop the JavaScript copy of each attribute once it is on the GPU (the bounding
 * sphere must already be computed). Saves the CPU memory of every tile on a phone.
 */
export function freeAfterUpload(g: BufferGeometry): void {
  for (const name of Object.keys(g.attributes)) {
    const a = g.attributes[name] as BufferAttribute;
    a.onUpload(function (this: BufferAttribute) {
      (this as unknown as { array: ArrayLike<number> | null }).array = null;
    });
  }
}

/**
 * The Contour ship: a chalk hull one unit long along +x (bow at +x), a low cabin aft and a pale
 * wake trailing behind on the water, flat-shaded with vertex colours (linear). Scaled by the
 * ship's length; about 50 triangles.
 */
export function boatGeometry(): BufferGeometry {
  const pos: number[] = [], col: number[] = [];
  const lin = (hex: string) => {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => srgbToLinear(v / 255));
  };
  const tri = (a: number[], b: number[], c: number[], colour: number[]) => {
    pos.push(...a, ...b, ...c);
    for (let k = 0; k < 3; k++) col.push(...colour);
  };
  const quad = (a: number[], b: number[], c: number[], d: number[], colour: number[]) => {
    tri(a, b, c, colour);
    tri(a, c, d, colour);
  };
  const hull = lin('#ebe3d4'), deck = lin('#f4efe5'), cabin = lin('#e3dac8'), wake = lin('#dce8ea');
  const top = 0.07, bottom = -0.02, w = 0.09;
  // deck outline, counter-clockwise seen from above (x east, z south): stern, sides, bow
  const outline = [[-0.5, w], [0.22, w], [0.5, 0], [0.22, -w], [-0.5, -w]];
  const at = (p: number[], y: number, shrink = 1) => [p[0] * shrink, y, p[1] * shrink];
  for (let i = 1; i + 1 < outline.length; i++) tri(at(outline[0], top), at(outline[i], top), at(outline[i + 1], top), deck);
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i], b = outline[(i + 1) % outline.length];
    quad(at(a, top), at(a, bottom, 0.92), at(b, bottom, 0.92), at(b, top), hull);
  }
  // cabin: a box aft
  const [x0, x1, z0, z1, y0, y1] = [-0.44, -0.2, -0.06, 0.06, top, top + 0.09];
  quad([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], cabin);
  quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], cabin);
  quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], cabin);
  quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], cabin);
  quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], cabin);
  // the wake: a long pale wedge on the water behind the stern
  tri([-0.5, 0.004, w * 1.1], [-2.6, 0.004, 0], [-0.5, 0.004, -w * 1.1], wake);
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(Float32Array.from(pos), 3));
  g.setAttribute('color', new BufferAttribute(Float32Array.from(col), 3));
  g.computeVertexNormals(); // non-indexed: one normal per face
  g.computeBoundingSphere();
  return g;
}
