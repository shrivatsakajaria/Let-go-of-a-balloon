/**
 * The landmark layer: shows the landmarks near the focus (the camera's ground point) in the
 * streamed world, and drops them when the focus is far.
 *
 * - Every SCAN_M of movement it asks the registry which sites are within LOAD_KM; their models are
 *   imported (lazily, once) and built, and the groups go into the scene. Past DROP_KM a group is
 *   removed and its geometry freed (the model's code stays loaded).
 * - Each frame (update) every group stands on the drawn ground at its site through the stream's
 *   floating origin (toScene), turned to its heading; the ground is eased as finer tiles arrive,
 *   and a landmark waits out of sight until its street's fine tile is in (as the person does).
 * - The meshes are drawn with the stream's shared Contour materials (walls with windows, plain
 *   stone and roofs), so they take the real sun, the haze and the night like the map; the glow
 *   bucket (clock faces) has its own material whose emissive follows the night from dusk.
 *   A new landmark fades in from the haze through a tile slot, like a tile.
 * - topAt gives the highest landmark top near a point, from a coarse height grid made at build,
 *   so the camera keeps out of them (the stream's buildingTopAt does not know them: their map
 *   buildings are hidden).
 *
 * update() and topAt() do not allocate (apart from the scans every SCAN_M).
 */
import * as THREE from 'three';
import { lonDelta, type LatLon } from '../geo/coords';
import { M_PER_DEG } from '../world/frame';
import { SLOT_ALWAYS, WINDOW_LIGHT, type ContourMaterials } from '../world/materials';
import { regionStyle as defaultRegion, type Light, type RegionStyle } from '../world/palette';
import { MODELS, SITES, loadLandmark, sitesNear } from './registry';
import type { Landmark, LandmarkBucket, LandmarkModel, LandmarkSite } from './types';

const D2R = Math.PI / 180;
/** Load the landmarks within this distance of the focus (km): the haze closes in at about 12 km from cruise. */
export const LOAD_KM = 14;
/** Drop them past this (km). */
export const DROP_KM = 20;
/** Look again for landmarks after the focus has moved this far (m). */
const SCAN_M = 300;
/** Height grid cell (m). */
const CELL_M = 6;

export type LandmarkHost = {
  scene: THREE.Object3D;
  toScene(p: LatLon, out?: { x: number; z: number }): { x: number; z: number };
  /** The drawn ground at p (m). */
  groundAt(p: LatLon): number;
  /** Zoom of the finest tile in at p (-1 none). Optional: without it a landmark shows at once. */
  zoomAt?(p: LatLon): number;
  materials: ContourMaterials;
};

export type LayerOptions = {
  sites?: LandmarkSite[];
  models?: Record<string, () => Promise<LandmarkModel>>;
  region?: (p: LatLon) => RegionStyle;
  /** Milliseconds clock for the fades (default performance.now). */
  now?: () => number;
  fadeMs?: number;
};

type Tops = { minX: number; minZ: number; nx: number; nz: number; h: Float32Array; reach: number };

