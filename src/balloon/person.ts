import * as THREE from 'three';
import type { LatLon } from '../geo/coords';
import { CONTOUR, lerpHex } from '../world/palette';

/**
 * The person who lets go (spec 6.2): simple, stylised, anonymous. Capsule body, sphere head with no
 * face, two-part arms, faceted like the rest of Contour, dressed in its chalk and clay tones.
 *
 *   const person = new Person(scene, at, facingDeg, feet);   // feet: scene position of the feet
 *   balloon.hold(person.hand);                               // person.hand is updated every frame
 *   person.play(() => balloon.release(), { readyAt: routeReady, onTimeout: showWindError });
 *   person.lookAt(balloon.mesh.position);                    // optional: the eyes follow the balloon
 *   person.update(dt);                                       // every frame
 *
 * Before play() the person holds the balloon with an idle sway (the start screen). The launch
 * (spec 8): hold with idle sway from 0 to 1.2 s; the hand opens at 1.2 s (onRelease, the balloon
 * squashes for 120 ms); the head tips up to watch it from 1.2 to 3 s; the arm half-raises toward
 * it from 2 to 3.5 s. If the route is not ready at 1.2 s the person keeps holding and lets go as
 * soon as it is; at 6 s without a route (or at once if `readyAt` rejects) the launch times out:
 * onRelease is never called, `timedOut` is set and onTimeout runs, so the app can show the wind
 * error. Post-release beats are timed from the actual release.
 *
 * Body motion is pose-to-pose with slow-in slow-out (sine) easing; it is character motion, not
 * interface motion, so it does not use the interface curve. No overshoot.
 */
export const PERSON_HEIGHT_M = 1.71;
export const HOLD_S = 1.2;
export const MAX_HOLD_S = 6;
const LOOK_S = 1.8; // 1.2 -> 3 s
const RAISE_FROM_S = 0.8; // 2 s
const RAISE_S = 1.5; // -> 3.5 s
const LOWER_FROM_S = 6.5;
const LOWER_S = 3;
const DEFAULT_LOOK = 0.85; // rad, when nothing to look at
const MAX_LOOK = 1.15;

export type PersonState = 'idle' | 'holding' | 'released' | 'timedOut';
export type PlayOpts = {
  /** Resolves when the route is ready; the hand opens at max(1.2 s, ready), never after 6 s. */
  readyAt?: Promise<unknown>;
  onTimeout?: () => void;
};

type V3 = { x: number; y: number; z: number };
type ArmPose = { upper: number; elbow: number; out: number };
const HOLD: ArmPose = { upper: 0.28, elbow: 1.1, out: 0.1 };
const RAISE: ArmPose = { upper: 1.6, elbow: 0.4, out: 0.22 };
const REST: ArmPose = { upper: 0.05, elbow: 0.12, out: 0.07 };
const RAD = Math.PI / 180;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
/** Slow in, slow out. */
const easeInOut = (x: number) => 0.5 - 0.5 * Math.cos(Math.PI * clamp01(x));
const mixPose = (a: ArmPose, b: ArmPose, f: number): ArmPose => ({
  upper: a.upper + (b.upper - a.upper) * f,
  elbow: a.elbow + (b.elbow - a.elbow) * f,
  out: a.out + (b.out - a.out) * f,
});

type Arm = { shoulder: THREE.Group; elbow: THREE.Group; hand: THREE.Mesh };

export class Person {
  readonly at: LatLon;
  readonly facingDeg: number;
  /** Feet, at the scene position; rotated to face facingDeg. */
  readonly root = new THREE.Group();
  /** World position of the holding hand (the string's grip), updated by update(). */
  readonly hand = new THREE.Vector3();
  state: PersonState = 'idle';

  private readonly scene: THREE.Object3D;
  private readonly body = new THREE.Group(); // sways from the ankles
  private readonly torso = new THREE.Group(); // leans back from the hips
  private readonly head = new THREE.Group();
  private readonly right: Arm;
  private readonly left: Arm;
  private readonly materials: THREE.Material[] = [];
  private t = 0;
  private clock = 0;
  private releasedAt = Infinity;
  private ready = true;
  private failed = false;
  private token = 0;
  private onRelease: (() => void) | null = null;
  private onTimeout: (() => void) | null = null;
  private look: V3 | null = null;
  // smoothed joint values
  private j = { headPitch: 0, headYaw: 0, lean: 0, rUpper: HOLD.upper, rElbow: HOLD.elbow, rOut: HOLD.out, open: 0 };

