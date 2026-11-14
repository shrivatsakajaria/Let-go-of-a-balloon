/**
 * Where the landing card's camera stands (spec 6.5, design A, the owner's decision of 14 November
 * 2026): the app's world seen from high up, looking along the route, with the Earth's curve.
 *
 * The card world's frame: metres from the middle of the route (the shot's `origin`; x east, z south,
 * as WorldStream.toScene with that origin), y up, and the ground bent down onto the Earth's sphere
 * from there, so the horizon arcs. The middle, not the landing: the flat frame then reaches only half
 * as far, so even a very long trip's start lies inside the sphere it is bent onto.
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
export const CARD_FOV = 34;
/** The route's projection is kept inside this box (fractions of the picture, from its top left). */
export const ROUTE_BOX = { left: 0.14, right: 0.86, top: 0.27, bottom: 0.77 };
/**
 * At least this many times the trip's length away, so the land round it shows (whatever the route's
 * shape): 3 up to 1,000 km, falling to 1.3 at 6,000 km (a very long trip is its own context).
 */
export function contextK(lengthKm: number): number {
  const k = Math.max(0, Math.min(1, Math.log10(Math.max(1, lengthKm) / 1000) / Math.log10(6)));
  return 3 - 1.7 * k;
}
/** A very long trip held under the ceiling may take a wider lens, up to this, to keep both ends in shot. */
const MAX_FOV = 60;
/**
 * Not higher than this above the ground looked at (from there half the globe is in sight), unless a
 * very long trip's ends would leave the picture even through the widest lens: then up to twice it.
 */
export const MAX_ALT_M = 6_000_000;
/** Never nearer than this: a short trip still shows its city region. */
export const MIN_DIST_M = 110_000;
const MAX_DIST_M = 14_000_000;
/** Degrees from straight down: steep for a long trip (its far end stays readable), oblique for a short one. */
export const TILT_MIN = 40;
export const TILT_MAX = 56;
/** From this high up (camera above the ground it looks at) the horizon shows: it is put at HORIZON_Y. */
const HORIZON_FROM_M = 350_000;
export const HORIZON_Y = 0.065;
/** The camera turns no further from straight down than this to bring the horizon into the picture. */
const TILT_HORIZON_MAX = 56;
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
  /** The card world's origin, the middle of the route: every card-world metre is from here. */
  origin: LatLon;
  /** The landing in card-world metres (the reveal starts on it). */
  landingAt: { x: number; z: number };
  /** Whether the route is looked at across rather than along. */
  across: boolean;
  /** Height of the camera above the ground it looks at, m. */
  altM: number;
};

/** Card-world metres of p, the landing at the origin (WorldStream.toScene with the landing as origin). */
export function toCard(landing: LatLon, p: LatLon): { x: number; z: number } {
  return { x: lonDelta(landing.lon, p.lon) * M_PER_DEG * Math.cos(landing.lat * D2R), z: -(p.lat - landing.lat) * M_PER_DEG };
}

/**
 * How far the ground has dropped below the landing's horizon at (x, z), m: onto the true sphere
 * through the landing (centre R straight under it), so the bent ground and the horizon worked out
 * from that sphere agree however far out (d^2 / 2R near the landing). Past a quarter of the way round
 * it is clamped (that ground is behind the horizon from any camera the card uses).
 */
export const dropAt = (x: number, z: number): number => {
  const d2 = Math.min(x * x + z * z, EARTH_R_M * EARTH_R_M);
  return EARTH_R_M - Math.sqrt(EARTH_R_M * EARTH_R_M - d2);
};

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

