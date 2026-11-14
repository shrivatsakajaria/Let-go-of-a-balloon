import * as THREE from 'three';
import { CLIMB_RATE_MS } from '../config';
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
  /** Highest tree top (absolute) within radiusM; -Infinity where there is none. Only for choosing eye-height spots. */
  treeTopAt?(p: LatLon, radiusM: number): number;
  balloonRadius(distM: number): number;
  reducedMotion?: boolean;
};

/** Spring smooth time: error falls like (1 + 2t/T) e^(-2t/T), so about 1% after 4 s. */
export const SMOOTH_TIME_S = 1.2;
/**
 * The launch (ruling R51, the crane shot): the hand opens at holdS; Ride settles (and the HUD fades in)
 * once the balloon has cleared the rooftops round it, never before settleMinS nor after settleMaxS; the
 * push back in to the balloon takes pushS of that.
 */
export const LAUNCH = { holdS: 1.2, settleMinS: 12, settleMaxS: 40, pushS: 7 } as const;
/** The push itself; the spring takes the rest of pushS to settle, so the camera has arrived when the HUD comes in. */
const PUSH_MOVE_S = LAUNCH.pushS - SMOOTH_TIME_S;
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
/** The street spot is fitted so the drifting balloon is still in front of it this long after Let go. */
const STREET_FIT_S = 8;
/**
 * The rooftops round the balloon: the highest top within CLEAR_R_M of it (ground + OPEN_M where there are
 * none). It has cleared them CLEAR_M above that, and is below them again under LOW_M (Ride's own building
 * clearance), so Film never flips between shots on the edge.
 */
const CLEAR_R_M = 30;
const CLEAR_M = 6;
const LOW_M = 3;
const OPEN_M = 5;
/** Ride is walled in by a building within RIDE_WALL_R_M of the balloon, or of the point RIDE_AHEAD_M ahead of it, that stands over it. */
const RIDE_WALL_R_M = 6;
const RIDE_AHEAD_M = 10;
/** ...looking this far ahead along its drift, so Film does not drop back among the rooftops soon after. */
const CLEAR_AHEAD_S = 24;
/**
 * The crane (after the hand opens; ruling R57). The balloon is the subject: the camera stays close to it,
 * at the distance where it fills CRANE_FRAC of the frame's height (easing from the first to the second as
 * it rises: the camera eases back, the street opening out below), a little below it (CRANE_EL) and to the
 * side (10 deg off the crane's line: the far side of the balloon from the featured landmark, or else about
 * upwind, down the street, craneAxis), and rises with it,
 * a little slower at first (CRANE_LAG_Y m behind at the release, caught up by CRANE_CATCH_S): the facades
 * slide down the frame and the sky opens above. It swings round the balloon onto that from where the
 * camera was as the hand opened (bearing and distance eased over CRANE_AZ_TAU_S), and opens the lens to
 * CRANE_FOV_OPEN over CRANE_ZOOM_S (the camera opens with the hand), settling to CRANE_FOV by 6 s.
 * The line of sight to the balloon is checked against the buildings and landmarks every CRANE_CHECK_S, at
 * the camera's spot now and CRANE_SEE_S on: if it is blocked (or a wall stands within CRANE_WALL_M behind the
 * balloon), the camera goes round the balloon, or up over it, to the nearest spot that is clear (craneSpot),
 * preferring one with sky behind the balloon (CRANE_SKY_M clear).
 */
const CRANE_EASE_S = 2;
const CRANE_FRAC: [number, number] = [0.085, 0.062];
const CRANE_EL = 10 * RAD;
const CRANE_LAG_Y = 2;
const CRANE_CATCH_S = 8;
const CRANE_Y0 = 0.22;
const CRANE_FOV = 46;
const CRANE_FOV_OPEN = 54;
const CRANE_ZOOM_S = 1.5;
const CRANE_SHARE_S = 0.8;
const CRANE_CHECK_S = 0.25;
/** ...and the spot must still see it this long on (the camera takes about a second to get round). */
const CRANE_SEE_S = 2;
const CRANE_AZ_TAU_S = 0.7;
const CRANE_WALL_M = 12;
const CRANE_SKY_M = 35;
/** Where the crane may go round the balloon (offsets from its line, radians) and how high (its elevation below the balloon; negative above). */
const CRANE_OFFS = [10, -10, 35, -35, 65, -65, 100, -100, 140, -140, 180].map((d) => d * RAD);
const CRANE_ELS = [CRANE_EL, -15 * RAD, -35 * RAD];
/** The crane's line (craneAxis) is judged for a camera pulling back AXIS_BACK m a metre of climb, AXIS_UP of it up, out to AXIS_MAX_M. */
const AXIS_BACK = 2;
const AXIS_UP = 0.5;
const AXIS_MAX_M = 24;
/** The person and the balloon within this angle of each other (radians) from the crane: they share the frame. */
const CRANE_PAIR_RAD = 0.13;
/** The crane may turn this far off upwind (deg) to pull back down a street, at this cost (m of clear run a degree past the cone). */
const CRANE_TURN_DEG = 45;
const CRANE_TURN_COST = 0.5;
/**
 * The crane and the push keep CRANE_OVER_M over a building they are about to cross: looking ahead along
 * their target's path for up to CRANE_AHEAD_S (the camera trails its target by about the spring's time),
 * the nearer the crossing the more of the way up (overBuildings), within CRANE_CLEAR_M of the path.
 */
const CRANE_OVER_M = 2;
const CRANE_CLEAR_M = 2;
const CRANE_AHEAD_S = 3;
const LAUNCH_X_TAU_S = 0.5;
/** Reduced motion's still frame: its field of view, and how much of it the person and the rise fill. */
const STILL_FOV = 50;
const STILL_FILL = 0.8;
/** ...from at least this far back (the person a small figure in it, the landmark and the sky above them). */
const STILL_MIN_M = 16;
/** ...and the cut comes early if the drifting balloon is about to leave it (NDC). */
const STILL_EDGE = 0.85;
/** The launch camera passing over the person keeps this high over their ground (m): the crane eases up within PERSON_EASE_M of them, the clamp holds it within PERSON_CLEAR_M. */
const PERSON_OVER_M = 2.8;
const PERSON_CLEAR_M = 1.2;
const PERSON_EASE_M = 4;
/** No building within this radius of the camera's ground point, or the camera goes over its roof. */
const STREET_CLEAR_M = 1.5;
/** The start screen frames the person and the held balloon: feet to the top of the balloon, about 3 m. */
const WAIT_SUBJECT_M = 3;
/** ...filling about a third of the screen's height (NDC), less on a short band. */
const WAIT_FILL = 0.62;
/**
 * Replay (spec 6.4, 8): the high, wide view sits this far from the balloon, this steeply above it, so
 * the land under a 2,600 km trip in 15 s moves past calmly enough to read coasts and names. Close (at
 * the start and the landing) it is a circling-like view of the balloon. The camera turns with the
 * route's heading smoothed over this long (hours flick past in fractions of a second), and follows
 * the replay's width with a short spring, so the 2 s climb and descent keep their timing.
 */
export const REPLAY_WIDE_M = 55000;
const REPLAY_EL_WIDE = 48 * RAD;
const REPLAY_EL_NEAR = 22 * RAD;
const REPLAY_YAW_S = 2.5;
const REPLAY_TAU_S = 0.25;

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
 * snap: taken as it is this frame, with no smoothing (a still frame: the camera must not drift).
 * x0Now: x0 is taken as it is (it was worked out from where the camera is now), the rest smoothed.
 */
type Target = { pos: THREE.Vector3; y0: number; x0?: number; fov: number; anchor: V3; snap?: boolean; x0Now?: boolean };
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
/**
 * cueRelease: the app says when the hand opens (release()), which can be later than holdS while the route is
 * still being worked out; the street shot holds until then. Without it the hand opens at holdS.
 */
