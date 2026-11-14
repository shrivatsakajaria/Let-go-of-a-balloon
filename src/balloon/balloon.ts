import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { BALLOON_HEX, CLIMB_RATE_MS } from '../config';
import type { RoutePoint } from '../flight/route';
import { parseHex, type Light } from '../world/palette';
import { Rope, ROPE_SEGMENTS, ROPE_SEG_M, type RopeStepOpts } from './rope';

/**
 * The balloon (spec 6.2 and 7): a real 30 cm party balloon in glossy #ff5a12, the one bright thing.
 *
 * API (positions are the caller's; the world owns the floating origin):
 *   const b = new Balloon(scene);
 *   b.hold(hand, grip?)             // while the person holds it; `hand` is read live every frame
 *   b.release()                     // the hand opens: the balloon is free and squashes; the string's
 *                                   // end slips out of the fingers (grip.releaseT, person.ts StringGrip)
 *   b.setState(point, dt, light, { pos, camera })   // every frame
 *
 * `pos` is where the route puts the balloon's centre in scene metres (x east, y up, z = -north);
 * `point` (the route point for this moment) drives the dynamics: lean from speed and heading, and
 * the shadow, which drops straight down by altM - groundM from `pos`. `camera` is the camera's
 * scene position: the balloon, its string and its shadow are drawn displayScale(distance) times
 * real size so it never vanishes in wide shots.
 *
 * While held, the balloon floats on its string above the hand and `pos` only places the shadow's
 * ground. On release it rises from where it was and eases onto `pos` (a critically damped blend
 * that starts at rest and never dips), so the caller can pass the route position the whole time.
 * Read `mesh.position` for where the balloon is drawn (for example, to aim the camera).
 */
export const BALLOON_RADIUS_M = 0.15;
export const MAX_DISPLAY_SCALE = 40;
/** Real size up to this camera distance (m). */
export const REAL_SIZE_WITHIN_M = 20;
/** Full enlargement from this camera distance (m). */
export const FULL_SCALE_AT_M = 2000;
/** Release squash (spec 8: "the balloon squashes for 120 ms"). */
export const RELEASE_SQUASH_S = 0.12;

/** String anchor below the centre, in balloon radii (the bottom of the knot, under the neck's rolled lip). */
export const KNOT_DROP = 1.44;
const LN_SPAN = Math.log(FULL_SCALE_AT_M / REAL_SIZE_WITHIN_M);
const LN_MAX = Math.log(MAX_DISPLAY_SCALE);
const RAD = Math.PI / 180;
/** The knot's velocity is smoothed over this long (s) for the air going past it. */
const KNOT_V_TAU_S = 0.2;
/** The air the string feels is eased over this long (s): gusts sway it, never flick it. */
const AIR_TAU_S = 0.6;
/** The crosswind past the knot is capped here (m/s); and the climb's air from below at AIR_MAX_UP_MS. */
const AIR_MAX_MS = 0.8;
const AIR_MAX_UP_MS = 4;
/** A slow, small sway in the air (m/s; periods of 7 to 22 s). */
const AIR_SWAY_MS = 0.25;
/** Ribbon vertices per rope segment (a smooth curve through the rope points, no visible corners). */
const RIBBON_SUB = 3;
const RIBBON_DAY = new THREE.Color('#f2ebe2');
/** The string's half-width is at least this many radians of view (its full width about 1.2 mrad, a pixel on a phone). */
const MIN_RIBBON_RAD = 0.0006;
const RIBBON_NIGHT = new THREE.Color('#6d7590');

/**
 * How many times real size to draw the balloon at a camera distance. 1 up to 20 m (real size at
 * street level), 40 from 2 km, and in between a smoothstep in log distance applied to log scale,
 * so it is smooth (C1) and monotonic. Its apparent size stays almost constant from about 200 m to
 * 1 km instead of shrinking to a dot. Camera director: balloonRadius(d) = 0.15 * displayScale(d).
 */
export function displayScale(distM: number): number {
  if (!(distM > REAL_SIZE_WITHIN_M)) return 1; // also NaN and negative
  if (distM >= FULL_SCALE_AT_M) return MAX_DISPLAY_SCALE;
  const u = Math.log(distM / REAL_SIZE_WITHIN_M) / LN_SPAN;
  const f = u * u * (3 - 2 * u);
  return Math.exp(LN_MAX * f);
}

