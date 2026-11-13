/**
 * One built tile in the scene: a group holding one mesh per bucket and an instanced mesh of trees,
 * all on the shared Contour materials, tagged with the tile's slot (its fade and zoom, see
 * materials.ts). `dispose()` releases everything the tile owns: its geometries, the instance
 * buffers and its slot. The materials are shared and stay.
 */
import * as THREE from 'three';
import type { MeshBuffers } from './terrain';
import type { PackedBuffers, Quartered } from './meshjob';
import { freeAfterUpload, toGeometry, treeGeometry } from './geometry';
import type { Bucket, ContourMaterials } from './materials';

/** The Contour tree colours (the prototype's sage treeCols). */
export const TREE_COLOURS = ['#5f8f5a', '#527f50', '#6c9a62', '#4a7449'];

type Buffers = MeshBuffers | PackedBuffers;
export type TileBuffers = {
  ground: Buffers;
  water: Buffers;
  waterways: Buffers;
  roads: Buffers;
  buildings: Buffers;
  roofs: Buffers;
  /** Tree instance matrices, 16 floats each. */
  trees: Float32Array;
};

/** Mesh buckets in draw order, and whether they cast shadows (when the tile casts at all). */
const MESH_BUCKETS: [Exclude<Bucket, 'trees'>, boolean][] = [
  ['ground', false],
  ['water', false],
  ['waterways', false],
  ['roads', false],
  ['buildings', true],
  ['roofs', true],
];

let sharedTree: THREE.BufferGeometry | null = null;

/**
 * The layer of shadow-only meshes: a sun whose shadow camera has it enabled draws them into the
 * shadow map (sunlight.ts); the view camera, on layer 0 only, never draws them.
 */
export const SHADOW_LAYER = 1;

/**
 * A geometry over vertices [start, start + count) of g, sharing its attributes, with the bounding
 * sphere of that range only (for culling).
 */
function rangeOf(g: THREE.BufferGeometry, start: number, count: number): THREE.BufferGeometry {
  const sub = new THREE.BufferGeometry();
  for (const name of Object.keys(g.attributes)) sub.setAttribute(name, g.attributes[name]);
  sub.setDrawRange(start, count);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  for (let i = start; i < start + count; i++) box.expandByPoint(v.fromBufferAttribute(pos, i));
  sub.boundingBox = box.clone();
  const sphere = new THREE.Sphere();
  box.getCenter(sphere.center);
  let r2 = 0;
  for (let i = start; i < start + count; i++) r2 = Math.max(r2, sphere.center.distanceToSquared(v.fromBufferAttribute(pos, i)));
  sphere.radius = Math.sqrt(r2);
  sub.boundingSphere = sphere;
  return sub;
}

const worldBox = new THREE.Box3();

/**
 * Cull by the mesh's bounding box instead of its sphere. A tile piece is wide and flat; its sphere
 * reaches hundreds of metres above and below it, which the low sun's thin shadow box (and the view
 * from above) then keeps in for nothing. Tiles are only moved and scaled, so the box stays tight.
 */
function boxInFrustum(this: THREE.Mesh, frustum: THREE.Frustum): boolean {
  const b = this.geometry.boundingBox;
  if (!b) return frustum.intersectsObject(this);
  return frustum.intersectsBox(worldBox.copy(b).applyMatrix4(this.matrixWorld));
}

/** Non-empty vertex ranges [start, count] of a parts list taken `step` cells at a time. */
function ranges(parts: Uint32Array, step: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i + step < parts.length; i += step) if (parts[i + step] > parts[i]) out.push([parts[i], parts[i + step] - parts[i]]);
  return out;
}

export type TileViewOptions = {
  zoom: number;
  /** Buildings, roofs and trees cast shadows. */
  castShadow: boolean;
  /** Start on the clip variant (coarse tiles, and tiles dissolving in over a coarser one). */
  clip: boolean;
  /** Dissolve in with the dither instead of fading from the haze. */
  dither?: boolean;
  /** Drop the JavaScript copy of each buffer once it is on the GPU. */
  freeArrays?: boolean;
};

export class TileView {
  readonly group = new THREE.Group();
  readonly slot: number;
  readonly triangles: number;
  private readonly meshes: { mesh: THREE.Mesh; bucket: Bucket }[] = [];
  private readonly materials: ContourMaterials;
  private clipped: boolean;
  private disposed = false;