export type LaunchOpts = { personAt: LatLon; landmarkHeadingDeg?: number; startUtcMs: number; waiting?: WaitFrame; cueRelease?: boolean };
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
  /** The establishing shot's camera position (world), chosen once per launch, and how blocked it was then (waitTarget). */
  private wide: THREE.Vector3 | null = null;
  private wideBlocked = 0;
  /** The waiting shot's camera height last frame. */
  private waitY = Number.NaN;
  /** Frames counted while waiting, to check the cached spots against newly arrived buildings now and then. */
  private recheck = 0;
  /** Which way the pull-back swings round the balloon (chosen once, so it never flips mid-move). */
  private swing: [number, number] = [0, 0];
  /** Launch clock (s) when the camera began to push back in to the balloon; NaN until then. */
  private pushAt = Number.NaN;
  /** Launch clock when the hand opened (with cueRelease); NaN until then. */
  private relAt = Number.NaN;
  /** The balloon is below the rooftops round it (with hysteresis); null: judge afresh next frame. */
  private low: boolean | null = null;
  /** Ride's view would be walled in (filmPick; with hysteresis); null: judge afresh. */
  private cramped: boolean | null = null;
  /** The look ahead for the rooftops (updateLow): when it was last worked out (clock) and whether it was clear. */
  private aheadAt = -Infinity;
  private aheadClear = false;
  /** The crane pulls back along this horizontal unit vector (from the person), chosen at the release. */
  private craneDir: THREE.Vector3 | null = null;
  /** The crane starts from here (the camera as the hand opened), with the balloon's framing across then. */
  private craneFrom: THREE.Vector3 | null = null;
  private craneX0 = 0;
  /** The crane's line (bearing from the balloon, radians), its eased bearing and distance round the balloon, and its chosen spot. */
  private craneAxisAz = 0;
  private craneAz = 0;
  private craneAzV = 0;
  private craneR = 0;
  private craneRV = 0;
  private craneOff = 0;
  private craneEl = 0;
  private craneCheckAt = -Infinity;
  private craneMovedAt = -Infinity;
  /** The push's target last frame, likewise. */
  private readonly pushPrev = new THREE.Vector3(Number.NaN, 0, Number.NaN);
  /** Reduced motion: the still frame after the release (position, and the fixed view's yaw and pitch). */
  private still: { pos: THREE.Vector3; yaw: number; pitch: number } | null = null;
  /** Reduced motion: the balloon is about to leave the still frame (the cut comes now). */
  private stillLost = false;
  private readonly craneT: Target = { pos: new THREE.Vector3(), y0: 0, x0: 0, fov: 50, anchor: { x: 0, y: 0, z: 0 } };
  private readonly ll: LatLon = { lat: 0, lon: 0 };
  private readonly v1 = new THREE.Vector3();
  private readonly v2 = new THREE.Vector3();
  private readonly v3 = new THREE.Vector3();
  private readonly v4 = new THREE.Vector3();
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
  /** Replay: 0 beside the balloon, 1 the high, wide view (the replay sets it every frame). */
  replayWide = 1;
  /** Replay: the smoothed bearing the camera looks along (radians), NaN until the first replay frame. */
  private replayYaw = Number.NaN;
  private stepS = 0;

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
      this.switchShot(this.filmPick('ride'));
    } else {
      this.switchShot(mode === 'above' ? 'circling' : mode === 'side' ? 'side' : mode === 'replay' ? 'replay' : 'ride');
    }
  }

  private switchShot(s: ShotName): void {
    if (s !== this._shot) this.orbit = Number.NaN; // circling re-seeds from the heading
    if (s === 'replay') this.replayYaw = Number.NaN; // and the replay from the route's heading
    this._shot = s;
    this.lastSwitch = this.clock;
  }

  /**
   * Film never rides while Ride would film a wall: the balloon below the tops of the buildings right round
   * it or just ahead of it (cramped); it circles. A tall landmark beside its path is no wall in Ride's view
   * (R57: the launch may end beside one, below its top, and settle in Ride).
   */
  private filmPick(s: ShotName): ShotName {
    return s === 'ride' && this.cramped ? 'circling' : s;
  }

  /** The shot a view shows (film resolved), for the launch to push in to. */
  private shotFor(mode: DirectorMode): ShotName {
    if (mode === 'film') return this.filmPick('ride');
    return mode === 'above' ? 'circling' : mode === 'side' ? 'side' : mode === 'replay' ? 'replay' : 'ride';
  }

  /** The rooftops round the balloon (absolute): the highest top within CLEAR_R_M, at least ground + OPEN_M. */
  private roofTop(b: LatLon): number {
    const g = this.deps.groundAt(b) + OPEN_M;
    const top = this.deps.buildingTopAt ? this.deps.buildingTopAt(b, CLEAR_R_M) : -Infinity;
    return Number.isFinite(top) ? Math.max(g, top) : g;
  }

  /** Is the balloon below the rooftops round it? Only worked out where it matters (Film and the launch). */
  private updateLow(b: RoutePoint, B: THREE.Vector3, B0: THREE.Vector3): void {
    if (this.mode !== 'film' && this._shot !== 'launch') {
      this.low = null;
      this.cramped = null;
      return;
    }
    this.updateCramped(b, B, B0);
    const top = this.roofTop(b);
    if (!Number.isFinite(top)) return;
    if (this.low === false) {
      this.low = B.y < top + LOW_M;
      return;
    }
    // cleared: above the rooftops round it now, and staying above those round where it drifts over the
    // next CLEAR_AHEAD_S as it climbs (an open square with tall buildings downwind is not clear); the look
    // ahead is worked out twice a second
    if (B.y < top + CLEAR_M) {
      this.low = true;
      return;
    }
    if (this.clock - this.aheadAt >= 0.5 || this.clock < this.aheadAt) {
      this.aheadAt = this.clock;
      this.aheadClear = true;
      const v = Number.isFinite(b.speedMs) && Number.isFinite(b.headingDeg) ? b.speedMs : 0;
      const h = b.headingDeg * RAD;
      const n = 8;
      for (let k = 1; this.aheadClear && v > 0 && k <= n; k++) {
        const tau = (CLEAR_AHEAD_S * k) / n;
        const q = this.fromScene(B0.x + Math.sin(h) * v * tau, B0.z - Math.cos(h) * v * tau, b, B0, this.ll);
        const T = this.roofTop(q);
        if (Number.isFinite(T) && B.y + CLIMB_RATE_MS * tau < T + LOW_M + 1) this.aheadClear = false;
      }
    }
    this.low = !this.aheadClear;
  }

  /** Is Ride's view walled in (see filmPick)? With hysteresis: in until the balloon is LOW_M over those tops, out under 1 m. */
  private updateCramped(b: RoutePoint, B: THREE.Vector3, B0: THREE.Vector3): void {
    const top = this.deps.buildingTopAt;
    if (!top) {
      this.cramped = false;
      return;
    }
    const h = (Number.isFinite(b.headingDeg) ? b.headingDeg : Number.isFinite(this.heading) ? this.heading : 0) * RAD;
    const ahead = this.fromScene(B0.x + Math.sin(h) * RIDE_AHEAD_M, B0.z - Math.cos(h) * RIDE_AHEAD_M, b, B0, this.ll);
    const T = Math.max(top(ahead, RIDE_WALL_R_M), top(b, RIDE_WALL_R_M));
    if (!Number.isFinite(T)) return;
    this.cramped = B.y < T + (this.cramped === false ? 1 : LOW_M);
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
    if (this.filmPick(s) === this._shot) return;
    const cycle = this.reduced ? FILM_CYCLE_REDUCED : FILM_CYCLE;
    const i = cycle.findIndex(([n]) => n === s);
    this.filmIdx = Math.max(0, i);
    this.filmElapsed = 0;
    this.switchShot(this.filmPick(s));
  }

  /**
   * The launch shot (street, then the crane), which settles into film (whose first shot is ride) (or a view
   * chosen meanwhile) once the balloon has cleared the rooftops, 12-40 s from this call (or from go()).
   */
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
    this.resetCrane();
    this.low = true; // held in the street
    this.cramped = true;
    this.ready = false; // first frame snaps to the street position
  }

  private resetCrane(): void {
    this.relAt = Number.NaN;
    this.aheadAt = -Infinity;
    this.craneFrom = null;
    this.pushPrev.set(Number.NaN, 0, Number.NaN);
    this.pushAt = Number.NaN;
    this.craneDir = null;
    this.still = null;
    this.stillLost = false;
  }

  /** The hand has opened (cueRelease): the crane starts now. */
  release(): void {
    if (this._shot === 'launch' && !this.wait && Number.isNaN(this.relAt)) this.relAt = Math.max(LAUNCH.holdS, this.launchT);
  }

  /** Launch clock when the hand opened (NaN until it has). */
  private get rel(): number {
    return this.launchOpts?.cueRelease ? this.relAt : LAUNCH.holdS;
  }

  /** Seconds since Let go (0 while waiting or after the launch). */
  get launchSeconds(): number {
    return this._shot === 'launch' && !this.wait ? this.launchT : 0;
  }

  /** Cut straight to a view, ending any launch (another balloon opened mid-flight): the next frame snaps. */
  cut(mode: DirectorMode): void {
    if (mode === 'launch') return;
    this.wait = null;
    this.launchOpts = null;
    this.street = this.wide = null;
    this.resetCrane();
    this.afterLaunch = 'film';
    this._shot = 'ride';
    this.low = this.cramped = null; // judged on the first frame (film then picks its shot)
    this.enter(mode);
    this.ready = false;
  }

  /** Waiting for Let go (the start screen's establishing shot). */
  get waiting(): boolean {
    return this._shot === 'launch' && this.wait !== null;
  }

  /** The free band moved (the start screen's layout changed): reframe the waiting shot. */
  setWaitFrame(f: WaitFrame): void {
    if (this.wait) this.wait = { ...f };
  }

  /**
   * Back to waiting (the launch failed before the hand opened): the camera eases back to the establishing
   * shot from wherever it is, with no cut.
   */
  rewind(f: WaitFrame): void {
    if (this._shot !== 'launch') return;
    this.wait = { ...f };
    this.launchT = 0;
    this.resetCrane();
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
    this.stepS = dt;

    if (this.paused && this.ready) {
      const shift = B.clone().sub(this.prevB);
      this.pos.add(shift);
      this.prevB.copy(B);
      this.apply(b, B, B0);
      return;
    }
    this.clock += dt;
    this.updateLow(b, B, B0);

    if (this._shot === 'launch') {
      if (!this.wait) this.launchT += dt;
      this.launchStep(B);
    } else if (this.mode === 'film') {
      this.filmElapsed += dt;
      const cycle = this.reduced ? FILM_CYCLE_REDUCED : FILM_CYCLE;
      if (this.filmElapsed >= cycle[this.filmIdx][1]) {
        this.filmElapsed -= cycle[this.filmIdx][1];
        this.filmIdx = (this.filmIdx + 1) % cycle.length;
        this.switchShot(this.filmPick(cycle[this.filmIdx][0]));
      }
      this.tryPending();
      // the balloon went below the rooftops, or came out above them: ride or circle in Ride's slot
      const want = this.filmPick(cycle[this.filmIdx][0]);
      if (cycle[this.filmIdx][0] === 'ride' && want !== this._shot) this.switchShot(want);
    }

    // Circling: never constant angular speed (a slow beat of +-45% around 2 deg/s).
    const scale = this.reduced ? 0.5 : 1;
    if (Number.isNaN(this.orbit)) this.orbit = (b.headingDeg + 100) * RAD;
    this.orbit += 0.035 * scale * (1 + 0.45 * Math.sin((2 * Math.PI * this.clock) / 47)) * dt;

    const tg = this.target(b, B, B0);

    if (!this.ready || tg.snap) {
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

    // While waiting the camera stands still in the street: the ground streaming in under it (coarse land,
    // then finer) moves it straight up or down with the ground, not in a slow glide.
    if (this.wait && Number.isFinite(this.waitY)) this.pos.y += tg.pos.y - this.waitY;
    this.waitY = this.wait ? tg.pos.y : Number.NaN;
    const tau = this._shot === 'replay' ? REPLAY_TAU_S : this.tau;
    spring3(this.pos, this.posV, tg.pos, tau, dtFull);
    [this.y0, this.y0V] = spring1(this.y0, this.y0V, tg.y0, tau, dtFull);
    // the launch shares the frame between the balloon and the person or landmark, whose bearings swing fast
    // as the hand opens: the framing across follows on a shorter spring
    if (tg.x0Now) [this.x0, this.x0V] = [tg.x0 ?? 0, 0];
    else [this.x0, this.x0V] = spring1(this.x0, this.x0V, tg.x0 ?? 0, this._shot === 'launch' ? Math.min(tau, LAUNCH_X_TAU_S) : tau, dtFull);
    // (the launch's lens opens with the hand, as quickly as its framing across follows)
    [this.fov, this.fovV] = spring1(this.fov, this.fovV, tg.fov, this._shot === 'launch' ? Math.min(tau, LAUNCH_X_TAU_S) : tau, dtFull);
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
    if (this._shot === 'launch') return this.launchTarget(b, B, B0, dir, right, h);
    return this.shotTarget(this._shot, B, dir, right, h);
  }

  private shotTarget(s: ShotName, B: THREE.Vector3, dir: THREE.Vector3, right: THREE.Vector3, h: number): Target {
    switch (s) {
      case 'circling': return this.circling(B);
      case 'side': return this.side(B, dir, right);
      case 'down': return this.down(B, dir);
      case 'replay': return this.replay(B, h);
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

  /**
   * The whole-trip replay: behind the balloon on its smoothed heading and above it, looking down at it
   * and the land ahead, from beside it (replayWide 0: a few hundred metres, the balloon at about 6% of
   * the height) to the high, wide view (1: REPLAY_WIDE_M, 48 deg down). Distance blends in log space,
   * so the climb speeds up as it goes, like a zoom out, and the descent slows into the landing.
   */
  private replay(B: THREE.Vector3, headingRad: number): Target {
    const yawWant = headingRad;
    if (!Number.isFinite(this.replayYaw)) this.replayYaw = yawWant;
    else this.replayYaw += wrapPi(yawWant - this.replayYaw) * (1 - Math.exp(-this.stepS / REPLAY_YAW_S));
    const w = Math.min(1, Math.max(0, Number.isFinite(this.replayWide) ? this.replayWide : 1));
    const fov = mix(40, 50, w);
    const dNear = this.distFor(0.04, fov, 80, 900);
    const d = Math.exp(mix(Math.log(dNear), Math.log(REPLAY_WIDE_M), w));
    const el = mix(REPLAY_EL_NEAR, REPLAY_EL_WIDE, w);
    const dir = new THREE.Vector3(Math.sin(this.replayYaw), 0, -Math.cos(this.replayYaw));
    const pos = B.clone().addScaledVector(dir, -d * Math.cos(el));
    pos.y += d * Math.sin(el);
    // the balloon a little above the middle: the trail behind it runs down the frame, the land ahead above
    return { pos, y0: mix(0.05, 0.12, w), fov, anchor: BALLOON };
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
   * rather than over it), for any wind (R36): with the landmark upwind the balloon may drift back toward the
   * camera, and the crane swings round to upwind after the release. Only when every such spot is blocked (and with
   * no landmark): a few metres upwind of the person and a little to one side, so the balloon drifts away
   * from it, never over it, and the person stays in the bottom of a narrow portrait frame while it tilts up.
   * The director cannot see occlusion: the app must put the person where the landmark has a sightline.
   */
  private streetPos(b: RoutePoint, B0: THREE.Vector3, dir: THREE.Vector3, right: THREE.Vector3): THREE.Vector3 {
    if (this.street) {
      // the ground and the buildings stream in after the spot was chosen: stand on the ground as drawn, and
      // while waiting (nothing has moved yet) choose again if a building has arrived on the spot
      const check = this.wait !== null && this.recheck % 20 === 0;
      if (this.settle(this.street, b, B0, check)) return this.street;
      this.street = null;
      this.wide = null;
    }
    const o = this.launchOpts!;
    const ps = this.deps.toScene(o.personAt);
    const P = new THREE.Vector3(ps.x, 0, ps.z);
    const spots: THREE.Vector3[] = [];
    const Ld = this.landmarkDir();
    if (Ld) {
      // Fit the balloon's drift to the landmark line within a narrow portrait frame over 0.5-4 s: further
      // back for a crosswind, and to the side the balloon drifts to, by just enough that its bearing swings
      // evenly across the line (as far off it at 0.5 s as at 4 s). Further back still if the landmark is
      // upwind, so the balloon stays in front of the camera longer (12 m at most).
      const Rd = new THREE.Vector3(-Ld.z, 0, Ld.x);
      const v = Number.isFinite(b.speedMs) ? Math.max(1.5, b.speedMs) : 2.5;
      const s4 = v * (4 - LAUNCH.holdS), s8 = v * (STREET_FIT_S - LAUNCH.holdS);
      const wL = dir.dot(Ld), wR = dir.dot(Rd);
      let back = 5 + 6 * Math.abs(wR);
      if (back + s8 * wL < 3) back = Math.min(12, 3 - s8 * wL);
      const den = 2 * back + s4 * wL;
      const side = (den > 1 ? Math.min(4, Math.max(0.7, (back * s4 * Math.abs(wR)) / den)) : 0.7) * (wR >= 0 ? 1 : -1);
      const set: [number, number][] = [[back, side], [back, -side], [back + 2, side], [back * 0.7, side], [back + 2, -side], [back * 0.7, -side], [3.5, 0.7], [3.5, -0.7]];
      for (const [bk, sd] of set) spots.push(P.clone().addScaledVector(Ld, -bk).addScaledVector(Rd, sd));
    }
    const upwind: [number, number][] = [[-4.2, 0.9], [-4.2, -0.9], [-4, 2.5], [-4, -2.5], [-1, 2.8], [-1, -2.8], [-2.5, 1.2], [-2.5, -1.2]];
    for (const [back, side] of upwind) spots.push(P.clone().addScaledVector(dir, back).addScaledVector(right, side));
    // the first spot with nothing on it and a clear sightline to the person (a tree in a park, say), or
    // else the first with nothing on it
    let pick: THREE.Vector3 | null = null, first: THREE.Vector3 | null = null;
    for (const c of spots) {
      const ll = this.fromScene(c.x, c.z, b, B0);
      const g = this.deps.groundAt(ll);
      if (!Number.isFinite(g) || !Number.isFinite(c.x) || !Number.isFinite(c.z)) continue;
      if (this.spotTop(ll, STREET_CLEAR_M) > g + 0.5) continue;
      c.setY(g + EYE_M);
      first ??= c;
      let seen = true;
      for (const f of [0.35, 0.7]) {
        const q = this.fromScene(c.x + (P.x - c.x) * f, c.z + (P.z - c.z) * f, b, B0);
        if (this.spotTop(q, 0.6) > this.deps.groundAt(q) + 1) seen = false;
      }
      if (seen) {
        pick = c;
        break;
      }
    }
    pick ??= first;
    if (!pick) pick = P.clone().addScaledVector(dir, -1.5).setY(this.deps.groundAt(o.personAt) + EYE_M);
    if (!finite3(pick)) return P.clone().setY(EYE_M); // never cache a non-finite spot; try again next frame
    this.street = pick;
    return pick;
  }

  /**
   * The launch's clock: when the push back in begins (the balloon has cleared the rooftops round it, and
   * Ride settles no sooner than settleMinS; by settleMaxS whatever happens), and the hand-over to the view
   * when it has arrived. Reduced motion has no push: it cuts (early, if the balloon leaves the still frame).
   */
  private launchStep(B: THREE.Vector3): void {
    const t = this.launchT;
    if (this.wait || !(t >= this.rel)) return;
    const push = this.reduced ? 0 : LAUNCH.pushS;
    if (Number.isNaN(this.pushAt)) {
      const due = t >= LAUNCH.settleMaxS - push || (t >= LAUNCH.settleMinS - push && !this.low) || this.stillLost;
      if (!due) return;
      this.pushAt = t;
      // circling (still below the rooftops at the ceiling) starts from the crane's side of the balloon
      if (this.shotFor(this.afterLaunch) === 'circling') this.orbit = Math.atan2(this.pos.x - B.x, -(this.pos.z - B.z));
    }
    if (t < this.pushAt + push) return;
    const orbit = this.orbit;
    this.enter(this.afterLaunch);
    if (this._shot === 'circling') this.orbit = orbit;
    this.lastSwitch = this.clock;
    if (this.reduced) this.ready = false; // a cut to the settled view
  }

  /**
   * The launch (ruling R51, the crane shot).
   * 0-1.2 s: the street shot, low beside the person holding the balloon, the featured landmark beyond
   * them (R36), the view leaning toward it.
   * From the release: one eased move, a dolly out from the person and a crane up with the balloon (crane()),
   * the balloon in the upper third, so the person shrinks and the balloon rises out of the street between
   * the buildings, the rooftops dropping below it, the landmark kept in frame.
   * Once the balloon has cleared the rooftops round it (launchStep): the camera pushes back in to the view
   * the launch hands over to (Ride, or Circling while still below the rooftops), round the balloon by
   * distance and bearing, never through it, so the hand-over is seamless.
   * Reduced motion: a still wide frame of the person and the rising balloon (stillTarget), then a cut.
   * The balloon stays in the frame throughout (the camera is aimed at it every frame).
   */
  private launchTarget(b: RoutePoint, B: THREE.Vector3, B0: THREE.Vector3, dir: THREE.Vector3, right: THREE.Vector3, h: number): Target {
    const t = this.launchT;
    const S = this.streetPos(b, B0, dir, right);
    if (this.wait) return this.waitTarget(b, B, B0, S, this.wait);
    if (!(t >= this.rel)) return { pos: S.clone(), y0: 0.6, x0: this.shareX(S, B, 40, this.lmBearing()), fov: 40, anchor: WORLD };
    if (this.reduced) return this.stillTarget(b, B, B0, dir);
    const cr = this.crane(b, B, B0, S, dir);
    if (Number.isNaN(this.pushAt)) return cr;
    const c = inOut(this.pushAt, this.pushAt + PUSH_MOVE_S, t);
    const end = this.shotTarget(this.shotFor(this.afterLaunch), B, dir, right, h);
    const off = this.polarMix(this.v1.copy(cr.pos).sub(B), end.pos.sub(B), c, c, 1);
    return {
      pos: this.overBuildings(off.add(B), this.pushPrev, b, B0),
      y0: mix(cr.y0, end.y0, c),
      x0: mix(cr.x0 ?? 0, end.x0 ?? 0, c),
      fov: mix(cr.fov, end.fov, c),
      anchor: { x: mix(cr.anchor.x, end.anchor.x, c), y: mix(cr.anchor.y, end.anchor.y, c), z: mix(cr.anchor.z, end.anchor.z, c) },
    };
  }

  /**
   * Lifts a launch camera target over the buildings on its path before it gets there: all the way over one
   * it will reach within about half of CRANE_AHEAD_S at its present speed (`prev` is its place last frame,
   * updated here), and part of the way over one further along, so it rises in steps rather than jumps and
   * the camera (trailing it) is over the building when it gets there. Moving along a wall, it is not lifted.
   */
  private overBuildings(p: THREE.Vector3, prev: THREE.Vector3, b: RoutePoint, B0: THREE.Vector3): THREE.Vector3 {
    const top = this.deps.buildingTopAt;
    const vx = Number.isFinite(prev.x) && this.stepS > 0 ? (p.x - prev.x) / this.stepS : 0;
    const vz = Number.isFinite(prev.x) && this.stepS > 0 ? (p.z - prev.z) / this.stepS : 0;
    prev.copy(p);
    if (!top) return p;
    const y0 = p.y;
    const n = 4;
    for (let k = 0; k <= n; k++) {
      const tau = (CRANE_AHEAD_S * k) / n;
      const ll = this.fromScene(p.x + vx * tau, p.z + vz * tau, b, B0, this.ll);
      const g = this.deps.groundAt(ll);
      const T = top(ll, CRANE_CLEAR_M);
      if (!Number.isFinite(g) || T <= g + 0.5) continue;
      const want = T + CRANE_OVER_M;
      // all the way up for a building it reaches within half the look-ahead, part of the way beyond
      if (want > y0) p.y = Math.max(p.y, y0 + (want - y0) * Math.min(1, (2 * (n + 1 - k)) / (n + 2)));
    }
    return p;
  }

  /** Bearing to the featured landmark (radians), NaN with none. */
  private lmBearing(): number {
    const lm = this.launchOpts?.landmarkHeadingDeg;
    return lm !== undefined && Number.isFinite(lm) ? lm * RAD : Number.NaN;
  }

  /**
   * Where the balloon sits across the frame so that it and whatever lies along `bearing` (radians) from
   * `from` share it, symmetrically about the centre; the balloon stays within 0.6 of it. With `release`, when
   * the two are too far apart to share the frame the balloon comes back to the middle (by 1.1: it is not held
   * at the edge for something out of sight). 0 for a NaN bearing.
   */
  private shareX(from: V3, B: V3, fovDeg: number, bearing: number, release = false): number {
    if (!Number.isFinite(bearing)) return 0;
    const d = wrapPi(Math.atan2(B.x - from.x, -(B.z - from.z)) - bearing);
    const dd = Math.max(-1.2, Math.min(1.2, d));
    const x = (0.5 * Math.tan(dd)) / this.tanH(fovDeg);
    const ax = Math.abs(x);
    return Math.sign(x) * (ax <= 0.6 ? ax : release ? 0.6 * (1 - inOut(0.6, 1.1, ax)) : 0.6);
  }

  /**
   * The line the crane ends up on (from its base, the camera's side), chosen once at the release: the line
   * that runs clear of buildings the furthest at about the crane's height (the street), within the angle of
   * upwind that keeps the person and the drifting balloon together in the frame (wider for a slow wind), or
   * a little past it (up to CRANE_TURN_DEG, at a cost) for a street; the nearest to the start shot's line
   * `a0` wins a tie.
   */
  private craneAxis(b: RoutePoint, B0: THREE.Vector3, a0: THREE.Vector3, ps: { x: number; z: number }, dir: THREE.Vector3): THREE.Vector3 {
    if (this.craneDir) return this.craneDir;
    const v = Number.isFinite(b.speedMs) ? Math.max(0.1, b.speedMs) : 2.5;
    // tan(gap) = v sin(phi) / (climb * back + v cos(phi)) <= tan(CRANE_PAIR_RAD), about
    const phiMax = Math.asin(Math.min(1, (Math.tan(CRANE_PAIR_RAD) * (CLIMB_RATE_MS * AXIS_BACK + v)) / v));
    const up = new THREE.Vector3(0, 1, 0);
    const upwind = new THREE.Vector3(-dir.x, 0, -dir.z);
    // the nearest line to a0 inside the cone
    const off = wrapPi(Math.atan2(a0.x, -a0.z) - Math.atan2(upwind.x, -upwind.z));
    const centre = Math.max(-phiMax, Math.min(phiMax, off));
    const top = this.deps.buildingTopAt;
    let best = -Infinity, bestGap = Infinity;
    this.craneDir = upwind.clone().applyAxisAngle(up, -centre);
    if (!top) return this.craneDir;
    // lines every 5 deg out to CRANE_TURN_DEG either side of upwind; past the cone, each degree costs
    // CRANE_TURN_COST m of clear run (a street a little off the wind beats a wall straight upwind)
    for (let deg = -CRANE_TURN_DEG; deg <= CRANE_TURN_DEG; deg += 5) {
      const ang = deg * RAD;
      const a = upwind.clone().applyAxisAngle(up, -ang);
      let run = 4;
      for (; run <= 2 * AXIS_MAX_M; run += 3) {
        const q = this.fromScene(ps.x + a.x * run, ps.z + a.z * run, b, B0, this.ll);
        const h = EYE_M + AXIS_UP * (run / AXIS_BACK);
        if (top(q, 2) > this.deps.groundAt(q) + h) break;
      }
      const score = run - CRANE_TURN_COST * Math.max(0, Math.abs(ang) - phiMax) / RAD;
      const gap = Math.abs(ang - centre);
      if (score > best || (score === best && gap < bestGap)) {
        best = score;
        bestGap = gap;
        this.craneDir = a;
      }
    }
    return this.craneDir;
  }

  /**
   * Is the straight line from p to q clear of buildings and landmarks (and the ground), sampled about every
   * 2 m from f0 to f1 of the way? No allocation.
   */
  private sightClear(p: V3, q: V3, f0: number, f1: number, b: RoutePoint, B0: THREE.Vector3): boolean {
    const top = this.deps.buildingTopAt;
    const len = Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z);
    const n = Math.max(2, Math.ceil((len * (f1 - f0)) / 2));
    for (let i = 0; i <= n; i++) {
      const f = f0 + ((f1 - f0) * i) / n;
      const ll = this.fromScene(p.x + (q.x - p.x) * f, p.z + (q.z - p.z) * f, b, B0, this.ll);
      const y = p.y + (q.y - p.y) * f;
      const T = top ? Math.max(top(ll, 0.5), this.deps.groundAt(ll)) : this.deps.groundAt(ll);
      if (Number.isFinite(T) && T > y - 0.3) return false;
    }
    return true;
  }

  /**
   * Can the crane stand at cam and see the balloon at B: not in a building or the ground, the line of sight
   * clear, and no wall within CRANE_WALL_M of the camera behind the balloon (with `sky`: nothing within
   * CRANE_SKY_M, the balloon against the sky or the far town)?
   */
  private spotOk(cam: THREE.Vector3, B: THREE.Vector3, sky: boolean, b: RoutePoint, B0: THREE.Vector3): boolean {
    const ll = this.fromScene(cam.x, cam.z, b, B0, this.ll);
    const g = this.deps.groundAt(ll);
    if (Number.isFinite(g) && cam.y < g + 1) return false;
    if (this.deps.buildingTopAt && this.deps.buildingTopAt(ll, 1.2) > cam.y - 0.5) return false;
    if (!this.sightClear(cam, B, 0.05, 0.85, b, B0)) return false;
    const dist = cam.distanceTo(B);
    const L = Math.max(sky ? CRANE_SKY_M : CRANE_WALL_M, dist + 2);
    const E = this.v2.copy(B).sub(cam).multiplyScalar(L / Math.max(1e-6, dist)).add(cam);
    return this.sightClear(cam, E, (dist + 1) / L, 1, b, B0);
  }

  /** The crane's spot for azimuth az (bearing from the balloon), elevation el below it, distance d, written into out. */
  private craneAt(B: V3, az: number, el: number, d: number, lagY: number, out: THREE.Vector3, b: RoutePoint, B0: THREE.Vector3): THREE.Vector3 {
    const r = d * Math.cos(el);
    out.set(B.x + Math.sin(az) * r, B.y - d * Math.sin(el) - lagY, B.z - Math.cos(az) * r);
    // never lower than eye height over the ground (as crane() stands it)
    const g = this.deps.groundAt(this.fromScene(out.x, out.z, b, B0, this.ll));
    if (Number.isFinite(g)) out.y = Math.max(out.y, g + EYE_M);
    return out;
  }

  /**
   * Chooses where round the balloon the crane stands (craneOff, craneEl) every CRANE_CHECK_S: the present
   * choice is kept while it sees the balloon now and CRANE_SEE_S on (and, if it has the sky behind the balloon,
   * while it keeps it); otherwise the first clear spot in CRANE_OFFS x CRANE_ELS, with the sky behind the
   * balloon if one has it. Nothing clear: it keeps what it has.
   */
  private craneSpot(b: RoutePoint, B: THREE.Vector3, B0: THREE.Vector3, dir: THREE.Vector3, d: number, lagY: number): void {
    if (this.clock - this.craneCheckAt < CRANE_CHECK_S && this.clock >= this.craneCheckAt) return;
    this.craneCheckAt = this.clock;
    const v = Number.isFinite(b.speedMs) ? Math.max(0, b.speedMs) : 0;
    const B1 = this.v3.set(B.x + dir.x * v * CRANE_SEE_S, B.y + CLIMB_RATE_MS * CRANE_SEE_S, B.z + dir.z * v * CRANE_SEE_S);
    // (held at a wall it is sliding up, it will not have moved on: R57b)
    if (this.deps.buildingTopAt && this.deps.buildingTopAt(this.fromScene(B1.x, B1.z, b, B0, this.ll), 1) > B1.y) B1.set(B.x, B1.y, B.z);
    const base = this.craneAxisAz;
    const ok = (oi: number, ei: number, sky: boolean) => {
      const az = base + CRANE_OFFS[oi], el = CRANE_ELS[ei];
      return this.spotOk(this.craneAt(B, az, el, d, lagY, this.v4, b, B0), B, sky, b, B0) && this.spotOk(this.craneAt(B1, az, el, d, lagY, this.v4, b, B0), B1, sky, b, B0);
    };
    const [o0, e0] = [this.craneOff, this.craneEl];
    const curSky = ok(o0, e0, true);
    if (curSky) return;
    const curOk = curSky || ok(o0, e0, false);
    // a spot with the sky behind the balloon is worth a move only now and then (no hunting between spots)
    const trySky = !curOk || this.clock - this.craneMovedAt > 3;
    for (const sky of trySky ? [true, false] : [false]) {
      if (!sky && curOk) return;
      for (let ei = 0; ei < CRANE_ELS.length; ei++) {
        for (let oi = 0; oi < CRANE_OFFS.length; oi++) {
          if (oi === o0 && ei === e0) continue;
          if (ok(oi, ei, sky)) {
            this.craneOff = oi;
            this.craneEl = ei;
            this.craneMovedAt = this.clock;
            return;
          }
        }
      }
    }
  }

  /**
   * The crane after the release (ruling R57): close to the balloon, a little below it and to the side,
   * rising with it (see the CRANE_ constants). It starts where the camera is as the hand opens and swings
   * round the balloon onto its spot (the azimuth and the distance are eased, so it goes round the balloon,
   * never through it), sharing the frame with the person at first. The same object is filled every frame.
   */
  private crane(b: RoutePoint, B: THREE.Vector3, B0: THREE.Vector3, S: THREE.Vector3, dir: THREE.Vector3): Target {
    const t = this.launchT;
    const o = this.launchOpts!;
    const ps = this.deps.toScene(o.personAt);
    const rel = this.rel;
    // the lens opens with the hand (the person and the balloon sliding off them share the frame), then settles
    const fovT = mix(mix(40, CRANE_FOV_OPEN, inOut(rel, rel + CRANE_ZOOM_S, t)), CRANE_FOV, inOut(rel + 3, rel + 6, t));
    const frac = mix(CRANE_FRAC[0], CRANE_FRAC[1], inOut(rel, rel + CRANE_CATCH_S + 4, t));
    const d = this.distFor(frac, fovT, 2.5, 40);
    const lagY = CRANE_LAG_Y * (1 - inOut(rel, rel + CRANE_CATCH_S, t));
    if (!this.craneFrom) {
      const F = (this.craneFrom = finite3(this.pos) && this.ready ? this.pos.clone() : S.clone());
      this.craneX0 = this.x0;
      const az0 = Math.atan2(F.x - ps.x, -(F.z - ps.z));
      // its line: the far side of the balloon from the featured landmark (it stays beside the balloon in
      // the frame, R36, R57), or else about upwind, down the street (craneAxis)
      const Ld = this.landmarkDir();
      const ax = Ld ? this.v1.copy(Ld).negate() : this.craneAxis(b, B0, this.v1.set(Math.sin(az0), 0, -Math.cos(az0)), ps, dir);
      this.craneAxisAz = Math.atan2(ax.x, -ax.z);
      this.craneAz = Math.atan2(F.x - B.x, -(F.z - B.z));
      this.craneAzV = 0;
      this.craneR = Math.max(1, Math.hypot(F.x - B.x, F.z - B.z));
      this.craneRV = 0;
      this.craneOff = 0;
      this.craneEl = 0;
      this.craneCheckAt = -Infinity;
      this.craneMovedAt = -Infinity;
    }
    this.craneSpot(b, B, B0, dir, d, lagY);
    const el = CRANE_ELS[this.craneEl];
    // round the balloon on eased azimuth and distance, from where the camera stood
    const want = this.craneAxisAz + CRANE_OFFS[this.craneOff];
    const dt = this.stepS;
    const target = this.craneAz + wrapPi(want - this.craneAz);
    [this.craneAz, this.craneAzV] = spring1(this.craneAz, this.craneAzV, target, CRANE_AZ_TAU_S, dt);
    [this.craneR, this.craneRV] = spring1(this.craneR, this.craneRV, d * Math.cos(el), CRANE_AZ_TAU_S, dt);
    const tg = this.craneT;
    const p = tg.pos.set(B.x + Math.sin(this.craneAz) * this.craneR, 0, B.z - Math.cos(this.craneAz) * this.craneR);
    const ll = this.fromScene(p.x, p.z, b, B0, this.ll);
    let g = this.deps.groundAt(ll);
    if (!Number.isFinite(g)) g = this.deps.groundAt(o.personAt);
    p.y = Math.max(g + EYE_M, B.y - d * Math.sin(el) - lagY);
    // following the balloon away over the person: up over their head, eased in (clamp keeps it there)
    const dP = Math.hypot(p.x - ps.x, p.z - ps.z);
    if (dP < PERSON_EASE_M) p.y = Math.max(p.y, this.deps.groundAt(o.personAt) + PERSON_OVER_M * (0.5 + 0.5 * Math.cos((Math.PI * dP) / PERSON_EASE_M)));
    const r = inOut(rel, rel + CRANE_EASE_S, t);
    tg.y0 = mix(0.6, CRANE_Y0, r);
    tg.fov = fovT;
    // the balloon shares the frame with the person just after the release (held at the edge rather than
    // let go of them), then with the landmark if it is in sight (else it comes to the middle), worked out from where the camera is and how wide it sees
    const at = this.ready ? this.pos : p;
    const fovNow = this.ready ? this.fov : tg.fov;
    const w = inOut(rel + 2, rel + 5, t);
    const share = mix(this.shareX(at, B, fovNow, Math.atan2(ps.x - at.x, -(ps.z - at.z))), this.shareX(at, B, fovNow, this.lmBearing(), true), w);
    tg.x0 = mix(this.craneX0, share, inOut(rel, rel + CRANE_SHARE_S, t));
    tg.x0Now = true;
    // moves with the balloon (the release registers first)
    tg.anchor.x = tg.anchor.y = tg.anchor.z = r;
    tg.snap = false;
    return tg;
  }

  /**
   * Reduced motion (spec 7.3): no crane. A still frame (it never moves or turns) of the person and the
   * rising balloon until the cut, chosen once at the release (stillFrame); the balloon's place in it is
   * worked out every frame from the fixed view.
   */
  private stillTarget(b: RoutePoint, B: THREE.Vector3, B0: THREE.Vector3, dir: THREE.Vector3): Target {
    if (!this.still) this.still = this.stillFrame(b, B0, dir);
    const st = this.still;
    const vx = B.x - st.pos.x, vy = B.y - st.pos.y, vz = B.z - st.pos.z;
    const dYaw = wrapPi(Math.atan2(vx, -vz) - st.yaw);
    const dPitch = Math.atan2(vy, Math.hypot(vx, vz)) - st.pitch;
    const x0 = Math.tan(dYaw) / this.tanH(STILL_FOV);
    const y0 = Math.tan(dPitch) / Math.tan((STILL_FOV * RAD) / 2);
    if (!(Math.abs(dYaw) < 1.2 && Math.abs(x0) < STILL_EDGE && Math.abs(y0) < STILL_EDGE)) this.stillLost = true;
    const tg = this.craneT;
    tg.pos.copy(st.pos);
    tg.x0 = x0;
    tg.y0 = y0;
    tg.fov = STILL_FOV;
    tg.anchor.x = tg.anchor.y = tg.anchor.z = 0;
    tg.snap = true;
    tg.x0Now = false;
    return tg;
  }

  /**
   * The still frame: at eye height on a line through the person, upwind of them (so the balloon drifts
   * away down the middle of the frame rather than out of its side), far enough back that the person's feet and the balloon, all the way up to about where it
   * clears the rooftops, fill STILL_FILL of the height. A line with a building on the spot or between it and
   * the person is passed over for the next; if every one has, the first is used, over the building.
   */
  private stillFrame(b: RoutePoint, B0: THREE.Vector3, dir: THREE.Vector3): { pos: THREE.Vector3; yaw: number; pitch: number } {
    const o = this.launchOpts!;
    const ps = this.deps.toScene(o.personAt);
    const gP = this.deps.groundAt(o.personAt);
    const top = Math.min(45, Math.max(OPEN_M + CLEAR_M, this.roofTop(o.personAt) - gP + CLEAR_M));
    const v = Number.isFinite(b.speedMs) ? Math.max(0, b.speedMs) : 2.5;
    // until it clears the rooftops, and at least until Ride may settle
    const uTop = Math.max(1, (top - 2.4) / CLIMB_RATE_MS, LAUNCH.settleMinS - (Number.isFinite(this.rel) ? this.rel : LAUNCH.holdS));
    const fill = STILL_FILL * STILL_FOV * RAD;
    const a0 = new THREE.Vector3(-dir.x, 0, -dir.z);
    const axes = [0, 20, -20, 40, -40].map((deg) => a0.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), deg * RAD));
    // with a featured landmark, first on its line through the person (the landmark behind them, R57)
    const Ld = this.landmarkDir();
    if (Ld) axes.unshift(Ld.clone().negate());
    const frame = (a: THREE.Vector3, h: number) => {
      const along = -dir.dot(a); // the drift away from the camera, per m/s
      const span = (D: number) => {
        let up = -Math.PI / 2;
        for (let u = 0; u <= uTop + 1e-6; u += uTop / 8) up = Math.max(up, Math.atan2(2.4 + CLIMB_RATE_MS * u - h, D + v * u * along));
        return { up, down: Math.atan2(h, D) };
      };
      let D = STILL_MIN_M;
      for (; D < 150; D += 0.5) {
        const s = span(D);
        if (s.up + s.down <= fill) break;
      }
      const s = span(D);
      return { D, pitch: (s.up - s.down) / 2 };
    };
    const at = (a: THREE.Vector3, D: number) => this.fromScene(ps.x + a.x * D, ps.z + a.z * D, b, B0);
    const clear = (a: THREE.Vector3, D: number): boolean => {
      if (!this.deps.buildingTopAt && !this.deps.treeTopAt) return true;
      for (const f of [1, 0.75, 0.5, 0.25]) {
        const q = at(a, D * f);
        if (this.spotTop(q, f === 1 ? STREET_CLEAR_M : 0.6) > this.deps.groundAt(q) + (f === 1 ? 0.5 : 1)) return false;
      }
      return true;
    };
    let pick: { a: THREE.Vector3; D: number; h: number; pitch: number } | null = null;
    for (const a of axes) {
      const f = frame(a, EYE_M);
      if (clear(a, f.D)) {
        pick = { a, D: f.D, h: EYE_M, pitch: f.pitch };
        break;
      }
    }
    if (!pick) {
      const a = axes[0];
      const D = frame(a, EYE_M).D;
      const q = at(a, D);
      const over = this.deps.buildingTopAt ? this.deps.buildingTopAt(q, STREET_CLEAR_M) + CRANE_OVER_M - gP : EYE_M;
      const h = Math.max(EYE_M, over);
      pick = { a, D, h, pitch: frame(a, h).pitch };
    }
    const q = at(pick.a, pick.D);
    const g = this.deps.groundAt(q);
    const pos = new THREE.Vector3(ps.x + pick.a.x * pick.D, (Number.isFinite(g) ? Math.max(g, gP) : gP) + pick.h, ps.z + pick.a.z * pick.D);
    return { pos, yaw: Math.atan2(-pick.a.x, pick.a.z), pitch: pick.pitch };
  }

  /**
   * The start screen's establishing shot: on the featured landmark's line through the person, so the
   * landmark stands behind them (R36), or else on the street camera's line (so the launch push-in is a
   * straight move in), far enough back that the person and the held balloon fill
   * about a third of the screen (at most 70% of the free band), centred in the band. The first spot that is not in a building and has no
   * building between it and the person wins; nearer spots are tried, down to the street spot itself.
   */
  private waitTarget(b: RoutePoint, B: THREE.Vector3, B0: THREE.Vector3, S: THREE.Vector3, w: WaitFrame): Target {
    const fov = 40;
    const tanV = Math.tan((fov * RAD) / 2);
    const span = Math.min(1.6, Math.max(0.3, w.spanY));
    const o = this.launchOpts!;
    const ps = this.deps.toScene(o.personAt);
    const gP = this.deps.groundAt(o.personAt);
    // how blocked a spot is: 0 clear; a building or a tree on the spot counts 10, each on the sightline 1
    const blocked = (c: THREE.Vector3): number => {
      const ll = this.fromScene(c.x, c.z, b, B0);
      const g = this.deps.groundAt(ll);
      if (!Number.isFinite(g)) return Infinity;
      if (!this.deps.buildingTopAt && !this.deps.treeTopAt) return 0;
      let n = this.spotTop(ll, STREET_CLEAR_M) > g + 0.5 ? 10 : 0;
      for (const f of [0.2, 0.4, 0.6, 0.8]) {
        const q = this.fromScene(c.x + (ps.x - c.x) * f, c.z + (ps.z - c.z) * f, b, B0);
        if (this.spotTop(q, 0.6) > this.deps.groundAt(q) + 1) n++;
      }
      return n;
    };
    this.recheck++;
    if (this.wide && this.recheck % 20 === 0 && blocked(this.wide) > this.wideBlocked) this.wide = null;
    if (this.wide) this.settle(this.wide, b, B0, false);
    if (!this.wide) {
      const u = new THREE.Vector3(ps.x - S.x, 0, ps.z - S.z);
      const len = u.length();
      if (len > 1e-6) u.divideScalar(len); else u.set(0, 0, -1);
      // with a featured landmark, on its line through the person, so it stands right behind them (R36)
      const lines = [this.landmarkDir(), u].filter((x): x is THREE.Vector3 => x !== null);
      const H = WAIT_SUBJECT_M;
      const want = Math.min(20, Math.max(6, H / (Math.min(0.7 * span, WAIT_FILL) * tanV)));
      // on the line first, then the street spot, then turned a little off the line (among trees in a park,
      // an aisle between them); nothing clear: the least blocked of them
      const up = new THREE.Vector3(0, 1, 0);
      const cands: THREE.Vector3[] = [];
      for (const rot of [0, 12, -12, 25, -25, 40, -40]) {
        for (const l of lines) {
          const lr = l.clone().applyAxisAngle(up, rot * RAD);
          for (const k of [1, 0.85, 0.7, 0.55, 0.42]) cands.push(new THREE.Vector3(ps.x, 0, ps.z).addScaledVector(lr, -want * k));
        }
        if (rot === 0) cands.push(S.clone());
      }
      let pick: THREE.Vector3 | null = null;
      let best = Infinity;
      for (const c of cands) {
        const n = blocked(c);
        if (n < best) {
          best = n;
          pick = c;
          if (n === 0) break;
        }
      }
      if (pick) pick.setY(this.deps.groundAt(this.fromScene(pick.x, pick.z, b, B0)) + EYE_M);
      if (!pick || !finite3(pick)) pick = S.clone();
      this.wide = pick;
      this.wideBlocked = Math.min(best, 99);
    }
    const C = this.wide;
    const dh = Math.max(0.5, Math.hypot(ps.x - C.x, ps.z - C.z));
    // nearer than wanted (a building behind): widen the view so the subject still fits the band
    const tanW = Math.max(tanV, Math.min(Math.tan(35 * RAD), WAIT_SUBJECT_M / (Math.min(0.7 * span, WAIT_FILL) * dh)));
    const fovW = (2 * Math.atan(tanW)) / RAD;
    const mid = gP + WAIT_SUBJECT_M / 2;
    const camPitch = Math.atan2(mid - C.y, dh) - Math.atan(w.centerY * tanW);
    const y0 = Math.max(-0.9, Math.min(0.9, Math.tan(Math.atan2(B.y - C.y, Math.hypot(B.x - C.x, B.z - C.z)) - camPitch) / tanW));
    return { pos: C.clone(), y0, x0: 0, fov: fovW, anchor: WORLD };
  }

  /** Blend two balloon-relative offsets by horizontal distance, bearing and height (round the balloon, never through it). */
  private polarMix(a: THREE.Vector3, b: THREE.Vector3, wh: number, wv: number, slot: 0 | 1): THREE.Vector3 {
    if (wh <= 0 && wv <= 0) return a.clone();
    const ra = Math.max(0.05, Math.hypot(a.x, a.z)), rb = Math.max(0.05, Math.hypot(b.x, b.z));
    const aza = Math.atan2(a.x, a.z), azb = Math.atan2(b.x, b.z);
    let dAz = wrapPi(azb - aza);
    // the swing direction is chosen once, so a near half-turn never flips sides from frame to frame
    if (this.swing[slot] === 0) this.swing[slot] = dAz >= 0 ? 1 : -1;
    else if (Math.sign(dAz) !== this.swing[slot] && Math.abs(dAz) > Math.PI / 2) dAz += 2 * Math.PI * this.swing[slot];
    const r = mix(ra, rb, wh);
    const az = aza + dAz * wh;
    return new THREE.Vector3(r * Math.sin(az), mix(a.y, b.y, wv), r * Math.cos(az));
  }

  /**
   * Applied after smoothing. Outside the balloon and its string; then never inside terrain or buildings:
   * ground + 8 m, building tops within 30 m (or the balloon's distance, if nearer) + 3 m, and always at least 1 m over any building within 1.5 m
   * (never inside one; the same radius the street camera's spot is checked with). During the launch the
   * street shot and the crane are exempt from the 8 m and 30 m rules (the camera stands in the street beside
   * the person, then cranes up between the buildings, rising over them itself where it must: overBuildings);
   * both rules come in with the push back in to the balloon, which ends above the rooftops.
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
      // the street and the crane may be below the rooftops; the rules come in with the push back in
      const c = Number.isNaN(this.pushAt) || this.reduced ? 0 : inOut(this.pushAt, this.pushAt + PUSH_MOVE_S, this.launchT);
      clearance = 1.2 + (8 - 1.2) * c;
      wBuild = c;
    }
    let floor = this.deps.groundAt(ll) + clearance;
    // the crane passing the person (it follows the balloon away over them): over their head, never through it
    if (this._shot === 'launch' && this.launchOpts && !this.wait) {
      const ps = this.deps.toScene(this.launchOpts.personAt);
      const dh = Math.hypot(p.x - ps.x, p.z - ps.z);
      if (dh < PERSON_CLEAR_M) floor = Math.max(floor, this.deps.groundAt(this.launchOpts.personAt) + PERSON_OVER_M * (0.5 + 0.5 * Math.cos((Math.PI * dh) / PERSON_CLEAR_M)));
    }
    if (this.deps.buildingTopAt) {
      if (wBuild > 0) {
        // within 30 m, or as near as the balloon is (Ride, a string's length away, is not lifted 30 m over a
        // tall landmark beside the balloon's path to look down on it: R57)
        const top = this.deps.buildingTopAt(ll, Math.min(30, Math.max(3, dist))) + 3;
        if (top > floor) floor += (top - floor) * wBuild;
      }
      floor = Math.max(floor, this.deps.buildingTopAt(ll, STREET_CLEAR_M) + 1);
    }
    if (p.y < floor) p.y = floor;
  }

  /** What stands at an eye-height camera spot or on its sightline: buildings, landmarks and trees (absolute top). */
  private spotTop(p: LatLon, r: number): number {
    const b = this.deps.buildingTopAt ? this.deps.buildingTopAt(p, r) : -Infinity;
    const t = this.deps.treeTopAt ? this.deps.treeTopAt(p, r) : -Infinity;
    return Math.max(b, t);
  }

  /** Put a cached camera spot on the ground as drawn now; false when a building now stands on it (if checked). */
  private settle(c: THREE.Vector3, b: RoutePoint, B0: THREE.Vector3, check: boolean): boolean {
    const ll = this.fromScene(c.x, c.z, b, B0);
    const g = this.deps.groundAt(ll);
    if (!Number.isFinite(g)) return true;
    if (check && this.spotTop(ll, STREET_CLEAR_M) > g + 0.5) return false;
    c.y = g + EYE_M;
    return true;
  }

  /** Inverse of toScene near the balloon, from a finite-difference Jacobian. */
  private fromScene(x: number, z: number, b: RoutePoint, B: THREE.Vector3, out: LatLon = { lat: 0, lon: 0 }): LatLon {
    // B is the route's own scene position (not a drawn-balloon override)
    const h = 0.001;
    const dN = this.deps.toScene({ lat: b.lat + h, lon: b.lon });
    const dE = this.deps.toScene({ lat: b.lat, lon: b.lon + h });
    const a = (dN.x - B.x) / h, c = (dN.z - B.z) / h; // d(x,z)/dLat
    const e = (dE.x - B.x) / h, f = (dE.z - B.z) / h; // d(x,z)/dLon
    const det = a * f - e * c;
    out.lat = b.lat;
    out.lon = b.lon;
    if (Math.abs(det) < 1e-9) return out;
    const dx = x - B.x, dz = z - B.z;
    out.lat += (f * dx - e * dz) / det;
    out.lon += (-c * dx + a * dz) / det;
    return out;
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
