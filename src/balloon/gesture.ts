/**
 * The release performance (spec 6.2 and 8; Task 26d), as poses over time: a pure function the Person
 * applies to its joints every frame. Pose to pose, each move eased slow in and slow out (sine), so
 * every joint starts and stops at rest and nothing snaps; character motion, not interface motion,
 * so it does not use the interface curve, and there is no overshoot.
 *
 *   idle         the start screen: the string held in a loosely closed hand at chest height, the
 *                head tilted up toward the balloon, a gentle breath and weight shift
 *   anticipate   0 to 1.2 s after the tap (and on, while the route is late): the arm lifts a little
 *                higher, up onto the toes, a breath in
 *   released     from the hand opening: thumb and fingers open over HAND_OPEN_S while the string's
 *                end slips out (releaseTAt); the open hand follows the balloon up over about a
 *                second while the head and body tilt up to watch; around 3 to 6 s a quiet reaction
 *                (the arm lowers slowly, the other hand comes to the chest, a breath out); then a
 *                calm rest, still watching
 *
 * Each phase starts exactly where the one before left off (the tap from idle at the same clock, the
 * hand opening from the held anticipation), so the Person never has to blend between them. Reduced
 * motion: the same hand opening, a third of the body motion and of the breathing.
 *
 * Joint conventions (Person): arms hang along -y; `pitch` raises the upper arm forward (+ forward and
 * up), `out` swings it out to the side, `roll` turns it inward about its own length (so a bent elbow
 * brings the hand toward the middle), `elbow` bends the forearm forward, `wrist` bends the hand
 * forward (negative: back, palm opening upward), `twist` turns the forearm (negative: palm up),
 * `fingers` and `thumb` curl from 0 (open, straight) to 1 (closed round the string). Body: `rise` up
 * onto the toes (m), `heel` the heels' lift (rad), `lean` the upper body back from the hips (rad,
 * looking up), `chest` the breath (-1 out .. 1 in), `look` how much of the way the head turns to the
 * balloon (0..1), `shift` the weight shift (a sway from the ankles, rad).
 */
export const HAND_OPEN_S = 0.25;
/** The string's end starts to slide once the fingers have loosened a little ... */
export const SLIP_FROM_S = 0.03;
/** ... and is out past the fingertips this long after (s). */
export const SLIP_S = 0.2;
/** The anticipation is complete this long after the tap (before the 1.2 s hand opening). */
export const ANTICIPATE_S = 1.05;

export type ArmPose = { pitch: number; out: number; roll: number; elbow: number; wrist: number; dev: number; twist: number; fingers: number; thumb: number };
export type BodyPose = { rise: number; heel: number; lean: number; chest: number; look: number; shift: number };
export type Pose = { body: BodyPose; r: ArmPose; l: ArmPose };
export type Phase = { kind: 'idle' } | { kind: 'anticipate'; s: number } | { kind: 'released'; s: number };

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
/** Slow in, slow out. */
export const ease = (x: number) => 0.5 - 0.5 * Math.cos(Math.PI * clamp01(x));

/** How far the string's end has slipped out of the opening hand, s seconds after it opened: 0 (in the fist) to 1 (free). */
export function releaseTAt(s: number): number {
  return clamp01((s - SLIP_FROM_S) / SLIP_S);
}

// ---- the key poses ----

// right arm: holding the string at chest height, in front and a little to the side
const R_HOLD = { pitch: 0.25, out: 0.42, roll: 0.05, elbow: 2.0, wrist: -0.1, dev: -0.45, twist: -0.45 };
const R_LIFT = { pitch: 0.48, out: 0.45, roll: 0.08, elbow: 2.0, wrist: -0.3, dev: -0.55, twist: -0.6 };
// the hand loosened, the moment it lets go
const R_OPEN = { pitch: 0.62, out: 0.46, roll: 0.08, elbow: 1.85, wrist: -0.4, dev: -0.3, twist: -0.75 };
// following the balloon up, open palm toward it
const R_REACH = { pitch: 1.95, out: 0.5, roll: 0.05, elbow: 0.42, wrist: -0.45, dev: 0, twist: -2.0 };
const R_REACH_EASE = { pitch: 1.8, out: 0.5, roll: 0.05, elbow: 0.55, wrist: -0.3, dev: 0, twist: -1.8 };
const R_REST = { pitch: 0.1, out: 0.11, roll: 0.0, elbow: 0.32, wrist: 0.08, dev: 0, twist: -0.35 };
// left arm: relaxed at the side; then the hand to the chest
const L_REST = { pitch: 0.05, out: 0.08, roll: 0.0, elbow: 0.2, wrist: 0.1, dev: 0, twist: 0.0 };
const L_CHEST = { pitch: 0.21, out: 0.25, roll: 0.95, elbow: 2.05, wrist: 0.51, dev: 0.31, twist: -0.68 };

