import * as THREE from 'three';
import type { RoutePoint } from '../flight/route';
import type { LatLon } from '../geo/coords';

/**
 * Directed camera (spec section 8). No free drag or spin: the camera hangs from the balloon.
 * Scene frame: x east, y up, z = -north, metres; the balloon's y is its altM.
 *
 * Note on the interface: the brief's `update(b, dtSec, groundAt)` became `deps.groundAt`.
 * The scene-to-LatLon inverse needed for the ground and building clamps is derived locally
 * from `toScene` (a linearisation around the balloon), so it is not part of the deps.
 *
 * The balloon is real size (about 0.15 m radius within 20 m, spec 6.2), so Ride hangs the camera about
 * a string's length (1.2 m) below and behind it. The app's camera near plane must be well under that
 * (0.05 m works).
 */
export type DirectorMode = 'film' | 'ride' | 'above' | 'side' | 'launch' | 'replay';
export type ShotName = 'launch' | 'ride' | 'circling' | 'side' | 'down' | 'replay';
export type DirectorEvent = 'coast' | 'sunset' | 'sunrise' | 'city' | 'landmark';

export type DirectorDeps = {
  toScene(p: LatLon): { x: number; z: number };
  groundAt(p: LatLon): number;
  /** Highest building top (absolute, like groundAt) within radiusM; ground or less where there is none. */
  buildingTopAt?(p: LatLon, radiusM: number): number;
  balloonRadius(distM: number): number;
  reducedMotion?: boolean;
};

/** Spring smooth time: error falls like (1 + 2t/T) e^(-2t/T), so about 1% after 4 s. */
export const SMOOTH_TIME_S = 1.2;
export const LAUNCH = { holdS: 1.2, tiltEndS: 8, handOverS: 20 } as const;
/** Ride: the balloon fills this share of the viewport height (spec 8: 18-35%). */
export const RIDE_FRACTION = 0.22; // of the radius model; the drawn teardrop and knot read about 1.28x taller (~28%)
const FILM_CYCLE: [ShotName, number][] = [['ride', 40], ['circling', 30], ['side', 30], ['down', 20]];
const FILM_CYCLE_REDUCED: [ShotName, number][] = [['ride', 40], ['circling', 30]];
const EVENT_SHOT: Record<DirectorEvent, ShotName> = {
  coast: 'side', sunset: 'side', sunrise: 'side', city: 'circling', landmark: 'circling',
};
const MIN_EVENT_GAP_S = 15;
const PENDING_EXPIRY_S = 30;
const EYE_M = 1.6;
const RAD = Math.PI / 180;
/** Launch, street phase: how far the camera may rise while it tilts up (0-8 s). */
const STREET_RISE_M = 0.9;
/** Launch, pull-back: the crane sits a few metres behind the balloon on the landmark line, a little below it. */
const CRANE_M = 6;
const CRANE_EL = 8 * RAD;
/** No building within this radius of the camera's ground point, or the camera goes over its roof. */
const STREET_CLEAR_M = 1.5;
/** The start screen frames the person and the held balloon: feet to the top of the balloon, about 2.6 m. */
const WAIT_SUBJECT_M = 2.6;

/** The interface curve cubic-bezier(0.22, 1, 0.36, 1), x -> y, no overshoot. */
export function easeOut(x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const [x1, y1, x2, y2] = [0.22, 1, 0.36, 1];
  const bez = (a: number, b: number, t: number) => 3 * a * (1 - t) ** 2 * t + 3 * b * (1 - t) * t * t + t ** 3;
  let lo = 0, hi = 1;
  for (let i = 0; i < 40; i++) {
    const m = (lo + hi) / 2;
    if (bez(x1, x2, m) < x) lo = m; else hi = m;
  }
  return bez(y1, y2, (lo + hi) / 2);
}
const smoothstep = (a: number, b: number, x: number) => {
  const u = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return u * u * (3 - 2 * u);
};
/** Slow in, slow out over [a, b]: camera moves are physical moves, not interface motion. */
const inOut = (a: number, b: number, x: number) => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, (x - a) / (b - a))));
const mix = (a: number, b: number, f: number) => a + (b - a) * f;
const wrapPi = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
type V3 = { x: number; y: number; z: number };
const finite3 = (v: V3) => Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);

/**
 * pos: where the camera wants to be. y0, x0: where the balloon sits in the frame (NDC; x0 defaults to 0);
 * the camera is aimed from wherever it actually is (after smoothing and clamps), so the framing holds even
 * while the position catches up, which matters a string's length from a 30 cm balloon.
 * anchor: per axis, how much of pos moves with the balloon (1) or stays put in the world (0).
 */
