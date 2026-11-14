import * as THREE from 'three';
import type { LatLon } from '../geo/coords';
import { buildFigure, OUTFITS, outfitFor, type Rig } from './figure';
import { copyPose, mixPose, newPose, poseAt, releaseTAt, type Phase, type Pose } from './gesture';

/**
 * The person who lets go (spec 6.2, Task 26d, ruling R62): anonymous and faceless, so anyone can see
 * themselves in them, and warm through silhouette, colour and posture (figure.ts: a coat in a warm
 * muted tone, a scarf whose end lifts in the wind, a hat or a hair shape; one of four outfits, chosen
 * from the start place). The performance is gesture.ts: pose to pose, slow in and slow out.
 *
 *   const person = new Person(scene, at, facingDeg, feet, { reducedMotion, wind });
 *   balloon.hold(person.hand, person);       // the string's grip (StringGrip below), read every frame
 *   person.play(() => balloon.release(), { readyAt: routeReady, onTimeout: showWindError });
 *   person.lookAt(balloon.mesh.position);    // the head follows the balloon
 *   person.update(dt);                       // every frame
 *
 * Before play() the person holds the balloon on the start screen: the string in a loosely closed
 * hand at chest height, the head tilted up toward it, breathing. The launch (spec 8): from the tap
 * the arm lifts a little, up onto the toes, a breath in; the hand opens at 1.2 s (onRelease, the
 * balloon squashes for 120 ms): thumb and fingers open over 0.25 s while the string's end slips out
 * of the fingers (releaseT 0 to 1); the open hand follows the balloon up while the head and body tilt
 * up to watch; around 3 to 6 s a quiet reaction (the arm lowers, the other hand to the chest); then a
 * calm rest. If the route is not ready at 1.2 s the person keeps holding (the anticipation held) and
 * lets go as soon as it is; at 6 s without a route (or at once if `readyAt` rejects) the launch times
 * out: onRelease is never called, `timedOut` is set and onTimeout runs, so the app can show the wind
 * error. Post-release beats are timed from the actual release. Reduced motion: the same hand
 * opening, a third of the body motion.
 */
export const PERSON_HEIGHT_M = 1.71;
export const HOLD_S = 1.2;
export const MAX_HOLD_S = 6;
const DEFAULT_LOOK = 1; // rad up, when there is nothing to look at
const MAX_HEAD_PITCH = 0.95;
/** Back from an interrupted launch to holding, over this long (s). */
const BLEND_S = 0.8;

/**
 * The hand/string contract (Task 26d with the string in balloon.ts): what the string reads from the
 * person's hand every frame. Person implements it; pass it to Balloon.hold(person.hand, person).
 */
export interface StringGrip {
  /**
   * World position of the string's end (scene metres), correct after every update(): in the closed
   * fist while held, moving with the fingers as they open, and sliding out past the fingertips while
   * releaseT runs from 0 to 1. The same Vector3 for the person's life: hold on to it.
   */
  readonly hand: THREE.Vector3;
  /**
   * 0 while the fist is closed round the string (also before the hand opens, and on the start
   * screen); from the hand opening it runs 0 to 1 over the slip (about 0.2 s, starting 0.03 s after
   * onRelease) as the end leaves the fingers; 1 once it is free, and it stays 1 for the person's
   * life (latched: a launch called off, a new play() or dispose() mid-slip never takes it back to 0;
   * a new balloon is held by a new person). While it is below 1 the string's end belongs to the hand
   * (pin it to `hand`); at 1 it is the string's own.
   */
  readonly releaseT: number;
}

export type PersonState = 'idle' | 'holding' | 'released' | 'timedOut';
export type PlayOpts = {
  /** Resolves when the route is ready; the hand opens at max(1.2 s, ready), never after holdS. */
  readyAt?: Promise<unknown>;
  onTimeout?: () => void;
  /**
   * Give up waiting for the route after this much frame time (default MAX_HOLD_S). Infinity leaves the
   * wait to the caller (the live scene counts it in real time and calls holdIdle).
   */
  holdS?: number;
  /**
   * A real clock (ms, e.g. performance.now): the hold (1.2 s, and holdS) and the performance after it
   * are then counted in real time, so a phone at a frame or two a second still lets go at 1.2 s once
   * the route is ready. By default they are counted in frame time (update's dt, at most 0.1 s a frame).
   */
  now?: () => number;
};
export type PersonOpts = {
  reducedMotion?: boolean;
  /** The wind at the start (the scarf's end lifts downwind): speed m/s, heading the compass bearing it blows toward. */
  wind?: { speedMs: number; headingDeg: number };
  /** An outfit index (default: chosen from the place). */
  outfit?: number;
};