/** Where the horizon crosses the middle of the picture, from its top (0: no sky in the picture). */
export function horizonFy(cam: THREE.PerspectiveCamera): number {
  if (groundHit(cam, 0.5, 0)) return 0;
  if (!groundHit(cam, 0.5, 1)) return 1;
  let a = 0, b = 1;
  for (let i = 0; i < 20; i++) {
    const m = (a + b) / 2;
    if (groundHit(cam, 0.5, m)) b = m;
    else a = m;
  }
  return (a + b) / 2;
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
export function cardShot(route: LatLon[], o: { aspect?: number; box?: typeof ROUTE_BOX; fovDeg?: number } = {}): CardShot {
  const aspect = o.aspect ?? CARD_ASPECT;
  const fovDeg = o.fovDeg ?? CARD_FOV;
  const box = o.box ?? ROUTE_BOX;
  const landing = route[route.length - 1];
  // the origin: the middle of the route's box, worked out round the landing
  const round = thin(route).map((p) => toCard(landing, p));
  const mid = {
    x: (Math.min(...round.map((q) => q.x)) + Math.max(...round.map((q) => q.x))) / 2,
    z: (Math.min(...round.map((q) => q.z)) + Math.max(...round.map((q) => q.z))) / 2,
  };
  const origin = fromCard(landing, mid.x, mid.z);
  const pts = thin(route).map((p) => toCard(origin, p));
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
  const pose: CardPose = { target: { x: (lo.x + hi.x) / 2, z: (lo.z + hi.z) / 2 }, headingDeg, tiltDeg, distM: MIN_DIST_M, fovDeg };
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
  /** Centre the route in the box: move the target across and along by the offsets, scaled to metres. */
  const centre = () => {
    const bb = bboxAt(pose);
    const cx = (bb.x0 + bb.x1) / 2 - (box.left + box.right) / 2;
    const cy = (bb.y0 + bb.y1) / 2 - (box.top + box.bottom) / 2;
    const span = 2 * pose.distM * Math.tan((pose.fovDeg / 2) * D2R); // metres across the picture's height at the target
    const along = (-cy * span) / Math.cos(pose.tiltDeg * D2R);
    const side = cx * span * aspect;
    pose.target = { x: pose.target.x + right.x * side + fwd.x * along, z: pose.target.z + right.z * side + fwd.z * along };
  };
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
    // and far enough off for the coast and countries round the route to show (a short trip: its region)
    pose.distM = Math.min(Math.max(b, contextK(lengthKm) * lengthKm * 1000), MAX_ALT_M / Math.cos(pose.tiltDeg * D2R));
    // seen from high up, the horizon arcs across the top of the picture, at HORIZON_Y: the camera turns
    // up or down to put it there (within the limits), and the distance is fitted again next round
    if (!across && pose.distM * Math.cos(pose.tiltDeg * D2R) > HORIZON_FROM_M) {
      let lo = TILT_MIN, hi = TILT_HORIZON_MAX;
      for (let i = 0; i < 24; i++) {
        const m = (lo + hi) / 2;
        if (horizonFy(poseCamera({ ...pose, tiltDeg: m }, aspect, cam)) < HORIZON_Y) lo = m;
        else hi = m;
      }
      pose.tiltDeg = Math.max(pose.tiltDeg, (lo + hi) / 2);
    }
    centre();
  }
  // the last move may have pushed it a little out: back off until it fits again (never past the ceiling)
  const ceiling = () => MAX_ALT_M / Math.cos(pose.tiltDeg * D2R);
  for (let i = 0; i < 30 && !fits(pose) && pose.distM * 1.03 <= ceiling(); i++) pose.distM *= 1.03;
  pose.distM = Math.min(pose.distM, ceiling());
  // held under the ceiling, a very long trip's ends can fall behind the horizon: look more nearly
  // straight down (the camera comes over the route's middle) until all of it is in sight
  for (let i = 0; i < 12 && bboxAt(pose).hidden && pose.tiltDeg > 6; i++) {
    pose.tiltDeg = Math.max(6, pose.tiltDeg - 5);
    pose.distM = Math.min(pose.distM, ceiling());
    centre();
    centre();
  }
  // and if the ends still do not fit in the picture, a wider lens (the start's ring and name stay in shot)
  for (let i = 0; i < 12 && !fits(pose) && pose.fovDeg < MAX_FOV; i++) {
    pose.fovDeg = Math.min(MAX_FOV, pose.fovDeg + 4);
    centre();
  }
  // past about 7,000 km even that is not enough: the ceiling lifts (to twice at the most) until it fits
  for (let i = 0; i < 40 && !fits(pose) && pose.distM * 1.05 * Math.cos(pose.tiltDeg * D2R) <= 2 * MAX_ALT_M; i++) {
    pose.distM *= 1.05;
    centre();
  }
  return { ...pose, landing: { lat: landing.lat, lon: landing.lon }, origin, landingAt: toCard(origin, landing), across, altM: pose.distM * Math.cos(pose.tiltDeg * D2R) };
}

