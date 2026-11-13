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
 */
export type DirectorMode = 'film' | 'ride' | 'above' | 'side' | 'launch' | 'replay';
export type ShotName = 'launch' | 'ride' | 'circling' | 'side' | 'down' | 'replay';
export type DirectorEvent = 'coast' | 'sunset' | 'sunrise' | 'city' | 'landmark';

export type DirectorDeps = {
  toScene(p: LatLon): { x: number; z: number };
  groundAt(p: LatLon): number;
  buildingTopAt?(p: LatLon, radiusM: number): number;
  balloonRadius(distM: number): number;
  reducedMotion?: boolean;
};

/** Spring smooth time: error falls like (1 + 2t/T) e^(-2t/T), so about 1% after 4 s. */
export const SMOOTH_TIME_S = 1.2;
export const LAUNCH = { holdS: 1.2, tiltEndS: 8, handOverS: 20 } as const;
const FILM_CYCLE: [ShotName, number][] = [['ride', 40], ['circling', 30], ['side', 30], ['down', 20]];
const FILM_CYCLE_REDUCED: [ShotName, number][] = [['ride', 40], ['circling', 30]];
const EVENT_SHOT: Record<DirectorEvent, ShotName> = {
  coast: 'side', sunset: 'side', sunrise: 'side', city: 'circling', landmark: 'circling',
};
const MIN_EVENT_GAP_S = 15;
const PENDING_EXPIRY_S = 30;
const EYE_M = 1.6;
const RAD = Math.PI / 180;

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

type Target = { pos: THREE.Vector3; look: THREE.Vector3; fov: number; anchor: 'world' | 'balloon' };

export class Director {
  mode: DirectorMode = 'ride';
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
  private launchOpts: { personAt: LatLon; landmarkHeadingDeg: number; startUtcMs: number } | null = null;
  private afterLaunch: DirectorMode = 'ride';
  private ready = false;
  private prevB = new THREE.Vector3();
  private pos = new THREE.Vector3();
  private look = new THREE.Vector3();
  private posV = new THREE.Vector3();
  private lookV = new THREE.Vector3();
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

  /** Street-level launch shot; runs 20 s from this call, then hands over to ride (or a view chosen meanwhile). */
  setLaunch(opts: { personAt: LatLon; landmarkHeadingDeg: number; startUtcMs: number }): void {
    this.launchOpts = opts;
    this.launchT = 0;
    this.afterLaunch = 'ride';
    this.mode = 'launch';
    this._shot = 'launch';
    this.ready = false; // first frame snaps to the street position
  }