type Target = { pos: THREE.Vector3; y0: number; x0?: number; fov: number; anchor: V3 };
const pitchOf = (v: THREE.Vector3) => Math.atan2(v.y, Math.hypot(v.x, v.z));
/** The NDC height of the balloon B for a camera at pos looking at `look` (both in one vertical plane). */
function frameY(pos: THREE.Vector3, look: THREE.Vector3, B: THREE.Vector3, fovDeg: number): number {
  const a = pitchOf(B.clone().sub(pos)) - pitchOf(look.clone().sub(pos));
  return Math.max(-0.9, Math.min(0.9, Math.tan(a) / Math.tan((fovDeg * RAD) / 2)));
}
/**
 * Where the start screen leaves the scene free (NDC y, -1 bottom to 1 top): the band's centre and height.
 * While waiting, the person and the held balloon are framed inside it (spec 6.1: nothing on top of them).
 */
export type WaitFrame = { centerY: number; spanY: number };
/**
 * landmarkHeadingDeg: bearing from the person to the featured landmark (spec 6.2); omit (or NaN) when there is none.
 * waiting: hold a wider establishing shot of the person and the balloon (the start screen) until go().
 */
export type LaunchOpts = { personAt: LatLon; landmarkHeadingDeg?: number; startUtcMs: number; waiting?: WaitFrame };
const BALLOON: V3 = { x: 1, y: 1, z: 1 };
const WORLD: V3 = { x: 0, y: 0, z: 0 };

export class Director {
  mode: DirectorMode = 'ride';
  /** Pause control (spec 7.3): choreography freezes, the camera still follows the balloon rigidly. */
  paused = false;
  private _shot: ShotName = 'ride';
  private readonly reduced: boolean;
  private readonly tau: number;
  private clock = 0;
  private filmIdx = 0;
  private filmElapsed = 0;
  private lastSwitch = -Infinity;
  private pending: { kind: DirectorEvent; at: number } | null = null;
  private orbit = 0;
  private launchT = 0;
  private launchOpts: LaunchOpts | null = null;
  /** Last finite route heading, for frames whose heading is not finite. */
  private heading = Number.NaN;
  /** Street camera position for this launch (world), chosen on the first launch frame. */
  private street: THREE.Vector3 | null = null;
  /** Start screen: the establishing shot is held, and the launch clock waits, until go(). */
  private wait: WaitFrame | null = null;
  /** The establishing shot's camera position (world), chosen once per launch. */
  private wide: THREE.Vector3 | null = null;
  /** Which way the pull-back swings round the balloon (chosen once, so it never flips mid-move). */
  private swing: [number, number] = [0, 0];
  private afterLaunch: DirectorMode = 'film';
  private ready = false;
  private prevB = new THREE.Vector3();
  private pos = new THREE.Vector3();
  private y0 = 0.5;
  private x0 = 0;
  private x0V = 0;
  private posV = new THREE.Vector3();
  private y0V = 0;
  private fov = 50;
  private fovV = 0;

  constructor(private readonly camera: THREE.PerspectiveCamera, private readonly deps: DirectorDeps) {
    this.reduced = !!deps.reducedMotion;
    this.tau = SMOOTH_TIME_S * (this.reduced ? 2 : 1);
  }

  /** The shot actually on screen (film resolves to one of the five). */
  get shot(): ShotName {
    return this._shot;
  }

  /** View buttons: film is automatic, above is circling. Ignored for 'launch'; applied after the launch if one is running. */
  set(mode: DirectorMode): void {
    if (mode === 'launch') return;
    if (this._shot === 'launch') {
      this.afterLaunch = mode;
      return;
    }
    this.enter(mode);
  }

  private enter(mode: DirectorMode): void {
    this.mode = mode;
    this.pending = null;
    if (mode === 'film') {
      this.filmIdx = 0;
      this.filmElapsed = 0;
      this.switchShot('ride');
    } else {
      this.switchShot(mode === 'above' ? 'circling' : mode === 'side' ? 'side' : mode === 'replay' ? 'replay' : 'ride');
    }
  }

  private switchShot(s: ShotName): void {
    if (s !== this._shot) this.orbit = Number.NaN; // circling re-seeds from the heading
    this._shot = s;
    this.lastSwitch = this.clock;
  }

  /** Film mode only. Switches to a fitting shot, at most about every 15 s; a too-early event waits. */
  event(kind: DirectorEvent): void {
    if (this.mode !== 'film') return;
    this.pending = { kind, at: this.clock };
    this.tryPending();
  }

