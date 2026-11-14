import * as THREE from 'three';
import { SLIDE } from '../balloon/slide';
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

/** A tree's crown: a cone from its foot (base) to its top, of `radius` at the foot, its trunk at (lat, lon). */
export type Crown = { lat: number; lon: number; radius: number; base: number; top: number };

export type DirectorDeps = {
  toScene(p: LatLon): { x: number; z: number };
  groundAt(p: LatLon): number;
  /** Highest building top (absolute, like groundAt) within radiusM; ground or less where there is none. */
  buildingTopAt?(p: LatLon, radiusM: number): number;
  /** Highest tree top (absolute) within radiusM; -Infinity where there is none. Only for choosing eye-height spots. */
  treeTopAt?(p: LatLon, radiusM: number): number;
  /** The tree whose crown reaches nearest p within radiusM, written into out (trunk, foot radius, foot and top); false if none. */
  crownNear?(p: LatLon, radiusM: number, out: Crown): boolean;
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
export const LAUNCH = { holdS: 1.2, settleMinS: 12, settleMaxS: 40, pushS: 9 } as const;
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
/** The real balloon's radius (m): the launch's lens keeps it readable. */
const BALLOON_R_M = 0.15;
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
/**
 * ...and the push in waits while a wall that would wall Ride in (RIDE_WALL_R_M, as Film's cramped) stands
 * over it within CLEAR_AHEAD_S along its drift, so the launch does not settle into Ride just before one.
 */
const CLEAR_AHEAD_S = 19; // (the push in, LAUNCH.pushS, a moment's wait, and 8 s of Ride)
/**
 * The launch's move (rulings R51, R57; Task 26c): one planned move worked out from the time since Let go and
 * since the hand opened (launchPlan), which the camera follows through a critically damped tracker whose
 * acceleration is capped at LAUNCH_MAX_A (followStep): nothing the drawn balloon does (its catch-up after
 * the release, a facade it slides up) is passed on to the camera's position, which follows the route; the
 * camera is aimed at the drawn balloon.
 * - The opening: from Let go the camera stays where the start screen had it (low, at HOLD_EYE_M, on the
 *   landmark's line) and over OPEN_S frames the person and the held balloon on a longer lens: HOLD_FRAME_M of the frame's height
 *   at the person, the horizon low (HOLD_HORIZON, NDC), so the lawn takes about a quarter of the frame and the
 *   landmark behind them the rest (the start screen's spot is on its line).
 * - The hold: as the hand opens the camera stays put while the string slips out, and the balloon rises in the
 *   frame to RISE_Y0 by HOLD_S, the person still in it, the balloon sharing the frame with them across
 *   (PERSON_SHARE_S), until it has clearly left them.
 * - The crane: it rises with the balloon, keeping it CRANE_ELEV above itself (a smooth maximum with the
 *   hold's height, CRANE_SOFT_M wide, so the rise starts gently as the balloon reaches that angle); across,
 *   it moves with the route's drift, eased in from FOLLOW_FROM_S over FOLLOW_S, its bearing from the balloon
 *   unchanged (no orbit, no swing). The framing eases to CRANE_Y0 over FRAME_S after the hold. The lens is
 *   never wider than keeps the balloon at MIN_FRAC of the frame's height. Facades slide down the frame and
 *   the sky opens above.
 * - Buildings: what the path needs to clear the roofs under it (LIFT_OVER_M), the person and its line of
 *   sight to the balloon lifts it. It is worked out along the predicted path at the release, PLAN_S of it
 *   every PLAN_STEP_S (each step looking PLAN_AHEAD_S on, a lift needed later counting less LIFT_EASY_MS a
 *   second until then, so the rise comes before the roof and is spread out), and again every frame; the
 *   lift follows the higher of the two through a critically damped spring (LIFT_T_S up, LIFT_DOWN_T_S down)
 *   with capped acceleration and speed.
 * - The push in (launchTarget): one smootherstep to Ride's place, by distance and height round the balloon;
 *   Ride takes its bearing from the crane's (rideYaw) and comes round behind the balloon slowly afterwards.
 */
const OPEN_S = 1;
const HOLD_EYE_M = 1;
const HOLD_FRAME_M = 5.2;
const HOLD_HORIZON = -0.45;
const HOLD_FEET_MIN = -0.9;
const HOLD_FOV_MIN = 14;
const HOLD_FOV_MAX = 50;
const HOLD_S = 2;
const RISE_Y0 = 0.75;
const CRANE_ELEV = 22 * RAD;
const CRANE_SOFT_M = 0.8;
const FOLLOW_FROM_S = 1;
const FOLLOW_SOON_S = 0;
const FOLLOW_S = 1.5;
const FRAME_S = 3;
const CRANE_Y0 = 0.22;
const MIN_FRAC = 0.055;
const LAUNCH_MAX_A = 2.5;
/** The tracker closes a gap at no more than this deceleration (so it never overshoots), and small ones at this rate (1/s). */
const LAUNCH_CLOSE_A = 0.8;
const LAUNCH_CLOSE_MAX = 6;
/** The push in starts no sooner than this long after the hand opens (s). */
const PUSH_AFTER_S = 4;
const PUSH_READY_M = 2;
const LAUNCH_CLOSE_W = 1.2;
/** ...and corrects its speed over this long (s). */
const LAUNCH_T_S = 0.15;
/** The launch hands over to the view once the camera is within HANDOVER_M of it, waiting at most HANDOVER_WAIT_S. */
const HANDOVER_M = 0.3;
const HANDOVER_WAIT_S = 4;
/** The balloon shares the frame with the person until this long after the hand opens (s). */
const PERSON_SHARE_S = 2.5;
const LIFT_OVER_M = 2;
/** ...and a balloon going over a roof is seen from this far off at least (m). */
const ROOF_SEE_M = 9.5;
const LIFT_T_S = 0.8;
const LIFT_DOWN_T_S = 3;
const LIFT_MAX_A = 2;
const LIFT_MAX_V = 3;
/**
 * A lift needed later counts now less LIFT_EASY_MS for each second until then past LIFT_LEAD_S (about the
 * spring's own lag): the rise is spread out, and done by the time it is needed.
 */
const LIFT_EASY_MS = 1.5;
const LIFT_LEAD_S = 1.8;
const liftLater = (need: number, inS: number) => need - LIFT_EASY_MS * Math.max(0, inS - LIFT_LEAD_S);
const PLAN_S = 40;
const PLAN_STEP_S = 0.5;
const PLAN_AHEAD_S = 6;
/** Ride's bearing (rideYaw) comes round to the wind's over this smooth time (s), at most RIDE_YAW_MAX rad/s. */
const RIDE_YAW_T_S = 8;
const RIDE_YAW_MAX = 6 * RAD;
/** Reduced motion's still frame: its field of view, and how much of it the person and the rise fill. */
const STILL_FOV = 26;
const STILL_FILL = 0.9;
/** ...from at least this far back (the person a small figure in it, the landmark and the sky above them). */
const STILL_MIN_M = 11;
/** ...and frames this much of the rise (s). */
const STILL_FIT_S = 4;
/** ...and the cut comes early if the drifting balloon is about to leave it (NDC). */
const STILL_EDGE = 0.85;
/**
 * With a tall featured landmark behind the person (Big Ben), the still takes in its top too: from as far
 * back as keeps the balloon at STILL_READ of the frame's height or more for STILL_READ_S after it leaves the
 * hand (nearer and wider when the landmark is tall), the person's feet, the landmark's top and the first
 * STILL_RISE_S of the rise in it, with STILL_MARGIN (radians) at the top and bottom edges. A wind across the
 * landmark's line would carry the balloon out of a frame that near at once: then the plain still is used.
 */
const STILL_READ = 0.041;
const STILL_READ_S = 0.5;
const STILL_NEAR_M = 5;
const STILL_RISE_S = 2;
const STILL_MARGIN = 1.5 * (Math.PI / 180);
/** How far along the landmark's line its top is looked for (m), and how often. */
const STILL_LM_REACH_M = 600;
const STILL_LM_STEP_M = 5;
/** The launch camera passing over the person keeps this high over their ground (m): the crane eases up within PERSON_EASE_M of them, the clamp holds it within PERSON_CLEAR_M. */
const PERSON_OVER_M = 2.8;
const PERSON_CLEAR_M = 1.2;
const PERSON_EASE_M = 3.5;
/**
 * The clamp's correction is eased in (easeClamp): a critically damped spring of this smooth time (s), its
 * acceleration capped (m/s/s) and its speed (m/s); inside a building, on a stiffer spring.
 */
const CLAMP_T_S = 0.6;
const CLAMP_CATCH_T_S = 0.35;
const CLAMP_MAX_A = 2.4;
const CLAMP_MAX_V = 8;
const CLAMP_LAUNCH_A = 0.45;
const CLAMP_V_T_S = 0.15;
/** The camera keeps this far out of a tree's crown (outOfCrowns). */
const CROWN_GAP_M = 0.5;
/**
 * Outside the launch, crowns are looked for only with the camera this low over the ground (m): the
 * tallest drawn trees are well under it, so a camera higher up costs no lookup at all.
 */
const CROWN_CHECK_M = 45;
/** No building within this radius of the camera's ground point, or the camera goes over its roof. */
const STREET_CLEAR_M = 1.5;
/** The start screen frames the person and the held balloon: feet to the top of the balloon, about 3 m. */
const WAIT_SUBJECT_M = 3;
/** ...filling about a third of the screen's height (NDC), less on a short band. */
const WAIT_FILL = 0.62;
/** ...and its frame is about this wide (half, per metre out) for what may stand beside the sightline. */
const WAIT_FRAME_W = 0.2;
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
/** Smootherstep on [0, 1]: at rest at both ends, its acceleration continuous too. */
const smoother = (x: number) => {
  const u = Math.min(1, Math.max(0, x));
  return u * u * u * (u * (u * 6 - 15) + 10);
};
/** A smooth maximum of x and 0 (CRANE_SOFT_M wide): no corner where the crane starts to rise. */
const softMax = (x: number) => (x + Math.sqrt(x * x + CRANE_SOFT_M * CRANE_SOFT_M)) / 2;
const wrapPi = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
type V3 = { x: number; y: number; z: number };
const finite3 = (v: V3) => Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);

