/**
 * Where the landing card's camera stands (spec 6.5, design A, the owner's decision of 14 November
 * 2026): the app's world seen from high up, looking along the route, with the Earth's curve.
 *
 * The card world's frame: metres from the landing (x east, z south, as WorldStream.toScene with the
 * landing as its origin), y up, and the ground bent down by the Earth's curve, d^2 / 2R at a distance
 * d from the landing, so the horizon arcs.
 *
 * The framing comes from the route:
 *  - the camera looks along the trip, from the start toward the landing, so the start sits low in the
 *    picture and the landing higher, and the journey runs away toward the horizon;
 *  - a route that comes back on itself (its start and landing close, its middle far out) is looked at
 *    across, so its loop shows rather than folding up;
 *  - the camera is as far off as the whole route and its margins need, never nearer than MIN_DIST_M:
 *    about 1,600 km up for a 900 km trip, a low view of the city region for a 36 km one, higher for a
 *    very long one;
 *  - the angle from straight down is clamped (TILT_MIN..TILT_MAX), less the longer the trip, so the far
 *    part of the route is never foreshortened to nothing.
 *
 * The reveal (cardreveal.ts) starts on the landed balloon with the same heading and pulls back to this
 * framing (poseAt). Pure: three.js maths only.
 */
import * as THREE from 'three';
import { EARTH_RADIUS_KM } from '../config';
import { lonDelta, type LatLon } from '../geo/coords';
import { M_PER_DEG } from '../world/frame';

export const EARTH_R_M = EARTH_RADIUS_KM * 1000;
/** The card's picture: 1080 x 1000 above the panel. */
export const CARD_ASPECT = 1080 / 1000;
export const CARD_FOV = 30;
/** The route's projection is kept inside this box (fractions of the picture, from its top left). */
export const ROUTE_BOX = { left: 0.14, right: 0.86, top: 0.27, bottom: 0.77 };
/** Never nearer than this: a short trip still shows its city region. */
export const MIN_DIST_M = 110_000;
const MAX_DIST_M = 14_000_000;
/** Degrees from straight down: steep for a long trip (its far end stays readable), oblique for a short one. */
export const TILT_MIN = 40;
export const TILT_MAX = 56;
/** Looking across a route that comes back on itself: closer to straight down. */
const TILT_ACROSS = 34;
/** A route whose start-to-landing line is shorter than this share of its spread is looked at across. */
const ACROSS_BELOW = 0.45;
const D2R = Math.PI / 180;

/** A camera pose: it looks at `target` on the (bent) ground from `distM` away. */
export type CardPose = {
  /** Ground point looked at, card-world metres. */
  target: { x: number; z: number };
  /** Compass direction the camera looks, degrees. */
  headingDeg: number;
  /** Degrees from straight down. */
  tiltDeg: number;
  distM: number;
  fovDeg: number;
};

export type CardShot = CardPose & {
  landing: LatLon;
  /** Whether the route is looked at across rather than along. */
  across: boolean;
  /** Height of the camera above the ground it looks at, m. */
  altM: number;
};

/** Card-world metres of p, the landing at the origin (WorldStream.toScene with the landing as origin). */
export function toCard(landing: LatLon, p: LatLon): { x: number; z: number } {
  return { x: lonDelta(landing.lon, p.lon) * M_PER_DEG * Math.cos(landing.lat * D2R), z: -(p.lat - landing.lat) * M_PER_DEG };
}

/** How far the ground has dropped below the landing's horizon at (x, z), m. */
export const dropAt = (x: number, z: number): number => (x * x + z * z) / (2 * EARTH_R_M);

/** The camera for a pose, aspect `aspect` (near and far planes to suit its distance). */
export function poseCamera(p: CardPose, aspect = CARD_ASPECT, out = new THREE.PerspectiveCamera()): THREE.PerspectiveCamera {
  const h = p.headingDeg * D2R, t = p.tiltDeg * D2R;
  const fx = Math.sin(h), fz = -Math.cos(h);
  const ty = -dropAt(p.target.x, p.target.z);
  out.fov = p.fovDeg;
  out.aspect = aspect;
  out.near = Math.max(1, p.distM * 0.02);
  out.far = p.distM * 4 + 2 * Math.sqrt(2 * EARTH_R_M * (p.distM + 1));
  out.up.set(0, 1, 0);
  out.position.set(p.target.x - fx * p.distM * Math.sin(t), ty + p.distM * Math.cos(t), p.target.z - fz * p.distM * Math.sin(t));
  out.lookAt(p.target.x, ty, p.target.z);
  out.updateProjectionMatrix();
  out.updateMatrixWorld();
  return out;
}