  private tryPending(): void {
    const p = this.pending;
    if (!p || this.mode !== 'film') return;
    if (this.clock - p.at > PENDING_EXPIRY_S) { this.pending = null; return; }
    if (this.clock - this.lastSwitch < MIN_EVENT_GAP_S) return;
    this.pending = null;
    let s = EVENT_SHOT[p.kind];
    if (this.reduced && s !== 'ride' && s !== 'circling') s = 'ride';
    if (s === this._shot) return;
    const cycle = this.reduced ? FILM_CYCLE_REDUCED : FILM_CYCLE;
    const i = cycle.findIndex(([n]) => n === s);
    this.filmIdx = Math.max(0, i);
    this.filmElapsed = 0;
    this.switchShot(s);
  }

  /** Street-level launch shot; runs 20 s from this call, then hands over to film (whose first shot is ride) (or a view chosen meanwhile). */
  setLaunch(opts: LaunchOpts): void {
    this.launchOpts = opts;
    this.launchT = 0;
    this.afterLaunch = 'film';
    this.mode = 'launch';
    this._shot = 'launch';
    this.street = null;
    this.wide = null;
    this.wait = opts.waiting ? { ...opts.waiting } : null;
    this.swing = [0, 0];
    this.ready = false; // first frame snaps to the street position
  }

  /** Waiting for Let go (the start screen's establishing shot). */
  get waiting(): boolean {
    return this._shot === 'launch' && this.wait !== null;
  }

  /** The free band moved (the start screen's layout changed): reframe the waiting shot. */
  setWaitFrame(f: WaitFrame): void {
    if (this.wait) this.wait = { ...f };
  }

  /** Let go: the launch timeline starts from 0, and the camera moves in from the establishing shot. */
  go(): void {
    if (!this.wait) return;
    this.wait = null;
    this.launchT = 0;
  }

  /**
   * One frame. `target` (optional) is the balloon's drawn scene position (its mesh's world position), which
   * the camera frames instead of the route position; without it (or if it is not finite) the route is used.
   */
  update(b: RoutePoint, dtSec: number, target?: V3): void {
    const dtFull = Number.isFinite(dtSec) ? Math.max(0, dtSec) : 0;
    const bs = this.deps.toScene(b);
    if (!Number.isFinite(bs.x) || !Number.isFinite(bs.z) || !Number.isFinite(b.altM)) return; // skip the frame, state untouched
    const B0 = new THREE.Vector3(bs.x, b.altM, bs.z); // route position: the base for scene-to-LatLon
    const B = target && finite3(target) ? new THREE.Vector3(target.x, target.y, target.z) : B0.clone();
    // Choreography clocks take small steps (a backgrounded tab must not skip shots); the spring gets the full dt to catch up.
    const dt = this.paused ? 0 : Math.min(dtFull, 1);

    if (this.paused && this.ready) {
      const shift = B.clone().sub(this.prevB);
      this.pos.add(shift);
      this.prevB.copy(B);
      this.apply(b, B, B0);
      return;
    }
    this.clock += dt;

    if (this._shot === 'launch') {
      if (!this.wait) this.launchT += dt;
      if (this.launchT >= LAUNCH.handOverS) {
        this.enter(this.afterLaunch);
        this.lastSwitch = this.clock;
      }
    } else if (this.mode === 'film') {
      this.filmElapsed += dt;
      const cycle = this.reduced ? FILM_CYCLE_REDUCED : FILM_CYCLE;
      if (this.filmElapsed >= cycle[this.filmIdx][1]) {
        this.filmElapsed -= cycle[this.filmIdx][1];
        this.filmIdx = (this.filmIdx + 1) % cycle.length;
        this.switchShot(cycle[this.filmIdx][0]);
      }
      this.tryPending();
    }

    // Circling: never constant angular speed (a slow beat of +-45% around 2 deg/s).
    const scale = this.reduced ? 0.5 : 1;
    if (Number.isNaN(this.orbit)) this.orbit = (b.headingDeg + 100) * RAD;
    this.orbit += 0.035 * scale * (1 + 0.45 * Math.sin((2 * Math.PI * this.clock) / 47)) * dt;

    const tg = this.target(b, B, B0);

    if (!this.ready) {
      this.pos.copy(tg.pos);
      this.y0 = tg.y0;
      this.x0 = tg.x0 ?? 0;
      this.x0V = 0;
      this.fov = tg.fov;
      this.posV.set(0, 0, 0);
      this.y0V = 0;
      this.fovV = 0;
      this.ready = true;
    } else {
      // Smooth in the moving frame: what is anchored to the balloon follows it with no lag.
      const shift = B.clone().sub(this.prevB);
      this.pos.x += shift.x * tg.anchor.x;
      this.pos.y += shift.y * tg.anchor.y;
      this.pos.z += shift.z * tg.anchor.z;
    }
    this.prevB.copy(B);

    spring3(this.pos, this.posV, tg.pos, this.tau, dtFull);
    [this.y0, this.y0V] = spring1(this.y0, this.y0V, tg.y0, this.tau, dtFull);
    [this.x0, this.x0V] = spring1(this.x0, this.x0V, tg.x0 ?? 0, this.tau, dtFull);
    [this.fov, this.fovV] = spring1(this.fov, this.fovV, tg.fov, this.tau, dtFull);
    this.apply(b, B, B0);
  }