const B_IDLE = { rise: 0, heel: 0, lean: 0.03, chest: 0, look: 0.6 };
const B_UP = { rise: 0.032, heel: 0.15, lean: 0.06, chest: 0.85, look: 0.9 };
const B_WATCH = { rise: 0.012, heel: 0.09, lean: 0.14, chest: 0.2, look: 1 };
const B_SIGH = { rise: 0, heel: 0, lean: 0.12, chest: -0.7, look: 1 };
const B_REST = { rise: 0, heel: 0, lean: 0.07, chest: 0, look: 0.85 };

type Rec = Record<string, number>;
type Key<T extends Rec> = readonly [number, T];

/** Eased pose to pose through the keys (holding before the first and after the last), into `out`. */
function track<T extends Rec>(keys: readonly Key<T>[], s: number, out: T): T {
  const o = out as Rec;
  let a: Rec = keys[0][1], b: Rec = a, f = 0;
  if (s > keys[0][0]) {
    a = b = keys[keys.length - 1][1];
    for (let i = 1; i < keys.length; i++) {
      if (s < keys[i][0]) {
        a = keys[i - 1][1];
        b = keys[i][1];
        f = ease((s - keys[i - 1][0]) / (keys[i][0] - keys[i - 1][0]));
        break;
      }
    }
  }
  for (const k in a) o[k] = a[k] + (b[k] - a[k]) * f;
  return out;
}

/** One eased value through [time, value] keys. */
function trackV(keys: readonly (readonly [number, number])[], s: number): number {
  if (s <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    if (s < keys[i][0]) return keys[i - 1][1] + (keys[i][1] - keys[i - 1][1]) * ease((s - keys[i - 1][0]) / (keys[i][0] - keys[i - 1][0]));
  }
  return keys[keys.length - 1][1];
}

// ---- the anticipation (s from the tap) ----

const R_ARM_BEFORE: Key<typeof R_HOLD>[] = [[0, R_HOLD], [ANTICIPATE_S, R_LIFT]];
const B_BEFORE: Key<typeof B_IDLE>[] = [[0, B_IDLE], [ANTICIPATE_S, B_UP]];
const AMP_BEFORE: [number, number][] = [[0, 1], [ANTICIPATE_S, 0.4]];

// ---- the released timeline (s from the hand opening) ----

const R_ARM_AFTER: Key<typeof R_HOLD>[] = [
  [0, R_LIFT],
  [0.24, R_OPEN],
  [1.3, R_REACH],
  [2.5, R_REACH_EASE],
  [4.7, R_REST],
];
const R_FINGERS: [number, number][] = [[0, 1], [HAND_OPEN_S, 0], [1.6, 0.04], [4.7, 0.38]];
const R_THUMB: [number, number][] = [[0, 1], [0.23, 0], [1.6, 0], [4.7, 0.3]];
const L_REST_F = { ...L_REST, fingers: 0.35 };
const L_ARM_AFTER: Key<typeof L_REST_F>[] = [
  [0, L_REST_F],
  [3.0, L_REST_F],
  [4.3, { ...L_CHEST, fingers: 0.12 }],
  [5.9, { ...L_CHEST, fingers: 0.12 }],
  [7.6, L_REST_F],
];
const B_AFTER: Key<typeof B_IDLE>[] = [
  [0, B_UP],
  [1.7, B_WATCH],
  [3.4, B_SIGH],
  [4.8, { ...B_WATCH, chest: 0.15, lean: 0.11, rise: 0, heel: 0 }],
  [8.5, B_REST],
];
/** How much the idle breath and sway play (they quieten while the breath is held). */
const AMP_AFTER: [number, number][] = [[0, 0.4], [1.6, 0.4], [3.4, 1]];
/** The held arm gives a little with the balloon's tug; none once the string is gone. */
const TUG_AFTER: [number, number][] = [[0, 1], [0.3, 0]];

