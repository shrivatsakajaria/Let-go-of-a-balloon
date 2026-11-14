/**
 * The landing card's world (spec 6.5, design A): the app's own low-poly world seen from high up, built
 * for the card and thrown away after it. It draws the still picture and every frame of the reveal.
 *
 *  - Its own WorldStream on the live worker pool, told to draw the tiles under the card's framing and
 *    under the reveal's way up (cardframe.ts cardTiles): whole-region z5 and z6 tiles from far up, the
 *    finer levels round the landed balloon where the reveal starts.
 *  - The Earth's curve: each tile's vertices are bent down by d^2 / 2R from the landing once it is in,
 *    so the horizon arcs; relief is lifted (EXAG) so mountains still read from far up.
 *  - Its own renderer and canvas with a clear sky (alpha): the sky is painted in 2D under it (a soft
 *    haze at the curved horizon, not a flat fill), so the picture and the reveal composite the same way.
 *  - Graded to the local time of the landing: golden hour, day or night, by the sun's real height there
 *    (the light comes from across the view, so the land's facets read).
 *
 * `view` projects what the 2D layer draws over the picture: the route, the start, the landing, the map's
 * country and sea names, the towns (lights at night) and the horizon.
 */
import * as THREE from 'three';
import type { Route } from '../flight/route';
import type { LatLon } from '../geo/coords';
import { sunPosition } from '../geo/sun';
import type { Label } from '../world/meshjob';
import type { TileKey } from '../world/lod';
import { SLOT_COUNT } from '../world/materials';
import { CONTOUR, lerpHex, lightFor, regionStyle, stageLight, type Color, type Light } from '../world/palette';
import { mixRGB, rgb, type RGB } from '../world/geom';
import { srgbToLinear } from '../world/color';
import { Sky } from '../world/sky';
import { WorldStream, type BuildPool } from '../world/stream';
import { cardShot, cardTiles, dropAt, EARTH_R_M, fromCard, poseAt, poseCamera, revealStart, toCard, type CardPose, type CardShot } from './cardframe';
import { pumpUntil } from './cardshot';

/** What the 2D layer draws over the picture, in picture pixels. */
export type CardView = {
  w: number;
  h: number;
  /** The route, start to landing, each point with whether it is in sight. */
  route: { x: number; y: number; seen: boolean }[];
  start: { x: number; y: number } | null;
  landing: { x: number; y: number } | null;
  /** The horizon where it crosses the picture, left to right (empty when no sky shows). */
  horizon: { x: number; y: number }[];
  /** Country and sea names from the map (candidates: the card keeps a few). */
  places: { text: string; kind: 'country' | 'sea'; rank: number; x: number; y: number }[];
  /** Towns, biggest first (lights at night). */
  towns: { x: number; y: number; rank: number }[];
  /** How far the camera is from the landing, m (the 2D balloon's size). */
  landingDistM: number;
};

export type CardLook = { light: Light; night: number; sunElevationDeg: number };

/** The land's tint at night is drawn toward this pale blue-grey (the sea stays dark). */
const NIGHT_LAND = '#c4d2e2';
const WATER_KINDS = new Set(['ocean', 'sea', 'bay', 'strait', 'gulf']);

/** The look for the landing's local time: the sun's real height there, held inside the keyed range. */
export function cardLook(landing: LatLon, utcMs: number): CardLook {
  // a high noon sun washes the land out from far up: the day look stops at a calmer, lower sun
  const el = Math.max(-16, Math.min(22, sunPosition(utcMs, landing).elevationDeg));
  const light = lightFor(el);
  return { light, night: light.night, sunElevationDeg: el };
}

/** The map label's English name, without the other languages a sea's name can carry. */
export function labelText(l: Pick<Label, 'name' | 'en'>): string {
  return (l.en || l.name.split(' / ')[0]).trim();
}