type V3 = { x: number; y: number; z: number };
type Arm = { side: 1 | -1; shoulder: THREE.Bone; roll: THREE.Bone; elbow: THREE.Bone; wrist: THREE.Bone; thumb: THREE.Bone; finger1: THREE.Bone; finger2: THREE.Bone };
const RAD = Math.PI / 180;
const smooth = (x: number) => x * x * (3 - 2 * x);

export class Person implements StringGrip {
  readonly at: LatLon;
  readonly facingDeg: number;
  /** Feet, at the scene position; rotated to face facingDeg. */
  readonly root = new THREE.Group();
  /** The string's grip in world space (StringGrip.hand), updated by update(). */
  readonly hand = new THREE.Vector3();
  /** Which of OUTFITS this person wears. */
  readonly outfit: number;
  /** Triangles in the figure. */
  readonly triangles: number;
  state: PersonState = 'idle';

  private readonly scene: THREE.Object3D;
  private readonly rig: Rig;
  private readonly reduced: boolean;
  private wind = { speedMs: 3, headingDeg: 0 };
  private t = 0;
  private clock = 0;
  private releasedAt = Infinity;
  private releasedMs = 0;
  private ready = true;
  private failed = false;
  private token = 0;
  private onRelease: (() => void) | null = null;
  private onTimeout: (() => void) | null = null;
  private holdS = MAX_HOLD_S;
  private realNow: (() => number) | null = null;
  private startMs = 0;
  private held = 0;
  private look: V3 | null = null;
  /** The pose applied last frame, and the one being built (scratch: a frame allocates nothing). */
  private readonly cur: Pose = newPose();
  private readonly from: Pose = newPose();
  private posed = false;
  private lastKind: Phase['kind'] = 'idle';
  private blendAt = Number.NaN;
  /** Released once: the string has gone (StringGrip.releaseT stays 1). */
  private letGo = false;
  private readonly phaseIdle: Phase = { kind: 'idle' };
  private readonly phaseAnt: Phase & { kind: 'anticipate' } = { kind: 'anticipate', s: 0 };
  private readonly phaseRel: Phase & { kind: 'released' } = { kind: 'released', s: 0 };
  private readonly arms: Arm[];
  private head = { pitch: 0, yaw: 0, init: false };
  // scratch
  private readonly v1 = new THREE.Vector3();
  private readonly v2 = new THREE.Vector3();
  private readonly q1 = new THREE.Quaternion();
  private readonly axis = new THREE.Vector3();

  constructor(scene: THREE.Object3D, at: LatLon, facingDeg: number, feet?: V3, opts: PersonOpts = {}) {
    this.scene = scene;
    this.at = at;
    this.facingDeg = facingDeg;
    this.reduced = !!opts.reducedMotion;
    this.outfit = opts.outfit !== undefined ? ((Math.round(opts.outfit) % OUTFITS.length) + OUTFITS.length) % OUTFITS.length : outfitFor(at);
    this.rig = buildFigure(OUTFITS[this.outfit]);
    this.triangles = this.rig.triangles;
    this.wind = opts.wind && Number.isFinite(opts.wind.speedMs + opts.wind.headingDeg) ? { ...opts.wind } : { speedMs: 3, headingDeg: facingDeg + 200 };
    const b = this.rig.bones;
    this.arms = (['R', 'L'] as const).map((s) => ({
      side: s === 'R' ? 1 : -1,
      shoulder: b[`shoulder${s}`],
      roll: b[`roll${s}`],
      elbow: b[`elbow${s}`],
      wrist: b[`wrist${s}`],
      thumb: b[`thumb${s}`],
      finger1: b[`finger1${s}`],
      finger2: b[`finger2${s}`],
    }));
    this.root.add(this.rig.mesh);
    this.root.rotation.y = -facingDeg * RAD; // model faces -z (north); compass heading clockwise
    if (feet) this.place(feet);
    scene.add(this.root);
    this.pose(0);
  }

  /** Move the feet to a scene position (for example after a floating-origin shift). */
  place(feet: V3): void {
    this.root.position.set(feet.x, feet.y, feet.z);
    this.root.updateMatrixWorld(true);
    this.updateHand();
  }

  /** Something to watch (the balloon); null to look up at nothing in particular. */
  lookAt(target: V3 | null): void {
    this.look = target;
  }

  /** The wind at the start: the scarf's end lifts downwind. */
  setWind(w: { speedMs: number; headingDeg: number }): void {
    if (Number.isFinite(w.speedMs + w.headingDeg)) this.wind = { ...w };
  }

