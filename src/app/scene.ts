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
import { MAX_HOLD_S, Person } from '../balloon/person';
import { Director, type DirectorMode, type WaitFrame } from '../camera/director';
import { FLIGHT_HOURS } from '../config';
import { positionAt, type Route, type RoutePoint } from '../flight/route';
import type { LatLon } from '../geo/coords';
import { brightLuminance, sceneAltitude } from '../ui/hudmath';
import { Clouds } from '../world/clouds';
import { hazeFarM } from '../world/lod';
import { regionStyle } from '../world/palette';
import { createRenderer } from '../world/render';
import { Sky } from '../world/sky';
import { WorldStream } from '../world/stream';
import { routeGround } from '../world/terrainsrc';
import { WorkerPool } from '../world/workerpool';
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
  /** The launch is over and the camera has settled into the flight (spec 8: at 20 s). */
  settled: boolean;
  waiting: boolean;
  shot: string;
  sunElevationDeg: number;
};

/** Shadows on a disc round the balloon: wider at a few hundred metres, tighter at street level and cruise. */
function shadowRadius(agl: number): number {
  const r = agl <= 100 ? 700 : agl <= 450 ? 700 + ((agl - 100) / 350) * 200 : 900 - ((agl - 450) / 1050) * 300;
  return Math.round(Math.min(900, Math.max(600, r)));
}