// ---- the tiles the card world draws ----

/** The zoom levels the card world draws from (lod.ts levelFor knows each). */
export const CARD_ZOOMS = [5, 6, 7, 10, 12];
/** A tile is drawn about this many picture pixels across (its 64 ground cells a few pixels each). */
const TILE_PX = 300;
/**
 * At most this many tiles for the card's framing: a world draws at most 63 (materials.ts SLOT_COUNT), and
 * the reveal's way up needs some of the rest.
 */
export const CARD_MAX_TILES = 46;
const CIRC_M = 2 * Math.PI * 6378137;

/**
 * Where a ray from the camera through picture point (fx, fy) meets the bent ground (a sphere through
 * the landing), card-world metres, or null when it misses the Earth (the sky).
 */
export function groundHit(cam: THREE.PerspectiveCamera, fx: number, fy: number): { x: number; z: number; d: number } | null {
  v.set(fx * 2 - 1, 1 - fy * 2, 0.5).unproject(cam).sub(cam.position).normalize();
  // |C + t v - O|^2 = R^2, O = (0, -R, 0)
  const ox = cam.position.x, oy = cam.position.y + EARTH_R_M, oz = cam.position.z;
  const b = ox * v.x + oy * v.y + oz * v.z;
  const cc = ox * ox + oy * oy + oz * oz - EARTH_R_M * EARTH_R_M;
  const disc = b * b - cc;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  if (t <= 0) return null;
  return { x: cam.position.x + v.x * t, z: cam.position.z + v.z * t, d: t };
}

/** The card world's lat/lon of card-world metres (toCard's inverse). */
export function fromCard(landing: LatLon, x: number, z: number): LatLon {
  const lat = Math.max(-85, Math.min(85, landing.lat - z / M_PER_DEG));
  const lon = landing.lon + x / (M_PER_DEG * Math.cos(landing.lat * D2R));
  return { lat, lon: ((((lon + 180) % 360) + 360) % 360) - 180 };
}