const v = new THREE.Vector3();
const c = new THREE.Vector3();

/**
 * Where a ground point at height y (above sea level) shows: picture fractions (0..1 from the top left),
 * and whether it is in sight (in front of the camera and on the near side of the Earth's horizon).
 */
export function projectTo(cam: THREE.PerspectiveCamera, x: number, z: number, y = 0): { fx: number; fy: number; seen: boolean } {
  const drop = dropAt(x, z);
  v.set(x, y - drop, z);
  // the horizon: the point faces the camera (the Earth's centre straight under the landing)
  c.set(0, -EARTH_R_M, 0);
  const nx = v.x - c.x, ny = v.y - c.y, nz = v.z - c.z;
  const facing = nx * (cam.position.x - v.x) + ny * (cam.position.y - v.y) + nz * (cam.position.z - v.z) > 0;
  v.project(cam);
  return { fx: (v.x + 1) / 2, fy: (1 - v.y) / 2, seen: facing && v.z < 1 && v.z > -1 };
}

type Local = { x: number; z: number };

/** The route's spread: its start-to-landing vector, and its main axis (unit) and extent along it, m. */
function spread(pts: Local[]): { sx: number; sz: number; axis: Local; extent: number } {
  const s = pts[0], l = pts[pts.length - 1];
  let mx = 0, mz = 0;
  for (const p of pts) {
    mx += p.x;
    mz += p.z;
  }
  mx /= pts.length;
  mz /= pts.length;
  let xx = 0, xz = 0, zz = 0;
  for (const p of pts) {
    xx += (p.x - mx) ** 2;
    xz += (p.x - mx) * (p.z - mz);
    zz += (p.z - mz) ** 2;
  }
  const ang = 0.5 * Math.atan2(2 * xz, xx - zz);
  const axis = { x: Math.cos(ang), z: Math.sin(ang) };
  let lo = Infinity, hi = -Infinity;
  for (const p of pts) {
    const d = p.x * axis.x + p.z * axis.z;
    lo = Math.min(lo, d);
    hi = Math.max(hi, d);
  }
  return { sx: l.x - s.x, sz: l.z - s.z, axis, extent: hi - lo };
}

const headingOf = (x: number, z: number) => ((Math.atan2(x, -z) / D2R) % 360 + 360) % 360;

/** The angle from straight down for a trip this long: TILT_MAX for a short one, TILT_MIN past 4,000 km. */
export function tiltFor(lengthKm: number): number {
  const k = Math.max(0, Math.min(1, (Math.log10(Math.max(1, lengthKm)) - Math.log10(40)) / (Math.log10(4000) - Math.log10(40))));
  return TILT_MAX - (TILT_MAX - TILT_MIN) * k * k;
}

/** The route's points thinned to at most n (always keeping both ends). */
function thin(pts: LatLon[], n = 160): LatLon[] {
  if (pts.length <= n) return pts;
  const out: LatLon[] = [];
  for (let i = 0; i < n; i++) out.push(pts[Math.round((i * (pts.length - 1)) / (n - 1))]);
  return out;
}

/**
 * The card's framing for a route (its points in order, start first). `aspect` and `box` default to the
 * card's picture; the 2D fallback has its own map and does not use this.
 */