/** The water's mid tone (water.ts facets lie between its shallows and this, its deep band on the coast). */
const lin = (c: RGB): RGB => [srgbToLinear(c[0]), srgbToLinear(c[1]), srgbToLinear(c[2])];
/**
 * In linear light, as the tiles' vertex colours are stored (meshjob.ts packs sRGB to linear bytes):
 * mixed and compared in sRGB, the calmed sea came out pale, and golden light turned it khaki.
 */
export const SEA_MID_LINEAR = lin(mixRGB(rgb(CONTOUR.waterShallow), rgb(CONTOUR.waterDeep), 0.32));
const SEA_DEEP_LINEAR = lin(rgb(CONTOUR.waterDeep));

/**
 * Draw a water mesh's facet colours a share k of the way toward the one mid tone (every tile alike, so
 * no tile shows as a square), leaving the deep coast band as it is.
 */
function calmColours(g: THREE.BufferGeometry, k: number, tone: RGB): void {
  const c = g.getAttribute('color') as THREE.BufferAttribute | undefined;
  if (!c) return;
  for (let i = 0; i < c.count; i++) {
    const r = c.getX(i), gg = c.getY(i), b = c.getZ(i);
    if (Math.abs(r - SEA_DEEP_LINEAR[0]) + Math.abs(gg - SEA_DEEP_LINEAR[1]) + Math.abs(b - SEA_DEEP_LINEAR[2]) < 0.03) continue;
    c.setXYZ(i, r + (tone[0] - r) * k, gg + (tone[1] - gg) * k, b + (tone[2] - b) * k);
  }
  c.needsUpdate = true;
}

/** The calmed sea's tone for a look (linear): the water's mid tone, deeper at night so the land reads lighter. */
export function seaTone(look: CardLook): RGB {
  const k = 1 - 0.7 * Math.max(0, (look.night - 0.3) / 0.7);
  return SEA_MID_LINEAR.map((c) => c * k) as RGB;
}

/** The land's tint the card world uses for a look (lighter than the sea's at night). */
export function cardGroundTint(look: CardLook): string {
  const L = look.light;
  return look.night > 0.4 ? lerpHex(L.groundTint, NIGHT_LAND, 0.85 * look.night) : L.groundTint;
}

/**
 * The calmed sea and a mid land green as the card's light leaves them (sRGB 0..1), in a simple model of
 * the tiles' lighting (albedo x (sun at half strength + sky light), the land tinted): for checks that
 * the two stay apart at golden hour, by day and at night.
 */
export function gradedColours(look: CardLook): { sea: RGB; land: RGB } {
  const S = stageLight(look.light);
  const sun = lin(rgb(S.sunColor)), sky = lin(rgb(S.hemiSky)), gnd = lin(rgb(S.hemiGround));
  const light = sun.map((c, i) => (c * S.sunIntensity * 0.5 + (sky[i] * 0.7 + gnd[i] * 0.3) * S.hemiIntensity) / Math.PI) as RGB;
  const tint = lin(rgb(cardGroundTint(look) as Color));
  const land = lin(rgb(CONTOUR.land[2]));
  const out = (a: RGB, t: RGB = [1, 1, 1]): RGB => a.map((c, i) => Math.min(1, linearToSrgb(c * t[i] * light[i]))) as RGB;
  return { sea: out(seaTone(look)), land: out(land, tint) };
}

const linearToSrgb = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