  constructor(b: TileBuffers, materials: ContourMaterials, o: TileViewOptions) {
    this.materials = materials;
    const slot = materials.slots.alloc(o.zoom, !!o.dither);
    if (slot < 0) throw new Error('no free tile slot');
    this.slot = slot;
    this.clipped = o.clip;
    const set = o.clip ? materials.clip : materials.solid;
    let tris = 0;
    for (const [bucket, casts] of MESH_BUCKETS) {
      const g = toGeometry(b[bucket], slot);
      if (!g) continue;
      tris += g.getAttribute('position').count / 3;
      // A bucket sorted by cell (meshjob splitCells): one mesh per quarter in view, and when it
      // casts, one shadow-only mesh per sixteenth (the low sun's long thin box then takes few).
      // They all share the one set of buffers.
      const parts = (b[bucket] as Quartered).parts;
      const shadows = o.castShadow && casts;
      const quarterGeos = parts?.length === 17 ? ranges(parts, 4).map(([a, n]) => rangeOf(g, a, n)) : [g];
      const shadowGeos = parts?.length === 17 && shadows ? ranges(parts, 1).map(([a, n]) => rangeOf(g, a, n)) : [];
      if (o.freeArrays) freeAfterUpload(g);
      for (const geo of quarterGeos) this.add(geo, set[bucket], bucket, shadows && shadowGeos.length === 0);
      for (const geo of shadowGeos) this.add(geo, set[bucket], bucket, true).layers.set(SHADOW_LAYER);
    }
    const count = b.trees.length / 16;
    if (count > 0) {
      sharedTree ??= treeGeometry();
      const geo = sharedTree.clone(); // 21 vertices: each tile owns its copy, so disposing it frees nothing shared
      geo.setAttribute('aSlot', new THREE.InstancedBufferAttribute(new Uint8Array(count).fill(slot), 1));
      const trees = new THREE.InstancedMesh(geo, set.trees, count);
      trees.instanceMatrix = new THREE.InstancedBufferAttribute(b.trees, 16);
      const c = new THREE.Color();
      for (let i = 0; i < count; i++) {
        const h = Math.abs(Math.sin(b.trees[i * 16 + 12] * 12.9898 + b.trees[i * 16 + 14] * 78.233) * 43758.5453) % 1;
        trees.setColorAt(i, c.set(TREE_COLOURS[Math.floor(h * TREE_COLOURS.length)]));
      }
      trees.computeBoundingSphere();
      trees.castShadow = o.castShadow;
      trees.receiveShadow = true;
      trees.matrixAutoUpdate = false;
      tris += count * (sharedTree.getAttribute('position').count / 3);
      this.group.add(trees);
      this.meshes.push({ mesh: trees, bucket: 'trees' });
    }
    this.triangles = tris;
  }

  private add(geo: THREE.BufferGeometry, material: THREE.Material, bucket: Bucket, castShadow: boolean): THREE.Mesh {
    if (!geo.boundingBox) geo.computeBoundingBox();
    const mesh = new THREE.Mesh(geo, material);
    mesh.intersectsFrustum = boxInFrustum;
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    this.group.add(mesh);
    this.meshes.push({ mesh, bucket });
    return mesh;
  }

  /** Switch between the clip and the solid material variants. */
  setClip(clip: boolean): void {
    if (clip === this.clipped) return;
    this.clipped = clip;
    const set = clip ? this.materials.clip : this.materials.solid;
    for (const m of this.meshes) m.mesh.material = set[m.bucket];
  }

  get clip(): boolean {
    return this.clipped;
  }

  /** Fade 0..1 (from the haze, or dissolving with the dither). */
  setFade(fade: number, dither?: boolean): void {
    this.materials.slots.set(this.slot, fade, dither);
  }

  /** Place the tile's frame in the scene: south-west corner at (x, y, z), local x scaled by scaleX. */
  place(x: number, y: number, z: number, scaleX: number): void {
    this.group.position.set(x, y, z);
    this.group.scale.set(scaleX, 1, 1);
    this.group.updateMatrix();
    this.group.updateMatrixWorld(true);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.group.removeFromParent();
    for (const { mesh, bucket } of this.meshes) {
      mesh.geometry.dispose();
      if (bucket === 'trees') (mesh as THREE.InstancedMesh).dispose(); // instance matrices and colours
    }
    this.meshes.length = 0;
    this.materials.slots.release(this.slot);
  }
}