type Entry = {
  site: LandmarkSite;
  state: 'loading' | 'shown';
  landmark: Landmark | null;
  group: THREE.Group | null;
  slot: number;
  born: number;
  fade: number;
  groundS: number;
  placedAt: number;
  tops: Tops | null;
};

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export class LandmarkLayer {
  /** A landmark appeared or left: shadows may need redrawing. */
  onChange: (() => void) | null = null;

  private readonly host: LandmarkHost;
  private readonly sites: LandmarkSite[];
  private readonly models: Record<string, () => Promise<LandmarkModel>>;
  private readonly region: (p: LatLon) => RegionStyle;
  private readonly now: () => number;
  private readonly fadeMs: number;
  private readonly entries = new Map<string, Entry>();
  private readonly glow: THREE.MeshStandardMaterial;
  private readonly tmp = { x: 0, z: 0 };
  private lastScan: LatLon | null = null;
  private lastTime = 0;
  private disposed = false;

  constructor(host: LandmarkHost, opts: LayerOptions = {}) {
    this.host = host;
    this.sites = opts.sites ?? SITES;
    this.models = opts.models ?? MODELS;
    this.region = opts.region ?? defaultRegion;
    this.now = opts.now ?? (() => performance.now());
    this.fadeMs = opts.fadeMs ?? 600;
    this.glow = host.materials.extra('landmark-glow', { roughness: 0.6 });
    this.glow.emissive.setRGB(WINDOW_LIGHT[0], WINDOW_LIGHT[1], WINDOW_LIGHT[2]);
    this.glow.emissiveIntensity = 0;
  }

  /** Call every frame: the focus (camera ground point), the time (UTC ms) and the light of the moment. */
  update(focus: LatLon, utcMs: number, light: Light): void {
    if (this.disposed) return;
    const t = this.now();
    const dt = Math.min(0.25, Math.max(0, (t - this.lastTime) / 1000));
    this.lastTime = t;
    const s = this.lastScan;
    if (!s || Math.abs(focus.lat - s.lat) * M_PER_DEG > SCAN_M || Math.abs(lonDelta(s.lon, focus.lon)) * M_PER_DEG * Math.cos(focus.lat * D2R) > SCAN_M) {
      this.lastScan = { lat: focus.lat, lon: focus.lon };
      this.scan(focus);
    }
    // clock faces and lanterns: dark by day, lit from about sunset, full by the end of dusk
    this.glow.emissiveIntensity = 1.8 * smooth(0.06, 0.4, light.night);
    for (const e of this.entries.values()) {
      if (e.state !== 'shown') continue;
      this.place(e, t, dt);
      if (e.group!.visible) e.landmark!.animate?.(e.group!, utcMs, light);
    }
  }

  /** The highest landmark top (absolute, like the stream's groundAt) within radiusM of p; -Infinity where there is none. */
  topAt(p: LatLon, radiusM: number): number {
    let best = -Infinity;
    for (const e of this.entries.values()) {
      const tp = e.tops;
      if (e.state !== 'shown' || !tp || !e.group!.visible) continue;
      const site = e.site;
      const east = lonDelta(site.at.lon, p.lon) * M_PER_DEG * Math.cos(site.at.lat * D2R);
      const south = -(p.lat - site.at.lat) * M_PER_DEG;
      if (east * east + south * south > (tp.reach + radiusM) ** 2) continue;
      const h = site.headingDeg * D2R, c = Math.cos(h), sn = Math.sin(h);
      const x = east * c + south * sn, z = -east * sn + south * c;
      const i0 = Math.max(0, Math.floor((x - radiusM - tp.minX) / CELL_M)), i1 = Math.min(tp.nx - 1, Math.floor((x + radiusM - tp.minX) / CELL_M));
      const j0 = Math.max(0, Math.floor((z - radiusM - tp.minZ) / CELL_M)), j1 = Math.min(tp.nz - 1, Math.floor((z + radiusM - tp.minZ) / CELL_M));
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const v = tp.h[j * tp.nx + i];
          if (v > -Infinity && v + e.groundS > best) best = v + e.groundS;
        }
      }
    }
    return best;
  }

  /** Ids of the landmarks in the scene (for checks). */
  shown(): string[] {
    const out: string[] = [];
    for (const e of this.entries.values()) if (e.state === 'shown') out.push(e.site.id);
    return out;
  }

  /** The group of a landmark in the scene, or null. */
  groupOf(id: string): THREE.Group | null {
    return this.entries.get(id)?.group ?? null;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const e of [...this.entries.values()]) this.drop(e);
    this.entries.clear();
    this.glow.dispose();
  }

  // ---- internals ----

  private scan(focus: LatLon): void {
    const near = sitesNear(focus, LOAD_KM, this.sites);
    for (const site of near) {
      if (this.entries.has(site.id)) continue;
      const e: Entry = { site, state: 'loading', landmark: null, group: null, slot: SLOT_ALWAYS, born: NaN, fade: 0, groundS: NaN, placedAt: 0, tops: null };
      this.entries.set(site.id, e);
      loadLandmark(site, this.models).then(
        (l) => {
          if (this.disposed || this.entries.get(site.id) !== e) return;
          this.show(e, l);
        },
        (err: Error) => {
          // offline or a broken module: forget it, so a later scan tries again
          if (this.entries.get(site.id) === e) this.entries.delete(site.id);
          console.warn(`landmark ${site.id}: ${err?.message ?? err}`);
        },
      );
    }
    const keep = new Set(sitesNear(focus, DROP_KM, this.sites).map((s) => s.id));
    for (const e of [...this.entries.values()]) if (!keep.has(e.site.id)) this.drop(e);
  }

  private show(e: Entry, l: Landmark): void {
    const group = l.build(this.region(l.at));
    group.name = l.id;
    group.userData.landmark = l.id;
    const slot = this.host.materials.slots.alloc(99);
    e.slot = slot < 0 ? SLOT_ALWAYS : slot;
    const m = this.host.materials.solid;
    group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const b = mesh.userData.bucket as LandmarkBucket;
      mesh.material = b === 'walls' ? m.buildings : b === 'glow' ? this.glow : m.roofs;
      const n = mesh.geometry.getAttribute('position').count;
      mesh.geometry.setAttribute('aSlot', new THREE.BufferAttribute(new Uint8Array(n).fill(e.slot), 1));
    });
    group.rotation.y = -l.headingDeg * D2R;
    group.visible = false;
    e.tops = heightGrid(group);
    e.landmark = l;
    e.group = group;
    e.state = 'shown';
    e.born = NaN;
    e.placedAt = this.now();
    this.host.scene.add(group);
  }

  private place(e: Entry, t: number, dt: number): void {
    const g = e.group!;
    const at = e.site.at;
    // until the street's own tile is in, the ground there is a guess: wait out of sight (6 s at most)
    const fine = !this.host.zoomAt || this.host.zoomAt(at) >= 13 || t - e.placedAt > 6000;
    const ground = this.host.groundAt(at);
    e.groundS = Number.isNaN(e.groundS) || !g.visible || Math.abs(ground - e.groundS) > 50 ? ground : e.groundS + (ground - e.groundS) * (1 - Math.exp(-dt / 0.6));
    const s = this.host.toScene(at, this.tmp);
    g.position.set(s.x, e.groundS, s.z);
    if (!fine) return;
    if (!g.visible) {
      g.visible = true;
      e.born = t;
      this.onChange?.();
    }
    if (e.fade < 1) {
      e.fade = Math.min(1, (t - e.born) / this.fadeMs);
      if (e.slot !== SLOT_ALWAYS) this.host.materials.slots.set(e.slot, e.fade);
      if (e.fade === 1) this.onChange?.();
    }
  }

  private drop(e: Entry): void {
    this.entries.delete(e.site.id);
    if (e.group) {
      this.host.scene.remove(e.group);
      e.group.traverse((o) => (o as THREE.Mesh).isMesh && (o as THREE.Mesh).geometry.dispose());
      e.group = null;
      this.onChange?.();
    }
    if (e.slot !== SLOT_ALWAYS) this.host.materials.slots.release(e.slot);
    e.slot = SLOT_ALWAYS;
  }
}