export class LiveScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(50, 1, 0.08, 60000);
  readonly stream: WorldStream;
  readonly sky: Sky;
  readonly clouds: Clouds;
  readonly director: Director;
  balloon: Balloon;
  person: Person | null = null;

  /** Called after each frame is drawn. */
  onFrame: ((f: SceneFrame) => void) | null = null;
  /** About once a second: how bright the scene is behind the top and bottom text (0..1). */
  onLuminance: ((top: number, bottom: number) => void) | null = null;
  /** Skip measuring the brightness behind the text (the launch: only the clock shows). */
  measurePaused = false;
  /** The first frame has been drawn. */
  onFirstFrame: (() => void) | null = null;

  private readonly canvas: HTMLCanvasElement;
  private readonly pool: WorkerPool<BuildRequest, BuildReply>;
  private readonly reduced: boolean;
  private start: LatLon;
  private route: Route | null = null;
  private released = false;
  private wind = { speedMs: 2, headingDeg: 90 };
  private wait: WaitFrame = { centerY: 0.15, spanY: 0.7 };
  private groundS = Number.NaN;
  private placedAt = 0;
  /** While the person holds on at Let go: when to give up waiting for the route (performance.now ms). */
  private holdUntil: { at: number; expire: () => void } | null = null;
  private feetS = Number.NaN;
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
    });
    this.clouds = new Clouds(this.scene, { haze: this.sky.haze, seed: 11, groundAt: (x, z) => this.stream.groundAt(this.stream.fromScene(x, z)) });
    this.stream.onRecentre = (e) => this.clouds.shift(e.dx, e.dz);
    this.stream.onChange = () => {
      this.shadowAsked = performance.now();
    };
    this.director = new Director(this.camera, {
      toScene: (p) => this.stream.toScene(p),
      groundAt: (p) => this.stream.groundAt(p),
      buildingTopAt: (p, r) => this.stream.buildingTopAt(p, r),
      balloonRadius: (d) => 0.15 * displayScale(d),
      reducedMotion: this.reduced,
    });
    this.balloon = new Balloon(this.scene, { reducedMotion: this.reduced });
    this.setStart(start);
    this.raf = requestAnimationFrame(this.frame);
  }

  // ---- what the scene shows ----

  /** The start screen at a place: the person holds the balloon in the establishing shot. */
  setStart(p: LatLon): void {
    this.start = { lat: p.lat, lon: p.lon };
    this.route = null;
    this.released = false;
    this.holdUntil = null;
    this.groundS = this.feetS = Number.NaN;
    // move the world's origin here first, so the director's street spots are chosen in the new frame
    this.stream.update({ lat: p.lat, lon: p.lon, altM: this.stream.groundAt(p) + 2, headingDeg: this.wind.headingDeg }, performance.now());
    this.newBalloon();
    this.placePerson();
    this.director.paused = false;
    this.director.setLaunch({ personAt: this.start, startUtcMs: Date.now(), waiting: this.wait });
  }

  /** The wind at the start is known: the person turns to it, and the street camera stands upwind. */
  setWind(w: { speedMs: number; headingDeg: number }): void {
    if (!Number.isFinite(w.speedMs) || !Number.isFinite(w.headingDeg)) return;
    this.wind = { ...w };
    if (this.director.waiting && !this.released) this.setStart(this.start);
  }

  /** Where the start screen leaves the scene free (NDC). */
  setWaitFrame(f: WaitFrame): void {
    this.wait = { ...f };
    this.director.setWaitFrame(f);
  }

  /**
   * Let go: the camera moves in, the person opens their hand at max(1.2 s, route ready) and never
   * after 6 s. `onRelease` gets the route once the balloon is free; `onTimeout` when it never was.
   */
  launch(route: Promise<Route>, onRelease: (r: Route) => void, onTimeout: () => void): void {
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
    // the person counts the 6 s in frame time; a slow frame rate must not stretch the wait in real time,
    // so the frame loop also checks the clock (performance.now, which a backgrounded tab does not skip)
    this.holdUntil = {
      at: performance.now() + MAX_HOLD_S * 1000 + 100,
      expire: () => {
        if (person.state !== 'holding') return;
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
        this.balloon.root.visible = true;
        this.balloon.release();
        onRelease(ready!);
      },
      { readyAt: route, onTimeout: timeout },
    );
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
    this.groundS = Number.NaN;
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
  }

  /** Map labels near p (for "Over ..."). */
  labelsNear(p: LatLon, km = 6) {
    return this.stream.labelsNear(p, km);
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.stream.dispose();
    this.pool.terminate();
    this.renderer.dispose();
  }

  // ---- internals ----

  private newBalloon(): void {
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

  private updatePerson(dt: number): void {
    const person = this.person;
    if (!person) return;
    const g = this.stream.groundAt(this.start);
    // until the street's own tile is in, the ground there is a guess: the person waits out of sight
    // rather than sinking into the street as finer land arrives
    const fine = this.stream.zoomAt(this.start) >= 13 || performance.now() - this.placedAt > 6000;
    if (fine && !person.root.visible) this.feetS = Number.NaN;
    person.root.visible = fine;
    if (!this.released) this.balloon.root.visible = fine;
    this.feetS = Number.isNaN(this.feetS) || !fine || Math.abs(g - this.feetS) > 200 ? g : this.feetS + (g - this.feetS) * (1 - Math.exp(-dt / 0.6));
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
    const now = Date.now();

    // where the balloon is on its route
    const route = this.route;
    const landed = !!route && this.released && now >= route.release + FLIGHT_HOURS * H;
    const pt = this.point;
    if (route && this.released) Object.assign(pt, positionAt(route, now));
    else Object.assign(pt, { tSec: 0, lat: this.start.lat, lon: this.start.lon, altM: Number.NaN, groundM: Number.NaN, speedMs: this.wind.speedMs, headingDeg: this.wind.headingDeg });
    if (landed) pt.speedMs = 0;

    // the drawn ground under it, eased so a finer tile arriving does not jolt the balloon
    const g = this.stream.groundAt(pt);
    this.groundS = Number.isNaN(this.groundS) || Math.abs(g - this.groundS) > 200 ? g : this.groundS + (g - this.groundS) * (1 - Math.exp(-dt / 0.8));

    if (this.holdUntil && performance.now() >= this.holdUntil.at) this.holdUntil.expire();
    this.updatePerson(dt);
    const y = !this.released ? this.feetS + 1.5 : landed ? this.groundS + LANDED_M : sceneAltitude(pt.altM, pt.groundM, this.groundS);
    const s = this.stream.toScene(pt, this.tmp);
    this.pos.set(s.x, y, s.z);

    // the balloon (sized for last frame's camera), then the camera framing it as drawn
    this.balloon.setState(pt, dt, this.sky.current, { pos: this.pos, camera: this.camera.position });
    this.balloon.mesh.getWorldPosition(this.target);
    Object.assign(this.dirPoint, pt);
    this.dirPoint.altM = y;
    this.director.update(this.dirPoint, dt, this.target);

    // near plane: just short of the nearest thing drawn close by (the balloon and its string, the person)
    const dB = this.camera.position.distanceTo(this.target);
    let near = (dB - 1.4 - 0.2 * displayScale(dB)) * 0.5;
    if (this.person) near = Math.min(near, (this.camera.position.distanceTo(this.person.root.position) - 0.6) * 0.5);
    const camGround = this.stream.groundAt(this.stream.fromScene(this.camera.position.x, this.camera.position.z));
    near = Math.min(near, (this.camera.position.y - camGround) * 0.5);
    this.camera.near = Math.min(10, Math.max(0.08, near));
    const far = hazeFarM(this.camera.position.y);
    this.camera.far = far * 1.25;
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
    this.sky.setView(this.camera, far * 0.75, this.renderer.getDrawingBufferSize(this.size).y / 2);

    // stream the world round the camera
    this.camera.getWorldDirection(this.look);
    const cll = this.stream.fromScene(this.camera.position.x, this.camera.position.z);
    const heading = (Math.atan2(this.look.x, -this.look.z) / D2R + 360) % 360;
    this.stream.update({ lat: cll.lat, lon: cll.lon, altM: this.camera.position.y, headingDeg: heading }, t);

    // clouds drift with the wind at cruise, and never take in the balloon or the camera
    const h = pt.headingDeg * D2R;
    this.clouds.setFocus(this.target, this.look);
    this.clouds.clearOf(this.target, 300);
    this.clouds.clearOf(this.camera.position, 300);
    this.clouds.update(dt, { u: pt.speedMs * Math.sin(h), v: pt.speedMs * Math.cos(h) });

    // the real sky over the balloon, once a second
    if (now - this.skyAt > 1000) {
      this.skyAt = now;
      const L = this.sky.update(now, pt);
      this.stream.materials.setGroundTint(L.groundTint);
    }

    // live shadows round the balloon, a little ahead of it
    const agl = Math.max(0, y - this.groundS);
    let redraw = this.sky.light.setRadius(shadowRadius(agl));
    const ahead = Math.min(400, agl * 0.4);
    this.focus.set(this.target.x + Math.sin(h) * ahead, this.groundS, this.target.z - Math.cos(h) * ahead);
    redraw = this.sky.place(this.focus) || redraw;
    if (this.shadowAsked > this.shadowDrawnAt && t - this.shadowDrawnAt > 250) redraw = true;
    if (redraw) {
      this.renderer.shadowMap.needsUpdate = true;
      this.shadowDrawnAt = t;
    }

    this.renderer.render(this.scene, this.camera);
    if (this.frames++ === 0) this.onFirstFrame?.();
    // reading pixels back stalls the pipeline: only when text sits over the scene and nothing is being
    // worked out (not during the launch, when only the clock shows)
    if (now - this.lumAt > 1000 && this.onLuminance && !this.measurePaused) {
      this.lumAt = now;
      this.measure();
    }

    // done with the person once the balloon is well away
    if (this.person && this.released && agl > 300 && !this.director.waiting) {
      this.person.dispose();
      this.person = null;
    }

    this.onFrame?.({
      now,
      point: pt,
      aglM: agl,
      groundM: this.groundS,
      feetM: this.feetS,
      released: this.released,
      landed,
      settled: this.director.shot !== 'launch',
      waiting: this.director.waiting,
      shot: this.director.shot,
      sunElevationDeg: this.sky.sun.elevationDeg,
    });
  };

  /** Read a few rows of the frame just drawn behind the top (170 px) and bottom (300 px) text. */
  private measure(): void {
    const gl = this.renderer.getContext();
    const W = gl.drawingBufferWidth, Hh = gl.drawingBufferHeight;
    if (W < 4 || Hh < 4) return;
    const pr = this.renderer.getPixelRatio();
    const band = (fromTopCss: number, toTopCss: number): Uint8Array => {
      const rows = 4;
      if (this.lumBuf.length !== W * 4 * rows) this.lumBuf = new Uint8Array(W * 4 * rows);
      const out = new Uint8Array(W * 4 * rows);
      for (let i = 0; i < rows; i++) {
        const yCss = fromTopCss + ((toTopCss - fromTopCss) * (i + 0.5)) / rows;
        const yGl = Math.max(0, Math.min(Hh - 1, Hh - 1 - Math.round(yCss * pr)));
        gl.readPixels(0, yGl, W, 1, gl.RGBA, gl.UNSIGNED_BYTE, this.lumBuf.subarray(i * W * 4, (i + 1) * W * 4));
      }
      out.set(this.lumBuf);
      return out;
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