  /** Start the launch timeline. */
  play(onRelease: () => void, opts: PlayOpts = {}): void {
    const token = ++this.token;
    if (this.state !== 'idle') this.startBlend();
    this.state = 'holding';
    this.t = 0;
    this.held = 0;
    this.releasedAt = Infinity;
    this.onRelease = onRelease;
    this.onTimeout = opts.onTimeout ?? null;
    this.holdS = opts.holdS ?? MAX_HOLD_S;
    this.realNow = opts.now ?? null;
    this.startMs = this.realNow ? this.realNow() : 0;
    this.failed = false;
    this.ready = !opts.readyAt;
    opts.readyAt?.then(
      () => { if (token === this.token) this.ready = true; },
      () => { if (token === this.token) this.failed = true; },
    );
  }

  /** Back to holding the balloon on the start screen, with no timeline running (eased back, no snap). */
  holdIdle(): void {
    this.token++;
    if (this.state !== 'idle') this.startBlend();
    this.state = 'idle';
    this.t = 0;
    this.releasedAt = Infinity;
    this.onRelease = null;
    this.onTimeout = null;
  }

  get timedOut(): boolean {
    return this.state === 'timedOut';
  }

  /** StringGrip.releaseT: 0 while the fist holds the string, 0 to 1 as it slips out, 1 once free. */
  get releaseT(): number {
    if (this.state === 'released') return releaseTAt(this.sinceRelease());
    return this.letGo ? 1 : 0;
  }

  /** How far the person is looking up, in radians (head plus lean back). */
  get headPitch(): number {
    return this.head.pitch + this.cur.body.lean;
  }

  update(dtSec: number): void {
    const dt = Number.isFinite(dtSec) ? Math.min(Math.max(dtSec, 0), 0.1) : 0;
    this.clock += dt;
    if (this.state === 'holding') {
      this.t += dt;
      // how long it has held: real time when play() was given a clock, else frame time
      this.held = this.realNow ? (this.realNow() - this.startMs) / 1000 : this.t;
      if (this.held >= this.holdS - 1e-9 || this.failed) {
        this.state = 'timedOut';
        this.startBlend();
        const cb = this.onTimeout;
        this.onTimeout = this.onRelease = null;
        cb?.();
      } else if (this.held >= HOLD_S - 1e-9 && this.ready) {
        this.state = 'released';
        this.letGo = true;
        this.releasedAt = this.t;
        this.releasedMs = this.realNow ? this.realNow() : 0;
        const cb = this.onRelease;
        this.onRelease = this.onTimeout = null;
        cb?.();
      }
    } else if (this.state === 'released') {
      this.t += dt;
    }
    this.pose(dt);
  }