  update(b: RoutePoint, dtSec: number): void {
    const dt = Math.max(0, dtSec);
    this.clock += dt;
    const bs = this.deps.toScene(b);
    const B = new THREE.Vector3(bs.x, b.altM, bs.z);

    if (this._shot === 'launch') {
      this.launchT += dt;
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

    const tg = this.target(b, B);

    if (!this.ready) {
      this.pos.copy(tg.pos);
      this.look.copy(tg.look);
      this.fov = tg.fov;
      this.posV.set(0, 0, 0);
      this.lookV.set(0, 0, 0);
      this.fovV = 0;
      this.ready = true;
    } else if (tg.anchor === 'balloon') {
      const shift = B.clone().sub(this.prevB);
      this.pos.add(shift);
      this.look.add(shift);
    }
    this.prevB.copy(B);

    spring3(this.pos, this.posV, tg.pos, this.tau, dt);
    spring3(this.look, this.lookV, tg.look, this.tau, dt);
    [this.fov, this.fovV] = spring1(this.fov, this.fovV, tg.fov, this.tau, dt);

    const out = this.pos.clone();
    this.clamp(out, b, B);
    this.camera.position.copy(out);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.look);
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

  private target(b: RoutePoint, B: THREE.Vector3): Target {
    const h = b.headingDeg * RAD;
    const dir = new THREE.Vector3(Math.sin(h), 0, -Math.cos(h)); // where the wind carries it
    const right = new THREE.Vector3(-dir.z, 0, dir.x);
    switch (this._shot) {
      case 'launch': return this.launchTarget(B, dir);
      case 'circling': return this.circling(B);
      case 'side': return this.side(B, dir, right);
      case 'down': return this.down(B, dir);
      case 'replay': return this.replay(B, dir);
      default: return this.ride(B, dir, right);
    }
  }

  /** Just below and behind, balloon large near the top of the frame, looking forward and down. */
  private ride(B: THREE.Vector3, dir: THREE.Vector3, right: THREE.Vector3): Target {
    const fov = 50;
    const d = this.distFor(0.26, fov, 6, 400);
    const e = 8 * RAD; // balloon is 8 deg above the camera
    const pos = B.clone().addScaledVector(dir, -d * Math.cos(e));
    pos.y -= d * Math.sin(e);
    if (!this.reduced) {
      // slow bob, off in reduced motion so the framing is fixed
      pos.addScaledVector(right, Math.sin(this.clock * 0.3) * 0.8);
      pos.y += Math.sin(this.clock * 0.5) * 0.4;
    }
    // Put the balloon centre at NDC y = 0.52: tilt the view down by that angle below the line to it.
    const phi = Math.atan(0.52 * Math.tan((fov * RAD) / 2));
    const p = e - phi;
    const look = pos.clone().addScaledVector(dir, Math.cos(p) * 200);
    look.y += Math.sin(p) * 200;
    return { pos, look, fov, anchor: 'balloon' };
  }

  private circling(B: THREE.Vector3): Target {
    const fov = 34;
    const d = this.distFor(0.1, fov, 60, 500);
    const el = 38 * RAD;
    const pos = B.clone().add(new THREE.Vector3(Math.sin(this.orbit) * d * Math.cos(el), d * Math.sin(el), -Math.cos(this.orbit) * d * Math.cos(el)));
    const look = B.clone();
    look.y -= 0.15 * d;
    return { pos, look, fov, anchor: 'balloon' };
  }

  private side(B: THREE.Vector3, dir: THREE.Vector3, right: THREE.Vector3): Target {
    const fov = 40;
    const d = this.distFor(0.14, fov, 25, 500);
    const sway = Math.sin(this.clock * 0.2) * 3 * (this.reduced ? 0.5 : 1);
    const pos = B.clone().addScaledVector(right, d).addScaledVector(dir, sway);
    pos.y += 0.03 * d;
    const look = B.clone();
    look.y -= 0.1 * d; // slight look-down keeps the horizon in the upper frame, land or sea below
    return { pos, look, fov, anchor: 'balloon' };
  }

  private down(B: THREE.Vector3, dir: THREE.Vector3): Target {
    const fov = 40;
    const d = this.distFor(0.08, fov, 60, 600);
    const pos = B.clone().addScaledVector(dir, -0.1 * d);
    pos.y += d;
    const look = B.clone().addScaledVector(dir, 0.1 * d);
    return { pos, look, fov, anchor: 'balloon' };
  }

  /** High wide follow shot. Task 18 refines it. */
  private replay(B: THREE.Vector3, dir: THREE.Vector3): Target {
    const fov = 45;
    const d = this.distFor(0.04, fov, 200, 4000);
    const pos = B.clone().addScaledVector(dir, -0.55 * d);
    pos.y += 0.7 * d;
    const look = B.clone().addScaledVector(dir, 0.1 * d);
    look.y -= 0.05 * d;
    return { pos, look, fov, anchor: 'balloon' };
  }

  private launchTarget(B: THREE.Vector3, dir: THREE.Vector3): Target {
    const o = this.launchOpts!;
    const t = this.launchT;
    const ps = this.deps.toScene(o.personAt);
    const g = this.deps.groundAt(o.personAt);
    const lh = o.landmarkHeadingDeg * RAD;
    const Ld = new THREE.Vector3(Math.sin(lh), 0, -Math.cos(lh));
    const Rd = new THREE.Vector3(-Ld.z, 0, Ld.x);
    // Beside the person, a few metres off, eye height 1.6 m, looking toward the landmark side.
    const street = new THREE.Vector3(ps.x, g + EYE_M, ps.z).addScaledVector(Ld, -4).addScaledVector(Rd, 2.5);
    const rise = 16.4 * easeOut((t - LAUNCH.holdS) / (LAUNCH.tiltEndS - LAUNCH.holdS));
    const high = street.clone();
    high.y += rise;
    const ride = this.ride(B, dir, new THREE.Vector3(-dir.z, 0, dir.x));
    const fovStart = 38;
    if (t < LAUNCH.tiltEndS) {
      // 0-1.2 s hold on the hand; 1.2-8 s the view tilts up with the balloon past the rooftops.
      return { pos: high, look: B.clone(), fov: fovStart, anchor: 'world' };
    }
    // 8-20 s pull back and widen, landmark swings into view, converging on ride at 20 s.
    const u = easeOut((t - LAUNCH.tiltEndS) / (LAUNCH.handOverS - LAUNCH.tiltEndS));
    const bell = Math.sin(Math.PI * u);
    const pos = high.clone().lerp(ride.pos, u).addScaledVector(Ld, -80 * bell);
    pos.y += 30 * bell;
    const landmark = new THREE.Vector3(ps.x, g, ps.z).addScaledVector(Ld, 2500);
    const base = B.clone().lerp(ride.look, u);
    const look = base.clone().addScaledVector(landmark.sub(base), 0.4 * bell);
    return { pos, look, fov: fovStart + (ride.fov - fovStart) * u, anchor: 'balloon' };
  }

  /** Never inside terrain or buildings: ground + 8 m, building tops (30 m radius) + 3 m. Looser at street level during launch. */
  private clamp(p: THREE.Vector3, b: RoutePoint, B: THREE.Vector3): void {
    const ll = this.fromScene(p.x, p.z, b, B);
    let clearance = 8;
    let wBuild = 1;
    if (this._shot === 'launch') {
      const w = smoothstep(4, 12, this.launchT);
      clearance = 1.2 + (8 - 1.2) * w;
      wBuild = w;
    }
    let floor = this.deps.groundAt(ll) + clearance;
    if (this.deps.buildingTopAt && wBuild > 0) {
      const top = this.deps.buildingTopAt(ll, 30) + 3;
      if (top > floor) floor += (top - floor) * wBuild;
    }
    if (p.y < floor) p.y = floor;
  }

  /** Inverse of toScene near the balloon, from a finite-difference Jacobian. */
  private fromScene(x: number, z: number, b: RoutePoint, B: THREE.Vector3): LatLon {
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
