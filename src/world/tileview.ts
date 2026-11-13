/**
 * One built tile in the scene: a group holding one mesh per bucket and an instanced mesh of trees,
 * all on the shared Contour materials, tagged with the tile's slot (its fade and zoom, see
 * materials.ts). `dispose()` releases everything the tile owns: its geometries, the instance
 * buffers and its slot. The materials are shared and stay.
 */
import * as THREE from 'three';
import type { MeshBuffers } from './terrain';
import type { PackedBuffers, Quartered } from './meshjob';
import { boatGeometry, freeAfterUpload, sphereOfBox, toGeometry, treeGeometry, unionBox } from './geometry';
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
  /** Street lamps, [x, y, z] each (y the ground): drawn as points at night. */
  lamps?: Float32Array;
  /** Ships, glow.ts BOAT_STRIDE floats each: x, y, z, heading, length. */
  boats?: Float32Array;
};

/** Mesh buckets in draw order, and whether they cast shadows (when the tile casts at all). */
const MESH_BUCKETS: [Exclude<Bucket, 'trees' | 'boats'>, boolean][] = [
  ['ground', false],
  ['water', false],
  ['waterways', false],
  ['roads', false],
  ['buildings', true],
  ['roofs', true],
];

let sharedTree: THREE.BufferGeometry | null = null;
let sharedBoat: THREE.BufferGeometry | null = null;
let treeColours: THREE.Color[] | null = null;
/** Lamps show from this night factor on. */
const LAMPS_FROM = 0.03;

/**
 * The layer of shadow-only meshes: a sun whose shadow camera has it enabled draws them into the
 * shadow map (sunlight.ts); the view camera, on layer 0 only, never draws them.
 */
export const SHADOW_LAYER = 1;

/**
 * A geometry over vertices [start, start + count) of g, sharing its attributes, with the bounds of
 * that range only (for culling): from the worker's cell boxes when given, else measured.
 */
