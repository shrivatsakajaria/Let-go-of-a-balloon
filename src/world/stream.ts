/**
 * The streaming world: keeps the map tiles a moving camera needs (lod.ts) built, placed and faded
 * in, from street level to wide replay shots, over a 2,600 km flight.
 *
 * - Floating origin: scene metres are measured from `origin` (x east, y up, z = -north), with
 *   longitude scaled at the origin's latitude and taken through lonDelta, so the scene is
 *   continuous across the date line. When the camera's ground point drifts more than ~5 km from
 *   the origin, the origin moves there and every tile is placed again (float precision stays at
 *   millimetres); `onRecentre` tells the balloon and the camera to shift too. Each tile's own frame
 *   (frame.ts) lands at an offset plus a scale of x, so tiles meet edge to edge exactly.
 * - Builds run in the worker pool, at most MAX_IN_FLIGHT at once, nearest first. A tile that leaves
 *   the wanted set before its build ends is cancelled (its late reply is ignored).
 * - At most MAX_TILES alive. A tile that leaves stays until coarser land under it is in, so the
 *   ground never opens.
 * - New tiles fade in over 400 ms: from the haze colour where nothing is under them (the world
 *   fades in from the haze outwards, never grey squares), or dissolving in over the coarser land
 *   they replace. Coarser levels sit a little lower and are clipped where a finer level is drawn
 *   (coverage.ts), and skirts close every edge.
 * - groundAt / buildingTopAt read the finest loaded tile, with no allocation per call.
 */
import * as THREE from 'three';
import { lonDelta, tileBounds, wrapLon, type LatLon } from '../geo/coords';
import { M_PER_DEG, tileFrame } from './frame';
import { CoverageMap } from './coverage';
import { createHaze, type HazeUniforms } from './haze';
import { ContourMaterials } from './materials';
import { lightFor, type RegionStyle } from './palette';
import { groundHeightAt, type GroundGrid } from './terrain';
import { TileView } from './tileview';
import { MAX_IN_FLIGHT, MAX_TILES, levelFor, tileKey, tilesFor, type LodCamera, type LodLevel, type TileKey } from './lod';
import type { BuildReply, BuildRequest } from './worker';
import type { HiddenFootprint } from './meshjob';
import { vectorTileTemplate } from './vector';

/** The parts of WorkerPool the stream uses. */
export type BuildPool = {
  request(msg: Omit<BuildRequest, 'id'>, transfer?: Transferable[], opts?: { signal?: AbortSignal }): Promise<BuildReply>;
};

export type RecentreEvent = {
  from: LatLon;
  to: LatLon;
  /** Where the new origin was in the old scene frame: subtract to shift a position near it. */
  dx: number;
  dz: number;
  /** Exact old scene position to new (the x scale changes slightly with the origin's latitude). */
  remap(x: number, z: number): { x: number; z: number };
};

export type StreamOptions = {
  /** OpenFreeMap {z}/{x}/{y} template, or how to get it (default: read the TileJSON once). */
  vectorUrl?: string | (() => Promise<string>);
  /** Shared haze uniforms (sky dome and materials); default from a mid-day light. */
  haze?: HazeUniforms;
  groundTint?: string;
  origin?: LatLon;
  /** Milliseconds clock (default performance.now). */
  now?: () => number;
  maxTiles?: number;
  maxInFlight?: number;
  /** Re-centre when the focus is this far from the origin (m). */
  recentreM?: number;
  fadeMs?: number;
  /** Ground height where no tile is loaded (default: the route's coarse ground, else 0). */
  fallbackGround?: (p: LatLon) => number | undefined;
  /** Landmark footprints whose map buildings are not drawn. */
  hidden?: HiddenFootprint[];
};

type Ground = GroundGrid & { south: number; north: number; west: number; dLon: number; mLon: number };

