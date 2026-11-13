/**
 * One built tile in the scene: a group holding one mesh per bucket and an instanced mesh of trees,
 * all on the shared Contour materials, tagged with the tile's slot (its fade and zoom, see
 * materials.ts). `dispose()` releases everything the tile owns: its geometries, the instance
 * buffers and its slot. The materials are shared and stay.
 */
import * as THREE from 'three';
import type { MeshBuffers } from './terrain';
import type { PackedBuffers } from './meshjob';
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
      if (o.freeArrays) freeAfterUpload(g);
      const mesh = new THREE.Mesh(g, set[bucket]);
      mesh.castShadow = o.castShadow && casts;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      this.group.add(mesh);
      this.meshes.push({ mesh, bucket });
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