function rangeOf(g: THREE.BufferGeometry, start: number, count: number, box?: THREE.Box3): THREE.BufferGeometry {
  const sub = new THREE.BufferGeometry();
  for (const name of Object.keys(g.attributes)) sub.setAttribute(name, g.attributes[name]);
  sub.setDrawRange(start, count);
  if (!box || box.isEmpty()) {
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    const v = new THREE.Vector3();
    box = new THREE.Box3();
    for (let i = start; i < start + count; i++) box.expandByPoint(v.fromBufferAttribute(pos, i));
  }
  sub.boundingBox = box;
  sub.boundingSphere = sphereOfBox(box);
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

/** Geometries over the non-empty ranges of a parts list taken `step` cells at a time. */
function ranges(g: THREE.BufferGeometry, parts: Uint32Array, step: number, bounds?: Float32Array): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  for (let i = 0; i + step < parts.length; i += step) {
    if (parts[i + step] <= parts[i]) continue;
    const box = bounds && bounds.length === (parts.length - 1) * 6 ? unionBox(bounds, i, i + step) : undefined;
    out.push(rangeOf(g, parts[i], parts[i + step] - parts[i], box));
  }
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
  private lamps: THREE.Points | null = null;
  /** Tree instance matrices (tile frame), kept for the shadow-only copy of the trees near the focus. */
  private treeData: Float32Array | null = null;
  private treeShadow: THREE.InstancedMesh | null = null;
  private readonly casts: boolean;
  private clipped: boolean;
  private disposed = false;

  constructor(b: TileBuffers, materials: ContourMaterials, o: TileViewOptions) {
    this.materials = materials;
    const slot = materials.slots.alloc(o.zoom, !!o.dither);
    if (slot < 0) throw new Error('no free tile slot');
    this.slot = slot;
    this.clipped = o.clip;
    this.casts = o.castShadow;
    try {
      this.triangles = this.build(b, o);
    } catch (e) {
      // nothing half-built stays behind: geometries freed, the slot back
      this.dispose();
      throw e;
    }
  }

  private build(b: TileBuffers, o: TileViewOptions): number {
    const slot = this.slot;
    const set = o.clip ? this.materials.clip : this.materials.solid;
    let tris = 0;
    for (const [bucket, casts] of MESH_BUCKETS) {
      const g = toGeometry(b[bucket], slot);
      if (!g) continue;
      tris += g.getAttribute('position').count / 3;
      // A bucket sorted by cell (meshjob splitCells): one mesh per quarter in view, and when it
      // casts, one shadow-only mesh per sixteenth (the low sun's long thin box then takes few).
      // They all share the one set of buffers.
      const parts = (b[bucket] as Quartered).parts;
      const bounds = (b[bucket] as Partial<PackedBuffers>).bounds;
      const shadows = o.castShadow && casts;
      const quarterGeos = parts?.length === 17 ? ranges(g, parts, 4, bounds) : [g];
      const shadowGeos = parts?.length === 17 && shadows ? ranges(g, parts, 1, bounds) : [];
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
      treeColours ??= TREE_COLOURS.map((hex) => new THREE.Color(hex));
      for (let i = 0; i < count; i++) {
        const h = Math.abs(Math.sin(b.trees[i * 16 + 12] * 12.9898 + b.trees[i * 16 + 14] * 78.233) * 43758.5453) % 1;
        trees.setColorAt(i, treeColours[Math.floor(h * treeColours.length)]);
      }
      trees.computeBoundingSphere();
      // a whole tile of trees is tens of thousands of triangles in the shadow pass: only the ones
      // near the balloon cast (shadowTreesNear), from a copy on the shadow layer
      trees.castShadow = false;
      if (o.castShadow) this.treeData = b.trees;
      trees.receiveShadow = true;
      trees.matrixAutoUpdate = false;
      tris += count * (sharedTree.getAttribute('position').count / 3);
      this.group.add(trees);
      this.meshes.push({ mesh: trees, bucket: 'trees' });
    }
    const boats = b.boats && b.boats.length >= 5 ? b.boats : null;
    if (boats) {
      const n = Math.floor(boats.length / 5);
      sharedBoat ??= boatGeometry();
      const geo = sharedBoat.clone();
      geo.setAttribute('aSlot', new THREE.InstancedBufferAttribute(new Uint8Array(n).fill(slot), 1));
      const mesh = new THREE.InstancedMesh(geo, set.boats, n);
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
      const up = new THREE.Vector3(0, 1, 0);
      for (let i = 0; i < n; i++) {
        const k = i * 5;
        q.setFromAxisAngle(up, boats[k + 3]);
        mesh.setMatrixAt(i, m.compose(p.set(boats[k], boats[k + 1], boats[k + 2]), q, s.setScalar(boats[k + 4])));
      }
      mesh.computeBoundingSphere();
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      tris += n * (sharedBoat.getAttribute('position').count / 3);
      this.group.add(mesh);
      this.meshes.push({ mesh, bucket: 'boats' });
    }
    if (b.lamps && b.lamps.length >= 3) {
      const n = Math.floor(b.lamps.length / 3);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(b.lamps.subarray(0, n * 3), 3));
      geo.setAttribute('aSlot', new THREE.BufferAttribute(new Uint8Array(n).fill(slot), 1));
      geo.computeBoundingSphere();
      if (o.freeArrays) freeAfterUpload(geo);
      const pts = new THREE.Points(geo, this.materials.lamps);
      pts.matrixAutoUpdate = false;
      pts.visible = false;
      pts.renderOrder = 2;
      this.group.add(pts);
      this.lamps = pts;
    }
    return tris;
  }

  /** Night 0..1: the street lamps show from dusk (their brightness is in the shared material). */
  setNight(night: number): void {
    if (this.lamps) this.lamps.visible = night > LAMPS_FROM;
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

  /**
   * Trees within `r` metres of scene point (x, z) cast shadows (a shadow-only copy of just those, on
   * SHADOW_LAYER); the rest of the tile's trees cast none. For tiles that cast shadows; call when the
   * shadow focus moves and after `place`.
   */
  shadowTreesNear(x: number, z: number, r: number): void {
    const data = this.treeData;
    if (!this.casts || !data || this.disposed) return;
    const n = data.length / 16;
    let mesh = this.treeShadow;
    if (!mesh) {
      sharedTree ??= treeGeometry();
      const geo = sharedTree.clone();
      geo.setAttribute('aSlot', new THREE.InstancedBufferAttribute(new Uint8Array(n).fill(this.slot), 1));
      mesh = new THREE.InstancedMesh(geo, (this.clipped ? this.materials.clip : this.materials.solid).trees, n);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.layers.set(SHADOW_LAYER);
      mesh.castShadow = true;
      mesh.receiveShadow = false;
      mesh.matrixAutoUpdate = false;
      mesh.boundingSphere = new THREE.Sphere();
      this.group.add(mesh);
      mesh.updateMatrixWorld(true);
      this.meshes.push({ mesh, bucket: 'trees' });
      this.treeShadow = mesh;
    }
    // the focus in the tile's frame (tiles are only moved and scaled along x)
    const g = this.group;
    const lx = (x - g.position.x) / g.scale.x, lz = z - g.position.z;
    const rx = r / g.scale.x, r2 = r * r;
    const out = mesh.instanceMatrix.array as Float32Array;
    let k = 0, y0 = Infinity, y1 = -Infinity;
    for (let i = 0; i < n; i++) {
      const dx = (data[i * 16 + 12] - lx) * g.scale.x, dz = data[i * 16 + 14] - lz;
      if (dx * dx + dz * dz > r2) continue;
      out.set(data.subarray(i * 16, i * 16 + 16), k * 16);
      y0 = Math.min(y0, data[i * 16 + 13]);
      y1 = Math.max(y1, data[i * 16 + 13]);
      k++;
    }
    mesh.count = k;
    mesh.visible = k > 0;
    mesh.instanceMatrix.clearUpdateRanges();
    mesh.instanceMatrix.addUpdateRange(0, k * 16);
    mesh.instanceMatrix.needsUpdate = true;
    // trees stand up to ~15 m tall and ~5 m wide round their point
    mesh.boundingSphere!.center.set(lx, k ? (y0 + y1) / 2 : 0, lz);
    mesh.boundingSphere!.radius = Math.max(rx, r) + (k ? (y1 - y0) / 2 : 0) + 20;
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
      if (bucket === 'trees' || bucket === 'boats') (mesh as THREE.InstancedMesh).dispose(); // instance matrices and colours
    }
    this.meshes.length = 0;
    this.lamps?.geometry.dispose();
    this.lamps = null;
    this.materials.slots.release(this.slot);
  }
}