const TAU = 2 * Math.PI;
/** Reduced motion: this share of the body's movement away from the idle pose, and of the breath and sway. */
const REDUCED = 0.35;

/** A pose to write into (poseAt's `out`), so a frame allocates nothing. */
export function newPose(): Pose {
  const arm = (): ArmPose => ({ pitch: 0, out: 0, roll: 0, elbow: 0, wrist: 0, dev: 0, twist: 0, fingers: 0, thumb: 0 });
  return { body: { rise: 0, heel: 0, lean: 0, chest: 0, look: 0, shift: 0 }, r: arm(), l: arm() };
}

// scratch for poseAt
const sR = { ...R_HOLD };
const sL = { ...L_REST_F };
const sB = { ...B_IDLE };

/** The pose at a moment of the performance, written into `out` (a new one if not given). */
export function poseAt(phase: Phase, clock: number, reduced = false, out: Pose = newPose()): Pose {
  let fingers = 1, thumb = 1, amp = 1, tug = 1;
  if (phase.kind === 'idle') {
    Object.assign(sR, R_HOLD);
    Object.assign(sB, B_IDLE);
    Object.assign(sL, L_REST_F);
  } else if (phase.kind === 'anticipate') {
    const s = phase.s;
    track(R_ARM_BEFORE, s, sR);
    // a touch down before the rise onto the toes
    track(B_BEFORE, s, sB);
    sB.rise += -0.008 * Math.sin(Math.PI * clamp01(s / 0.45));
    Object.assign(sL, L_REST_F);
    amp = trackV(AMP_BEFORE, s);
  } else {
    const s = phase.s;
    track(R_ARM_AFTER, s, sR);
    fingers = trackV(R_FINGERS, s);
    thumb = trackV(R_THUMB, s);
    track(L_ARM_AFTER, s, sL);
    track(B_AFTER, s, sB);
    amp = trackV(AMP_AFTER, s);
    tug = trackV(TUG_AFTER, s);
  }

  if (reduced) {
    const k = REDUCED;
    const toward = (base: Rec, v: Rec, skip?: string) => {
      for (const key in base) if (key !== skip) v[key] = base[key] + (v[key] - base[key]) * k;
    };
    toward(R_HOLD, sR);
    toward(L_REST_F, sL, 'fingers');
    toward(B_IDLE, sB, 'look');
    amp *= k;
  }

  // the idle life on top: a breath, a slow weight shift, the arm giving with the balloon's tug
  const c = clock;
  const breath = Math.sin((TAU * c) / 3.9);
  const r = out.r, l = out.l, b = out.body;
  Object.assign(r, sR);
  r.elbow = sR.elbow + amp * tug * (0.04 * Math.sin(c * 0.9) + 0.015 * Math.sin(c * 2.1 + 1));
  r.fingers = fingers;
  r.thumb = thumb;
  l.pitch = sL.pitch + amp * 0.02 * Math.sin((TAU * c) / 4.6 + 0.6);
  l.out = sL.out;
  l.roll = sL.roll;
  l.elbow = sL.elbow;
  l.wrist = sL.wrist;
  l.dev = sL.dev;
  l.twist = sL.twist;
  l.fingers = sL.fingers;
  l.thumb = sL.fingers * 0.8;
  b.rise = sB.rise;
  b.heel = sB.heel;
  b.lean = sB.lean + amp * 0.006 * Math.sin((TAU * c) / 6.1 + 1);
  b.chest = sB.chest + amp * 0.5 * breath;
  b.look = sB.look;
  b.shift = amp * 0.016 * Math.sin((TAU * c) / 4.6);
  return out;
}

/** a + (b - a) * f, joint by joint, into `out` (which may be a or b). */
export function mixPose(a: Pose, b: Pose, f: number, out: Pose = newPose()): Pose {
  for (const part of ['body', 'r', 'l'] as const) {
    const x = a[part] as Rec, y = b[part] as Rec, o = out[part] as Rec;
    for (const k in x) o[k] = x[k] + (y[k] - x[k]) * f;
  }
  return out;
}

/** Copy a pose into `out`. */
export function copyPose(a: Pose, out: Pose): Pose {
  return mixPose(a, a, 0, out);
}