type Entry = {
  key: string;
  t: TileKey;
  level: LodLevel;
  state: 'loading' | 'live' | 'leaving';
  ac: AbortController | null;
  view: TileView | null;
  born: number;
  fade: number;
  dither: boolean;
  settled: boolean;
  wanted: boolean;
  ground: Ground | null;
  tops: Float32Array | null;
};

export type StreamStats = {
  alive: number;
  loading: number;
  live: number;
  leaving: number;
  settled: number;
  hidden: number;
  failed: number;
  built: number;
  cancelled: number;
  /** Triangles in the live tiles (drawn or not). */
  triangles: number;
  recentres: number;
  /** Tiles the camera wants now. */
  wanted: number;
  /** Every wanted tile is in and faded in, nothing is loading or leaving: the view is complete. */
  ready: boolean;
};

const ease = (x: number) => 1 - Math.pow(2, -10 * Math.min(1, Math.max(0, x)));
const D2R = Math.PI / 180;

export class WorldStream {
  readonly coverage: CoverageMap;
  readonly materials: ContourMaterials;
  readonly haze: HazeUniforms;
  origin: LatLon;
  onRecentre: ((e: RecentreEvent) => void) | null = null;
  /** A tile appeared, settled or left: shadows may need redrawing. */
  onChange: (() => void) | null = null;

  private readonly scene: THREE.Scene;
  private readonly pool: BuildPool;
  private readonly region: (p: LatLon) => RegionStyle;
  private readonly entries = new Map<string, Entry>();
  /** Entries with ground data, for allocation-free queries. */
  private live: Entry[] = [];
  private readonly failed = new Map<string, { until: number; tries: number }>();
  private readonly now: () => number;
  private readonly maxTiles: number;
  private readonly maxInFlight: number;
  private readonly recentreM: number;
  private readonly fadeMs: number;
  private readonly fallbackGround: (p: LatLon) => number | undefined;
  private readonly hidden: HiddenFootprint[];
  private readonly vectorUrl: () => Promise<string>;
  private tpl: string | null = null;
  private tplLoading = false;
  private cosO = 1;
  private coverageDirty = true;
  private wantedKeys: TileKey[] = [];
  private lastWant = { lat: NaN, lon: NaN, alt: NaN, heading: NaN, at: -Infinity };
  private time = 0;
  private counts = { built: 0, cancelled: 0, failed: 0, recentres: 0 };
  private disposed = false;

  constructor(scene: THREE.Scene, pool: BuildPool, region: (p: LatLon) => RegionStyle, opts: StreamOptions = {}) {
    this.scene = scene;
    this.pool = pool;
    this.region = region;
    this.now = opts.now ?? (() => performance.now());
    this.maxTiles = opts.maxTiles ?? MAX_TILES;
    this.maxInFlight = opts.maxInFlight ?? MAX_IN_FLIGHT;
    this.recentreM = opts.recentreM ?? 5000;
    this.fadeMs = opts.fadeMs ?? 400;
    this.hidden = opts.hidden ?? [];
    this.fallbackGround = opts.fallbackGround ?? (() => undefined);
    const v = opts.vectorUrl;
    this.vectorUrl = typeof v === 'string' ? () => Promise.resolve(v) : v ?? (() => vectorTileTemplate());
    const light = lightFor(30);
    this.haze = opts.haze ?? createHaze(light, new THREE.Vector3(0.3, 0.6, -0.5).normalize());
    this.origin = { ...(opts.origin ?? { lat: 0, lon: 0 }) };
    this.cosO = Math.cos(this.origin.lat * D2R);
    this.coverage = new CoverageMap(this.origin);
    this.materials = new ContourMaterials(this.haze, this.coverage.uniforms, { groundTint: opts.groundTint ?? light.groundTint });
  }

  // ---- scene frame ----

  /** Scene metres (x east, z = -north) of a point, relative to the floating origin. */
  toScene(p: LatLon, out: { x: number; z: number } = { x: 0, z: 0 }): { x: number; z: number } {
    out.x = lonDelta(this.origin.lon, p.lon) * M_PER_DEG * this.cosO;
    out.z = -(p.lat - this.origin.lat) * M_PER_DEG;
    return out;
  }