/** Volume-preserving squash and stretch: y = 1 + s, x = z = 1 / sqrt(1 + s). */
export function squashScale(s: number): { y: number; xz: number } {
  const y = 1 + Math.max(-0.5, Math.min(0.5, s));
  return { y, xz: 1 / Math.sqrt(y) };
}

type V3 = { x: number; y: number; z: number };
export type BalloonOpts = { reducedMotion?: boolean };
/**
 * pos and camera: see the class comment. elapsedS: the time that really went by since the last frame
 * (s), when the frame's dt is capped (the scene counts at most 0.25 s, while the route follows the
 * clock); the string and the release ease follow it, so a stalled frame does not fling the string.
 */
export type BalloonAt = { pos: V3; camera?: V3; elapsedS?: number };

/** Exact critically damped spring step toward 0 (offset x, velocity v, angular frequency w). */
function damp(x: number, v: number, w: number, dt: number): [number, number] {
  const e = Math.exp(-w * dt);
  const t = v + w * x;
  return [(x + t * dt) * e, (v - w * t * dt) * e];
}

export class Balloon {
  /** Everything the balloon adds to the scene: the balloon, its string and its shadow. */
  readonly root = new THREE.Group();
  /** The balloon itself, at its drawn centre; rotation carries the lean, wobble and spin. */
  readonly mesh = new THREE.Group();
  /** Skin and knot, scaled by display scale and squash. */
  readonly body = new THREE.Group();
  readonly material: THREE.MeshPhysicalMaterial;
  /** The neck, lip and knot: the same latex, a shade deeper and satin. */
  private readonly neckMat: THREE.MeshPhysicalMaterial;
  readonly rope = new Rope(ROPE_SEGMENTS, ROPE_SEG_M);
  readonly shadow: THREE.Mesh;
  /** The display scale used for the last frame. */
  scale = 1;

  private readonly reduced: boolean;
  private readonly scene: THREE.Object3D;
  private readonly ribbon: THREE.Mesh;
  private readonly ribbonGeo: THREE.BufferGeometry;
  private readonly ribbonMat: THREE.MeshBasicMaterial;
  private readonly shadowMat: THREE.MeshBasicMaterial;
  private envTex: THREE.DataTexture;
  private envKey: number[] = [];
  private readonly rimUniform = { value: 0 };
  private hand: V3 | null = null;
  private grip: { readonly releaseT: number } | null = null;
  /** After the release, while the string's end is still slipping out of the fingers: the hand it follows. */
  private slip: V3 | null = null;
  private started = false;
  private clock = 0;
  private sinceRelease = Infinity;
  private offset = new THREE.Vector3();
  private offsetV = new THREE.Vector3();
  private prevCur = new THREE.Vector3();
  private velS = new THREE.Vector3();
  private accY = 0;
  private squash = 0;
  private squashV = 0;
  private tilt = new THREE.Vector2(); // x: east component, y: -north (scene z) component, radians
  private tiltV = new THREE.Vector2();
  private spin = 0;
  private lastPos = new THREE.Vector3();
  /** Set at the release: the next frame starts the balloon at rest where it was drawn. */
  private restAt = false;
  /** The knot as drawn, and where the string's simulation (real size) hangs from it. */
  private knotDrawn = new THREE.Vector3();
  private knotReal = new THREE.Vector3();
  private knotPrev = new THREE.Vector3();
  /** The knot's velocity, smoothed, and the air going past it (filtered), m/s. */
  private knotV = new THREE.Vector3();
  private airRel = new THREE.Vector3();
  // scratch, so the string's part of a frame allocates nothing
  private tmpV = new THREE.Vector3();
  private drop = new THREE.Vector3();
  private airWant = new THREE.Vector3();
  private endReal = new THREE.Vector3();
  private ropeOpts: RopeStepOpts = {};
  private ribbonPts = Array.from({ length: ROPE_SEGMENTS + 1 }, () => new THREE.Vector3());