  /** World position of the string's grip (the same as `hand`). */
  handPosition(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.hand);
  }

  /** Seconds since the hand opened (real time when play() was given a clock). */
  private sinceRelease(): number {
    if (this.state !== 'released') return 0;
    return this.realNow ? Math.max(0, (this.realNow() - this.releasedMs) / 1000) : this.t - this.releasedAt;
  }

  private phase(): Phase {
    if (this.state === 'holding') {
      this.phaseAnt.s = this.held;
      return this.phaseAnt;
    }
    if (this.state === 'released') {
      this.phaseRel.s = this.sinceRelease();
      return this.phaseRel;
    }
    return this.phaseIdle;
  }

  /** The pose is about to jump (an interrupted launch): ease from where it is now. */
  private startBlend(): void {
    if (!this.posed) return;
    copyPose(this.cur, this.from);
    this.blendAt = this.clock;
  }

  /** Whether an eased change-over from an interrupted launch is running. */
  get blending(): boolean {
    return !Number.isNaN(this.blendAt);
  }

  private pose(dt: number): void {
    const ph = this.phase();
    // idle to anticipation and anticipation to release continue from the pose before; anything else
    // (a launch called off) eases over from where the body was
    const natural = ph.kind === this.lastKind || (this.lastKind === 'idle' && ph.kind === 'anticipate') || (this.lastKind === 'anticipate' && ph.kind === 'released');
    if (!natural && !this.blending) this.startBlend();
    this.lastKind = ph.kind;
    const p = poseAt(ph, this.clock, this.reduced, this.cur);
    if (this.blending) {
      const f = (this.clock - this.blendAt) / BLEND_S;
      if (f >= 1) this.blendAt = Number.NaN;
      else mixPose(this.from, p, smooth(Math.max(0, f)), p);
    }
    this.posed = true;
    this.apply(p, dt);
  }

  private apply(p: Pose, dt: number): void {
    const b = this.rig.bones;
    const { body } = p;
    b.feet.rotation.x = -body.heel;
    b.body.position.y = body.rise;
    b.body.rotation.z = body.shift;
    b.torso.rotation.x = body.lean;
    const ch = body.chest;
    b.torso.scale.set(1 + 0.01 * ch, 1 + 0.005 * ch, 1 + 0.02 * ch);

    for (let i = 0; i < 2; i++) {
      const arm = this.arms[i], a = i === 0 ? p.r : p.l, side = arm.side;
      arm.shoulder.rotation.set(a.pitch, 0, a.out * side);
      arm.roll.rotation.y = a.roll * side;
      arm.elbow.rotation.x = a.elbow;
      arm.wrist.rotation.set(a.dev, a.twist * side, -side * a.wrist, 'YXZ');
      // the thumb: splayed forward when open, across the front of the curled fingers when closed
      arm.thumb.rotation.set(0.89 - 1.75 * a.thumb, 0, -side * (0.3 + 0.56 * a.thumb));
      arm.finger1.rotation.z = -side * (0.06 + 1.5 * a.fingers);
      arm.finger2.rotation.z = -side * (0.08 + 1.55 * a.fingers);
    }

    // the head: up toward the balloon by `look` of the way (less what the body's lean already gives)
    let pitch = DEFAULT_LOOK, yaw = 0;
    if (this.look) {
      // where the neck was drawn last frame (the one matrix update a frame is at the end)
      const headW = this.v1.setFromMatrixPosition(b.neck.matrixWorld);
      const d = this.v2.set(this.look.x - headW.x, this.look.y - headW.y, this.look.z - headW.z);
      d.applyQuaternion(this.q1.copy(this.root.quaternion).invert()); // into the body frame (faces -z)
      const horiz = Math.hypot(d.x, d.z);
      pitch = Math.max(0, Math.atan2(d.y, horiz));
      yaw = Math.max(-0.9, Math.min(0.9, Math.atan2(-d.x, -d.z)));
      if (horiz < 0.05) yaw = 0;
    }
    const wantPitch = Math.max(-0.1, Math.min(MAX_HEAD_PITCH, body.look * pitch - body.lean));
    const wantYaw = body.look * yaw * 0.8;
    const h = this.head;
    const k = !h.init || dt <= 0 ? (h.init ? 0 : 1) : 1 - Math.exp(-dt * 5);
    h.pitch += (wantPitch - h.pitch) * k;
    h.yaw += (wantYaw - h.yaw) * k;
    h.init = true;
    b.neck.rotation.set(h.pitch, h.yaw, 0, 'YXZ');

    // the scarf's end lifts gently downwind, a slow flutter running down it (always a little behind)
    const c = this.clock;
    const rel = (this.wind.headingDeg - this.facingDeg) * RAD;
    const wn = Math.min(1, Math.max(0, this.wind.speedMs) / 9);
    const calm = this.reduced ? 0.3 : 1;
    const dx = Math.sin(rel), dz = -Math.cos(rel) * 0.7 + 0.75; // downwind in the body frame, biased behind
    const dl = Math.hypot(dx, dz) || 1;
    this.axis.set(-dz / dl, 0, dx / dl); // turns -y toward (dx, 0, dz)
    const flutter = calm * (0.05 + 0.08 * wn);
    const a1 = 0.1 + 0.28 * wn + flutter * (Math.sin(c * 2.1) + 0.45 * Math.sin(c * 5.3 + 1));
    const a2 = 0.16 + 0.32 * wn + flutter * 1.4 * (Math.sin(c * 2.1 - 0.9) + 0.45 * Math.sin(c * 5.3 - 0.4));
    b.tail1.quaternion.setFromAxisAngle(this.axis, a1);
    b.tail2.quaternion.setFromAxisAngle(this.axis, a2);

    this.root.updateMatrixWorld(true);
    this.updateHand();
  }

  /** The grip: in the fist, then along the opening fingers and out past the fingertips. */
  private updateHand(): void {
    const a = this.rig.gripIn.getWorldPosition(this.v1);
    const t = this.releaseT;
    if (t <= 0) {
      this.hand.copy(a);
      return;
    }
    const out = this.rig.gripOut.getWorldPosition(this.v2);
    this.hand.copy(a).lerp(out, smooth(t));
  }

  /** Removes the person; any running launch is cancelled (a late route or timeout never calls back). */
  dispose(): void {
    this.token++;
    this.onRelease = null;
    this.onTimeout = null;
    this.state = 'idle';
    this.letGo ||= this.releasedAt < Infinity;
    this.scene.remove(this.root);
    this.rig.mesh.geometry.dispose();
    this.rig.mesh.skeleton.dispose();
    this.rig.material.dispose();
  }
}