export class CardWorld {
  readonly shot: CardShot;
  readonly start: CardPose;
  readonly canvas: HTMLCanvasElement;
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly sky: Sky;
  readonly stream: WorldStream;
  readonly look: CardLook;
  /** Relief lifted this many times, so it reads from far up. */
  readonly exag: number;
  private readonly groundTint: string;
  private readonly sea: RGB;
  private readonly camera = new THREE.PerspectiveCamera();
  private readonly bent = new WeakSet<THREE.BufferGeometry>();
  private readonly landing: LatLon;
  /** The card world's origin (the middle of the route): every card-world metre is from here. */
  private readonly origin: LatLon;
  private readonly route: LatLon[];
  private heights: Float32Array | null = null;
  private disposed = false;
  /** The route in card-world metres (x, z per point), worked out once. */
  private readonly routeLocal: Float64Array;
  private routePx: { x: number; y: number; seen: boolean }[] = [];
  private labelCache: { text: string; kind: string; rank?: number; x: number; z: number }[] | null = null;
  // scratch vectors for the reveal's frames (no garbage per frame)
  private readonly sv = new THREE.Vector3();
  private readonly sC = new THREE.Vector3();
  private readonly sN = new THREE.Vector3();
  private readonly sCentre = new THREE.Vector3();
  private readonly sA = new THREE.Vector3();
  private readonly sB = new THREE.Vector3();
  private readonly sDir = new THREE.Vector3();
  private readonly finalTiles: TileKey[];
  private readonly revealTiles: TileKey[];
  private wanted: TileKey[];
  /** Asked for the reveal's tiles too (the stream is told by a changed camera height). */
  private phase = 0;

  constructor(pool: BuildPool, route: Route, o: { sunAt: number; reveal?: boolean; canvas?: HTMLCanvasElement }) {
    const pts = route.points.map((p) => ({ lat: p.lat, lon: p.lon }));
    this.route = pts;
    this.landing = pts[pts.length - 1];
    this.shot = cardShot(pts);
    this.origin = this.shot.origin;
    this.routeLocal = new Float64Array(pts.length * 2);
    pts.forEach((p, i) => {
      const c = toCard(this.origin, p);
      this.routeLocal[i * 2] = c.x;
      this.routeLocal[i * 2 + 1] = c.z;
    });
    this.start = revealStart(this.shot);
    // (held back: lifted much more, the steep faces turn to clay and the reveal's start, near the ground, bristles)
    this.exag = Math.max(1, Math.min(2, 1 + this.shot.altM / 1_200_000));
    this.canvas = o.canvas ?? document.createElement('canvas');
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true, premultipliedAlpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(1);
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.shadowMap.enabled = false;
    this.renderer.setClearColor(0x000000, 0);

    this.look = cardLook(this.landing, o.sunAt);
    this.sky = new Sky(this.scene, { shadow: { radius: 700, mapSize: 256, snap: 100, upM: 60, downM: 40 }, stars: 0 });
    const az = (this.shot.headingDeg - 40 + 360) % 360;
    this.sky.apply({ elevationDeg: this.look.sunElevationDeg, azimuthDeg: az }, null, false);
    // the land hazes toward the horizon's colour whichever way it is seen from (looking down from far
    // up, the haze would otherwise take the greyer colour under the horizon); the sky is painted in 2D
    this.sky.haze.uLow.value.copy(this.sky.haze.uHor.value);
    // at night the land is lit a little more than the sea, so the coast still reads under the town lights
    this.groundTint = cardGroundTint(this.look);
    this.sea = seaTone(this.look);
    this.sky.dome.mesh.visible = false;
    this.sky.sunDisc.visible = false;
    this.sky.moonDisc.visible = false;
    this.sky.stars.visible = false;

    // the card's own tiles first; the reveal's (round the balloon and on the way up) only once those are in
    this.finalTiles = cardTiles(this.origin, [this.shot], pts);
    const have = new Set(this.finalTiles.map((t) => `${t.z}/${t.x}/${t.y}`));
    this.revealTiles = o.reveal
      ? cardTiles(this.origin, [this.start, poseAt(this.start, this.shot, 0.3), poseAt(this.start, this.shot, 0.55), poseAt(this.start, this.shot, 0.8)], pts, { max: 200, tilePx: 420, nearLanding: true })
          .filter((t) => !have.has(`${t.z}/${t.x}/${t.y}`))
          .slice(0, Math.max(0, SLOT_COUNT - 2 - this.finalTiles.length))
      : [];
    this.wanted = this.finalTiles;
    this.stream = new WorldStream(this.scene, pool, regionStyle, {
      haze: this.sky.haze,
      groundTint: this.groundTint,
      origin: this.origin,
      want: () => this.wanted,
      maxTiles: this.finalTiles.length + this.revealTiles.length + 4,
      maxInFlight: 8,
      fadeMs: 1,
      recentreM: 1e12,
    });
    this.stream.setNight(this.look.night);
  }