  constructor(scene: THREE.Object3D, opts: BalloonOpts = {}) {
    this.scene = scene;
    this.reduced = !!opts.reducedMotion;

    // Party-balloon teardrop: the prototype's shape (1.04 wide at the crown, 1.16 tall), with a smooth
    // profile so no crease shows at the equator, drawn in at the bottom into the neck, and the UV seam
    // welded so the normals are continuous all round (smooth shading: the balloon reads round and
    // glossy in the flat-shaded world).
    const sphere = new THREE.SphereGeometry(1, 48, 32);
    sphere.deleteAttribute('uv');
    sphere.deleteAttribute('normal');
    const g = mergeVertices(sphere, 1e-5);
    sphere.dispose();
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      // the lower fifth tucks in toward the neck, smoothly (no crease where it starts)
      const tuck = y < -0.74 ? ((-0.74 - y) / 0.26) ** 2 : 0;
      const k = (1 + 0.18 * y - 0.14 * y * y) * (1 - 0.55 * tuck);
      p.setXYZ(i, x * k, y * 1.16 - 0.02 * tuck, z * k);
    }
    g.computeVertexNormals();
    this.envTex = makeSkyEnv(null);
    this.material = new THREE.MeshPhysicalMaterial({
      color: BALLOON_HEX,
      roughness: 0.3,
      metalness: 0,
      clearcoat: 1,
      clearcoatRoughness: 0.16,
      sheen: 0.35,
      sheenColor: new THREE.Color('#ffb48a'),
      sheenRoughness: 0.5,
      envMap: this.envTex,
      envMapIntensity: 1,
      emissive: new THREE.Color(BALLOON_HEX),
      emissiveIntensity: 0.06,
    });
    // a faint warm rim at night (city light catching the edge), added to the emissive term
    const rim = this.rimUniform;
    this.material.onBeforeCompile = (sh) => {
      sh.uniforms.uRim = rim;
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uRim;')
        .replace(
          '#include <emissivemap_fragment>',
          '#include <emissivemap_fragment>\n\ttotalEmissiveRadiance += vec3(1.0, 0.62, 0.42) * uRim * pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), 2.5);',
        );
    };
    this.material.customProgramCacheKey = () => 'balloon-rim';
    const skin = new THREE.Mesh(g, this.material);
    // the neck, its rolled lip and the knot, in the same latex a shade deeper and satin
    this.neckMat = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(BALLOON_HEX).multiplyScalar(0.6),
      roughness: 0.5,
      metalness: 0,
      clearcoat: 0.3,
      clearcoatRoughness: 0.4,
      sheen: 0.22,
      sheenColor: new THREE.Color('#ffb48a'),
      sheenRoughness: 0.45,
      envMap: this.envTex,
      envMapIntensity: 0.6,
      emissive: new THREE.Color(BALLOON_HEX),
      emissiveIntensity: 0.03,
    });
    const neck = new THREE.Mesh(makeNeck(), this.neckMat);
    this.body.add(skin, neck);
    this.mesh.add(this.body);

    // the string: a thin camera-facing ribbon along the rope points
    const n = ROPE_SEGMENTS * RIBBON_SUB + 1;
    this.ribbonGeo = new THREE.BufferGeometry();
    this.ribbonGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 2 * 3), 3));
    const idx: number[] = [];
    for (let i = 0; i < n - 1; i++) idx.push(2 * i, 2 * i + 1, 2 * i + 2, 2 * i + 1, 2 * i + 3, 2 * i + 2);
    this.ribbonGeo.setIndex(idx);
    this.ribbonMat = new THREE.MeshBasicMaterial({ color: RIBBON_DAY, side: THREE.DoubleSide });
    this.ribbon = new THREE.Mesh(this.ribbonGeo, this.ribbonMat);
    this.ribbon.frustumCulled = false;

    // the shadow: a soft stylised decal straight below (spec 15), no live shadow casting
    this.shadowMat = new THREE.MeshBasicMaterial({
      color: '#262b3a',
      map: makeRadialTexture(),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.shadowMat);
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.renderOrder = 1;

    this.root.add(this.shadow, this.ribbon, this.mesh);
    scene.add(this.root);
  }

  displayScale(cameraDistM: number): number {
    return displayScale(cameraDistM);
  }

  get held(): boolean {
    return this.hand !== null;
  }

  /** Opacity of the shadow decal this frame (0 at night). */
  get shadowOpacity(): number {
    return this.shadowMat.opacity;
  }

  /**
   * Point i of the string as drawn (0 at the knot), in scene metres: the simulated (real-size)
   * string magnified about the knot by the display scale.
   */
  stringPoint(i: number, out: THREE.Vector3): THREE.Vector3 {
    if (i <= 0) return out.copy(this.knotDrawn);
    const x0 = this.rope.point(0, this.tmpV);
    return this.rope.point(i, out).sub(x0).multiplyScalar(this.scale).add(this.knotDrawn);
  }

  /**
   * Pin the string's end to the hand; the vector is read every frame, so pass the live hand position.
   * With a grip (person.ts StringGrip: the person), the end stays with `hand` after release() until
   * grip.releaseT reaches 1, sliding out of the opening fingers instead of jumping free.
   */
  hold(hand: V3, grip?: { readonly releaseT: number }): void {
    this.hand = hand;
    this.grip = grip ?? null;
    this.slip = null;
    this.sinceRelease = Infinity;
  }

  /** The hand opens: the string comes free, the balloon squashes for 120 ms and starts to rise. */
  release(): void {
    if (!this.hand) return;
    this.slip = this.grip && this.grip.releaseT < 1 ? this.hand : null;
    this.hand = null;
    this.sinceRelease = 0;
    this.offsetV.set(0, -CLIMB_RATE_MS, 0); // start at rest while the route already climbs
    // (and drifts: setState's next frame sets the whole start from the route's own speed and heading,
    // which this call does not have; see restAt there)
    this.restAt = true;
    this.squashV -= 1.2; // a small kick into the squash
  }

  setState(p: RoutePoint, dtSec: number, light: Light, at: BalloonAt): void {
    const frameDt = Number.isFinite(dtSec) ? Math.max(dtSec, 0) : 0;
    // the time that really went by (the route moved by it), at least the frame's own
    const rawDt = at.elapsedS !== undefined && Number.isFinite(at.elapsedS) ? Math.max(frameDt, at.elapsedS) : frameDt;
    const dt = Math.min(frameDt, 0.1);
    const pos = at.pos;
    if (!Number.isFinite(pos.x + pos.y + pos.z)) return;
    this.clock += dt;
    const w = this.reduced ? 0.5 : 1;
    const t = this.clock;

    // a big jump in the given position (origin shift, seek) is carried, not animated
    const jumped = this.started && Math.hypot(pos.x - this.lastPos.x, pos.y - this.lastPos.y, pos.z - this.lastPos.z) > 100;
    this.lastPos.set(pos.x, pos.y, pos.z);

    const cam = at.camera ?? { x: pos.x, y: pos.y, z: pos.z + 5 };
    const hd = (Number.isFinite(p.headingDeg) ? p.headingDeg : 0) * RAD;
    const sp = Number.isFinite(p.speedMs) ? Math.max(0, p.speedMs) : 0;
    const cur = this.mesh.position;
    const ropeLen = () => ROPE_SEGMENTS * ROPE_SEG_M * this.scale;

    if (this.hand) {
      // floating on the string: a buoyant pendulum above the hand with a slow, small sway
      const h = this.hand;
      const sx = (0.07 * Math.sin(t * 0.9) + 0.025 * Math.sin(t * 2.1 + 1)) * w;
      const sz = (0.05 * Math.sin(t * 0.7 + 2) + 0.02 * Math.sin(t * 1.9)) * w;
      const dir = new THREE.Vector3(sx, 1, sz).normalize();
      this.scale = displayScale(Math.hypot(h.x - cam.x, h.y - cam.y, h.z - cam.z));
      const reach = ropeLen() * 0.96 + KNOT_DROP * BALLOON_RADIUS_M * this.scale;
      cur.set(h.x, h.y, h.z).addScaledVector(dir, reach);
      this.offset.set(cur.x - pos.x, cur.y - pos.y, cur.z - pos.z);
      this.offsetV.set(0, 0, 0);
      this.tilt.set(sx, sz); // the balloon lines up with its string
      this.tiltV.set(0, 0);
    } else {
      this.sinceRelease += dt;
      const de = Math.min(rawDt, 10);
      if (this.restAt && this.started) {
        // the hand has just opened (as this frame began): the balloon starts at rest where it was drawn,
        // and eases onto the route, which already drifts with the wind and climbs. (release() is called
        // between frames, with no route point to hand: it sets restAt, and the first frame without the
        // hand does this, from that frame's speed and heading. Before any frame, started is false, and
        // release() leaves the climb's offsetV alone to ease from.)
        this.restAt = false;
        const vx = Math.sin(hd) * sp, vz = -Math.cos(hd) * sp;
        this.offset.set(cur.x - pos.x + vx * de, cur.y - pos.y + CLIMB_RATE_MS * de, cur.z - pos.z + vz * de);
        this.offsetV.set(-vx, -CLIMB_RATE_MS, -vz);
      }
      // ease the release offset away: critically damped, about 0.7 s (an exact step, so in real time
      // even at a few frames a second)
      for (const k of ['x', 'y', 'z'] as const) {
        [this.offset[k], this.offsetV[k]] = damp(this.offset[k], this.offsetV[k], 3, de);
      }
      cur.set(pos.x + this.offset.x, pos.y + this.offset.y, pos.z + this.offset.z);
      this.scale = displayScale(Math.hypot(cur.x - cam.x, cur.y - cam.y, cur.z - cam.z));

      // lean into the wind: toward the heading, in proportion to speed, capped; plus a gentle wobble
      const lean = Math.min(0.2, 0.014 * sp);
      const wob = 0.045 * w;
      const tx = Math.sin(hd) * lean + wob * (Math.sin(t * 0.83) + 0.4 * Math.sin(t * 1.97 + 0.5));
      const tz = -Math.cos(hd) * lean + wob * (Math.sin(t * 0.61 + 1.3) + 0.4 * Math.sin(t * 1.53));
      // a soft spring so the lean settles like a body on a string, with a little give
      const wn = 2.4, zeta = 0.55;
      this.tiltV.x += (wn * wn * (tx - this.tilt.x) - 2 * zeta * wn * this.tiltV.x) * dt;
      this.tiltV.y += (wn * wn * (tz - this.tilt.y) - 2 * zeta * wn * this.tiltV.y) * dt;
      this.tilt.x += this.tiltV.x * dt;
      this.tilt.y += this.tiltV.y * dt;
    }

    // vertical velocity and acceleration of the drawn balloon, lightly smoothed
    if (!this.started || jumped || dt === 0) {
      this.prevCur.copy(cur);
      if (!this.started) this.velS.set(0, 0, 0);
    } else {
      const v = cur.clone().sub(this.prevCur).divideScalar(dt);
      const prevVy = this.velS.y;
      this.velS.lerp(v, 1 - Math.exp(-dt / 0.12));
      const a = (this.velS.y - prevVy) / dt;
      this.accY += (a - this.accY) * (1 - Math.exp(-dt / 0.15));
      this.prevCur.copy(cur);
    }

    // squash and stretch: a springy skin driven by vertical acceleration, and the release squash
    const squashing = this.sinceRelease < RELEASE_SQUASH_S;
    const target = squashing ? -0.12 : Math.max(-0.06, Math.min(0.06, 0.012 * this.accY));
    const ws = 2 * Math.PI * 2.2, zs = 0.35;
    if (dt > 0) {
      this.squashV += (ws * ws * (target - this.squash) - 2 * zs * ws * this.squashV) * dt;
      this.squash += this.squashV * dt;
      this.squash = Math.max(-0.2, Math.min(0.2, this.squash));
    }

    // slow spin about the balloon's own axis
    this.spin += dt * 0.15 * (this.reduced ? 0.5 : 1);
    const tiltLen = Math.hypot(this.tilt.x, this.tilt.y);
    const q = new THREE.Quaternion();
    if (tiltLen > 1e-9) {
      // rotate up toward (tilt.x, 0, tilt.y) by |tilt|: axis = up x dir
      const axis = new THREE.Vector3(this.tilt.y, 0, -this.tilt.x).divideScalar(tiltLen);
      q.setFromAxisAngle(axis, Math.min(tiltLen, 0.5));
    }
    this.mesh.quaternion.copy(q).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.spin));
    const k = squashScale(this.squash);
    const s = this.scale * BALLOON_RADIUS_M;
    this.body.scale.set(s * k.xz, s * k.y, s * k.xz);

    // the string: pinned at the knot, and at the hand while held. It is simulated at real size, hung
    // from where the knot of a real-size balloon would be, and drawn magnified about the drawn knot,
    // so the display scale (the camera's distance) never moves it
    const drop = this.drop.set(0, -KNOT_DROP * k.y * BALLOON_RADIUS_M, 0).applyQuaternion(this.mesh.quaternion);
    this.knotReal.copy(cur).add(drop);
    this.knotDrawn.copy(cur).addScaledVector(drop, this.scale);
    const knot = this.knotReal;
    if (!this.started) {
      this.rope.reset(knot);
      this.knotPrev.copy(knot);
      this.knotV.set(0, 0, 0);
    }
    // the air going past the knot: the route's wind less the knot's own motion (smoothed; nothing
    // from a jump), so the string trails below a climbing balloon and a crosswind leans it gently.
    // Capped, and eased over most of a second, plus a slow sway: no flicks
    if (this.started && !jumped && rawDt > 0) {
      const kv = this.tmpV.subVectors(knot, this.knotPrev).divideScalar(rawDt);
      if (kv.length() < 200) this.knotV.lerp(kv, 1 - Math.exp(-rawDt / KNOT_V_TAU_S));
    }
    this.knotPrev.copy(knot);
    const sway = AIR_SWAY_MS * w;
    const want = this.airWant.set(
      Math.sin(hd) * sp - this.knotV.x + sway * (Math.sin(t * 0.37 + 0.4) + 0.5 * Math.sin(t * 0.83)),
      Math.max(-AIR_MAX_UP_MS, Math.min(0, -this.knotV.y)),
      -Math.cos(hd) * sp - this.knotV.z + sway * (Math.sin(t * 0.29 + 2.1) + 0.5 * Math.sin(t * 0.71 + 1)),
    );
    const across = Math.hypot(want.x, want.z);
    if (across > AIR_MAX_MS) {
      want.x *= AIR_MAX_MS / across;
      want.z *= AIR_MAX_MS / across;
    }
    if (!this.started) this.airRel.copy(want);
    else this.airRel.lerp(want, 1 - Math.exp(-rawDt / AIR_TAU_S));
    // the string's end: at the hand while held, then with the opening fingers until it has slipped out
    if (this.slip && !(this.grip && this.grip.releaseT < 1)) this.slip = null;
    const pin = this.hand ?? this.slip;
    const end = pin ? this.endReal.set(pin.x, pin.y, pin.z).sub(this.knotDrawn).divideScalar(this.scale).add(knot) : null;
    if (end && !this.hand) {
      // slipping out: the rising balloon draws the string through the fingers, never stretching it
      const d = end.distanceTo(knot), L = this.rope.length;
      if (d > L) end.sub(knot).multiplyScalar(L / d).add(knot);
    }
    this.ropeOpts.air = this.airRel;
    this.ropeOpts.end = end;
    this.rope.step(rawDt, knot, this.ropeOpts);
    this.started = true;
    this.updateRibbon(cam);

    // shadow straight down onto the ground
    const above = Math.max(0, (Number.isFinite(p.altM) && Number.isFinite(p.groundM) ? p.altM - p.groundM : 0));
    const groundY = pos.y - above;
    const hShadow = Math.max(0, cur.y - groundY);
    const shadowScale = displayScale(Math.hypot(cur.x - cam.x, groundY - cam.y, cur.z - cam.z));
    const r = BALLOON_RADIUS_M * shadowScale * (1.15 + Math.min(2, hShadow / 300));
    this.shadow.position.set(cur.x, groundY + 0.02, cur.z);
    this.shadow.scale.set(r, r, 1);
    const day = (1 - light.night) * Math.min(1, light.sunIntensity / 1.8);
    this.shadowMat.opacity = 0.42 * day * (0.25 + 0.75 * Math.exp(-hShadow / 150));
    this.shadow.visible = this.shadowMat.opacity > 0.003;

    // a faint lift at night (the prototype's curve), and calmer reflections in the dark
    this.material.emissiveIntensity = 0.06 + light.night * 0.32;
    this.material.envMapIntensity = 1 - 0.6 * light.night;
    this.neckMat.emissiveIntensity = 0.03 + light.night * 0.24;
    this.neckMat.envMapIntensity = this.material.envMapIntensity * 0.6;
    this.rimUniform.value = 0.55 * light.night;
    this.refreshEnv(light);
    this.ribbonMat.color.copy(RIBBON_DAY).lerp(RIBBON_NIGHT, light.night);
  }

  /** Rebuild the reflection sky when the light has really changed (a few times an hour at dusk). */
  private refreshEnv(light: Light): void {
    const key = [...parseHex(light.skyTop), ...parseHex(light.skyHorizon), ...parseHex(light.hemiGround)];
    if (this.envKey.length && key.every((v, i) => Math.abs(v - this.envKey[i]) < 8)) return;
    this.envKey = key;
    const old = this.envTex;
    this.envTex = makeSkyEnv(light);
    this.material.envMap = this.envTex;
    this.neckMat.envMap = this.envTex;
    old.dispose();
  }

  private updateRibbon(cam: V3): void {
    const n = this.rope.segments;
    const m = n * RIBBON_SUB;
    const pos = this.ribbonGeo.getAttribute('position') as THREE.BufferAttribute;
    const pts = this.ribbonPts;
    for (let i = 0; i <= n; i++) this.stringPoint(i, pts[i]);
    const c = new THREE.Vector3(), prev = new THREE.Vector3(), next = new THREE.Vector3();
    const tan = new THREE.Vector3(), view = new THREE.Vector3(), side = new THREE.Vector3();
    const half = 0.0025 * this.scale;
    const at = (j: number, out: THREE.Vector3) => {
      const jj = Math.min(m, Math.max(0, j));
      const s = Math.min(n - 1, Math.floor(jj / RIBBON_SUB));
      const f = jj / RIBBON_SUB - s;
      return catmull(pts[Math.max(0, s - 1)], pts[s], pts[s + 1], pts[Math.min(n, s + 2)], f, out);
    };
    for (let j = 0; j <= m; j++) {
      at(j, c);
      at(j - 1, prev);
      at(j + 1, next);
      tan.subVectors(next, prev);
      view.set(cam.x - c.x, cam.y - c.y, cam.z - c.z);
      side.crossVectors(tan, view);
      const l = side.length();
      // never thinner than about a pixel on a phone, or a held balloon looks loose from the hand
      const hw = Math.max(half, MIN_RIBBON_RAD * view.length());
      if (l < 1e-12) side.set(hw, 0, 0);
      else side.multiplyScalar(hw / l);
      pos.setXYZ(2 * j, c.x + side.x, c.y + side.y, c.z + side.z);
      pos.setXYZ(2 * j + 1, c.x - side.x, c.y - side.y, c.z - side.z);
    }
    pos.needsUpdate = true;
  }

  dispose(): void {
    this.scene.remove(this.root);
    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
    this.material.dispose();
    this.neckMat.dispose();
    this.ribbonMat.dispose();
    this.shadowMat.map?.dispose();
    this.shadowMat.dispose();
    this.envTex.dispose();
  }
}