  fromScene(x: number, z: number): LatLon {
    return { lat: this.origin.lat - z / M_PER_DEG, lon: wrapLon(this.origin.lon + x / (M_PER_DEG * this.cosO)) };
  }

  // ---- per frame ----

  /** Call every frame with the camera (ground point lat/lon, height above sea level, look heading). */
  update(camera: LodCamera, nowMs = this.now()): void {
    if (this.disposed) return;
    this.time = nowMs;
    const moved = this.maybeRecentre(camera);
    if (!this.tpl) this.loadTemplate();
    const w = this.lastWant;
    const far = Math.abs(camera.lat - w.lat) * M_PER_DEG > 40 || Math.abs(lonDelta(w.lon, camera.lon)) * M_PER_DEG * this.cosO > 40;
    if (moved || far || Math.abs(camera.altM - w.alt) > 50 || Math.abs(lonDelta(w.heading, camera.headingDeg)) > 4 || nowMs - w.at > 1000 || Number.isNaN(w.lat)) {
      this.lastWant = { lat: camera.lat, lon: camera.lon, alt: camera.altM, heading: camera.headingDeg, at: nowMs };
      this.retarget(camera);
    }
    this.startBuilds();
    this.animate();
    if (this.coverageDirty) this.refreshCoverage();
  }

  // ---- queries ----

  /** Height of the drawn ground at p (m), from the finest loaded tile; coarse route data or 0 elsewhere. */
  groundAt(p: LatLon): number {
    const e = this.finestAt(p);
    if (e) return this.groundOf(e, p);
    const f = this.fallbackGround(p);
    return f !== undefined && Number.isFinite(f) ? f : 0;
  }

  /** Highest building top (absolute, like groundAt) within radiusM of p; the ground where there is none. */
  buildingTopAt(p: LatLon, radiusM: number): number {
    let best = this.groundAt(p);
    const live = this.live;
    for (let k = 0; k < live.length; k++) {
      const e = live[k];
      const g = e.ground!, tops = e.tops;
      if (!tops || tops.length === 0) continue;
      const x = lonDelta(g.west, p.lon) * g.mLon, z = -(p.lat - g.south) * M_PER_DEG;
      const W = g.dLon * g.mLon, H = (g.north - g.south) * M_PER_DEG;
      if (x < -radiusM - 200 || x > W + radiusM + 200 || z > radiusM + 200 || z < -H - radiusM - 200) continue;
      for (let i = 0; i < tops.length; i += 4) {
        const dx = tops[i] - x, dz = tops[i + 1] - z, r = radiusM + tops[i + 2];
        if (dx * dx + dz * dz <= r * r && tops[i + 3] > best) best = tops[i + 3];
      }
    }
    return best;
  }

  stats(): StreamStats {
    let loading = 0, live = 0, leaving = 0, settled = 0, hidden = 0, triangles = 0;
    for (const e of this.entries.values()) {
      if (e.state === 'loading') loading++;
      else if (e.state === 'live') live++;
      else leaving++;
      if (e.settled) settled++;
      if (e.view && !e.view.group.visible) hidden++;
      if (e.view) triangles += e.view.triangles;
    }
    let ready = loading === 0 && leaving === 0 && this.wantedKeys.length > 0;
    for (let i = 0; ready && i < this.wantedKeys.length; i++) {
      const e = this.entries.get(tileKey(this.wantedKeys[i]));
      if (!e || !e.settled) ready = false;
    }
    return { alive: this.entries.size, loading, live, leaving, settled, hidden, failed: this.counts.failed, built: this.counts.built, cancelled: this.counts.cancelled, triangles, recentres: this.counts.recentres, wanted: this.wantedKeys.length, ready };
  }