  /** Step the stream and bend what came in. */
  private step(): void {
    const here = { lat: this.origin.lat, lon: this.origin.lon, altM: this.shot.altM + this.phase * 1000, headingDeg: this.shot.headingDeg };
    this.stream.update(here, performance.now());
    this.bendNew();
  }

  /** Until every tile is in (twice running), the time is up, `stop` says the moment has come, or `alive` says no. */
  async load(o: { maxMs: number; alive: () => boolean; stop?: () => boolean }): Promise<'ready' | 'timeout' | 'cancelled' | 'stopped'> {
    const how = await pumpUntil(
      () => {
        this.step();
        return this.stream.stats().ready;
      },
      { maxMs: o.maxMs, everyMs: 60, alive: () => !this.disposed && o.alive(), stop: o.stop },
    );
    if (how !== 'cancelled') {
      // tiles that came in just now are placed and bent
      this.step();
      this.heights = null;
      this.labelCache = null;
    }
    return how;
  }

  /** Whether every tile asked for is in (one step first, so what came in just now counts). */
  complete(): boolean {
    this.step();
    return this.stream.stats().ready;
  }

  /** The reveal's tiles as well (once the card's own are in): until they are all in, or the time is up. */
  async loadReveal(o: { maxMs: number; alive: () => boolean; stop?: () => boolean; inFlight?: number }): Promise<'ready' | 'timeout' | 'cancelled' | 'stopped'> {
    this.wanted = [...this.finalTiles, ...this.revealTiles];
    this.phase = 1;
    // fewer builds at once while the replay still streams its own tiles on the same workers
    this.stream.setMaxInFlight(o.inFlight ?? 8);
    try {
      return await this.load(o);
    } finally {
      this.stream.setMaxInFlight(8);
    }
  }