/**
 * The balloon's neck in balloon radii (y down from the centre): pinched where it leaves the skin,
 * flaring into a small rolled lip (a ring), and the tied knot below it, a little off-centre as real
 * knots sit (which lets the slow spin read). The string is tied at the bottom of the knot, KNOT_DROP
 * below the centre. Smooth normals, about 600 triangles.
 */
export function makeNeck(): THREE.BufferGeometry {
  const lathe = (prof: [number, number][], segs: number) => {
    const g = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), segs);
    g.deleteAttribute('uv');
    return g;
  };
  // the neck: out of the skin's tuck, pinched, then flaring to the lip
  const neck = lathe([[0.12, -1.1], [0.088, -1.14], [0.07, -1.17], [0.061, -1.2], [0.062, -1.235], [0.078, -1.262], [0.09, -1.275]], 16);
  // the rolled lip: a soft ring
  const lip = new THREE.TorusGeometry(0.082, 0.031, 8, 18);
  lip.deleteAttribute('uv');
  lip.rotateX(Math.PI / 2);
  lip.translate(0, -1.288, 0);
  // the knot: a squashed, slightly lumpy bulb under the lip, tied a little to one side
  const knot = lathe([[0.03, -1.29], [0.066, -1.31], [0.082, -1.345], [0.074, -1.385], [0.05, -1.42], [0.018, -1.437], [0.001, -1.44]], 14);
  knot.scale(1, 1, 0.82);
  const pos = knot.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const a = Math.atan2(z, x);
    const lump = 1 + 0.11 * Math.sin(3 * a + 0.6) * Math.sin(Math.PI * Math.min(1, Math.max(0, (-1.3 - y) / 0.14)));
    pos.setXYZ(i, x * lump + 0.014 * Math.sin(Math.PI * Math.min(1, Math.max(0, (-1.3 - y) / 0.14))), y, z * lump);
  }
  knot.computeVertexNormals();
  const merged = mergeGeometries([neck, lip, knot], false)!;
  for (const g of [neck, lip, knot]) g.dispose();
  return merged;
}

