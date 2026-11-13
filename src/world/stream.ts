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
 * - groundAt / buildingTopAt read the finest loaded tile, with no allocation per call. groundAt is
 *   the ground as drawn (coarse levels sit dropM lower).
 * - At most one z14 tile arrives per frame (its GPU upload is the costly part); the others wait.
 * - At night (setNight) the tiles' street lamps show; windows and city glow read the shared haze
 *   uniform uNight directly.
 */
import * as THREE from 'three';
import { lonDelta, tileBounds, wrapLon, type LatLon } from '../geo/coords';
import { M_PER_DEG, tileFrame } from './frame';
import { CoverageMap } from './coverage';
import { createHaze, WIN_PERIOD_M, type HazeUniforms } from './haze';
import { ContourMaterials } from './materials';
import { lightFor, type RegionStyle } from './palette';
import { groundHeightAt, type GroundGrid } from './terrain';
import { TileView } from './tileview';
import { MAX_IN_FLIGHT, MAX_TILES, levelFor, tileKey, tilesFor, type LodCamera, type LodLevel, type TileKey } from './lod';
import type { BuildReply, BuildRequest } from './worker';
import type { HiddenFootprint, Label } from './meshjob';
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
  /** The tiles to draw, in place of the level-of-detail rings round the camera (the landing card's corridor). */
  want?: (camera: LodCamera, budget: number) => TileKey[];
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
  labels: Label[];
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
  /** Longest main-thread time taken by one arriving tile (geometry, culling bounds), ms. */
  arriveMsMax: number;
};