  /** Each tile's vertices bent by the Earth's curve (and its relief lifted), once, as it comes in. */
  private bendNew(): void {
    const v = new THREE.Vector3();
    const inv = new THREE.Matrix4();
    const k = this.exag;
    for (const t of this.stream.tiles()) {
      const g = this.stream.groupOf(t.key);
      if (!g) continue;
      g.updateMatrixWorld(true);
      const z = Number(t.key.split('/')[0]);
      g.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh || !m.geometry || this.bent.has(m.geometry)) return;
        const pos = m.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
        if (!pos) return;
        // the sea seen from far up (z5 to z7): its facets' colours drawn together toward one tone, so
        // earcut's long thin triangles do not show as fans and every tile's sea matches its neighbours'
        const mat = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.Material | undefined;
        if (z <= 7 && mat && /-water-/.test(mat.name)) calmColours(m.geometry, 0.7, this.sea);
        inv.copy(m.matrixWorld).invert();
        for (let i = 0; i < pos.count; i++) {
          v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
          v.y = v.y * k - dropAt(v.x, v.z);
          v.applyMatrix4(inv);
          pos.setXYZ(i, v.x, v.y, v.z);
        }
        pos.needsUpdate = true;
        m.geometry.computeBoundingSphere();
        m.geometry.computeBoundingBox();
        m.frustumCulled = false;
        this.bent.add(m.geometry);
      });
    }
  }

  /** The camera for a pose, its haze set for how far it sees. */
  private aim(pose: CardPose, w: number, h: number): THREE.PerspectiveCamera {
    const cam = poseCamera(pose, w / h, this.camera);
    const alt = Math.max(1, Math.hypot(cam.position.x, cam.position.y + EARTH_R_M, cam.position.z) - EARTH_R_M);
    const horizon = Math.sqrt(2 * EARTH_R_M * alt + alt * alt);
    const far = Math.max(horizon * 1.05, pose.distM * 1.6);
    cam.far = far * 1.3;
    cam.updateProjectionMatrix();
    this.sky.setView(cam, far, h / 2);
    this.sky.fog.near = Math.min(pose.distM * 0.85, far * 0.5);
    this.sky.place(new THREE.Vector3(pose.target.x, 0, pose.target.z));
    return cam;
  }

  /** Draw the world from a pose into its canvas, w x h pixels (the sky left clear). Null when the context is lost. */
  draw(pose: CardPose, w: number, h: number): HTMLCanvasElement | null {
    if (this.disposed || this.renderer.getContext().isContextLost()) return null;
    this.bendNew();
    if (this.canvas.width !== w || this.canvas.height !== h) this.renderer.setSize(w, h, false);
    const cam = this.aim(pose, w, h);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.clear();
    this.renderer.render(this.scene, cam);
    return this.canvas;
  }

  /** The drawn ground's height at each route point (relief lifted), worked out once the tiles are in. */
  private routeHeights(): Float32Array {
    if (this.heights) return this.heights;
    const h = new Float32Array(this.route.length);
    this.route.forEach((p, i) => (h[i] = Math.max(0, this.stream.groundAt(p)) * this.exag));
    this.heights = h;
    return h;
  }

  /** What the 2D layer draws over the picture from a pose, w x h picture pixels. */
  /**
   * What the 2D layer draws over the picture from a pose, w x h picture pixels. `reuse`: the reveal's
   * frames fill one array of route points (painted at once, no garbage per frame); the still keeps its own.
   */
  view(pose: CardPose, w: number, h: number, reuse = false): CardView {
    const cam = poseCamera(pose, w / h, this.camera);
    const v = this.sv, cp = cam.position;
    const toPx = (x: number, y: number, z: number, out: { x: number; y: number; seen: boolean }) => {
      v.set(x, y - dropAt(x, z), z);
      const nx = v.x, ny = v.y + EARTH_R_M, nz = v.z;
      const facing = nx * (cp.x - v.x) + ny * (cp.y - v.y) + nz * (cp.z - v.z) > 0;
      v.project(cam);
      out.x = ((v.x + 1) / 2) * w;
      out.y = ((1 - v.y) / 2) * h;
      out.seen = facing && v.z > -1 && v.z < 1;
    };
    const hs = this.routeHeights();
    const L = this.routeLocal;
    const n = this.route.length;
    let pts = this.routePx;
    if (!reuse || pts.length !== n) {
      pts = Array.from({ length: n }, () => ({ x: 0, y: 0, seen: false }));
      if (reuse) this.routePx = pts;
    }
    for (let i = 0; i < n; i++) toPx(L[i * 2], hs[i] + 30, L[i * 2 + 1], pts[i]);
    return this.finishView(cam, pts, w, h);
  }

  private finishView(cam: THREE.PerspectiveCamera, route: CardView['route'], w: number, h: number): CardView {
    const s = route[0], l = route[route.length - 1];
    const v = this.sv, cp = cam.position;
    // the horizon: where lines of sight graze the Earth (a circle round the point under the camera)
    const horizon: { x: number; y: number }[] = [];
    const C = this.sC.copy(cp);
    C.y += EARTH_R_M;
    const dC = C.length();
    if (dC > EARTH_R_M * 1.00001) {
      const nrm = this.sN.copy(C).normalize();
      const centre = this.sCentre.set(0, -EARTH_R_M, 0).addScaledVector(nrm, (EARTH_R_M * EARTH_R_M) / dC);
      const r = EARTH_R_M * Math.sqrt(1 - (EARTH_R_M * EARTH_R_M) / (dC * dC));
      const a = this.sA.set(1, 0, 0).cross(nrm);
      if (a.lengthSq() < 0.25) a.set(0, 0, 1).cross(nrm);
      a.normalize();
      const b = this.sB.copy(nrm).cross(a);
      const dir = cam.getWorldDirection(this.sDir);
      const STEPS = 180;
      for (let i = 0; i <= STEPS; i++) {
        const t = (i / STEPS) * Math.PI * 2;
        v.copy(centre).addScaledVector(a, Math.cos(t) * r).addScaledVector(b, Math.sin(t) * r);
        // in front of the camera
        if ((v.x - cp.x) * dir.x + (v.y - cp.y) * dir.y + (v.z - cp.z) * dir.z <= 0) continue;
        v.project(cam);
        if (v.z < -1 || v.z > 1) continue;
        const x = ((v.x + 1) / 2) * w, y = ((1 - v.y) / 2) * h;
        if (x >= -w * 0.2 && x <= w * 1.2 && y >= -h * 0.05 && y <= h) horizon.push({ x, y });
      }
      horizon.sort((p, q) => p.x - q.x);
    }
    const places: CardView['places'] = [];
    const towns: CardView['towns'] = [];
    for (const lab of this.labels()) {
      v.set(lab.x, -dropAt(lab.x, lab.z), lab.z);
      const facing = v.x * (cp.x - v.x) + (v.y + EARTH_R_M) * (cp.y - v.y) + v.z * (cp.z - v.z) > 0;
      if (!facing) continue;
      v.project(cam);
      if (v.z < -1 || v.z > 1) continue;
      const x = ((v.x + 1) / 2) * w, y = ((1 - v.y) / 2) * h;
      if (lab.kind === 'country') places.push({ text: lab.text, kind: 'country', rank: lab.rank ?? 3, x, y });
      else if (WATER_KINDS.has(lab.kind)) places.push({ text: lab.text, kind: 'sea', rank: lab.rank ?? (lab.kind === 'ocean' ? 1 : 2), x, y });
      else if (lab.kind === 'city' || lab.kind === 'town') towns.push({ x, y, rank: lab.rank ?? (lab.kind === 'city' ? 6 : 9) });
    }
    towns.sort((p, q) => p.rank - q.rank);
    return {
      w,
      h,
      route,
      start: s.seen ? { x: s.x, y: s.y } : null,
      landing: l.seen ? { x: l.x, y: l.y } : null,
      horizon,
      places,
      towns,
      landingDistM: cp.length(),
    };
  }

  /** The map's labels in card-world metres, worked out once the tiles are in (not every frame). */
  private labels(): { text: string; kind: string; rank?: number; x: number; z: number }[] {
    if (this.labelCache) return this.labelCache;
    this.labelCache = this.stream.labelsNear(this.origin, 40_000).map((lab) => {
      const c = toCard(this.origin, lab);
      return { text: labelText(lab), kind: lab.kind, rank: lab.rank, x: c.x, z: c.z };
    });
    return this.labelCache;
  }

  /** Where in the world a picture point is (for checks), or null in the sky. */
  ground(pose: CardPose, fx: number, fy: number): LatLon | null {
    const cam = poseCamera(pose, 1080 / 1000, this.camera);
    const v = new THREE.Vector3(fx * 2 - 1, 1 - fy * 2, 0.5).unproject(cam).sub(cam.position).normalize();
    const o = cam.position.clone().add(new THREE.Vector3(0, EARTH_R_M, 0));
    const b = o.dot(v), c = o.lengthSq() - EARTH_R_M * EARTH_R_M, d = b * b - c;
    if (d < 0) return null;
    const t = -b - Math.sqrt(d);
    return fromCard(this.origin, cam.position.x + v.x * t, cam.position.z + v.z * t);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stream.dispose();
    this.sky.dispose();
    this.renderer.dispose();
    // let the context go now rather than when the canvas is collected (phones have few to spare)
    this.renderer.forceContextLoss();
  }
}