/** Soft radial falloff in the alpha channel, white elsewhere: the shadow's shape. */
function makeRadialTexture(size = 64): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5) / size * 2 - 1, dy = (y + 0.5) / size * 2 - 1;
      const r = Math.min(1, Math.hypot(dx, dy));
      const a = Math.pow(1 - r * r * (3 - 2 * r), 1.4); // soft core, feathered edge
      const k = (y * size + x) * 4;
      data[k] = data[k + 1] = data[k + 2] = 255;
      data[k + 3] = Math.round(255 * a);
    }
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

/** Uniform Catmull-Rom between p1 and p2. */
function catmull(p0: THREE.Vector3, p1: THREE.Vector3, p2: THREE.Vector3, p3: THREE.Vector3, t: number, out: THREE.Vector3): THREE.Vector3 {
  const t2 = t * t, t3 = t2 * t;
  const a = -0.5 * t3 + t2 - 0.5 * t, b = 1.5 * t3 - 2.5 * t2 + 1, c = -1.5 * t3 + 2 * t2 + 0.5 * t, d = 0.5 * t3 - 0.5 * t2;
  return out.set(
    a * p0.x + b * p1.x + c * p2.x + d * p3.x,
    a * p0.y + b * p1.y + c * p2.y + d * p3.y,
    a * p0.z + b * p1.z + c * p2.z + d * p3.z,
  );
}