function tileOf(p: LatLon, z: number): { z: number; x: number; y: number } {
  const n = 2 ** z;
  const lat = Math.max(-85.05, Math.min(85.05, p.lat)) * D2R;
  const x = Math.floor(((p.lon + 180) / 360) * n);
  const y = Math.floor(((1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2) * n);
  return { z, x: ((x % n) + n) % n, y: Math.max(0, Math.min(n - 1, y)) };
}

/**
 * The map tiles under the pictures seen from these poses (the card's, and the reveal's on its way up),
 * each at the zoom whose tile is drawn about TILE_PX across where it shows: whole-region z5 and z6 tiles
 * from far up, z10 and z12 round the balloon at the start of the reveal. The landing's and the start's
 * tiles first, then nearest the route; at most CARD_MAX_TILES.
 */
export function cardTiles(origin: LatLon, poses: CardPose[], route: LatLon[], o: { aspect?: number; heightPx?: number; max?: number; tilePx?: number; nearLanding?: boolean } = {}): { z: number; x: number; y: number }[] {
  const landing = route[route.length - 1];
  const L = toCard(origin, landing);
  const aspect = o.aspect ?? CARD_ASPECT, heightPx = o.heightPx ?? 1000;
  const rank = new Map<string, { t: { z: number; x: number; y: number }; r: number }>();
  const add = (t: { z: number; x: number; y: number }, r: number) => {
    const k = `${t.z}/${t.x}/${t.y}`;
    const had = rank.get(k);
    if (!had || r < had.r) rank.set(k, { t, r });
  };
  const cam = new THREE.PerspectiveCamera();
  const pts = thin(route, 40).map((p) => toCard(origin, p));
  // nearest the route first (the card), or nearest the balloon (the reveal, which starts on it)
  const near = (x: number, z: number) => (o.nearLanding ? Math.hypot(x - L.x, z - L.z) : Math.min(...pts.map((p) => Math.hypot(p.x - x, p.z - z))));
  poses.forEach((pose, pi) => {
    poseCamera(pose, aspect, cam);
    const pxRad = (pose.fovDeg * D2R) / heightPx;
    // rows closer together toward the top, where a pixel covers the most ground (out to the horizon)
    // a little past the edges too, so a tile that only just reaches into the picture is not missed
    const N = 22, M = 18;
    for (let i = 0; i <= N; i++)
      for (let j = 0; j <= M; j++) {
        const hit = groundHit(cam, -0.04 + (1.08 * j) / M, Math.min(1.04, (i / N) ** 1.7 * 1.04));
        if (!hit) continue;
        const ll = fromCard(origin, hit.x, hit.z);
        // metres per picture pixel there (looking down at a slant: a little more)
        const mpp = hit.d * pxRad * 1.4;
        const want = Math.log2((CIRC_M * Math.cos(ll.lat * D2R)) / (mpp * (o.tilePx ?? TILE_PX)));
        const z = CARD_ZOOMS.reduce((a, b) => (Math.abs(b - want) < Math.abs(a - want) ? b : a));
        add(tileOf(ll, z), 10 + (o.nearLanding ? 0 : pi) + near(hit.x, hit.z) / 1e6);
      }
  });
  // the two ends and the line between them, at the zoom their part of the picture asked for, else z6
  const zAt = (p: LatLon) => {
    for (const z of [...CARD_ZOOMS].reverse()) {
      const t = tileOf(p, z);
      if (rank.has(`${z}/${t.x}/${t.y}`)) return z;
    }
    return 6;
  };
  add(tileOf(landing, zAt(landing)), 0);
  add(tileOf(route[0], zAt(route[0])), 1);
  for (const p of thin(route, 40)) add(tileOf(p, zAt(p)), 2);
  // under the finer tiles, a coarse parent (z5 under z6 and z7, z7 under z10 and z12): wherever a fine
  // tile is late or missing, the land is still there, coarser (the coverage map hides it elsewhere)
  for (const { t } of [...rank.values()]) {
    if (t.z === 5) continue;
    const pz = t.z >= 10 ? 7 : 5;
    const k = 2 ** (t.z - pz);
    add({ z: pz, x: Math.floor(t.x / k), y: Math.floor(t.y / k) }, 5);
  }
  return [...rank.values()].sort((a, b) => a.r - b.r).slice(0, o.max ?? CARD_MAX_TILES).map((e) => e.t);
}

// ---- the reveal's move ----

/** Where the reveal starts: on the landed balloon, looking the way the card will, from REVEAL_START_M. */
export const REVEAL_START_M = 9000;
const START_TILT = 52;

export function revealStart(shot: CardShot): CardPose {
  return { target: { ...shot.landingAt }, headingDeg: shot.headingDeg, tiltDeg: START_TILT, distM: REVEAL_START_M, fovDeg: shot.fovDeg };
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
  // the share of the way out in plain distance (tiny while near, all of it at the end), squared for the
  // look point, so the balloon stays near the middle until the land round it is small
  const w = (distM - from.distM) / (to.distM - from.distM || 1);
  const wt = w * w;
  let dh = ((to.headingDeg - from.headingDeg + 540) % 360) - 180;
  if (dh === -180) dh = 180;
  return {
    target: { x: from.target.x + (to.target.x - from.target.x) * wt, z: from.target.z + (to.target.z - from.target.z) * wt },
    headingDeg: (from.headingDeg + dh * k + 360) % 360,
    tiltDeg: from.tiltDeg + (to.tiltDeg - from.tiltDeg) * Math.sqrt(w),
    distM,
    fovDeg: from.fovDeg + (to.fovDeg - from.fovDeg) * k,
  };
}