/**
 * A coarse height grid over a model (its own frame, before the heading turn): the highest point of
 * every triangle in each CELL_M cell its plan bounds touch, -Infinity where there is nothing.
 */
function heightGrid(group: THREE.Group): Tops {
  group.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const m = new THREE.Matrix4();
  const box = new THREE.Box3();
  const meshes: THREE.Mesh[] = [];
  group.traverse((o) => (o as THREE.Mesh).isMesh && meshes.push(o as THREE.Mesh));
  for (const mesh of meshes) box.union(new THREE.Box3().setFromObject(mesh).applyMatrix4(inv));
  const minX = Math.floor(box.min.x), minZ = Math.floor(box.min.z);
  const nx = Math.max(1, Math.ceil((box.max.x - minX) / CELL_M)), nz = Math.max(1, Math.ceil((box.max.z - minZ) / CELL_M));
  const h = new Float32Array(nx * nz).fill(-Infinity);
  const v = new THREE.Vector3();
  const tri = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  for (const mesh of meshes) {
    m.multiplyMatrices(inv, mesh.matrixWorld);
    const p = mesh.geometry.getAttribute('position');
    for (let i = 0; i + 2 < p.count; i += 3) {
      for (let k = 0; k < 3; k++) tri[k].fromBufferAttribute(p, i + k).applyMatrix4(m);
      const top = Math.max(tri[0].y, tri[1].y, tri[2].y);
      const i0 = Math.floor((Math.min(tri[0].x, tri[1].x, tri[2].x) - minX) / CELL_M), i1 = Math.floor((Math.max(tri[0].x, tri[1].x, tri[2].x) - minX) / CELL_M);
      const j0 = Math.floor((Math.min(tri[0].z, tri[1].z, tri[2].z) - minZ) / CELL_M), j1 = Math.floor((Math.max(tri[0].z, tri[1].z, tri[2].z) - minZ) / CELL_M);
      for (let j = Math.max(0, j0); j <= Math.min(nz - 1, j1); j++) for (let ii = Math.max(0, i0); ii <= Math.min(nx - 1, i1); ii++) if (top > h[j * nx + ii]) h[j * nx + ii] = top;
    }
  }
  v.set(Math.max(-box.min.x, box.max.x), 0, Math.max(-box.min.z, box.max.z));
  return { minX, minZ, nx, nz, h, reach: v.length() };
}