export function cardShot(route: LatLon[], o: { aspect?: number; box?: typeof ROUTE_BOX } = {}): CardShot {
  const aspect = o.aspect ?? CARD_ASPECT;
  const box = o.box ?? ROUTE_BOX;
  const landing = route[route.length - 1];
  const pts = thin(route).map((p) => toCard(landing, p));
  const { sx, sz, axis, extent } = spread(pts);
  const direct = Math.hypot(sx, sz);
  const lengthKm = Math.max(direct, extent) / 1000;
  // along the trip, or across a route that comes back on itself (the landing kept the further side)
  const across = direct < ACROSS_BELOW * extent && extent > 1000;
  let headingDeg: number;
  if (!across) headingDeg = direct > 1 ? headingOf(sx, sz) : 0;
  else {
    const px = -axis.z, pz = axis.x; // perpendicular to the main axis
    const sign = sx * px + sz * pz >= 0 ? 1 : -1;
    headingDeg = headingOf(px * sign, pz * sign);
  }
  const tiltDeg = across ? TILT_ACROSS : tiltFor(lengthKm);

  // the target: the middle of the route's box, refined so its projection centres in the box
  let lo = { x: Infinity, z: Infinity }, hi = { x: -Infinity, z: -Infinity };
  for (const p of pts) {
    lo = { x: Math.min(lo.x, p.x), z: Math.min(lo.z, p.z) };
    hi = { x: Math.max(hi.x, p.x), z: Math.max(hi.z, p.z) };
  }
  const pose: CardPose = { target: { x: (lo.x + hi.x) / 2, z: (lo.z + hi.z) / 2 }, headingDeg, tiltDeg, distM: MIN_DIST_M, fovDeg: CARD_FOV };
  const cam = new THREE.PerspectiveCamera();
  const bboxAt = (p: CardPose) => {
    poseCamera(p, aspect, cam);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, hidden = false;
    for (const q of pts) {
      const s = projectTo(cam, q.x, q.z);
      if (!s.seen) hidden = true;
      x0 = Math.min(x0, s.fx);
      x1 = Math.max(x1, s.fx);
      y0 = Math.min(y0, s.fy);
      y1 = Math.max(y1, s.fy);
    }
    return { x0, x1, y0, y1, hidden };
  };
  const fits = (p: CardPose) => {
    const b = bboxAt(p);
    return !b.hidden && b.x1 - b.x0 <= box.right - box.left && b.y1 - b.y0 <= box.bottom - box.top;
  };
  const right = { x: Math.cos(headingDeg * D2R), z: Math.sin(headingDeg * D2R) };
  const fwd = { x: Math.sin(headingDeg * D2R), z: -Math.cos(headingDeg * D2R) };
  for (let round = 0; round < 5; round++) {
    // the nearest distance at which the route fits (it shrinks on screen as the camera backs off)
    let a = MIN_DIST_M, b = MAX_DIST_M;
    if (fits({ ...pose, distM: a })) b = a;
    else
      for (let i = 0; i < 40; i++) {
        const m = Math.sqrt(a * b);
        if (fits({ ...pose, distM: m })) b = m;
        else a = m;
      }
    pose.distM = b;
    // centre the route in the box: move the target across and along by the offsets, scaled to metres
    const bb = bboxAt(pose);
    const cx = (bb.x0 + bb.x1) / 2 - (box.left + box.right) / 2;
    const cy = (bb.y0 + bb.y1) / 2 - (box.top + box.bottom) / 2;
    const span = 2 * pose.distM * Math.tan((CARD_FOV / 2) * D2R); // metres across the picture's height at the target
    const along = (-cy * span) / Math.cos(tiltDeg * D2R);
    const side = cx * span * aspect;
    pose.target = { x: pose.target.x + right.x * side + fwd.x * along, z: pose.target.z + right.z * side + fwd.z * along };
  }
  // the last move may have pushed it a little out: back off until it fits again
  for (let i = 0; i < 30 && !fits(pose); i++) pose.distM *= 1.03;
  return { ...pose, landing: { lat: landing.lat, lon: landing.lon }, across, altM: pose.distM * Math.cos(tiltDeg * D2R) };
}

// ---- the reveal's move ----

/** Where the reveal starts: on the landed balloon, looking the way the card will, from REVEAL_START_M. */
export const REVEAL_START_M = 4200;
const START_TILT = 62;

export function revealStart(shot: CardShot): CardPose {
  return { target: { x: 0, z: 0 }, headingDeg: shot.headingDeg, tiltDeg: START_TILT, distM: REVEAL_START_M, fovDeg: shot.fovDeg };
}

/**
 * The pose a share k (0..1, already eased) of the way from `from` to `to`: the distance grows
 * geometrically (a steady feel of rising), the look point leaves the balloon only as the distance
 * opens up (the balloon stays in sight while it is near), the tilt follows the distance. Exactly `from`
 * at 0 and `to` at 1.
 */
export function poseAt(from: CardPose, to: CardPose, k: number): CardPose {
  if (k <= 0) return { ...from, target: { ...from.target } };
  if (k >= 1) return { ...to, target: { ...to.target } };
  const distM = from.distM * (to.distM / from.distM) ** k;
  // the share of the way out in plain distance: tiny while near, all of it at the end
  const w = (distM - from.distM) / (to.distM - from.distM || 1);
  let dh = ((to.headingDeg - from.headingDeg + 540) % 360) - 180;
  if (dh === -180) dh = 180;
  return {
    target: { x: from.target.x + (to.target.x - from.target.x) * w, z: from.target.z + (to.target.z - from.target.z) * w },
    headingDeg: (from.headingDeg + dh * k + 360) % 360,
    tiltDeg: from.tiltDeg + (to.tiltDeg - from.tiltDeg) * Math.sqrt(w),
    distM,
    fovDeg: from.fovDeg + (to.fovDeg - from.fovDeg) * k,
  };
}