  constructor(scene: THREE.Object3D, at: LatLon, facingDeg: number, feet?: V3) {
    this.scene = scene;
    this.at = at;
    this.facingDeg = facingDeg;
    const mat = (hex: string) => {
      const m = new THREE.MeshStandardMaterial({ color: hex, roughness: 0.92, metalness: 0, flatShading: true });
      this.materials.push(m);
      return m;
    };
    // cool slate coat, darker slate trousers, chalk skin: calm, and nothing near the balloon's hue
    const coat = mat(CONTOUR.roof[2]);
    const trousers = mat(lerpHex(CONTOUR.roof[2], '#3a3f46', 0.5));
    const shoes = mat(lerpHex(CONTOUR.roof[2], '#2a2d33', 0.75));
    const skin = mat(CONTOUR.building[1]); // chalk: a mannequin, not a portrait
    const hair = mat(lerpHex(CONTOUR.roof[1], '#3e3832', 0.65));
    const capsule = (r: number, len: number, m: THREE.Material) => new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 3, 10), m);

    // legs and shoes
    for (const sx of [-1, 1]) {
      const leg = capsule(0.068, 0.74, trousers);
      leg.position.set(0.092 * sx, 0.45, 0);
      const shoe = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 6), shoes);
      shoe.scale.set(0.95, 0.55, 1.75);
      shoe.position.set(0.092 * sx, 0.035, -0.04);
      this.body.add(leg, shoe);
    }
    // torso: a coat to mid-thigh, a little broader than deep
    this.torso.position.y = 0.95; // hip pivot
    const coatMesh = capsule(0.155, 0.48, coat);
    coatMesh.scale.set(1.1, 1, 0.74);
    coatMesh.position.y = 0.2; // spans about 0.74 to 1.54 m
    this.torso.add(coatMesh);
    // neck and head (no face)
    this.head.position.y = 1.5 - 0.95;
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.048, 0.1, 8), skin);
    neck.position.y = 0.04;
    const headMesh = new THREE.Mesh(new THREE.SphereGeometry(0.104, 14, 10), skin);
    headMesh.scale.set(0.92, 1.06, 1);
    headMesh.position.y = 0.1;
    // short hair over the crown and back of the head reads which way they face, still without a face
    const hairMesh = new THREE.Mesh(new THREE.SphereGeometry(0.109, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), hair);
    hairMesh.scale.set(0.93, 1.02, 1.02);
    hairMesh.position.set(0, 0.108, 0.006);
    hairMesh.rotation.x = 0.55; // tipped back: covers crown and back, leaves the front bare
    this.head.add(neck, headMesh, hairMesh);
    this.torso.add(this.head);
    // arms
    this.right = this.makeArm(1, coat, skin);
    this.left = this.makeArm(-1, coat, skin);
    this.body.add(this.torso);
    this.root.add(this.body);
    this.root.rotation.y = -facingDeg * RAD; // model faces -z (north); compass heading clockwise
    if (feet) this.place(feet);
    scene.add(this.root);
    this.pose(0);
  }

  private makeArm(side: 1 | -1, coat: THREE.Material, skin: THREE.Material): Arm {
    const shoulder = new THREE.Group();
    shoulder.position.set(0.205 * side, 1.43 - 0.95, 0);
    const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.22, 3, 8), coat);
    upper.position.y = -0.15;
    const elbow = new THREE.Group();
    elbow.position.y = -0.3;
    const fore = new THREE.Mesh(new THREE.CapsuleGeometry(0.044, 0.2, 3, 8), coat);
    fore.position.y = -0.14;
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.046, 10, 8), skin);
    hand.position.y = -0.31;
    elbow.add(fore, hand);
    shoulder.add(upper, elbow);
    this.torso.add(shoulder);
    return { shoulder, elbow, hand };
  }

  /** Move the feet to a scene position (for example after a floating-origin shift). */
  place(feet: V3): void {
    this.root.position.set(feet.x, feet.y, feet.z);
    this.root.updateMatrixWorld(true);
    this.hand.copy(this.handPosition(new THREE.Vector3()));
  }

  /** Something to watch after letting go (the balloon); null to look straight up-ish. */
  lookAt(target: V3 | null): void {
    this.look = target;
  }

  /** Start the launch timeline. */
  play(onRelease: () => void, opts: PlayOpts = {}): void {
    const token = ++this.token;
    this.state = 'holding';
    this.t = 0;
    this.releasedAt = Infinity;
    this.onRelease = onRelease;
    this.onTimeout = opts.onTimeout ?? null;
    this.failed = false;
    this.ready = !opts.readyAt;
    opts.readyAt?.then(
      () => { if (token === this.token) this.ready = true; },
      () => { if (token === this.token) this.failed = true; },
    );
  }

  /** Back to holding the balloon with an idle sway, with no timeline running (the start screen). */
  holdIdle(): void {
    this.token++;
    this.state = 'idle';
    this.t = 0;
    this.releasedAt = Infinity;
    this.onRelease = null;
    this.onTimeout = null;
  }

  get timedOut(): boolean {
    return this.state === 'timedOut';
  }

  /** How far the person is looking up, in radians (head plus lean back). */
  get headPitch(): number {
    return this.j.headPitch + this.j.lean;
  }

  update(dtSec: number): void {
    const dt = Number.isFinite(dtSec) ? Math.min(Math.max(dtSec, 0), 0.1) : 0;
    this.clock += dt;
    if (this.state === 'holding') {
      this.t += dt;
      if (this.t >= MAX_HOLD_S - 1e-9 || this.failed) {
        this.state = 'timedOut';
        const cb = this.onTimeout;
        this.onTimeout = this.onRelease = null;
        cb?.();
      } else if (this.t >= HOLD_S - 1e-9 && this.ready) {
        this.state = 'released';
        this.releasedAt = this.t;
        const cb = this.onRelease;
        this.onRelease = this.onTimeout = null;
        cb?.();
      }
    } else if (this.state === 'released') {
      this.t += dt;
    }
    this.pose(dt);
  }

  /** World position of the holding (right) hand. */
  handPosition(out: THREE.Vector3): THREE.Vector3 {
    this.root.updateMatrixWorld(true);
    return this.right.hand.getWorldPosition(out);
  }

  private pose(dt: number): void {
    const c = this.clock;
    // idle: a slow weight shift and breath, small enough to read as calm
    this.body.rotation.z = 0.013 * Math.sin((2 * Math.PI * c) / 4.6);
    this.body.rotation.x = 0.006 * Math.sin((2 * Math.PI * c) / 6.1 + 1);
    const breath = Math.sin((2 * Math.PI * c) / 3.9);
    this.torso.scale.set(1 + 0.004 * breath, 1 + 0.006 * breath, 1 + 0.008 * breath);

    // targets for this moment of the timeline
    let arm = HOLD;
    let look = 0;
    let open = 0;
    let lookPitch = DEFAULT_LOOK;
    let lookYaw = 0;
    if (this.state === 'released') {
      const s = this.t - this.releasedAt;
      open = clamp01(s / 0.15);
      look = easeInOut(s / LOOK_S);
      const up = easeInOut((s - RAISE_FROM_S) / RAISE_S);
      const down = easeInOut((s - LOWER_FROM_S) / LOWER_S);
      arm = mixPose(mixPose(HOLD, RAISE, up), REST, down);
      // the hand flicks open a touch as it lets go
      const flick = s < 0.4 ? Math.sin(Math.PI * clamp01(s / 0.4)) * 0.18 : 0;
      arm = { ...arm, elbow: arm.elbow + flick };
      if (this.look) {
        const headW = this.head.getWorldPosition(new THREE.Vector3());
        const d = new THREE.Vector3(this.look.x - headW.x, this.look.y - headW.y, this.look.z - headW.z);
        const local = d.applyQuaternion(this.root.quaternion.clone().invert()); // into the body frame (faces -z)
        const horiz = Math.hypot(local.x, local.z);
        lookPitch = Math.min(MAX_LOOK, Math.max(0, Math.atan2(local.y, horiz)));
        lookYaw = Math.max(-0.9, Math.min(0.9, Math.atan2(-local.x, -local.z)));
      }
    } else {
      // holding: the arm gives a little with the balloon's tug
      arm = { ...HOLD, elbow: HOLD.elbow + 0.04 * Math.sin(c * 0.9) + 0.015 * Math.sin(c * 2.1 + 1) };
    }

    const j = this.j;
    const k = dt > 0 ? 1 - Math.exp(-dt * 9) : 1; // follow the targets closely, never jump
    const total = look * lookPitch;
    j.headPitch += (total * 0.78 - j.headPitch) * k;
    j.lean += (total * 0.22 - j.lean) * k;
    j.headYaw += (look * lookYaw - j.headYaw) * k;
    j.rUpper += (arm.upper - j.rUpper) * k;
    j.rElbow += (arm.elbow - j.rElbow) * k;
    j.rOut += (arm.out - j.rOut) * k;
    j.open += (open - j.open) * k;

    this.head.rotation.set(j.headPitch, j.headYaw, 0, 'YXZ');
    this.torso.rotation.x = j.lean;
    this.right.shoulder.rotation.set(j.rUpper, 0, j.rOut);
    this.right.elbow.rotation.x = j.rElbow;
    this.right.hand.scale.set(1 + 0.15 * j.open, 1 - 0.12 * j.open, 1 + 0.15 * j.open);
    const ls = 0.02 * Math.sin((2 * Math.PI * c) / 4.6 + 0.6);
    this.left.shoulder.rotation.set(REST.upper + ls, 0, -REST.out);
    this.left.elbow.rotation.x = REST.elbow;

    this.root.updateMatrixWorld(true);
    this.right.hand.getWorldPosition(this.hand);
  }

  dispose(): void {
    this.scene.remove(this.root);
    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
    for (const m of this.materials) m.dispose();
  }
}