/**
 * A tiny sky for the balloon's own reflections, in the light's colours: a bright sky over a darker
 * ground, plus one soft bright window high up, so the clearcoat reads as glossy latex from any side
 * (the sun's own highlight comes from the scene's light). Neutral greys before the first light.
 */
function makeSkyEnv(light: Light | null, w = 64, h = 32): THREE.DataTexture {
  const lin = (hex: string) => parseHex(hex).map((v) => v / 255);
  const top = light ? lin(light.skyTop) : [0.8, 0.82, 0.85];
  const hor = light ? lin(light.skyHorizon) : [0.9, 0.9, 0.9];
  const gnd = light ? lin(light.hemiGround) : [0.3, 0.3, 0.3];
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const el = ((y + 0.5) / h - 0.5) * Math.PI; // row 0 is straight down (v = 0)
    for (let x = 0; x < w; x++) {
      const az = ((x + 0.5) / w) * 2 * Math.PI;
      // sky above, ground below, blended softly across the horizon so no seam crosses the balloon
      const se = Math.sin(el);
      const sky = hor.map((v, i) => v + (top[i] - v) * Math.min(1, Math.max(0, se) * 1.6));
      const ground = gnd.map((v, i) => v + (hor[i] * 0.7 - v) * 0.35);
      const f = Math.min(1, Math.max(0, (se + 0.25) / 0.5));
      const fs = f * f * (3 - 2 * f);
      const c = sky.map((v, i) => ground[i] + (v - ground[i]) * fs);
      const dAz = Math.atan2(Math.sin(az - 0.9), Math.cos(az - 0.9));
      const dEl = el - 0.62;
      const win = 0.9 * Math.exp(-(dAz * dAz) / 0.18 - (dEl * dEl) / 0.06);
      const k = (y * w + x) * 4;
      for (let i = 0; i < 3; i++) data[k + i] = Math.round(255 * Math.min(1, c[i] + win));
      data[k + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  t.mapping = THREE.EquirectangularReflectionMapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}