const ease = (x: number) => 1 - Math.pow(2, -10 * Math.min(1, Math.max(0, x)));
const mod = (a: number, m: number) => ((a % m) + m) % m;
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
  private readonly want: StreamOptions['want'];
  private readonly vectorUrl: () => Promise<string>;
  private tpl: string | null = null;
  private tplLoading = false;
  private cosO = 1;
  private coverageDirty = true;
  private wantedKeys: TileKey[] = [];
  /** tileKey of each wanted key, worked out once per retarget (not per frame). */
  private wantedStr: string[] = [];
  /** z14 replies waiting for their frame (at most one z14 arrival per frame). */
  private arrivals: { e: Entry; reply: Extract<BuildReply, { type: 'built' }> }[] = [];
  private readonly statsOut: StreamStats = { alive: 0, loading: 0, live: 0, leaving: 0, settled: 0, hidden: 0, failed: 0, built: 0, cancelled: 0, triangles: 0, recentres: 0, wanted: 0, ready: false, arriveMsMax: 0 };
  private night = 0;
  private lastCamera: LodCamera | null = null;
  private lastWant = { lat: NaN, lon: NaN, alt: NaN, heading: NaN, at: -Infinity };
  private time = 0;
  private counts = { built: 0, cancelled: 0, failed: 0, recentres: 0 };
  private disposed = false;
  private arriveMsMax = 0;
  private started = false;

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
    this.want = opts.want;
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
    this.lastCamera = camera;
    // the street lamps follow the shared night uniform (Sky sets it): no caller has to remember
    if (this.haze.uNight.value !== this.night) this.setNight(this.haze.uNight.value);
    const moved = this.maybeRecentre(camera);
    this.takeArrival();
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

  /**
   * Height of the ground as drawn at p (m), from the finest loaded tile (coarse levels are drawn
   * dropM below their data, so that is taken off); coarse route data or 0 where no tile is in.
   */
  groundAt(p: LatLon): number {
    const e = this.finestAt(p);
    if (e) return this.groundOf(e, p) - e.level.dropM;
    const f = this.fallbackGround(p);
    return f !== undefined && Number.isFinite(f) ? f : 0;
  }

  /** Zoom of the finest tile with ground at p, or -1 when none is loaded there. */
  zoomAt(p: LatLon): number {
    return this.finestAt(p)?.t.z ?? -1;
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

  /** Map labels (places, water names) of the live tiles within km of p, nearest first, each name once. */
  labelsNear(p: LatLon, km: number): Label[] {
    const out: { l: Label; d: number }[] = [];
    const seen = new Set<string>();
    const cos = Math.cos(p.lat * D2R);
    for (const e of this.entries.values()) {
      if (e.state !== 'live') continue;
      for (const l of e.labels) {
        const dN = (l.lat - p.lat) * M_PER_DEG, dE = lonDelta(p.lon, l.lon) * M_PER_DEG * cos;
        const d = Math.hypot(dN, dE) / 1000;
        if (d > km || seen.has(`${l.kind}:${l.name}`)) continue;
        seen.add(`${l.kind}:${l.name}`);
        out.push({ l, d });
      }
    }
    return out.sort((a, b) => a.d - b.d).map((o) => o.l);
  }

  /** The stream's numbers. The same object is filled in on every call (no garbage per frame). */
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
    let ready = loading === 0 && leaving === 0 && this.wantedStr.length > 0;
    for (let i = 0; ready && i < this.wantedStr.length; i++) {
      const e = this.entries.get(this.wantedStr[i]);
      if (!e || !e.settled) ready = false;
    }
    const o = this.statsOut;
    o.alive = this.entries.size;
    o.loading = loading;
    o.live = live;
    o.leaving = leaving;
    o.settled = settled;
    o.hidden = hidden;
    o.failed = this.counts.failed;
    o.built = this.counts.built;
    o.cancelled = this.counts.cancelled;
    o.triangles = triangles;
    o.recentres = this.counts.recentres;
    o.wanted = this.wantedStr.length;
    o.ready = ready;
    o.arriveMsMax = this.arriveMsMax;
    return o;
  }

  /** Night 0..1 (palette Light.night): street lamps show from dusk. update() also reads it from haze.uNight. */
  setNight(night: number): void {
    if (night === this.night) return;
    this.night = night;
    for (const e of this.entries.values()) e.view?.setNight(night);
  }

  /** Keys of the tiles alive, by state (for debugging and tests). */
  tiles(): { key: string; state: Entry['state']; settled: boolean; visible: boolean; wanted: boolean }[] {
    return [...this.entries.values()].map((e) => ({ key: e.key, state: e.state, settled: e.settled, visible: !!e.view?.group.visible, wanted: e.wanted }));
  }

  /** The scene group of a live tile, or null (for checks). */
  groupOf(key: string): THREE.Group | null {
    return this.entries.get(key)?.view?.group ?? null;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.arrivals.length = 0;
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
    // the first frame moves the origin to the camera if it is far; after that, past recentreM
    if (this.started && dx * dx + dz * dz <= this.recentreM * this.recentreM) return false;
    this.started = true;
    const from = { ...this.origin };
    const to = { lat: camera.lat, lon: wrapLon(camera.lon) };
    if (dx * dx + dz * dz <= 1e-6) return false;
    const shift = this.toScene(to);
    const oldCos = this.cosO;
    this.origin = to;
    this.cosO = Math.cos(to.lat * D2R);
    this.coverage.setOrigin(to);
    this.coverageDirty = true;
    for (const e of this.entries.values()) if (e.view) this.place(e);
    // always told, even with no tile in: the balloon and camera may already be placed
    this.counts.recentres++;
    // modulo the window pattern's period, so the shift stays small (float precision) on any flight
    const w = this.haze.uWinShift.value;
    w.x = mod(w.x + shift.x, WIN_PERIOD_M);
    w.z = mod(w.z + shift.z, WIN_PERIOD_M);
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
    this.wantedKeys = this.want ? this.want(camera, this.maxTiles) : tilesFor(camera, this.maxTiles, { keep });
    this.wantedStr = this.wantedKeys.map(tileKey);
    const wanted = new Set(this.wantedStr);
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
    for (let i = 0; i < this.wantedKeys.length; i++) {
      if (loading >= this.maxInFlight) break;
      const key = this.wantedStr[i];
      if (this.entries.has(key)) continue;
      const t = this.wantedKeys[i];
      const f = this.failed.get(key);
      if (f && f.until > this.time) continue;
      if (this.entries.size >= this.maxTiles && !this.evictOne()) break;
      this.build(t, key);
      loading++;
    }
  }

  /**
   * Make room without opening a hole where it shows. In order: a leaving tile (coarser land is in
   * under it); an unwanted tile hidden under finer land; an unwanted tile with coarser land in under
   * it; else the unwanted tile furthest from the camera (out in the haze, or behind).
   */
  private evictOne(): boolean {
    let pick: Entry | null = null;
    let best = -Infinity;
    const c = this.lastCamera;
    for (const e of this.entries.values()) {
      if (e.state === 'leaving') {
        pick = e;
        break;
      }
      if (e.state !== 'live' || e.wanted) continue;
      let score: number;
      if (e.view && !e.view.group.visible) score = 3e9;
      else if (this.coarserSettled(e.t)) score = 2e9 + e.t.z;
      else score = c ? this.distanceTo(e.t, c) : e.t.z;
      if (score > best) {
        best = score;
        pick = e;
      }
    }
    if (!pick) return false;
    this.drop(pick, true);
    return true;
  }

  /** Metres from the camera's ground point to the centre of tile t. */
  private distanceTo(t: TileKey, c: LodCamera): number {
    const b = tileBounds(t.z, t.x, t.y);
    const dz = ((b.south + b.north) / 2 - c.lat) * M_PER_DEG;
    const dx = lonDelta(c.lon, (b.west + b.east) / 2) * M_PER_DEG * Math.cos(c.lat * D2R);
    return Math.hypot(dx, dz);
  }

  private build(t: TileKey, key: string): void {
    const level = levelFor(t.z);
    const b = tileBounds(t.z, t.x, t.y);
    const centre = { lat: (b.south + b.north) / 2, lon: (b.west + b.east) / 2 };
    const ac = new AbortController();
    const e: Entry = { key, t, level, state: 'loading', ac, view: null, born: 0, fade: 0, dither: false, settled: false, wanted: true, ground: null, tops: null, labels: [] };
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
          hiddenFootprints: this.hiddenIn(b),
        },
        [],
        { signal: ac.signal },
      )
      .then(
        (reply) => {
          if (this.entries.get(key) !== e || e.state !== 'loading' || this.disposed) return; // cancelled meanwhile
          if (reply.type !== 'built') this.fail(e, reply.message);
          else if (e.t.z === 14) this.arrivals.push({ e, reply });
          else this.arrive(e, reply);
        },
        (err: Error) => {
          if (err?.name === 'AbortError' || this.entries.get(key) !== e || this.disposed) return;
          this.fail(e, err?.message ?? String(err));
        },
      );
  }

  /** The landmark footprints that reach into a tile (buildings are kept or not by their centroid). */
  private hiddenIn(b: { south: number; north: number; west: number; east: number }): HiddenFootprint[] {
    const out: HiddenFootprint[] = [];
    for (const h of this.hidden) {
      const dLat = h.radiusM / M_PER_DEG, dLon = dLat / Math.max(0.01, Math.cos(h.lat * D2R));
      if (h.lat + dLat < b.south || h.lat - dLat > b.north) continue;
      if (lonDelta(b.west, h.lon) < -dLon || lonDelta(b.east, h.lon) > dLon) continue;
      out.push(h);
    }
    return out;
  }

  private fail(e: Entry, message: string): void {
    this.entries.delete(e.key);
    this.counts.failed++;
    const tries = (this.failed.get(e.key)?.tries ?? 0) + 1;
    this.failed.set(e.key, { until: this.time + Math.min(60000, 2000 * 2 ** (tries - 1)), tries });
    console.warn(`tile ${e.key}: ${message}`);
  }

  /** The first z14 reply still wanted, if any, arrives this frame. */
  private takeArrival(): void {
    while (this.arrivals.length > 0) {
      const { e, reply } = this.arrivals.shift()!;
      if (this.entries.get(e.key) !== e || e.state !== 'loading') continue; // cancelled meanwhile
      this.arrive(e, reply);
      return;
    }
  }

  private arrive(e: Entry, reply: Extract<BuildReply, { type: 'built' }>): void {
    const t0 = performance.now();
    const m = reply.meshes;
    e.ac = null;
    e.dither = this.coarserSettled(e.t);
    const clip = e.t.z < 14 || e.dither;
    try {
      e.view = new TileView(m, this.materials, { zoom: e.t.z, castShadow: e.level.castShadow, clip, dither: e.dither, freeArrays: true });
    } catch (err) {
      // the view gave its slot back; the tile is tried again after a back-off
      e.view = null;
      this.fail(e, (err as Error)?.message ?? String(err));
      return;
    }
    e.view.setNight(this.night);
    this.place(e);
    this.scene.add(e.view.group);
    e.state = 'live';
    e.born = NaN; // the fade starts on the next frame
    e.fade = 0;
    e.view.setFade(0);
    e.tops = m.tops;
    e.labels = m.labels ?? [];
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
    this.arriveMsMax = Math.max(this.arriveMsMax, performance.now() - t0);
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

  /** Dissolve out from where the tile is (it may still be fading in). */
  private leave(e: Entry): void {
    const from = Math.min(1, Math.max(0, e.fade));
    e.state = 'leaving';
    e.born = this.time - (1 - from) * this.fadeMs;
    e.fade = from;
    e.settled = false;
    e.view!.setClip(true);
    e.view!.setFade(from, true);
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