  private apply(b: RoutePoint, B: THREE.Vector3, B0: THREE.Vector3): void {
    const out = this.pos.clone();
    this.clamp(out, b, B, B0);
    this.camera.position.copy(out);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.aim(out, B, this.y0, this.fov, this.x0));
    if (Math.abs(this.camera.fov - this.fov) > 1e-6) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
    this.camera.updateMatrixWorld(true);
  }

  /** Distance at which a balloon fills `frac` of the viewport height (fixed point, radius depends on distance). */
  private distFor(frac: number, fovDeg: number, min: number, max: number): number {
    const k = frac * Math.tan((fovDeg * RAD) / 2);
    let d = 40;
    for (let i = 0; i < 12; i++) d = this.deps.balloonRadius(d) / k;
    return Math.min(max, Math.max(min, d));
  }

  /** tan of the horizontal half field of view for a vertical fov in degrees. */
  private tanH(fovDeg: number): number {
    const aspect = Number.isFinite(this.camera.aspect) && this.camera.aspect > 0 ? this.camera.aspect : 1;
    return Math.tan((fovDeg * RAD) / 2) * aspect;
  }

  /** A point to look at that puts the balloon at NDC (x0, y0) for a camera at pos (fov in degrees). */
  private aim(pos: THREE.Vector3, B: THREE.Vector3, y0: number, fovDeg: number, x0 = 0): THREE.Vector3 {
    const v = B.clone().sub(pos);
    const dist = v.length();
    if (!(dist > 1e-6)) return B.clone().add(new THREE.Vector3(0, -1, -1));
    const yaw = Math.atan2(v.x, -v.z) - Math.atan(x0 * this.tanH(fovDeg));
    const pitchB = Math.atan2(v.y, Math.hypot(v.x, v.z));
    // keep off the pole so lookAt's up vector stays defined
    const pitch = Math.min(1.45, Math.max(-1.45, pitchB - Math.atan(y0 * Math.tan((fovDeg * RAD) / 2))));
    const d = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
    return pos.clone().addScaledVector(d, dist);
  }

  private target(b: RoutePoint, B: THREE.Vector3, B0: THREE.Vector3): Target {
    // a non-finite heading falls back to the last good one, then to the landmark bearing, then north
    if (Number.isFinite(b.headingDeg)) this.heading = b.headingDeg;
    const lm = this.launchOpts?.landmarkHeadingDeg;
    const hd = Number.isFinite(this.heading) ? this.heading : lm !== undefined && Number.isFinite(lm) ? lm : 0;
    const h = hd * RAD;
    const dir = new THREE.Vector3(Math.sin(h), 0, -Math.cos(h)); // where the wind carries it
    const right = new THREE.Vector3(-dir.z, 0, dir.x);
    switch (this._shot) {
      case 'launch': return this.launchTarget(b, B, B0, dir, right);
      case 'circling': return this.circling(B);
      case 'side': return this.side(B, dir, right);
      case 'down': return this.down(B, dir);
      case 'replay': return this.replay(B, dir);
      default: return this.ride(B, dir, right);
    }
  }

  /**
   * A camera tied to the string: just below and behind, the balloon large at the top of the frame, looking
   * forward and down. The distance comes from the projected-height target with the balloon's real radius
   * (about 1.2 m for the real-size balloon, roughly the string's length); it is only kept outside the
   * balloon and its string here and above ground and buildings by the clamp.
   */
  private ride(B: THREE.Vector3, dir: THREE.Vector3, right: THREE.Vector3): Target {
    const fov = 50;
    const d = this.distFor(RIDE_FRACTION, fov, 0.9, 400);
    const e = 8 * RAD; // balloon is 8 deg above the camera
    const pos = B.clone().addScaledVector(dir, -d * Math.cos(e));
    pos.y -= d * Math.sin(e);
    if (!this.reduced) {
      // slow sway, off in reduced motion so the framing is fixed; scaled with the distance (a hanging camera)
      pos.addScaledVector(right, Math.sin(this.clock * 0.3) * Math.min(0.8, 0.08 * d));
      pos.y += Math.sin(this.clock * 0.5) * Math.min(0.4, 0.04 * d);
    }
    // The balloon centre at NDC y = 0.52 (top edge well inside the frame), aimed from where the camera hangs.
    return { pos, y0: 0.52, fov, anchor: BALLOON };
  }

  private circling(B: THREE.Vector3): Target {
    const fov = 34;
    const d = this.distFor(0.1, fov, 60, 500);
    const el = 38 * RAD;
    const pos = B.clone().add(new THREE.Vector3(Math.sin(this.orbit) * d * Math.cos(el), d * Math.sin(el), -Math.cos(this.orbit) * d * Math.cos(el)));
    const look = B.clone();
    look.y -= 0.15 * d;
    return { pos, y0: frameY(pos, look, B, fov), fov, anchor: BALLOON };
  }

  private side(B: THREE.Vector3, dir: THREE.Vector3, right: THREE.Vector3): Target {
    const fov = 40;
    const d = this.distFor(0.14, fov, 25, 500);
    const sway = Math.sin(this.clock * 0.2) * 3 * (this.reduced ? 0.5 : 1);
    const pos = B.clone().addScaledVector(right, d).addScaledVector(dir, sway);
    pos.y += 0.03 * d;
    const look = B.clone();
    look.y -= 0.1 * d; // slight look-down keeps the horizon in the upper frame, land or sea below
    return { pos, y0: frameY(pos, look, B, fov), fov, anchor: BALLOON };
  }

  private down(B: THREE.Vector3, dir: THREE.Vector3): Target {
    const fov = 40;
    const d = this.distFor(0.08, fov, 60, 600);
    const pos = B.clone().addScaledVector(dir, -0.1 * d);
    pos.y += d;
    const look = B.clone().addScaledVector(dir, 0.1 * d);
    return { pos, y0: frameY(pos, look, B, fov), fov, anchor: BALLOON };
  }

  /** High wide follow shot. Task 18 refines it. */
  private replay(B: THREE.Vector3, dir: THREE.Vector3): Target {
    const fov = 45;
    const d = this.distFor(0.04, fov, 200, 4000);
    const pos = B.clone().addScaledVector(dir, -0.55 * d);
    pos.y += 0.7 * d;
    const look = B.clone().addScaledVector(dir, 0.1 * d);
    look.y -= 0.05 * d;
    return { pos, y0: frameY(pos, look, B, fov), fov, anchor: BALLOON };
  }

  /** Unit bearing from the person to the featured landmark, or null when there is none. */
  private landmarkDir(): THREE.Vector3 | null {
    const lm = this.launchOpts?.landmarkHeadingDeg;
    if (lm === undefined || !Number.isFinite(lm)) return null;
    return new THREE.Vector3(Math.sin(lm * RAD), 0, -Math.cos(lm * RAD));
  }

  /**
   * Street camera, chosen once per launch, at eye height. The first spot with no building on it wins.
   * With a featured landmark (spec 6.2: in view during the launch) the camera stands beyond the person from
   * it, camera -> person -> landmark roughly in line, 5-12 m back and 0.7-4 m to the side the balloon drifts
   * to (so the rising balloon crosses the landmark line and the person, at eye level, stands beside it
   * rather than over it). That is skipped when the wind would carry the balloon back over the camera within
   * the tilt even from 12 m (landmark well upwind), or when every such spot is blocked. Otherwise (and with
   * no landmark): a few metres upwind of the person and a little to one side, so the balloon drifts away
   * from it, never over it, and the person stays in the bottom of a narrow portrait frame while it tilts up.
   * The director cannot see occlusion: the app must put the person where the landmark has a sightline.
   */
  private streetPos(b: RoutePoint, B0: THREE.Vector3, dir: THREE.Vector3, right: THREE.Vector3): THREE.Vector3 {
    if (this.street) return this.street;
    const o = this.launchOpts!;
    const ps = this.deps.toScene(o.personAt);
    const P = new THREE.Vector3(ps.x, 0, ps.z);
    const spots: THREE.Vector3[] = [];
    const Ld = this.landmarkDir();
    if (Ld) {
      // Fit the balloon's drift to the landmark line within a narrow portrait frame over 0.5-4 s: further
      // back for a crosswind, and to the side the balloon drifts to, by just enough that its bearing swings
      // evenly across the line (as far off it at 0.5 s as at 4 s). Further back still if the landmark is
      // upwind, so the balloon is still in front of the camera at 8 s; past 12 m that is not possible.
      const Rd = new THREE.Vector3(-Ld.z, 0, Ld.x);
      const v = Number.isFinite(b.speedMs) ? Math.max(1.5, b.speedMs) : 2.5;
      const s4 = v * (4 - LAUNCH.holdS), s8 = v * (LAUNCH.tiltEndS - LAUNCH.holdS);
      const wL = dir.dot(Ld), wR = dir.dot(Rd);
      let back = 5 + 6 * Math.abs(wR);
      if (back + s8 * wL < 3) back = 3 - s8 * wL;
      if (back <= 12) {
        const den = 2 * back + s4 * wL;
        const side = (den > 1 ? Math.min(4, Math.max(0.7, (back * s4 * Math.abs(wR)) / den)) : 0.7) * (wR >= 0 ? 1 : -1);
        const set: [number, number][] = [[back, side], [back, -side], [back + 2, side], [back * 0.7, side], [back + 2, -side], [back * 0.7, -side]];
        for (const [bk, sd] of set) spots.push(P.clone().addScaledVector(Ld, -bk).addScaledVector(Rd, sd));
      }
    }
    const upwind: [number, number][] = [[-4.2, 0.9], [-4.2, -0.9], [-4, 2.5], [-4, -2.5], [-1, 2.8], [-1, -2.8], [-2.5, 1.2], [-2.5, -1.2]];
    for (const [back, side] of upwind) spots.push(P.clone().addScaledVector(dir, back).addScaledVector(right, side));
    let pick: THREE.Vector3 | null = null;
    for (const c of spots) {
      const ll = this.fromScene(c.x, c.z, b, B0);
      const g = this.deps.groundAt(ll);
      if (!Number.isFinite(g) || !Number.isFinite(c.x) || !Number.isFinite(c.z)) continue;
      if (this.deps.buildingTopAt && this.deps.buildingTopAt(ll, STREET_CLEAR_M) > g + 0.5) continue;
      pick = c.setY(g + EYE_M);
      break;
    }
    if (!pick) pick = P.clone().addScaledVector(dir, -1.5).setY(this.deps.groundAt(o.personAt) + EYE_M);
    if (!finite3(pick)) return P.clone().setY(EYE_M); // never cache a non-finite spot; try again next frame
    this.street = pick;
    return pick;
  }

  /**
   * Spec 8 launch. 0-1.2 s: low at street level beside the person, the person and the balloon in the shot
   * (and the featured landmark beyond them, which the view leans toward until 8 s).
   * 1.2-8 s: the camera stays at eye height (rising under a metre) and tilts up with the balloon (fov 40-44), past the
   * rooftops. 8-20 s: it climbs and catches up, swinging round to a few metres behind the balloon on the
   * landmark line (the crane, a little below it, so the landmark sits under it as the view widens to show
   * the place), and from 14.5 s closes in to the Ride framing, which it reaches at 19 s, so the hand-over
   * at 20 s is seamless. Horizontal moves interpolate round the balloon (distance and bearing), never
   * through it. The balloon stays in the frame throughout (the camera is aimed at it every frame).
   */
  private launchTarget(b: RoutePoint, B: THREE.Vector3, B0: THREE.Vector3, dir: THREE.Vector3, right: THREE.Vector3): Target {
    const t = this.launchT;
    const S = this.streetPos(b, B0, dir, right);
    if (this.wait) return this.waitTarget(b, B, B0, S, this.wait);
    const k = inOut(LAUNCH.holdS, LAUNCH.tiltEndS, t);
    const street = S.clone();
    street.y += STREET_RISE_M * k;
    const fovStreet = 40 + 4 * k;
    const yStreet = 0.6 - 0.4 * k; // balloon high in the frame over the person, then nearer the middle
    const Lm = this.landmarkDir();
    // With a landmark, swing the view from the balloon toward it: the two share the frame symmetrically, the
    // balloon kept within 0.6 of the centre (it always wins).
    let xStreet = 0;
    if (Lm) {
      const v = B.clone().sub(street);
      const d = wrapPi(Math.atan2(v.x, -v.z) - Math.atan2(Lm.x, -Lm.z));
      const dd = Math.max(-1.2, Math.min(1.2, d));
      xStreet = Math.max(-0.6, Math.min(0.6, (0.5 * Math.tan(dd)) / this.tanH(fovStreet)));
    }
    if (t < LAUNCH.tiltEndS) {
      return { pos: street, y0: yStreet, x0: xStreet, fov: fovStreet, anchor: WORLD };
    }
    const av = inOut(8, 12.5, t); // climb first
    const ah = inOut(8.5, 14, t); // and catch up, swinging round to the landmark side
    const c = inOut(14.5, 19, t); // then close in to ride
    const Ld = Lm ?? dir; // no landmark: the crane sits behind the balloon on the wind line
    const crane = Ld.clone().multiplyScalar(-CRANE_M * Math.cos(CRANE_EL));
    crane.y = -CRANE_M * Math.sin(CRANE_EL);
    const ride = this.ride(B, dir, right);
    const off1 = this.polarMix(street.clone().sub(B), crane, ah, av, 0);
    const off = this.polarMix(off1, ride.pos.clone().sub(B), c, c, 1);
    const pos = B.clone().add(off);
    const fov = mix(mix(fovStreet, 50, ah), ride.fov, c);
    const y0 = mix(mix(yStreet, 0.3, ah), 0.52, c);
    const wh = ah + (1 - ah) * c, wv = av + (1 - av) * c;
    return { pos, y0, x0: xStreet * (1 - ah), fov, anchor: { x: wh, y: wv, z: wh } };
  }

  /**
   * The start screen's establishing shot: on the street camera's line through the person (so the
   * launch push-in is a straight move in), far enough back that the person and the held balloon fill
   * about 70% of the free band, centred in it. The first spot that is not in a building and has no
   * building between it and the person wins; nearer spots are tried, down to the street spot itself.
   */
  private waitTarget(b: RoutePoint, B: THREE.Vector3, B0: THREE.Vector3, S: THREE.Vector3, w: WaitFrame): Target {
    const fov = 40;
    const tanV = Math.tan((fov * RAD) / 2);
    const span = Math.min(1.6, Math.max(0.3, w.spanY));
    const o = this.launchOpts!;
    const ps = this.deps.toScene(o.personAt);
    const gP = this.deps.groundAt(o.personAt);
    if (!this.wide) {
      const u = new THREE.Vector3(ps.x - S.x, 0, ps.z - S.z);
      const len = u.length();
      if (len > 1e-6) u.divideScalar(len); else u.set(0, 0, -1);
      const H = WAIT_SUBJECT_M;
      const want = Math.min(18, Math.max(6, H / (0.7 * (span / 2) * tanV * 2)));
      const clear = (c: THREE.Vector3): boolean => {
        const ll = this.fromScene(c.x, c.z, b, B0);
        const g = this.deps.groundAt(ll);
        if (!Number.isFinite(g)) return false;
        if (!this.deps.buildingTopAt) return true;
        if (this.deps.buildingTopAt(ll, STREET_CLEAR_M) > g + 0.5) return false;
        for (const f of [0.2, 0.4, 0.6, 0.8]) {
          const q = this.fromScene(c.x + (ps.x - c.x) * f, c.z + (ps.z - c.z) * f, b, B0);
          if (this.deps.buildingTopAt(q, 0.6) > this.deps.groundAt(q) + 1) return false;
        }
        return true;
      };
      let pick: THREE.Vector3 | null = null;
      for (const k of [1, 0.85, 0.7, 0.55, 0.42]) {
        const c = new THREE.Vector3(ps.x, 0, ps.z).addScaledVector(u, -want * k);
        if (clear(c)) {
          pick = c.setY(this.deps.groundAt(this.fromScene(c.x, c.z, b, B0)) + EYE_M);
          break;
        }
      }
      if (!pick || !finite3(pick)) pick = S.clone();
      this.wide = pick;
    }
    const C = this.wide;
    const dh = Math.max(0.5, Math.hypot(ps.x - C.x, ps.z - C.z));
    // nearer than wanted (a building behind): widen the view so the subject still fits the band
    const tanW = Math.max(tanV, Math.min(Math.tan(35 * RAD), WAIT_SUBJECT_M / (0.7 * span * dh)));
    const fovW = (2 * Math.atan(tanW)) / RAD;
    const mid = gP + WAIT_SUBJECT_M / 2;
    const camPitch = Math.atan2(mid - C.y, dh) - Math.atan(w.centerY * tanW);
    const y0 = Math.max(-0.9, Math.min(0.9, Math.tan(Math.atan2(B.y - C.y, Math.hypot(B.x - C.x, B.z - C.z)) - camPitch) / tanW));
    return { pos: C.clone(), y0, x0: 0, fov: fovW, anchor: WORLD };
  }

  /** Blend two balloon-relative offsets by horizontal distance (log), bearing and height. */
  private polarMix(a: THREE.Vector3, b: THREE.Vector3, wh: number, wv: number, slot: 0 | 1): THREE.Vector3 {
    if (wh <= 0 && wv <= 0) return a.clone();
    const ra = Math.max(0.05, Math.hypot(a.x, a.z)), rb = Math.max(0.05, Math.hypot(b.x, b.z));
    const aza = Math.atan2(a.x, a.z), azb = Math.atan2(b.x, b.z);
    let dAz = wrapPi(azb - aza);
    // the swing direction is chosen once, so a near half-turn never flips sides from frame to frame
    if (this.swing[slot] === 0) this.swing[slot] = dAz >= 0 ? 1 : -1;
    else if (Math.sign(dAz) !== this.swing[slot] && Math.abs(dAz) > Math.PI / 2) dAz += 2 * Math.PI * this.swing[slot];
    const r = Math.exp(mix(Math.log(ra), Math.log(rb), wh));
    const az = aza + dAz * wh;
    return new THREE.Vector3(r * Math.sin(az), mix(a.y, b.y, wv), r * Math.cos(az));
  }

  /**
   * Applied after smoothing. Outside the balloon and its string; then never inside terrain or buildings:
   * ground + 8 m, building tops within 30 m + 3 m, and always at least 1 m over any building within 1.5 m
   * (never inside one; the same radius the street camera's spot is checked with). During the launch the
   * street phase is exempt from the 8 m and 30 m rules (the camera stands on the street beside the person):
   * the 8 m rule fades in over 8-12.5 s while the camera climbs, and the 30 m rule over 8-20 s, so a camera
   * catching up with a balloon still below the rooftops is not lifted over it to look down on it.
   */
  private clamp(p: THREE.Vector3, b: RoutePoint, B: THREE.Vector3, B0: THREE.Vector3): void {
    // balloon: a sphere a little bigger than it, and a narrow column below it where the string hangs
    const v = p.clone().sub(B);
    const dist = v.length();
    const gap = 0.6 + 2 * this.deps.balloonRadius(dist);
    if (dist < gap) {
      if (dist > 1e-6) p.copy(B).addScaledVector(v, gap / dist);
      else p.copy(B).add(new THREE.Vector3(0, -gap, 0));
    }
    const below = B.y - p.y;
    const hr = Math.hypot(p.x - B.x, p.z - B.z);
    if (below > 0 && below < 2 && hr < 0.4) {
      if (hr > 1e-6) {
        p.x = B.x + ((p.x - B.x) * 0.4) / hr;
        p.z = B.z + ((p.z - B.z) * 0.4) / hr;
      } else p.x = B.x + 0.4;
    }

    const ll = this.fromScene(p.x, p.z, b, B0);
    let clearance = 8;
    let wBuild = 1;
    if (this._shot === 'launch') {
      clearance = 1.2 + (8 - 1.2) * smoothstep(LAUNCH.tiltEndS, 12.5, this.launchT);
      wBuild = smoothstep(LAUNCH.tiltEndS, LAUNCH.handOverS, this.launchT);
    }
    let floor = this.deps.groundAt(ll) + clearance;
    if (this.deps.buildingTopAt) {
      if (wBuild > 0) {
        const top = this.deps.buildingTopAt(ll, 30) + 3;
        if (top > floor) floor += (top - floor) * wBuild;
      }
      floor = Math.max(floor, this.deps.buildingTopAt(ll, STREET_CLEAR_M) + 1);
    }
    if (p.y < floor) p.y = floor;
  }

  /** Inverse of toScene near the balloon, from a finite-difference Jacobian. */
  private fromScene(x: number, z: number, b: RoutePoint, B: THREE.Vector3): LatLon {
    // B is the route's own scene position (not a drawn-balloon override)
    const h = 0.001;
    const dN = this.deps.toScene({ lat: b.lat + h, lon: b.lon });
    const dE = this.deps.toScene({ lat: b.lat, lon: b.lon + h });
    const a = (dN.x - B.x) / h, c = (dN.z - B.z) / h; // d(x,z)/dLat
    const e = (dE.x - B.x) / h, f = (dE.z - B.z) / h; // d(x,z)/dLon
    const det = a * f - e * c;
    if (Math.abs(det) < 1e-9) return { lat: b.lat, lon: b.lon };
    const dx = x - B.x, dz = z - B.z;
    return { lat: b.lat + (f * dx - e * dz) / det, lon: b.lon + (-c * dx + a * dz) / det };
  }
}

/** Exact critically damped step toward a fixed target; smooth time T (omega = 2 / T). */
function spring1(x: number, v: number, target: number, T: number, dt: number): [number, number] {
  const w = 2 / T;
  const ex = Math.exp(-w * dt);
  const d = x - target;
  const tmp = v + w * d;
  return [target + (d + tmp * dt) * ex, (v - w * tmp * dt) * ex];
}
function spring3(x: THREE.Vector3, v: THREE.Vector3, target: THREE.Vector3, T: number, dt: number): void {
  for (const k of ['x', 'y', 'z'] as const) {
    const [nx, nv] = spring1(x[k], v[k], target[k], T, dt);
    x[k] = nx;
    v[k] = nv;
  }
}
