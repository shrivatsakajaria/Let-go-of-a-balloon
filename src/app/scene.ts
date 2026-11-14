/**
 * The live 3D scene behind the page: the streamed Contour world (WorldStream) under the real sky
 * (Sky, Clouds), the person and the balloon, and the directed camera (Director), drawn every frame.
 *
 * Positions: the route's points are lat/lon with heights over coarse ground; they are drawn through
 * the stream's floating origin (toScene) at sceneAltitude, so the balloon leaves the drawn street and
 * flies its pressure level at cruise. The director frames the drawn balloon (target override) and is
 * given the stream's ground and buildings, so the camera never goes into them.
 *
 * Depth: the camera hangs a string's length from a 30 cm balloon and sees 50 km of land. The near
 * plane follows what is near (0.08 m in Ride, metres in wider shots) and the far plane the haze, which
 * keeps a 24-bit depth buffer good enough at cruise without a logarithmic depth buffer (that writes
 * the fragment depth, which would undo the polygon offsets roads and water rely on).
 */
import * as THREE from 'three';
import { Balloon, displayScale } from '../balloon/balloon';
import { Person } from '../balloon/person';
import { keepHolding, MAX_HOLD_MS } from './hold';
import { Director, type DirectorMode, type WaitFrame } from '../camera/director';
import { FLIGHT_HOURS } from '../config';
import { positionAt, type Route, type RoutePoint } from '../flight/route';
import type { LatLon } from '../geo/coords';
import { FacadeSlide } from '../balloon/slide';
import { brightLuminance, climbFloor, sceneAltitude } from '../ui/hudmath';
import { LandmarkLayer } from '../landmarks/layer';
import { hiddenFootprints } from '../landmarks/registry';
import { aglOver, climbFloorFrom, nextFeet, standableGround, startLiftM, type GroundSources } from './standable';
import { Clouds } from '../world/clouds';
import { streakTarget, WindStreaks } from '../world/windstreaks';
import { hazeFarM } from '../world/lod';
import { FrameBudget } from '../world/framebudget';
import { regionStyle } from '../world/palette';
import { createRenderer, isSoftwareRenderer } from '../world/render';
import { Sky } from '../world/sky';
import { WorldStream } from '../world/stream';
import { routeGround } from '../world/terrainsrc';
import { WorkerPool } from '../world/workerpool';
import { ReplayTrail, type TrailFrame } from '../world/trail';
import type { BuildReply, BuildRequest } from '../world/worker';

const D2R = Math.PI / 180;
const H = 3600e3;
/** A landed balloon rests on its string just off the ground. */
const LANDED_M = 0.6;

export type SceneFrame = {
  /** Wall-clock time of the frame (UTC ms). */
  now: number;
  /** Where the balloon is on its route (or the start, before release). */
  point: RoutePoint;
  /** Height above the drawn ground, m. */
  aglM: number;
  /** The drawn ground under the balloon and under the person's feet, m. */
  groundM: number;
  feetM: number;
  released: boolean;
  landed: boolean;
  /** The launch is over and the camera has settled into the flight (R51: once the balloon has cleared the rooftops, 12-40 s). */
  settled: boolean;
  waiting: boolean;
  shot: string;
  sunElevationDeg: number;
};

/**
 * The whole-trip replay drives the scene (ui/replay.ts): the route time shown, how wide the camera is,
 * and the balloon settling onto the ground at the end. Read every frame.
 */
export type ReplaySample = {
  /** Route time to show (UTC ms). */
  now: number;
  /** The camera: 0 beside the balloon, 1 the high, wide view. */
  wide: number;
  /** The balloon coming down onto the ground at the end, 0..1. */
  landing: number;
};
export type SceneReplay = {
  /** Write this frame's replay state into `out` (read once per frame). */
  sample(out: ReplaySample): void;
};
/** During the replay's travel the world streams as if from this high: coarse land only, which keeps up. */
const REPLAY_STREAM_ALT_M = 60000;
/**
 * The floating origin follows the balloon (the focus), re-centred at the start of each frame before
 * anything is placed. In the replay the balloon crosses kilometres a frame: a longer step keeps the
 * re-centres to a few a second (positions stay within ~70 km of the origin, millimetres in float32).
 */