  /** Keys of the tiles alive, by state (for debugging and tests). */
  tiles(): { key: string; state: Entry['state']; settled: boolean; visible: boolean }[] {
    return [...this.entries.values()].map((e) => ({ key: e.key, state: e.state, settled: e.settled, visible: !!e.view?.group.visible }));
  }

  /** The scene group of a live tile, or null (for checks). */
  groupOf(key: string): THREE.Group | null {
    return this.entries.get(key)?.view?.group ?? null;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const e of this.entries.values()) this.drop(e, false);
    this.entries.clear();
    this.live = [];
    this.coverage.dispose();
    this.materials.dispose();
  }

  // ---- internals ----

  private loadTemplate(): void {
    if (this.tplLoading) return;
    this.tplLoading = true;
    this.vectorUrl().then(
      (t) => {
        this.tpl = t;
        this.tplLoading = false;
      },
      () => {
        // try again shortly; the land waits in the haze
        setTimeout(() => (this.tplLoading = false), 3000);
      },
    );
  }

  private maybeRecentre(camera: LodCamera): boolean {
    const dz = (camera.lat - this.origin.lat) * M_PER_DEG;
    const dx = lonDelta(this.origin.lon, camera.lon) * M_PER_DEG * this.cosO;
    if (this.entries.size > 0 && dx * dx + dz * dz <= this.recentreM * this.recentreM) return false;
    const from = { ...this.origin };
    const to = { lat: camera.lat, lon: wrapLon(camera.lon) };
    if (from.lat === to.lat && from.lon === to.lon) return false;
    const shift = this.toScene(to);
    const oldCos = this.cosO;
    this.origin = to;
    this.cosO = Math.cos(to.lat * D2R);
    this.coverage.setOrigin(to);
    this.coverageDirty = true;
    for (const e of this.entries.values()) if (e.view) this.place(e);
    if (this.entries.size === 0) return true; // the first placement: nothing to shift
    this.counts.recentres++;
    this.haze.uWinShift.value.x += shift.x;
    this.haze.uWinShift.value.z += shift.z;
    const newCos = this.cosO;
    const remap = (x: number, z: number) => {
      const lat = from.lat - z / M_PER_DEG, lon = from.lon + x / (M_PER_DEG * oldCos);
      return { x: lonDelta(to.lon, lon) * M_PER_DEG * newCos, z: -(lat - to.lat) * M_PER_DEG };
    };
    this.onRecentre?.({ from, to, dx: shift.x, dz: shift.z, remap });
    return true;
  }

  /** Recompute the wanted set; cancel builds no longer wanted, start leaving tiles no longer wanted. */
  private retarget(camera: LodCamera): void {
    const keep = new Set<string>();
    for (const e of this.entries.values()) if (e.state !== 'leaving') keep.add(e.key);
    this.wantedKeys = tilesFor(camera, this.maxTiles, { keep });
    const wanted = new Set(this.wantedKeys.map(tileKey));
    for (const e of [...this.entries.values()]) {
      e.wanted = wanted.has(e.key);
      if (e.wanted) {
        if (e.state === 'leaving') this.revive(e);
        continue;
      }
      if (e.state === 'loading') {
        e.ac?.abort();
        this.entries.delete(e.key);
        this.counts.cancelled++;
      }
    }
    this.releaseUnwanted();
  }

  /** Unwanted live tiles leave once coarser land under them is in; until then they stay. */
  private releaseUnwanted(): void {
    for (const e of this.entries.values()) {
      if (e.state !== 'live' || e.wanted) continue;
      if (this.coarserSettled(e.t)) this.leave(e);
    }
  }

  private startBuilds(): void {
    if (!this.tpl) return;
    let loading = 0;
    for (const e of this.entries.values()) if (e.state === 'loading') loading++;
    for (const t of this.wantedKeys) {
      if (loading >= this.maxInFlight) break;
      const key = tileKey(t);
      if (this.entries.has(key)) continue;
      const f = this.failed.get(key);
      if (f && f.until > this.time) continue;
      if (this.entries.size >= this.maxTiles && !this.evictOne()) break;
      this.build(t, key);
      loading++;
    }
  }

  /** Make room: drop a leaving tile, else an unwanted one (furthest from being needed first). */
  private evictOne(): boolean {
    let pick: Entry | null = null;
    for (const e of this.entries.values()) {
      if (e.state === 'leaving') {
        pick = e;
        break;
      }
      if (e.state === 'live' && !e.wanted && (!pick || e.t.z > pick.t.z)) pick = e;
    }
    if (!pick) return false;
    this.drop(pick, true);
    return true;
  }

  private build(t: TileKey, key: string): void {
    const level = levelFor(t.z);
    const b = tileBounds(t.z, t.x, t.y);
    const centre = { lat: (b.south + b.north) / 2, lon: (b.west + b.east) / 2 };
    const ac = new AbortController();
    const e: Entry = { key, t, level, state: 'loading', ac, view: null, born: 0, fade: 0, dither: false, settled: false, wanted: true, ground: null, tops: null };
    this.entries.set(key, e);
    this.pool
      .request(
        {
          type: 'build', z: t.z, x: t.x, y: t.y,
          region: this.region(centre),
          vectorUrl: this.tpl!,
          lcSize: level.lcSize,
          detail: level.detail,
          skirtM: level.skirtM,
          split: level.split,
          pack: true,
          hiddenFootprints: this.hidden,
        },
        [],
        { signal: ac.signal },
      )
      .then(
        (reply) => {
          if (this.entries.get(key) !== e || e.state !== 'loading' || this.disposed) return; // cancelled meanwhile
          if (reply.type !== 'built') this.fail(e, reply.message);
          else this.arrive(e, reply);
        },
        (err: Error) => {
          if (err?.name === 'AbortError' || this.entries.get(key) !== e || this.disposed) return;
          this.fail(e, err?.message ?? String(err));
        },
      );
  }

  private fail(e: Entry, message: string): void {
    this.entries.delete(e.key);
    this.counts.failed++;
    const tries = (this.failed.get(e.key)?.tries ?? 0) + 1;
    this.failed.set(e.key, { until: this.time + Math.min(60000, 2000 * 2 ** (tries - 1)), tries });
    console.warn(`tile ${e.key}: ${message}`);
  }

  private arrive(e: Entry, reply: Extract<BuildReply, { type: 'built' }>): void {
    const m = reply.meshes;
    e.ac = null;
    e.dither = this.coarserSettled(e.t);
    const clip = e.t.z < 14 || e.dither;
    e.view = new TileView(m, this.materials, { zoom: e.t.z, castShadow: e.level.castShadow, clip, dither: e.dither, freeArrays: true });
    this.place(e);
    this.scene.add(e.view.group);
    e.state = 'live';
    e.born = NaN; // the fade starts on the next frame
    e.fade = 0;
    e.view.setFade(0);
    e.tops = m.tops;
    const f = tileFrame(e.t.z, e.t.x, e.t.y);
    const n = e.level.lcSize;
    if (m.grid.length === (n + 1) * (n + 1)) {
      const X = new Float64Array(n + 1), Z = new Float64Array(n + 1);
      for (let k = 0; k <= n; k++) {
        X[k] = f.fracToLocal(k / n, 0).x;
        Z[k] = f.fracToLocal(0, 1 - k / n).z;
      }
      const b = f.bounds;
      e.ground = { frame: f, n, X, Z, raw: m.grid, terr: m.grid, south: b.south, north: b.north, west: b.west, dLon: b.east - b.west, mLon: f.widthM / (b.east - b.west) };
      this.live.push(e);
    }
    this.failed.delete(e.key);
    this.counts.built++;
    this.onChange?.();
  }

  /** Place a tile's frame in the scene for the current origin (coarse levels a little lower). */
  private place(e: Entry): void {
    const b = tileBounds(e.t.z, e.t.x, e.t.y);
    const x = lonDelta(this.origin.lon, b.west) * M_PER_DEG * this.cosO;
    const z = -(b.south - this.origin.lat) * M_PER_DEG;
    const scaleX = this.cosO / Math.cos(((b.south + b.north) / 2) * D2R);
    e.view!.place(x, -e.level.dropM, z, scaleX);
  }

  private animate(): void {
    // (deleting the current entry while iterating a Map is safe)
    for (const e of this.entries.values()) {
      if (!e.view) continue;
      if (e.state === 'live' && e.fade < 1) {
        if (Number.isNaN(e.born)) e.born = this.time;
        e.fade = ease((this.time - e.born) / this.fadeMs);
        if (e.fade > 0.999) e.fade = 1;
        e.view.setFade(e.fade);
        if (e.fade === 1) {
          e.settled = true;
          if (e.dither) {
            e.dither = false;
            e.view.setFade(1, false);
            if (e.t.z === 14) e.view.setClip(false);
          }
          this.coverageDirty = true;
          this.onChange?.();
        }
      } else if (e.state === 'leaving') {
        e.fade = 1 - (this.time - e.born) / this.fadeMs;
        if (e.fade <= 0) this.drop(e, true);
        else e.view.setFade(e.fade);
      }
    }
    if (this.coverageDirty) this.releaseUnwanted();
  }

  private leave(e: Entry): void {
    e.state = 'leaving';
    e.born = this.time;
    e.settled = false;
    e.view!.setClip(true);
    e.view!.setFade(1, true);
    this.coverageDirty = true;
  }

  /** A leaving tile wanted again: dissolve back in from where it is. */
  private revive(e: Entry): void {
    e.state = 'live';
    e.dither = true;
    const f = Math.min(0.999, Math.max(0, e.fade));
    e.born = this.time - (-Math.log2(1 - f) / 10) * this.fadeMs; // the ease's inverse
    e.view!.setClip(true);
    e.view!.setFade(f, true);
    this.coverageDirty = true;
  }

  private drop(e: Entry, notify: boolean): void {
    e.ac?.abort();
    e.view?.dispose();
    e.view = null;
    this.entries.delete(e.key);
    const i = this.live.indexOf(e);
    if (i >= 0) this.live.splice(i, 1);
    if (e.settled || e.state === 'leaving') this.coverageDirty = true;
    if (notify) this.onChange?.();
  }

  /** Some coarser tile that contains t is fully in. */
  private coarserSettled(t: TileKey): boolean {
    for (const zc of [13, 12, 10, 7]) {
      if (zc >= t.z) continue;
      const s = t.z - zc;
      const e = this.entries.get(`${zc}/${t.x >> s}/${t.y >> s}`);
      if (e?.settled && e.state === 'live') return true;
    }
    return false;
  }

  private refreshCoverage(): void {
    this.coverageDirty = false;
    const settled: TileKey[] = [];
    for (const e of this.entries.values()) if (e.settled && e.state === 'live') settled.push(e.t);
    this.coverage.rebuild(settled);
    for (const e of this.entries.values()) if (e.view) e.view.group.visible = e.state === 'leaving' || !this.coverage.hides(e.t);
  }

  private finestAt(p: LatLon): Entry | null {
    let best: Entry | null = null;
    const live = this.live;
    for (let k = 0; k < live.length; k++) {
      const e = live[k];
      const g = e.ground!;
      if (p.lat < g.south || p.lat > g.north) continue;
      const d = lonDelta(g.west, p.lon);
      if (d < 0 || d > g.dLon) continue;
      if (!best || e.t.z > best.t.z) best = e;
    }
    return best;
  }

  private groundOf(e: Entry, p: LatLon): number {
    const g = e.ground!;
    return groundHeightAt(g, lonDelta(g.west, p.lon) * g.mLon, -(p.lat - g.south) * M_PER_DEG);
  }
}