/**
 * pos: where the camera wants to be. y0, x0: where the balloon sits in the frame (NDC; x0 defaults to 0);
 * the camera is aimed from wherever it actually is (after smoothing and clamps), so the framing holds even
 * while the position catches up, which matters a string's length from a 30 cm balloon.
 * anchor: per axis, how much of pos moves with the balloon (1) or stays put in the world (0).
 * snap: taken as it is this frame, with no smoothing (a still frame: the camera must not drift).
 * direct: a planned move, smooth by construction, taken as it is (its velocity is kept for the spring after it).
 */
type Target = { pos: THREE.Vector3; y0: number; x0?: number; fov: number; anchor: V3; snap?: boolean; direct?: boolean };
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
  /** Street camera position for this launch (world), chosen on the first launch frame, and whether it saw the person then. */
  private street: THREE.Vector3 | null = null;
  private streetSeen = false;
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
  /** The launch's opening: where the camera stood and how it framed at Let go, and the hold's framing (y0). */
  private open: { from: THREE.Vector3; y0: number; x0: number; fov: number; fovHold: number; yHold: number } | null = null;
  /** The launch camera's tracker (followStep): where it is, how fast it moves, and its target last frame. */
  private readonly track = { p: new THREE.Vector3(), v: new THREE.Vector3(), last: new THREE.Vector3(), on: false, err: 0 };
  /**
   * The launch's plan, made as the hand opens: the route's balloon then, the smooth maximum's value then,
   * and the lift the predicted path needs (every PLAN_STEP_S).
   */
  private plan: { B: THREE.Vector3; d0: number; sm0: number; need: Float64Array; from: number } | null = null;
  /** The launch camera's lift over buildings (m) and its rate. */
  private lift = 0;
  private liftV = 0;
  /** Ride's bearing (radians; where it looks along): NaN takes the wind's. */
  private rideYaw = Number.NaN;
  /** Reduced motion: the still frame after the release (position, the fixed view's yaw and pitch, its field of view). */
  private still: { pos: THREE.Vector3; yaw: number; pitch: number; fov: number } | null = null;
  /** Reduced motion: the balloon is about to leave the still frame (the cut comes now). */
  private stillLost = false;
  private readonly craneT: Target = { pos: new THREE.Vector3(), y0: 0, x0: 0, fov: 50, anchor: { x: 0, y: 0, z: 0 } };
  private readonly ll: LatLon = { lat: 0, lon: 0 };
  private readonly crown: Crown = { lat: 0, lon: 0, radius: 0, base: 0, top: 0 };
  /** fromScene's Jacobian and the base point it was worked out for. */
  private readonly jac = { lat: Number.NaN, lon: Number.NaN, bx: Number.NaN, bz: Number.NaN, a: 0, c: 0, e: 0, f: 0, det: 0 };
  private readonly v1 = new THREE.Vector3();
  private readonly v3 = new THREE.Vector3();
  private readonly v4 = new THREE.Vector3();
  private readonly v5 = new THREE.Vector3();
  private readonly holdAt = new THREE.Vector3();
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
  /**
   * What the camera did last frame, for the browser tests' smoothness probe (read through the page's test
   * hook): the target it was steering for, how far the clamp moved it, the launch's choices and the person's
   * feet (scene).
   */
  /** The clamp's correction as applied (eased: easeClamp), its rate, and whether it has started. */
  private readonly guard = { on: false, aMax: CLAMP_MAX_A, off: new THREE.Vector3(), v: new THREE.Vector3(), want: new THREE.Vector3() };
  readonly probe = { target: [0, 0, 0], clampM: 0, lift: 0, pushAt: Number.NaN, low: 0, person: [0, 0, 0] };

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
    if (s === 'ride' && this._shot !== 'launch') this.rideYaw = Number.NaN; // and Ride from the wind (the launch hands it its own)
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
    // cleared: above the rooftops round it now, and no wall that would wall Ride in stands over it along
    // its drift over the next CLEAR_AHEAD_S as it climbs; the look ahead is worked out twice a second
    if (B.y < top + CLEAR_M) {
      this.low = true;
      return;
    }
    if (this.clock - this.aheadAt >= 0.5 || this.clock < this.aheadAt) {
      this.aheadAt = this.clock;
      this.aheadClear = true;
      const v = Number.isFinite(b.speedMs) && Number.isFinite(b.headingDeg) ? b.speedMs : 0;
      const h = b.headingDeg * RAD;
      const n = 10;
      const top = this.deps.buildingTopAt;
      for (let k = 1; top && this.aheadClear && v > 0 && k <= n; k++) {
        const tau = (CLEAR_AHEAD_S * k) / n;
        // (where Ride would look then: RIDE_AHEAD_M on, as Film's cramped does)
        const ahead = v * tau + RIDE_AHEAD_M;
        const q = this.fromScene(B0.x + Math.sin(h) * ahead, B0.z - Math.cos(h) * ahead, b, B0, this.ll);
        const T = top(q, RIDE_WALL_R_M);
        if (Number.isFinite(T) && B.y + CLIMB_RATE_MS * tau < T + 1) this.aheadClear = false;
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
    this.open = null;
    this.plan = null;
    this.track.on = false;
    this.lift = this.liftV = 0;
    this.pushAt = Number.NaN;
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
    this.open = null; // the opening starts from wherever the camera is now
    this.track.on = false;
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
      if (this.track.on) {
        this.track.p.add(shift);
        this.track.last.add(shift);
      }
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
    tg.pos.toArray(this.probe.target);

    if (tg.direct && this.ready) {
      // a planned move: taken as it is; its velocity relative to the balloon (the spring after it works
      // in the balloon's moving frame) is kept for a seamless hand-over
      if (dtFull > 0) {
        this.posV.set(
          (tg.pos.x - this.pos.x - (B.x - this.prevB.x)) / dtFull,
          (tg.pos.y - this.pos.y - (B.y - this.prevB.y)) / dtFull,
          (tg.pos.z - this.pos.z - (B.z - this.prevB.z)) / dtFull,
        );
        this.y0V = (tg.y0 - this.y0) / dtFull;
        this.x0V = ((tg.x0 ?? 0) - this.x0) / dtFull;
        this.fovV = (tg.fov - this.fov) / dtFull;
      }
      this.pos.copy(tg.pos);
      this.y0 = tg.y0;
      this.x0 = tg.x0 ?? 0;
      this.fov = tg.fov;
      this.prevB.copy(B);
      this.waitY = Number.NaN;
      this.apply(b, B, B0);
      return;
    }
    if (!this.ready || tg.snap) {
      this.guard.on = false; // a cut: the clamp's correction is taken as it is
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
    [this.x0, this.x0V] = spring1(this.x0, this.x0V, tg.x0 ?? 0, tau, dtFull);
    [this.fov, this.fovV] = spring1(this.fov, this.fovV, tg.fov, tau, dtFull);
    this.apply(b, B, B0);
  }

  private apply(b: RoutePoint, B: THREE.Vector3, B0: THREE.Vector3): void {
    const out = this.pos.clone();
    this.clamp(out, b, B, B0);
    this.easeClamp(out, b, B0);
    const pr = this.probe;
    pr.clampM = out.distanceTo(this.pos);
    pr.lift = this.lift;
    pr.pushAt = this.pushAt;
    pr.low = this.low ? 1 : 0;
    if (this._shot === 'launch' && this.launchOpts) {
      const ps = this.deps.toScene(this.launchOpts.personAt);
      pr.person[0] = ps.x;
      pr.person[1] = this.deps.groundAt(this.launchOpts.personAt);
      pr.person[2] = ps.z;
    }
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
      default: return this.ride(B, dir);
    }
  }

  /**
   * A camera tied to the string: just below and behind, the balloon large at the top of the frame, looking
   * forward and down. The distance comes from the projected-height target with the balloon's real radius
   * (about 1.2 m for the real-size balloon, roughly the string's length); it is only kept outside the
   * balloon and its string here and above ground and buildings by the clamp.
   */
  private ride(B: THREE.Vector3, wind: THREE.Vector3): Target {
    // its bearing comes round to the wind's slowly (after the launch it starts from the crane's)
    const want = Math.atan2(wind.x, -wind.z);
    if (!Number.isFinite(this.rideYaw)) this.rideYaw = want;
    else if (this.stepS > 0) {
      const d = wrapPi(want - this.rideYaw);
      const [nd] = spring1(d, 0, 0, RIDE_YAW_T_S, this.stepS);
      this.rideYaw += Math.max(-RIDE_YAW_MAX * this.stepS, Math.min(RIDE_YAW_MAX * this.stepS, d - nd));
    }
    const dir = this.v3.set(Math.sin(this.rideYaw), 0, -Math.cos(this.rideYaw));
    const right = this.v4.set(-dir.z, 0, dir.x);
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
      if (!this.settle(this.street, b, B0, check)) {
        this.street = null;
        this.wide = null;
      } else if (check && this.streetSeen && !this.seesPerson(this.street, b, B0)) {
        // it saw the person when chosen, and a tree or a building has since arrived in between: choose again
        this.street = null;
      } else return this.street;
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
      if (this.seesPerson(c, b, B0)) {
        pick = c;
        break;
      }
    }
    this.streetSeen = pick !== null;
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
      // (and the crane has had its time: the push in never starts within PUSH_AFTER_S of the hand opening, nor
      // while the camera is still catching up with it, PUSH_READY_M or more behind, as in a strong wind)
      const ready = !this.track.on || this.track.err < PUSH_READY_M;
      const due = t >= LAUNCH.settleMaxS - push || (t >= LAUNCH.settleMinS - push && t >= this.rel + PUSH_AFTER_S && ready && !this.low) || this.stillLost;
      if (!due) return;
      this.pushAt = t;
      // Ride looks along the crane's bearing (the push in is straight in, no swing round the balloon)
      this.rideYaw = Math.atan2(B.x - this.pos.x, -(B.z - this.pos.z));
      // circling (still below the rooftops at the ceiling) starts from the crane's side of the balloon
      if (this.shotFor(this.afterLaunch) === 'circling') this.orbit = Math.atan2(this.pos.x - B.x, -(this.pos.z - B.z));
    }
    if (t < this.pushAt + push) return;
    // (the camera hands over once it has caught up with the push, a few seconds at most)
    if (!this.reduced && this.track.on && t < this.pushAt + push + HANDOVER_WAIT_S && t < LAUNCH.settleMaxS && this.track.err > HANDOVER_M) return;
    const orbit = this.orbit;
    this.enter(this.afterLaunch);
    if (this._shot === 'circling') this.orbit = orbit;
    this.lastSwitch = this.clock;
    if (this.reduced) this.ready = false; // a cut to the settled view
  }

  /**
   * The launch (rulings R51, R57; Task 26c). Waiting: the start screen's shot (waitTarget). From Let go: one
   * planned move (launchPlan: the opening, the hold, the crane), then the push in to the view the launch
   * hands over to (Ride, or Circling while still below the rooftops), round the balloon by distance and
   * height in one smootherstep; the camera follows all of it through followStep. Reduced motion: the street
   * shot, then a still frame of the person and the rising balloon (stillTarget) and a cut. The balloon stays
   * in the frame throughout (the camera is aimed at it every frame).
   */
  private launchTarget(b: RoutePoint, B: THREE.Vector3, B0: THREE.Vector3, dir: THREE.Vector3, right: THREE.Vector3, h: number): Target {
    const t = this.launchT;
    const S = this.streetPos(b, B0, dir, right);
    if (this.wait) return this.waitTarget(b, B, B0, S, this.wait);
    if (this.reduced) {
      if (!(t >= this.rel)) return { pos: S.clone(), y0: 0.6, x0: this.shareX(S, B, 40, this.lmBearing()), fov: 40, anchor: WORLD };
      return this.stillTarget(b, B, B0, dir);
    }
    // the hold spot: where the start screen's camera stood (on the landmark's line), else the street spot; low
    const H = this.wide ? this.holdAt.copy(this.wide) : this.holdAt.set(S.x, S.y - EYE_M + HOLD_EYE_M, S.z);
    const cr = this.launchPlan(b, B, B0, H, dir);
    if (!Number.isNaN(this.pushAt)) {
      const c = smoother((t - this.pushAt) / PUSH_MOVE_S);
      const end = this.shotTarget(this.shotFor(this.afterLaunch), B, dir, right, h);
      const off = this.polarMix(this.v1.copy(cr.pos).sub(B), end.pos.sub(B), c, c, 1);
      cr.pos.copy(off).add(B);
      cr.y0 = mix(cr.y0, end.y0, c);
      cr.x0 = mix(cr.x0 ?? 0, end.x0 ?? 0, c);
      cr.fov = mix(cr.fov, end.fov, c);
    }
    // (kept clear of roofs, crowns and the person before the follower: a floor it meets, or leaves, is taken
    // in at the follower's acceleration, not as a jolt after it)
    this.clamp(cr.pos, b, B, B0);
    this.followStep(cr.pos);
    // the lens, from where the camera is: never wider than keeps the balloon at MIN_FRAC of the frame (a smooth
    // minimum), so it reads while the camera catches up with it
    const fovFrac = (2 * Math.atan(BALLOON_R_M / (Math.max(1, cr.pos.distanceTo(B)) * MIN_FRAC))) / RAD;
    cr.fov = (cr.fov + fovFrac - Math.sqrt((cr.fov - fovFrac) ** 2 + 4)) / 2;
    return cr;
  }

  /**
   * The camera follows the planned target: it moves at the target's own speed plus what closes the gap (no
   * faster than lets it stop by LAUNCH_CLOSE_A, so it never overshoots; in proportion for small gaps), reaching
   * that speed over LAUNCH_T_S, its acceleration capped at LAUNCH_MAX_A, in substeps of the frame (the target
   * moving evenly through it). Writes the camera's place into p.
   */
  private followStep(p: THREE.Vector3): void {
    const k = this.track;
    const dt = this.stepS;
    if (!k.on) {
      k.p.copy(this.ready && finite3(this.pos) ? this.pos : p);
      k.v.set(0, 0, 0);
      k.last.copy(k.p);
      k.on = true;
    }
    if (dt > 0) {
      const n = Math.ceil(dt * 120 - 1e-9);
      const h = dt / n;
      const vtx = (p.x - k.last.x) / dt, vty = (p.y - k.last.y) / dt, vtz = (p.z - k.last.z) / dt;
      for (let i = 1; i <= n; i++) {
        const f = i / n;
        const ex = k.last.x + (p.x - k.last.x) * f - k.p.x, ey = k.last.y + (p.y - k.last.y) * f - k.p.y, ez = k.last.z + (p.z - k.last.z) * f - k.p.z;
        const e = Math.hypot(ex, ey, ez);
        const close = e > 1e-9 ? Math.min(LAUNCH_CLOSE_W * e, Math.sqrt(2 * LAUNCH_CLOSE_A * e), LAUNCH_CLOSE_MAX) / e : 0;
        let ax = (vtx + ex * close - k.v.x) / LAUNCH_T_S;
        let ay = (vty + ey * close - k.v.y) / LAUNCH_T_S;
        let az = (vtz + ez * close - k.v.z) / LAUNCH_T_S;
        const a = Math.hypot(ax, ay, az);
        if (a > LAUNCH_MAX_A) {
          ax *= LAUNCH_MAX_A / a;
          ay *= LAUNCH_MAX_A / a;
          az *= LAUNCH_MAX_A / a;
        }
        k.p.x += (k.v.x + (ax * h) / 2) * h;
        k.p.y += (k.v.y + (ay * h) / 2) * h;
        k.p.z += (k.v.z + (az * h) / 2) * h;
        k.v.x += ax * h;
        k.v.y += ay * h;
        k.v.z += az * h;
      }
    }
    k.err = k.p.distanceTo(p);
    k.last.copy(p);
    p.copy(k.p);
  }

  /**
   * The launch's planned move (see OPEN_S ... PLAN_AHEAD_S): the opening and the hold from Let go, the crane
   * from the hand opening; a function of the launch clock and where the route's balloon is (B0), and aimed
   * at the drawn balloon (B). The same object is filled every frame.
   */
  private launchPlan(b: RoutePoint, B: THREE.Vector3, B0: THREE.Vector3, H: THREE.Vector3, dir: THREE.Vector3): Target {
    const t = this.launchT, tg = this.craneT;
    const o = this.launchOpts!;
    const gP = this.deps.groundAt(o.personAt);
    const ps = this.deps.toScene(o.personAt);
    if (!this.open) {
      const dP = Math.max(1, Math.hypot(H.x - ps.x, H.z - ps.z));
      const fovHold = Math.min(HOLD_FOV_MAX, Math.max(HOLD_FOV_MIN, (2 * Math.atan(HOLD_FRAME_M / 2 / dP)) / RAD));
      const from = this.ready && finite3(this.pos) ? this.pos.clone() : H.clone();
      this.open = { from, y0: this.ready ? this.y0 : 0.4, x0: this.ready ? this.x0 : 0, fov: this.ready ? this.fov : fovHold, fovHold, yHold: this.holdY0(H, gP, B, fovHold) };
    }
    const op = this.open;
    const so = smoother(t / OPEN_S);
    const p = tg.pos;
    let y0 = mix(op.y0, op.yHold, so);
    let kf = 0;
    const u = t - this.rel;
    if (u >= 0) {
      if (!this.plan) this.plan = this.makePlan(b, B0, H, dir);
      const pl = this.plan;
      // across, it goes where the balloon is drawn (held back at a facade it climbs, it is not flown over
      // and looked straight down on: the follower takes out the slide's quicker moves); up, with the route
      const Bh = this.v5.set(B.x, B0.y, B.z);
      this.planAt(u, Bh, H, p);
      // over buildings: the predicted path's need and the present one's, through the lift's spring
      const v = Number.isFinite(b.speedMs) ? Math.max(0, b.speedMs) : 0;
      let need = this.liftNeed(p, B, b, B0);
      for (const tau of [0.5, 1, 1.5, 2, 3, 4]) {
        const Bf = this.v4.set(Bh.x + dir.x * v * tau, B0.y + CLIMB_RATE_MS * tau, Bh.z + dir.z * v * tau);
        Bf.y = this.drawnY(Bf, b, B0);
        need = Math.max(need, liftLater(this.liftNeed(this.planAt(u + tau, Bf, H, this.v3), Bf, b, B0), tau));
      }
      const i = Math.min(pl.need.length - 1, Math.max(0, u / PLAN_STEP_S));
      const i0 = Math.floor(i);
      need = Math.max(need, mix(pl.need[i0], pl.need[Math.min(pl.need.length - 1, i0 + 1)], i - i0));
      this.liftStep(Math.max(0, need), this.stepS);
      p.y += this.lift;
      // the framing: the balloon rises in the frame through the hold, then settles into the crane's
      kf = smoother((u - HOLD_S) / FRAME_S);
      y0 += (RISE_Y0 - op.yHold) * smoother(u / HOLD_S) + (CRANE_Y0 - RISE_Y0) * kf;
    } else p.copy(H);
    // what is left of the opening
    p.x += (1 - so) * (op.from.x - H.x);
    p.y += (1 - so) * (op.from.y - H.y);
    p.z += (1 - so) * (op.from.z - H.z);
    const fov = mix(op.fov, op.fovHold, so);
    // across: the balloon shares the frame with the person below it (worked out from the hold spot, which never
    // passes over them), letting go of them as it clearly leaves (PERSON_SHARE_S), then comes to the middle
    const keep = u > 0 ? 1 - smoother(u / PERSON_SHARE_S) : 1;
    const withPerson = this.share(H, B, Math.atan2(ps.x - H.x, -(ps.z - H.z)), fov) * keep;
    tg.y0 = y0;
    tg.x0 = mix(op.x0, withPerson, so) * (1 - kf);
    tg.fov = fov;
    tg.anchor.x = tg.anchor.y = tg.anchor.z = 0;
    tg.snap = false;
    tg.direct = true;
    return tg;
  }

  /**
   * The crane's place (before any lift) u s after the hand opened, for the route's balloon at B: from the hold
   * spot H it moves with the balloon's drift (eased in), keeping its bearing from it, and rises with it once it
   * is CRANE_ELEV above (a smooth maximum). Written into out.
   */
  private planAt(u: number, B: V3, H: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    const pl = this.plan!;
    const k = smoother((u - pl.from) / FOLLOW_S);
    out.x = H.x + k * (B.x - pl.B.x);
    out.z = H.z + k * (B.z - pl.B.z);
    // (at the distance it holds from the balloon: it never sinks while the balloon gets ahead of it)
    out.y = H.y + softMax(B.y - pl.d0 * Math.tan(CRANE_ELEV) - H.y) - pl.sm0;
    return out;
  }

  /** The plan, made as the hand opens: where the route's balloon is, and the lift the predicted path needs. */
  private makePlan(b: RoutePoint, B0: THREE.Vector3, H: THREE.Vector3, dir: THREE.Vector3) {
    const d0 = Math.max(1, Math.hypot(H.x - B0.x, H.z - B0.z));
    const sm0 = softMax(B0.y - d0 * Math.tan(CRANE_ELEV) - H.y);
    const n = Math.round(PLAN_S / PLAN_STEP_S) + 1;
    const need = new Float64Array(n);
    // (the follow starts sooner in a strong wind: the balloon is soon well clear of the person anyway)
    const v = Number.isFinite(b.speedMs) ? Math.max(0, b.speedMs) : 0;
    const from = Math.min(FOLLOW_FROM_S, Math.max(FOLLOW_SOON_S, FOLLOW_FROM_S + 0.3 - 0.1 * v));
    this.plan = { B: B0.clone(), d0, sm0, need, from };
    // the predicted path: on with the wind, climbing
    const raw = new Float64Array(n);
    const Bp = new THREE.Vector3(), C = new THREE.Vector3();
    let drawn = -Infinity;
    for (let i = 0; i < n; i++) {
      const u = i * PLAN_STEP_S;
      Bp.set(B0.x + dir.x * v * u, B0.y + CLIMB_RATE_MS * u, B0.z + dir.z * v * u);
      // (past a roof it went over, the drawn balloon comes down to its route only slowly)
      Bp.y = Math.max(this.drawnY(Bp, b, B0), drawn - SLIDE.decayMs * PLAN_STEP_S);
      drawn = Bp.y;
      raw[i] = this.liftNeed(this.planAt(u, Bp, H, C), Bp, b, B0);
    }
    // each step needs what lies PLAN_AHEAD_S on too: the lift comes before the roof
    const ahead = Math.round(PLAN_AHEAD_S / PLAN_STEP_S);
    for (let i = 0; i < n; i++) {
      let m = 0;
      for (let j = i; j <= Math.min(n - 1, i + ahead); j++) m = Math.max(m, liftLater(raw[j], (j - i) * PLAN_STEP_S));
      need[i] = m;
    }
    return this.plan;
  }

  /**
   * How far a launch camera at p must rise to be LIFT_OVER_M over a roof under it (within 2 m), PERSON_OVER_M
   * over the person's ground within PERSON_EASE_M of them, and to see the balloon at B over what stands between
   * them (most of the way to it). 0 where nothing is in the way.
   */
  private liftNeed(p: V3, B: V3, b: RoutePoint, B0: THREE.Vector3): number {
    // following the balloon away over the person: over their head (the clamp keeps it there too)
    const o = this.launchOpts!;
    const ps = this.deps.toScene(o.personAt);
    let need = Math.hypot(p.x - ps.x, p.z - ps.z) < PERSON_EASE_M ? this.deps.groundAt(o.personAt) + PERSON_OVER_M - p.y : 0;
    if (!this.deps.buildingTopAt && !this.deps.treeTopAt) return Number.isFinite(need) ? need : 0;
    const By = this.drawnY(B, b, B0);
    const ll = this.fromScene(p.x, p.z, b, B0, this.ll);
    const g = this.deps.groundAt(ll);
    const T = this.spotTop(ll, 2);
    if (Number.isFinite(T) && T > g + 0.5) need = T + LIFT_OVER_M - p.y;
    for (const f of [0.15, 0.3, 0.45, 0.6, 0.75]) {
      const q = this.fromScene(p.x + (B.x - p.x) * f, p.z + (B.z - p.z) * f, b, B0, this.ll);
      const Tq = this.spotTop(q, 0.5);
      if (!Number.isFinite(Tq) || Tq <= this.deps.groundAt(q) + 0.5) continue;
      // the line from the camera to the balloon passes Tq + 0.5 there
      need = Math.max(need, (Tq + 0.5 - f * By) / (1 - f) - p.y);
    }
    // a balloon going over a roof is not filmed from close by, looking down on it against the roof: from
    // ROOF_SEE_M off at least
    const hd = Math.hypot(B.x - p.x, B.z - p.z);
    if (hd > 0.5 && hd < ROOF_SEE_M) {
      for (const s of [1, 3, 5]) {
        const q = this.fromScene(B.x + ((B.x - p.x) / hd) * s, B.z + ((B.z - p.z) / hd) * s, b, B0, this.ll);
        const Tq = this.spotTop(q, 0.5);
        if (!Number.isFinite(Tq) || Tq <= this.deps.groundAt(q) + 0.5 || Tq < By - 4) continue;
        need = Math.max(need, By + Math.sqrt(ROOF_SEE_M * ROOF_SEE_M - hd * hd) - p.y);
        break;
      }
    }
    return Number.isFinite(need) ? need : 0;
  }

  /** How high a balloon on its way at B is drawn: over a building it has met, up its facade and over its roof, never in it (R57b). */
  private drawnY(B: V3, b: RoutePoint, B0: THREE.Vector3): number {
    if (!this.deps.buildingTopAt) return B.y;
    const lb = this.fromScene(B.x, B.z, b, B0, this.ll);
    const T = this.deps.buildingTopAt(lb, SLIDE.radiusM);
    return T > this.deps.groundAt(lb) + 0.5 ? Math.max(B.y, T + SLIDE.marginM) : B.y;
  }

  /** The lift toward what is needed: a critically damped spring (quicker up than down), its acceleration and speed capped. */
  private liftStep(want: number, dt: number): void {
    if (!(dt > 0)) return;
    const T = want > this.lift ? LIFT_T_S : LIFT_DOWN_T_S;
    const n = Math.ceil(dt / (1 / 60) - 1e-9);
    const h = dt / n;
    for (let s = 0; s < n; s++) {
      const [x, v] = spring1(this.lift, this.liftV, want, T, h);
      let nv = v;
      let dv = nv - this.liftV;
      if (Math.abs(dv) > LIFT_MAX_A * h) dv = Math.sign(dv) * LIFT_MAX_A * h;
      nv = Math.max(-LIFT_MAX_V, Math.min(LIFT_MAX_V, this.liftV + dv));
      const capped = nv !== v;
      this.lift = Math.max(0, capped ? this.lift + ((this.liftV + nv) / 2) * h : x);
      this.liftV = nv;
    }
  }

  /**
   * Where the balloon sits across the frame (NDC x) so that it and what lies along `bearing` from the camera at
   * p share the frame (about symmetrically when they are close together); it saturates softly at 0.6, short
   * of the edge, when they are too far apart.
   */
  private share(p: V3, B: V3, bearing: number, fovDeg: number): number {
    const d = wrapPi(Math.atan2(B.x - p.x, -(B.z - p.z)) - bearing);
    // (a soft saturation: on a long lens the two part across the frame quickly, and the view must not swing
    // to keep them, then swing back after the balloon)
    return 0.6 * Math.tanh((0.5 * Math.tan(Math.max(-1.2, Math.min(1.2, d)))) / this.tanH(fovDeg) / 1.5);
  }

  /**
   * The hold's framing on its lens: the camera's pitch puts the horizon at HOLD_HORIZON (the lawn a quarter of
   * the frame), or lower if the person's feet would leave it (HOLD_FEET_MIN); returned as the balloon's NDC height.
   */
  private holdY0(H: THREE.Vector3, gP: number, B: V3, fovDeg: number): number {
    const ps = this.deps.toScene(this.launchOpts!.personAt);
    const tanH = Math.tan((fovDeg * RAD) / 2);
    const feet = Math.atan2(gP - H.y, Math.max(0.5, Math.hypot(ps.x - H.x, ps.z - H.z)));
    const pitch = Math.min(Math.atan(-HOLD_HORIZON * tanH), feet - Math.atan(HOLD_FEET_MIN * tanH));
    const eB = Math.atan2(B.y - H.y, Math.max(0.5, Math.hypot(B.x - H.x, B.z - H.z)));
    return Math.max(-0.5, Math.min(0.8, Math.tan(eB - pitch) / tanH));
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
    const x0 = Math.tan(dYaw) / this.tanH(st.fov);
    const y0 = Math.tan(dPitch) / Math.tan((st.fov * RAD) / 2);
    if (!(Math.abs(dYaw) < 1.2 && Math.abs(x0) < STILL_EDGE && Math.abs(y0) < STILL_EDGE)) this.stillLost = true;
    const tg = this.craneT;
    tg.pos.copy(st.pos);
    tg.x0 = x0;
    tg.y0 = y0;
    tg.fov = st.fov;
    tg.anchor.x = tg.anchor.y = tg.anchor.z = 0;
    tg.snap = true;
    tg.direct = false;
    return tg;
  }

  /**
   * The still frame: at eye height on a line through the person, upwind of them (so the balloon drifts
   * away down the middle of the frame rather than out of its side), (on the featured landmark's line first), far enough back (at least STILL_MIN_M) that the person's
   * feet and the balloon over the first STILL_FIT_S of its rise fill STILL_FILL of the height, on a long lens
   * (STILL_FOV), so the balloon reads (about 4% of the frame or more); the cut comes as it leaves the frame. A line with a building on the spot or between it and
   * the person is passed over for the next; if every one has, the first is used, over the building.
   * With a featured landmark taller than that frame (Big Ben), a frame that takes in its top is tried first
   * (landmarkFrame); the plain one is the fallback.
   */
  private stillFrame(b: RoutePoint, B0: THREE.Vector3, dir: THREE.Vector3): { pos: THREE.Vector3; yaw: number; pitch: number; fov: number } {
    const o = this.launchOpts!;
    const ps = this.deps.toScene(o.personAt);
    const gP = this.deps.groundAt(o.personAt);
    const top = Math.min(45, Math.max(OPEN_M + CLEAR_M, this.roofTop(o.personAt) - gP + CLEAR_M));
    const v = Number.isFinite(b.speedMs) ? Math.max(0, b.speedMs) : 2.5;
    // the first STILL_FIT_S of the rise (or until it clears the rooftops, if sooner): framed nearer than the
    // whole climb, so the balloon reads (about 4% of the frame's height or more) while it is in it
    const uTop = Math.max(1, Math.min(STILL_FIT_S, (top - 2.4) / CLIMB_RATE_MS));
    const fill = STILL_FILL * STILL_FOV * RAD;
    const a0 = new THREE.Vector3(-dir.x, 0, -dir.z);
    const axes = [0, 20, -20, 40, -40].map((deg) => a0.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), deg * RAD));
    // with a featured landmark, first on its line through the person (the landmark behind them, R57)
    const Ld = this.landmarkDir();
    if (Ld) axes.unshift(Ld.clone().negate());
    const riseUp = (a: THREE.Vector3, h: number, D: number, uMax: number) => {
      const along = -dir.dot(a); // the drift away from the camera, per m/s
      let up = -Math.PI / 2;
      for (let u = 0; u <= uMax + 1e-6; u += uMax / 8) up = Math.max(up, Math.atan2(2.4 + CLIMB_RATE_MS * u - h, D + v * u * along));
      return up;
    };
    const frame = (a: THREE.Vector3, h: number) => {
      const span = (D: number) => ({ up: riseUp(a, h, D, uTop), down: Math.atan2(h, D) });
      let D = STILL_MIN_M;
      for (; D < 150; D += 0.5) {
        const s = span(D);
        if (s.up + s.down <= fill) break;
      }
      const s = span(D);
      return { D, pitch: (s.up - s.down) / 2, fov: STILL_FOV };
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
    let pick: { a: THREE.Vector3; D: number; h: number; pitch: number; fov: number; yawOff?: number } | null = null;

    // the landmark's top, along its line from the person: [distance from the person, height over their eyes]
    const tops: [number, number][] = [];
    if (Ld && this.deps.buildingTopAt) {
      for (let dl = STILL_LM_STEP_M * 2; dl <= STILL_LM_REACH_M; dl += STILL_LM_STEP_M) {
        const t = this.deps.buildingTopAt(this.fromScene(ps.x + Ld.x * dl, ps.z + Ld.z * dl, b, B0), STILL_LM_STEP_M / 2) - gP - EYE_M;
        if (Number.isFinite(t) && t > OPEN_M) tops.push([dl, t]);
      }
    }
    if (Ld && tops.length) {
      // lines near the landmark's (it stays behind the person), the most nearly upwind first (the drift away)
      const lines = [0, 15, -15, 30, -30, 45, -45, 60, -60]
        .map((deg) => Ld.clone().negate().applyAxisAngle(new THREE.Vector3(0, 1, 0), deg * RAD))
        .sort((p, q) => q.dot(a0) - p.dot(a0));
      for (const a of lines) {
        const f = this.landmarkFrame(a, Ld, tops, dir, v, (D) => riseUp(a, EYE_M, D, Math.min(uTop, STILL_RISE_S)));
        if (f && clear(a, f.D)) {
          pick = { a, D: f.D, h: EYE_M, pitch: f.pitch, fov: f.fov, yawOff: f.yawOff };
          break;
        }
      }
    }

    for (const a of pick ? [] : axes) {
      const f = frame(a, EYE_M);
      if (clear(a, f.D)) {
        pick = { a, D: f.D, h: EYE_M, pitch: f.pitch, fov: f.fov };
        break;
      }
    }
    if (!pick) {
      const a = axes[0];
      const D = frame(a, EYE_M).D;
      const q = at(a, D);
      const over = this.deps.buildingTopAt ? this.deps.buildingTopAt(q, STREET_CLEAR_M) + LIFT_OVER_M - gP : EYE_M;
      const h = Math.max(EYE_M, over);
      const f = frame(a, h);
      pick = { a, D, h, pitch: f.pitch, fov: f.fov };
    }
    const q = at(pick.a, pick.D);
    const g = this.deps.groundAt(q);
    const pos = new THREE.Vector3(ps.x + pick.a.x * pick.D, (Number.isFinite(g) ? Math.max(g, gP) : gP) + pick.h, ps.z + pick.a.z * pick.D);
    return { pos, yaw: Math.atan2(-pick.a.x, pick.a.z) + (pick.yawOff ?? 0), pitch: pick.pitch, fov: pick.fov };
  }

  /**
   * A still on line `a` (person to camera) that takes in the featured landmark's top (spec 7.3; `tops`: along
   * its line Ld from the person, [distance, height over the person's eyes]), the person's feet and the start
   * of the rise (`riseUp(D)`: the highest angle the balloon reaches in it from D back), with a margin at both
   * edges, and across the frame the person, the landmark and the drifting balloon for STILL_RISE_S (the frame
   * turned by `yawOff` to hold them).
   * As far back as keeps the balloon at STILL_READ of the frame's height as it leaves the hand and STILL_READ_S on (a tall
   * landmark brings the camera nearer and the lens wider). Null when no distance does all that.
   */
  private landmarkFrame(a: THREE.Vector3, Ld: THREE.Vector3, tops: [number, number][], dir: THREE.Vector3, v: number, riseUp: (D: number) => number): { D: number; pitch: number; fov: number; yawOff: number } | null {
    // across the frame, as angles from the line to the person (the yaw the frame is turned by is chosen to
    // hold them all): the person, the landmark's top and the balloon as it drifts over STILL_RISE_S
    const yaw0 = Math.atan2(-a.x, a.z);
    const across = (wx: number, wz: number) => wrapPi(Math.atan2(wx, -wz) - yaw0);
    let best: { D: number; pitch: number; fov: number; yawOff: number } | null = null;
    for (let D = STILL_NEAR_M; D <= 60; D += 0.5) {
      let lm = -Math.PI / 2, lmAcross = 0;
      for (const [dl, t] of tops) {
        const dx = Ld.x * dl - a.x * D, dz = Ld.z * dl - a.z * D;
        const ang = Math.atan2(t, Math.hypot(dx, dz));
        if (ang > lm) {
          lm = ang;
          lmAcross = across(dx, dz);
        }
      }
      const up = Math.max(lm, riseUp(D)) + STILL_MARGIN;
      const down = Math.atan2(EYE_M, D) + STILL_MARGIN;
      const fov = Math.max(STILL_FOV * RAD, up + down);
      // it reads as it leaves the hand, and a moment on (drifting away, it shrinks)
      const dist = Math.hypot(D + v * STILL_READ_S * Math.max(0, -dir.dot(a)), 2.4 + CLIMB_RATE_MS * STILL_READ_S - EYE_M);
      if ((2 * this.deps.balloonRadius(dist)) / dist / fov < STILL_READ) continue;
      let lo = Math.min(0, lmAcross), hi = Math.max(0, lmAcross);
      let near = false;
      for (let u = 0; u <= STILL_RISE_S + 1e-6; u += STILL_RISE_S / 8) {
        const wx = -a.x * D + dir.x * v * u, wz = -a.z * D + dir.z * v * u;
        if (Math.hypot(wx, wz) < 2) near = true; // it would drift over the camera
        const f = across(wx, wz);
        lo = Math.min(lo, f);
        hi = Math.max(hi, f);
      }
      const half = Math.atan(this.tanH(fov / RAD)) * STILL_EDGE * 0.9;
      if (near || hi - lo > 2 * half) continue;
      // further back while it all holds: a longer lens
      best = { D, pitch: (up - down) / 2, fov: fov / RAD, yawOff: (hi + lo) / 2 };
    }
    return best;
  }

  /**
   * The start screen's establishing shot: on the featured landmark's line through the person, so the
   * landmark stands behind them (R36), or else on the street camera's line (so the launch push-in is a
   * straight move in), far enough back that the person and the held balloon fill
   * about a third of the screen (at most 70% of the free band), centred in the band. The first spot that is not in a building and has no
   * building between it and the person wins; nearer spots are tried, down to the street spot itself. A spot
   * on or beside a building, or in a crown, loses to any other (the clamp would lift it off eye height).
   */
  private waitTarget(b: RoutePoint, B: THREE.Vector3, B0: THREE.Vector3, S: THREE.Vector3, w: WaitFrame): Target {
    const fov = 40;
    const tanV = Math.tan((fov * RAD) / 2);
    const span = Math.min(1.6, Math.max(0.3, w.spanY));
    const o = this.launchOpts!;
    const ps = this.deps.toScene(o.personAt);
    const gP = this.deps.groundAt(o.personAt);
    // how blocked a spot is: 0 clear; a building or a tree on the spot counts 10, on the sightline 2, beside it
    // in the frame 1
    const blocked = (c: THREE.Vector3): number => {
      const ll = this.fromScene(c.x, c.z, b, B0);
      const g = this.deps.groundAt(ll);
      if (!Number.isFinite(g)) return Infinity;
      if (!this.deps.buildingTopAt && !this.deps.treeTopAt) return 0;
      // (on a building, within a crown, or anywhere the clamp would lift it off eye height: a spot looking
      // down from a roof edge is no spot)
      // (outweighing any sightline: 6 samples of it count 12 at most)
      let n = this.spotTop(ll, STREET_CLEAR_M) > g + 0.5 || this.spotTop(ll, CROWN_GAP_M + 1) > g + 1.5 ? 100 : 0;
      // the sightline, and as wide as the frame is there (a tree crown beside the camera fills a portrait frame)
      const D = Math.hypot(ps.x - c.x, ps.z - c.z);
      for (const f of [0.1, 0.2, 0.35, 0.5, 0.65, 0.8]) {
        const q = this.fromScene(c.x + (ps.x - c.x) * f, c.z + (ps.z - c.z) * f, b, B0);
        const gq = this.deps.groundAt(q) + 1;
        if (this.spotTop(q, 0.6) > gq) n += 2;
        else if (this.spotTop(q, 0.3 + WAIT_FRAME_W * f * D) > gq) n++;
      }
      return n;
    };
    this.recheck++;
    if (this.wide && this.recheck % 20 === 0) {
      const n = blocked(this.wide);
      if (n > this.wideBlocked || (n >= 100 && this.recheck % 60 === 0)) this.wide = null;
    }
    if (this.wide) this.settle(this.wide, b, B0, false, HOLD_EYE_M);
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
      for (const rot of [0, 12, -12, 25, -25, 40, -40, 60, -60, 90, -90, 135, -135, 180]) {
        for (const l of lines) {
          const lr = l.clone().applyAxisAngle(up, rot * RAD);
          for (const k of [1, 0.85, 0.7, 0.55, 0.42, 1.25]) cands.push(new THREE.Vector3(ps.x, 0, ps.z).addScaledVector(lr, -want * k));
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
      // every one of those on or by a house, or in a crown (a yard or a street among houses, street trees):
      // a ring search round the person, nearest first, so the camera stands at eye height on open ground
      // rather than by a house, where the clamp would lift it over the roof
      if (best >= 100) {
        const a0 = Math.atan2(-u.x, -u.z);
        for (const r of [3, 4, 5, 6.5, 8, 10, 2.2, 13, 17, 22, 28]) {
          for (let k = 0; k < 24 && best > 0; k++) {
            const a = a0 + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 15 * RAD;
            const c = new THREE.Vector3(ps.x + Math.sin(a) * r, 0, ps.z + Math.cos(a) * r);
            const n = blocked(c);
            if (n < best) {
              best = n;
              pick = c;
            }
          }
        }
      }
      if (pick) pick.setY(this.deps.groundAt(this.fromScene(pick.x, pick.z, b, B0)) + HOLD_EYE_M);
      if (!pick || !finite3(pick)) pick = S.clone();
      this.wide = pick;
      this.wideBlocked = Math.min(best, 999);
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
   * In the launch the clamp never moves the camera at once (a building or a tree streaming in under or beside it, the
   * balloon's sphere grazed on the push in): its correction (out - pos) is taken in through a critically
   * damped spring (CLAMP_T_S) whose acceleration is capped at CLAMP_MAX_A and speed at CLAMP_MAX_V, so the
   * camera rises over what arrived instead of jumping. Hard safety: a camera inside a building (below a roof
   * within STREET_CLEAR_M) catches up on a stiffer spring (CLAMP_CATCH_T_S), still under the same caps: a
   * second or two inside a wall that has just streamed in is less jarring than a jump of a storey or more,
   * and the launch's planned path (launchPlan's lift, its own clamp before the follower) keeps clear of the
   * buildings already there. A cut (the first frame, a still, a snap) takes the correction as it is.
   * Writes the camera's place into out.
   */
  private easeClamp(out: THREE.Vector3, b: RoutePoint, B0: THREE.Vector3): void {
    const g = this.guard;
    const want = g.want.copy(out).sub(this.pos);
    // only the launch eases: elsewhere (Ride, Above, Side-on, circling, replay) and while paused the
    // correction is taken at once, so no view sits in a building or the ground; what is left of the
    // launch's eased correction at the hand-over is still eased out (the hand-over is not a jump), until it
    // has met the correction
    if (this.paused || (this._shot !== 'launch' && (!g.on || (want.distanceTo(g.off) < 0.02 && g.v.length() < 0.05)))) {
      g.on = false;
      return;
    }
    const dt = this.stepS;
    if (!g.on || !finite3(want)) {
      if (finite3(want)) g.off.copy(want);
      else g.off.set(0, 0, 0);
      g.v.set(0, 0, 0);
      g.on = true;
      return;
    }
    if (dt > 0) {
      let T = CLAMP_T_S;
      if (this.deps.buildingTopAt) {
        const ll = this.fromScene(this.pos.x + g.off.x, this.pos.z + g.off.z, b, B0, this.ll);
        const top = this.deps.buildingTopAt(ll, STREET_CLEAR_M);
        if (top > this.deps.groundAt(ll) + 0.5 && this.pos.y + g.off.y < top) T = CLAMP_CATCH_T_S;
      }
      // (in the launch the follower already takes the planned move's clamp in at LAUNCH_MAX_A: the guard only
      // covers what is left over, with what is left of the budget)
      // (and after it the cap comes back up over a few seconds: the hand-over is not a jolt either)
      if (this._shot === 'launch' && this.track.on && !this.wait) g.aMax = CLAMP_LAUNCH_A;
      else g.aMax = Math.min(CLAMP_MAX_A, g.aMax + 0.5 * dt);
      const n = Math.ceil(dt * 120 - 1e-9);
      const h = dt / n;
      const w = 2 / T;
      for (let i = 0; i < n; i++) {
        // toward the clamp's correction at a speed it can always stop from (as followStep: never an overshoot,
        // however the cap or the correction changes), reaching it over CLAMP_V_T_S, the acceleration capped;
        // a speed it already has that the cap could not stop in time is stopped as gently as it can be
        const ex = want.x - g.off.x, ey = want.y - g.off.y, ez = want.z - g.off.z;
        const e = Math.hypot(ex, ey, ez);
        const v = g.v.length();
        const aMax = g.aMax + (e > 1e-6 ? Math.min(0.5, Math.max(0, (v * v) / (2 * e) - g.aMax)) : 0);
        const close = e > 1e-9 ? Math.min(w * e, Math.sqrt(2 * 0.8 * aMax * e), CLAMP_MAX_V) / e : 0;
        let ax = (ex * close - g.v.x) / CLAMP_V_T_S;
        let ay = (ey * close - g.v.y) / CLAMP_V_T_S;
        let az = (ez * close - g.v.z) / CLAMP_V_T_S;
        const am = Math.hypot(ax, ay, az);
        if (am > aMax) {
          ax *= aMax / am;
          ay *= aMax / am;
          az *= aMax / am;
        }
        g.off.x += (g.v.x + (ax * h) / 2) * h;
        g.off.y += (g.v.y + (ay * h) / 2) * h;
        g.off.z += (g.v.z + (az * h) / 2) * h;
        g.v.x += ax * h;
        g.v.y += ay * h;
        g.v.z += az * h;
      }
    }
    out.copy(this.pos).add(g.off);
  }

  /**
   * Applied after smoothing. Outside the balloon and its string; then never inside terrain or buildings:
   * ground + 8 m, building tops within 30 m (or the balloon's distance, if nearer) + 3 m, and always at least 1 m over any building within 1.5 m
   * (never inside one; the same radius the street camera's spot is checked with). During the launch the
   * street shot and the crane are exempt from the 8 m and 30 m rules (the camera stands in the street beside
   * the person, then cranes up between the buildings, rising over them itself where it must: launchPlan);
   * both rules come in with the push back in to the balloon, which ends above the rooftops.
   */
  private clamp(p: THREE.Vector3, b: RoutePoint, B: THREE.Vector3, B0: THREE.Vector3): void {
    // trees first: a sideways push out of a crown, which the rules below (the balloon, the person, the
    // ground and buildings) may then move again, so those always have the last word
    this.outOfCrowns(p, b, B0);
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
      const c = Number.isNaN(this.pushAt) || this.reduced ? 0 : smoother((this.launchT - this.pushAt) / PUSH_MOVE_S);
      clearance = 0.6 + (8 - 0.6) * c;
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
      // (over a building, that is: on open ground the launch camera may stand lower than a metre)
      const near = this.deps.buildingTopAt(ll, STREET_CLEAR_M);
      if (near > this.deps.groundAt(ll) + 0.5) floor = Math.max(floor, near + 1);
    }
    if (p.y < floor) p.y = floor;
  }

  /**
   * The camera low among trees (the launch in a park; Ride or Film low over one, as a link opened in the
   * first minutes, or a landed balloon), never inside a tree's crown: below a crown's top and within its
   * cone there, it is pushed out sideways to the cone plus CROWN_GAP_M (not lifted: a lift would be a
   * jump). Twice, for a camera between two crowns. Outside the launch only when the camera is within
   * CROWN_CHECK_M of the ground (the lookup is the stream's grid index). No allocation.
   */
  private outOfCrowns(p: THREE.Vector3, b: RoutePoint, B0: THREE.Vector3): void {
    const near = this.deps.crownNear;
    if (!near) return;
    const cr = this.crown;
    if (this._shot !== 'launch' && p.y - this.deps.groundAt(this.fromScene(p.x, p.z, b, B0, this.ll)) > CROWN_CHECK_M) return;
    for (let k = 0; k < 2; k++) {
      if (!near(this.fromScene(p.x, p.z, b, B0, this.ll), CROWN_GAP_M, cr)) return;
      const H = cr.top - cr.base;
      if (!(H > 0) || p.y >= cr.top) return;
      const rAt = cr.radius * Math.min(1, Math.max(0, 1 - (p.y - cr.base) / H)) + CROWN_GAP_M;
      const t = this.deps.toScene(cr);
      let dx = p.x - t.x, dz = p.z - t.z;
      const dh = Math.hypot(dx, dz);
      if (dh >= rAt) return;
      if (dh < 1e-6) [dx, dz] = [1, 0];
      const f = rAt / Math.max(1e-6, Math.hypot(dx, dz));
      p.x = t.x + dx * f;
      p.z = t.z + dz * f;
    }
  }

  /** Does the eye-height spot c see the person (nothing standing on the line between, tree crowns included)? */
  private seesPerson(c: THREE.Vector3, b: RoutePoint, B0: THREE.Vector3): boolean {
    const ps = this.deps.toScene(this.launchOpts!.personAt);
    for (const f of [0.2, 0.35, 0.5, 0.7, 0.85]) {
      const q = this.fromScene(c.x + (ps.x - c.x) * f, c.z + (ps.z - c.z) * f, b, B0, this.ll);
      if (this.spotTop(q, 0.6) > this.deps.groundAt(q) + 1) return false;
    }
    return true;
  }

  /** What stands at an eye-height camera spot or on its sightline: buildings, landmarks and trees (absolute top). */
  private spotTop(p: LatLon, r: number): number {
    const b = this.deps.buildingTopAt ? this.deps.buildingTopAt(p, r) : -Infinity;
    const t = this.deps.treeTopAt ? this.deps.treeTopAt(p, r) : -Infinity;
    return Math.max(b, t);
  }

  /** Put a cached camera spot on the ground as drawn now; false when a building now stands on it (if checked). */
  private settle(c: THREE.Vector3, b: RoutePoint, B0: THREE.Vector3, check: boolean, eye = EYE_M): boolean {
    const ll = this.fromScene(c.x, c.z, b, B0);
    const g = this.deps.groundAt(ll);
    if (!Number.isFinite(g)) return true;
    if (check && this.spotTop(ll, STREET_CLEAR_M) > g + 0.5) return false;
    c.y = g + eye;
    return true;
  }

  /** Inverse of toScene near the balloon, from a finite-difference Jacobian. */
  private fromScene(x: number, z: number, b: RoutePoint, B: THREE.Vector3, out: LatLon = { lat: 0, lon: 0 }): LatLon {
    // B is the route's own scene position (not a drawn-balloon override). The Jacobian is worked out once
    // for a base point (in practice once a frame), not on every lookup.
    const J = this.jac;
    if (J.lat !== b.lat || J.lon !== b.lon || J.bx !== B.x || J.bz !== B.z) {
      const h = 0.001;
      const dN = this.deps.toScene({ lat: b.lat + h, lon: b.lon });
      const dE = this.deps.toScene({ lat: b.lat, lon: b.lon + h });
      J.a = (dN.x - B.x) / h; J.c = (dN.z - B.z) / h; // d(x,z)/dLat
      J.e = (dE.x - B.x) / h; J.f = (dE.z - B.z) / h; // d(x,z)/dLon
      J.det = J.a * J.f - J.e * J.c;
      J.lat = b.lat; J.lon = b.lon; J.bx = B.x; J.bz = B.z;
    }
    out.lat = b.lat;
    out.lon = b.lon;
    if (!(Math.abs(J.det) >= 1e-9)) return out;
    const dx = x - B.x, dz = z - B.z;
    out.lat += (J.f * dx - J.e * dz) / J.det;
    out.lon += (-J.c * dx + J.a * dz) / J.det;
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