const REPLAY_RECENTRE_M = 30000;
/** In the replay the shadow box sits this far above the balloon, where nothing casts a shadow. */
const REPLAY_SHADOW_UP_M = 50000;

/** Shadows on a disc round the balloon: wider at a few hundred metres, tighter at street level and cruise. */
function shadowRadius(agl: number): number {
  const r = agl <= 100 ? 700 : agl <= 450 ? 700 + ((agl - 100) / 350) * 200 : 900 - ((agl - 450) / 1050) * 300;
  return Math.round(Math.min(900, Math.max(600, r)));
}

/** Above this height over the ground the drawn balloon has nothing to slide up (R57b). */
const SLIDE_ABOVE_M = 400;

export class LiveScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(50, 1, 0.08, 60000);
  readonly stream: WorldStream;
  /** Landmark models near the camera, in place of their map buildings. */
  readonly landmarks: LandmarkLayer;
  /** Where people, the street camera and the climb stand: the drawn ground or a landmark's own ground (standable.ts). */
  private readonly ground: GroundSources = { groundAt: (p) => this.stream.groundAt(p), landmarkGroundAt: (p) => this.landmarks.groundAt(p) };
  readonly sky: Sky;
  readonly clouds: Clouds;
  /** Wind streaks once the balloon is well up (owner's decision, 14 November 2026). */
  readonly streaks: WindStreaks;
  readonly director: Director;
  balloon: Balloon;
  person: Person | null = null;

  /** Called after each frame is drawn. */
  onFrame: ((f: SceneFrame) => void) | null = null;
  /** About once a second: how bright the scene is behind the top and bottom text (0..1). */
  onLuminance: ((top: number, bottom: number) => void) | null = null;
  /** Skip measuring the brightness behind the text (the launch: only the clock shows). */
  measurePaused = false;
  /** The frame budget (world/framebudget.ts): the view's tiles to their cap, the shadow pass to its share, the detail. */
  private readonly budget: FrameBudget;
  /** The last frame drawn redrew the shadow map (for the performance checks). */
  shadowDrawn = false;
  /** The first frame has been drawn. */
  onFirstFrame: (() => void) | null = null;

  private readonly canvas: HTMLCanvasElement;
  /** The mesh workers (the landing card's own coarse world builds on them too). */
  readonly pool: WorkerPool<BuildRequest, BuildReply>;
  private readonly reduced: boolean;
  private start: LatLon;
  private route: Route | null = null;
  private released = false;
  private wind = { speedMs: 2, headingDeg: 90 };
  private wait: WaitFrame = { centerY: 0.15, spanY: 0.7 };
  private groundS = Number.NaN;
  /** Scene y of the balloon when it was let go here (NaN for a balloon opened from a link). */
  private releaseY = Number.NaN;
  /** The drawn balloon's slide up a facade it meets (R57b). */
  private readonly slide = new FacadeSlide();
  private readonly slideTop = (x: number, z: number, r: number) => {
    const p = this.stream.fromScene(x, z);
    return Math.max(this.stream.buildingTopAt(p, r), this.landmarks.topAt(p, r));
  };
  private placedAt = 0;
  private landmark: number | undefined = undefined;
  /** While the person holds on at Let go: when to give up waiting for the route (performance.now ms). */
  private holdUntil: { at: number; expire: () => void } | null = null;
  private feetS = Number.NaN;
  /** Whether the feet stood on a landmark's own ground last frame (a change snaps them). */
  private feetOnLandmark = false;
  private last = performance.now();
  private frames = 0;
  private skyAt = -Infinity;
  private lumAt = 0;
  private shadowAsked = 0;
  private shadowDrawnAt = -Infinity;
  private raf = 0;
  private disposed = false;
  private readonly tmp = { x: 0, z: 0 };
  private readonly pos = new THREE.Vector3();
  private readonly target = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  private readonly focus = new THREE.Vector3();
  private readonly size = new THREE.Vector2();
  private readonly point: RoutePoint = { tSec: 0, lat: 0, lon: 0, altM: 0, groundM: 0, speedMs: 0, headingDeg: 0 };
  private readonly dirPoint: RoutePoint = { tSec: 0, lat: 0, lon: 0, altM: 0, groundM: 0, speedMs: 0, headingDeg: 0 };
  private lumBuf = new Uint8Array(0);
  private replay: { drive: SceneReplay; trail: ReplayTrail; mode: DirectorMode; shadowCleared: boolean } | null = null;
  private readonly rs: ReplaySample = { now: 0, wide: 0, landing: 0 };
  private readonly trailFrame: TrailFrame = {
    route: null as unknown as Route, tSec: 0, toScene: (p, out) => this.stream.toScene(p, out), head: this.target, camera: this.camera, viewportH: 1, balloonRadiusM: 0, lower: 0,
  };
  private readonly streakFrame = { focus: this.target, camera: this.camera, focusRadius: 0.15, groundM: 0, wind: { u: 0, v: 0 }, target: 0 };
  private readonly streakState = { released: false, landed: false, replay: false, reduced: false, shot: '', aglM: 0, toLandS: Number.NaN };
  private readonly info: SceneFrame = {
    now: 0, point: this.point, aglM: 0, groundM: 0, feetM: 0, released: false, landed: false, settled: false, waiting: true, shot: '', sunElevationDeg: 0,
  };

  constructor(canvas: HTMLCanvasElement, start: LatLon, opts: { reducedMotion: boolean }) {
    this.canvas = canvas;
    this.reduced = opts.reducedMotion;
    this.start = { lat: start.lat, lon: start.lon };
    this.renderer = createRenderer(canvas);

    this.sky = new Sky(this.scene, { shadow: { radius: 700, mapSize: 2048, snap: 100, upM: 60, downM: 40 } });
    this.sky.update(Date.now(), start);
    this.pool = new WorkerPool<BuildRequest, BuildReply>(
      () => new Worker(new URL('../world/worker.ts', import.meta.url), { type: 'module' }),
      Math.min(4, Math.max(1, (navigator.hardwareConcurrency || 2) - 1)),
      { timeoutMs: 20000 },
    );
    this.stream = new WorldStream(this.scene, this.pool, regionStyle, {
      haze: this.sky.haze,
      groundTint: this.sky.current.groundTint,
      origin: start,
      fallbackGround: (p) => routeGround.peek(p),
      hidden: hiddenFootprints(),
    });
    this.landmarks = new LandmarkLayer({ scene: this.scene, toScene: (p, out) => this.stream.toScene(p, out), groundAt: (p) => this.stream.groundAt(p), zoomAt: (p) => this.stream.zoomAt(p), materials: this.stream.materials });
    this.budget = new FrameBudget(this.stream, this.sky.light, { frameTimes: !isSoftwareRenderer(this.renderer) });
    this.clouds = new Clouds(this.scene, { haze: this.sky.haze, seed: 11, groundAt: (x, z) => this.stream.groundAt(this.stream.fromScene(x, z)) });
    // off with reduced motion, and on a software renderer, where they cost frames for nothing (the
    // browser tests, which draw in software, turn them on with window.__lgoabStreaks)
    const forceStreaks = typeof window !== 'undefined' && !!(window as unknown as { __lgoabStreaks?: boolean }).__lgoabStreaks;
    const streaksOn = !this.reduced && (forceStreaks || !isSoftwareRenderer(this.renderer));
    this.streaks = new WindStreaks(this.scene, { haze: this.sky.haze, enabled: streaksOn, pixelRatio: this.renderer.getPixelRatio() });
    this.stream.onRecentre = (e) => {
      this.clouds.shift(e.dx, e.dz);
      this.streaks.shift(e.dx, e.dz);
    };
    this.stream.onChange = this.landmarks.onChange = () => {
      this.shadowAsked = performance.now();
    };
    this.director = new Director(this.camera, {
      toScene: (p) => this.stream.toScene(p),
      // street camera spots stand on a landmark's own ground (a summit terrace), never inside it
      groundAt: (p) => standableGround(this.ground, p),
      buildingTopAt: (p, r) => Math.max(this.stream.buildingTopAt(p, r), this.landmarks.topAt(p, r)),
      treeTopAt: (p, r) => this.stream.treeTopAt(p, r),
      crownNear: (p, r, out) => this.stream.crownNear(p, r, out),
      balloonRadius: (d) => 0.15 * displayScale(d),
      reducedMotion: this.reduced,
    });
    this.balloon = new Balloon(this.scene, { reducedMotion: this.reduced });
    this.setStart(start);
    this.raf = requestAnimationFrame(this.frame);
  }

  // ---- what the scene shows ----

  /** The start screen at a place: the person holds the balloon in the establishing shot. */
  setStart(p: LatLon, landmarkHeadingDeg?: number): void {
    this.landmark = landmarkHeadingDeg;
    this.start = { lat: p.lat, lon: p.lon };
    this.route = null;
    this.released = false;
    this.holdUntil = null;
    this.groundS = this.feetS = this.releaseY = Number.NaN;
    // move the world's origin here first, so the director's street spots are chosen in the new frame
    this.stream.update({ lat: p.lat, lon: p.lon, altM: this.stream.groundAt(p) + 2, headingDeg: this.wind.headingDeg }, performance.now());
    this.newBalloon();
    this.placePerson();
    this.director.paused = false;
    this.streaks.paused = false;
    this.streaks.cut(); // none fade out over the start screen
    this.director.setLaunch({ personAt: this.start, landmarkHeadingDeg: this.landmark, startUtcMs: Date.now(), waiting: this.wait, cueRelease: true });
  }

  /** The wind at the start is known: the person turns to it, and the street camera stands upwind. */
  setWind(w: { speedMs: number; headingDeg: number }): void {
    if (!Number.isFinite(w.speedMs) || !Number.isFinite(w.headingDeg)) return;
    this.wind = { ...w };
    if (this.director.waiting && !this.released) this.setStart(this.start, this.landmark);
  }

  /** Where the start screen leaves the scene free (NDC). */
  setWaitFrame(f: WaitFrame): void {
    this.wait = { ...f };
    this.director.setWaitFrame(f);
  }

  /**
   * Let go: the camera moves in, the person opens their hand at max(1.2 s, route ready) and never
   * after 6 s, unless `working` says the winds are in and the route is on its way (then up to 20 s). `onRelease` gets the route once the balloon is free; `onTimeout` when it never was.
   */
  launch(route: Promise<Route>, onRelease: (r: Route) => void, onTimeout: () => void, working: () => boolean = () => false): void {
    if (!this.person) this.placePerson();
    const person = this.person!;
    this.director.go();
    let ready: Route | null = null;
    route.then((r) => (ready = r), () => {});
    let done = false;
    const timeout = () => {
      if (done) return;
      done = true;
      this.holdUntil = null;
      onTimeout();
    };
    // the hold is counted in real time by the frame loop (performance.now, which a backgrounded tab
    // does not skip), not in the person's frame time (app/hold.ts: 6 s, or 20 s while the winds are in
    // and the route is being worked out; never while a route that came waits for the next frame)
    const t0 = performance.now();
    this.holdUntil = {
      at: t0 + MAX_HOLD_MS,
      expire: () => {
        if (person.state !== 'holding') return;
        const now = performance.now();
        if (this.holdUntil && keepHolding(now - t0, { routeReady: ready !== null, windsIn: working() })) {
          this.holdUntil.at = now + 250;
          return;
        }
        person.holdIdle();
        timeout();
      },
    };
    person.play(
      () => {
        done = true;
        this.holdUntil = null;
        this.route = ready;
        this.released = true;
        // the climb floor: only for a launch from a landmark's terrace (hudmath.climbFloor)
        this.releaseY = climbFloorFrom(this.feetS, this.startLift());
        this.balloon.root.visible = true;
        this.balloon.release();
        this.director.release(); // the crane starts as the hand opens
        onRelease(ready!);
      },
      // the 1.2 s before the hand opens is real time too: a phone at a frame or two a second lets go
      // once the route is in, not after 1.2 s of its capped frame time (12 frames, so 12 s at 1 fps)
      { readyAt: route, onTimeout: timeout, holdS: Infinity, now: () => performance.now() },
    );
  }

  /** A launch that has not let go yet is called off (another balloon is opening): the hand stays closed. */
  cancelLaunch(): void {
    this.holdUntil = null;
    if (this.person?.state === 'holding') this.person.holdIdle();
  }

  /** The launch failed before the hand opened: back to the start screen's shot, with no cut. */
  rewind(): void {
    this.holdUntil = null;
    this.person?.holdIdle();
    this.director.rewind(this.wait);
  }

  /** Show a balloon already in flight (a shared or saved link): no launch, the camera with it. */
  fly(route: Route, mode: DirectorMode = 'film'): void {
    this.route = route;
    this.released = true;
    this.holdUntil = null;
    this.start = route.points[0];
    this.groundS = this.releaseY = Number.NaN;
    const p = positionAt(route, Date.now());
    this.stream.update({ lat: p.lat, lon: p.lon, altM: p.altM, headingDeg: p.headingDeg }, performance.now());
    this.person?.dispose();
    this.person = null;
    this.newBalloon();
    this.balloon.root.visible = true;
    this.balloon.release();
    this.director.cut(mode);
  }

  setView(mode: DirectorMode): void {
    this.director.set(mode);
  }

  setPaused(p: boolean): void {
    this.director.paused = p;
    this.streaks.paused = p; // they hold still, still shown (spec 7.3)
  }

  /** Map labels near p (for "Over ..."). */
  labelsNear(p: LatLon, km = 6) {
    return this.stream.labelsNear(p, km);
  }

  /** The whole-trip replay starts: the camera cuts to the start of the route, a trail follows the balloon. */
  startReplay(drive: SceneReplay): void {
    if (!this.route || !this.released) return;
    this.stopReplay();
    this.replay = { drive, trail: new ReplayTrail(this.scene), mode: this.director.mode, shadowCleared: false };
    // the person (still in the street early in a flight) waits out of sight and is there again after
    if (this.person) this.person.root.visible = false;
    this.freshBalloon();
    this.clouds.mesh.visible = false;
    this.streaks.cut();
    this.groundS = Number.NaN;
    this.skyAt = -Infinity;
    this.director.cut('replay');
    drive.sample(this.rs);
    this.director.replayWide = this.rs.wide;
  }

  /** Back to live: the trail goes, the clock is now again, and the camera cuts back to the view it had. */
  stopReplay(): void {
    const r = this.replay;
    if (!r) return;
    this.replay = null;
    r.trail.dispose();
    this.freshBalloon(); // its string swung after a balloon that crossed a sea in 15 s
    this.clouds.mesh.visible = true;
    this.groundS = Number.NaN;
    this.skyAt = -Infinity;
    this.renderer.shadowMap.needsUpdate = true;
    this.director.cut(r.mode);
  }

  private freshBalloon(): void {
    this.newBalloon();
    this.balloon.root.visible = true;
    this.balloon.release();
  }

  get replaying(): boolean {
    return this.replay !== null;
  }

  /** Disposed: nothing may be drawn with it any more (the landing card checks before it renders). */
  get gone(): boolean {
    return this.disposed;
  }

  /** Stop drawing and free everything: the world, sky, clouds, person, balloon, workers and the GL context. */
  dispose(): void {
    if (this.disposed) return;
    this.stopReplay();
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.holdUntil = null;
    this.onFrame = this.onLuminance = this.onFirstFrame = null;
    this.person?.dispose();
    this.person = null;
    this.balloon.dispose();
    this.clouds.dispose();
    this.streaks.dispose();
    this.sky.dispose();
    this.landmarks.dispose();
    this.stream.dispose();
    this.pool.terminate();
    this.scene.clear();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }

  // ---- internals ----

  private newBalloon(): void {
    this.slide.reset();
    this.balloon.dispose();
    this.balloon = new Balloon(this.scene, { reducedMotion: this.reduced });
  }

  private placePerson(): void {
    this.person?.dispose();
    // facing back toward the street camera, which stands upwind, a little turned
    this.person = new Person(this.scene, this.start, (this.wind.headingDeg + 160) % 360);
    this.placedAt = performance.now();
    this.feetS = Number.NaN;
    this.updatePerson(0);
    this.balloon.hold(this.person.hand);
  }

  /**
   * How far the launch spot stands above the drawn ground (a landmark's terrace over a summit the
   * map has lost), for the route's climb; 0 almost everywhere.
   */
  startLift(): number {
    return startLiftM(this.ground, this.start);
  }

  private updatePerson(dt: number): void {
    const person = this.person;
    if (!person) return;
    const g = standableGround(this.ground, this.start);
    // a landmark's ground appearing (or leaving) under the feet moves them at once, not over seconds
    const onLandmark = g > this.stream.groundAt(this.start);
    const changed = onLandmark !== this.feetOnLandmark;
    this.feetOnLandmark = onLandmark;
    // until the street's own tile is in (and any landmark whose ground may be under the spot), the
    // ground there is a guess: the person waits out of sight rather than sinking into the street, or
    // standing inside a summit's rock, as finer land and the landmark arrive
    const fine = (this.stream.zoomAt(this.start) >= 13 && this.landmarks.settledAt(this.start)) || performance.now() - this.placedAt > 6000;
    if (fine && !person.root.visible) this.feetS = Number.NaN;
    person.root.visible = fine;
    if (!this.released) this.balloon.root.visible = fine;
    this.feetS = !fine ? g : nextFeet(this.feetS, g, dt, changed);
    const s = this.stream.toScene(this.start, this.tmp);
    person.place({ x: s.x, y: this.feetS, z: s.z });
    person.update(dt);
    person.lookAt(this.balloon.mesh.position);
  }

  private resize(): void {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    const pr = this.renderer.getPixelRatio();
    if (this.renderer.domElement.width === Math.round(w * pr) && this.renderer.domElement.height === Math.round(h * pr)) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  private readonly frame = (t: number): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min(0.25, Math.max(0, (t - this.last) / 1000));
    this.last = t;
    this.resize();
    const rp = this.replay;
    const rs = this.rs;
    if (rp) rp.drive.sample(rs); // once a frame: the time, the camera's width and the landing
    const now = rp ? rs.now : Date.now();

    // where the balloon is on its route
    const route = this.route;
    const landed = !!route && this.released && !rp && now >= route.release + FLIGHT_HOURS * H;
    const pt = this.point;
    if (route && this.released) positionAt(route, now, pt);
    else {
      pt.tSec = 0;
      pt.lat = this.start.lat;
      pt.lon = this.start.lon;
      pt.altM = pt.groundM = Number.NaN;
      pt.speedMs = this.wind.speedMs;
      pt.headingDeg = this.wind.headingDeg;
    }
    if (landed) pt.speedMs = 0;

    // the floating origin follows the balloon, moved now, before anything is placed this frame
    const step = rp ? REPLAY_RECENTRE_M : undefined;
    this.stream.recentre(pt, step);

    // the drawn ground under it, eased so a finer tile arriving does not jolt the balloon
    const g = this.stream.groundAt(pt);
    this.groundS = Number.isNaN(this.groundS) || Math.abs(g - this.groundS) > 200 ? g : this.groundS + (g - this.groundS) * (1 - Math.exp(-dt / 0.8));

    if (this.holdUntil && performance.now() >= this.holdUntil.at) this.holdUntil.expire();
    if (!rp) this.updatePerson(dt);
    let y = !this.released ? this.feetS + 1.5 : landed ? this.groundS + LANDED_M : sceneAltitude(pt.altM, pt.groundM, this.groundS);
    // never inside a landmark's own ground (the route's climb starts from it: this only catches a
    // replayed route, which knows nothing of the terrace)
    if (this.released) y = Math.max(y, this.landmarks.groundAt(pt) + 1.5);
    // just let go, it rises from where the hand opened, though the drawn slope below falls away
    if (this.released && !rp && route && !landed && Number.isFinite(this.releaseY)) y = climbFloor(y, pt.tSec, this.releaseY, pt.altM, route.points[0].altM);
    if (rp) {
      // the replay's balloon settles at the end, resting on the ground at the size it is drawn
      const rest = this.groundS + LANDED_M * displayScale(this.camera.position.distanceTo(this.target));
      y += (rest - y) * rs.landing;
    }
    const s = this.stream.toScene(pt, this.tmp);
    // the drawn balloon slides up a facade it meets, never into it (R57b); well up, nothing is in its way
    let sx = s.x, sz = s.z;
    if (this.released && !rp && !landed && route && y - this.groundS < SLIDE_ABOVE_M) {
      const h = pt.headingDeg * (Math.PI / 180);
      const ux = Math.sin(h), uz = -Math.cos(h);
      this.slide.step(s.x, y, s.z, ux, uz, pt.speedMs, dt, this.slideTop);
      sx -= ux * this.slide.back;
      sz -= uz * this.slide.back;
      y += this.slide.lift;
    }
    this.pos.set(sx, y, sz);

    // the balloon (sized for last frame's camera), then the camera framing it as drawn
    this.balloon.setState(pt, dt, this.sky.current, { pos: this.pos, camera: this.camera.position });
    this.balloon.mesh.getWorldPosition(this.target);
    const dp = this.dirPoint;
    dp.tSec = pt.tSec;
    dp.lat = pt.lat;
    dp.lon = pt.lon;
    dp.groundM = pt.groundM;
    dp.speedMs = pt.speedMs;
    dp.headingDeg = pt.headingDeg;
    dp.altM = y;
    if (rp) this.director.replayWide = rs.wide;
    this.director.update(this.dirPoint, dt, this.target);

    // near plane: just short of the nearest thing drawn close by (the balloon and its string, the person)
    const dB = this.camera.position.distanceTo(this.target);
    let near = (dB - 1.4 - 0.2 * displayScale(dB)) * 0.5;
    if (this.person && !rp) near = Math.min(near, (this.camera.position.distanceTo(this.person.root.position) - 0.6) * 0.5);
    const camGround = standableGround(this.ground, this.stream.fromScene(this.camera.position.x, this.camera.position.z));
    near = Math.min(near, (this.camera.position.y - camGround) * 0.5);
    this.camera.near = Math.min(rp ? 500 : 10, Math.max(0.08, near));
    const far = hazeFarM(this.camera.position.y);
    this.camera.far = far * 1.25;
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
    this.sky.setView(this.camera, far * 0.75, this.renderer.getDrawingBufferSize(this.size).y / 2);
    // the replay looks down from tens of kilometres: the haze starts below the camera, not at it
    if (rp) this.sky.fog.near = Math.min(this.sky.fog.far * 0.6, Math.max(this.sky.fog.near, (this.camera.position.y - camGround) * 0.9));

    // stream the world round the camera
    this.camera.getWorldDirection(this.look);
    const cll = this.stream.fromScene(this.camera.position.x, this.camera.position.z);
    const heading = (Math.atan2(this.look.x, -this.look.z) / D2R + 360) % 360;
    const streamAlt = rp && rs.wide > 0.5 ? Math.max(this.camera.position.y, REPLAY_STREAM_ALT_M) : this.camera.position.y;
    this.stream.update({ lat: cll.lat, lon: cll.lon, altM: streamAlt, headingDeg: heading }, t, { focus: pt, recentreM: step });
    // landmarks animate at the time the scene shows (a clock face keeps the replay's hour)
    // (not looked for while the replay is high and wide: it crosses a landmark's reach in a frame)
    this.landmarks.update(cll, now, this.sky.current, { scan: !(rp && rs.wide > 0.5) });

    // clouds drift with the wind at cruise, and never take in the balloon or the camera
    const h = pt.headingDeg * D2R;
    this.clouds.setFocus(this.target, this.look);
    this.clouds.clearOf(this.target, 300);
    this.clouds.clearOf(this.camera.position, 300);
    if (!rp) this.clouds.update(dt, { u: pt.speedMs * Math.sin(h), v: pt.speedMs * Math.cos(h) });

    // the real sky over the balloon, once a second (every frame in the replay: night sweeps across)
    if (rp || now - this.skyAt > 1000) {
      this.skyAt = now;
      const L = this.sky.update(now, pt);
      this.stream.materials.setGroundTint(L.groundTint);
    }

    // the frame budget: what the view will draw of the tiles, the farthest buildings left out past the
    // cap (none in the replay)
    this.budget.fitView(this.camera, !rp);

    // live shadows round the balloon, a little ahead of it
    // over a landmark's terrace where it is higher than the drawn ground (in the hand on Corcovado:
    // 1.5 m, not 183 m); not by changing groundS, which sceneAltitude reads with the lifted route
    const agl = aglOver(y, this.groundS, this.landmarks.groundAt(pt));
    let redraw = this.sky.light.setRadius(shadowRadius(agl));
    const ahead = Math.min(400, agl * 0.4);
    this.focus.set(this.target.x + Math.sin(h) * ahead, this.groundS, this.target.z - Math.cos(h) * ahead);
    // the replay draws no cast shadows: its shadow box goes up into the empty sky, so the map it draws
    // is clear (no boats' or roofs' shadows from wherever the box last was; the balloon's own shadow is a
    // decal and stays). Back to live, the box comes down to the balloon again and the map is redrawn.
    if (rp) this.focus.y = this.target.y + REPLAY_SHADOW_UP_M;
    redraw = this.sky.place(this.focus) || redraw; // (the light still turns with the sun)
    if (this.shadowAsked > this.shadowDrawnAt && t - this.shadowDrawnAt > 250) redraw = true;
    // the empty map is drawn once when the box has gone up, then not again until Back to live
    if (rp) {
      redraw = !rp.shadowCleared;
      rp.shadowCleared = true;
    }
    if (redraw) {
      this.renderer.shadowMap.needsUpdate = true;
      this.shadowDrawnAt = t;
      // the shadow pass's budget: trees cast near the balloon only, and a dense city gets a smaller disc
      if (!rp) this.budget.fitShadows(this.scene, this.focus);
    }

    // wind streaks flow past once the balloon is well up (never in the launch, the replay or reduced motion)
    const sf = this.streakFrame;
    sf.groundM = this.groundS;
    sf.focusRadius = 0.15 * displayScale(dB);
    sf.wind.u = pt.speedMs * Math.sin(h);
    sf.wind.v = pt.speedMs * Math.cos(h);
    const st = this.streakState;
    st.released = this.released;
    st.landed = landed;
    st.replay = !!rp;
    st.reduced = this.reduced;
    st.shot = this.director.shot;
    st.aglM = agl;
    st.toLandS = route ? (route.release + FLIGHT_HOURS * H - now) / 1000 : Number.NaN;
    sf.target = streakTarget(st);
    this.streaks.update(dt, sf);

    if (rp && route) {
      const tf = this.trailFrame;
      tf.route = route;
      tf.tSec = (now - route.release) / 1000;
      tf.viewportH = this.canvas.clientHeight;
      tf.balloonRadiusM = 0.15 * displayScale(dB);
      tf.lower = rs.landing;
      rp.trail.update(tf);
    }

    this.shadowDrawn = this.renderer.shadowMap.needsUpdate;
    this.renderer.render(this.scene, this.camera);
    // what the view drew; over budget in a dense city the buildings levels come nearer (the replay
    // streams its own way)
    this.budget.afterRender(this.renderer.info.render, this.shadowDrawn && !rp, t, dt * 1000, !rp);
    if (this.frames++ === 0) this.onFirstFrame?.();
    // reading pixels back stalls the pipeline: only when text sits over the scene and nothing is being
    // worked out (not during the launch, when only the clock shows)
    if (now - this.lumAt > 1000 && this.onLuminance && !this.measurePaused) {
      this.lumAt = now;
      this.measure();
    }

    // done with the person once the balloon is well away
    if (this.person && this.released && agl > 300 && !this.director.waiting && !rp) {
      this.person.dispose();
      this.person = null;
    }

    if (this.onFrame) {
      const f = this.info; // one object, filled in every frame
      f.now = now;
      f.aglM = agl;
      f.groundM = this.groundS;
      f.feetM = this.feetS;
      f.released = this.released;
      f.landed = landed;
      f.settled = this.director.shot !== 'launch';
      f.waiting = this.director.waiting;
      f.shot = this.director.shot;
      f.sunElevationDeg = this.sky.sun.elevationDeg;
      this.onFrame(f);
    }
  };

  /** Read a few rows of the frame just drawn behind the top (170 px) and bottom (300 px) text. */
  private measure(): void {
    const gl = this.renderer.getContext();
    const W = gl.drawingBufferWidth, Hh = gl.drawingBufferHeight;
    if (W < 4 || Hh < 4) return;
    const pr = this.renderer.getPixelRatio();
    // one buffer, read and measured band by band
    const band = (fromTopCss: number, toTopCss: number): Uint8Array => {
      const rows = 4;
      if (this.lumBuf.length !== W * 4 * rows) this.lumBuf = new Uint8Array(W * 4 * rows);
      for (let i = 0; i < rows; i++) {
        const yCss = fromTopCss + ((toTopCss - fromTopCss) * (i + 0.5)) / rows;
        const yGl = Math.max(0, Math.min(Hh - 1, Hh - 1 - Math.round(yCss * pr)));
        gl.readPixels(0, yGl, W, 1, gl.RGBA, gl.UNSIGNED_BYTE, this.lumBuf.subarray(i * W * 4, (i + 1) * W * 4));
      }
      return this.lumBuf;
    };
    const hCss = Hh / pr;
    try {
      const top = brightLuminance(band(8, 150));
      const bottom = brightLuminance(band(hCss - 280, hCss - 8));
      this.onLuminance?.(top, bottom);
    } catch {
      /* a lost context: try again next second */
    }
  }
}
