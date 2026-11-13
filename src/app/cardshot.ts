/**
 * The landing card's picture (spec 6.5): a high, angled golden-hour view that shows both ends of the
 * route, rendered into an offscreen target and read back, never touching the live view.
 *
 * Two ways, by how far the balloon went:
 *
 *  - Near (start within NEAR_START_KM of the landing): the live scene itself, which already holds the
 *    landing area in detail. The camera stands 520 m up behind the landing and looks back along the
 *    route, a little off its line, so the start shows through the haze. For that one frame the sky is
 *    set to golden hour and the live balloon, person and clouds are hidden; all of it is put back in
 *    the same task, so no live frame sees it.
 *
 *  - Far (any longer route): a card world of its own, built for the one frame and thrown away: a
 *    WorldStream on the live worker pool, told to draw the coarse (z7) land under the whole view plus
 *    the usual finer rings round the camera's ground point, under its own golden-hour Sky. The camera
 *    stands high (about 8% of the route's length up) and far behind the landing, so the landing sits
 *    low in the picture and the start near the horizon, small, inside the haze (farShot). The land
 *    there is z7: rivers, coast, land use and relief in broad facets, no buildings, which is what the
 *    eye would see from 70 km up anyway.
 *
 * The render target is marked as an XR target with an sRGB texture stored as plain RGBA8: three.js
 * then tone-maps and encodes exactly as it does for the screen (the same shader programs, no
 * recompiling) and the bytes read back are the picture as it would show. Warm slopes are then calmed
 * (tameWarm) so the balloon is the one bright thing. Everything made for the frame is disposed.
 */
import * as THREE from 'three';
import type { Route } from '../flight/route';
import { positionAt } from '../flight/route';
import { bearingDeg, destination, haversineKm, lonLatToTile, type LatLon } from '../geo/coords';
import { seaAt } from '../geo/gazetteer';
import { tameWarm, type CardFrame, type CardScene } from '../ui/card';
import { M_PER_DEG } from '../world/frame';
import { tilesFor, tileKey, type TileKey } from '../world/lod';
import { regionStyle } from '../world/palette';
import { Sky } from '../world/sky';
import { WorldStream } from '../world/stream';
import { routeGround } from '../world/terrainsrc';
import type { LiveScene } from './scene';

/** Near: how high above the landing ground the camera stands, m. */
const CAM_UP_M = 520;
/** Near: the landing point sits this far down from the frame's top (the horizon lands at about 0.16). */
const LANDING_Y = 0.42;
const FOV = 36;
const ASPECT = 1080 / 1000;
/** Near: haze clear to 6 km, gone at 30 km. */
const FOG_FAR = 30000;
const FOG_NEAR = 6000;
/**
 * The sun 7 degrees up, 40 degrees left of where the camera looks: low light across and toward the
 * camera, so slopes read by their shading and keep their sage and chalk. With the sun behind the
 * camera every slope faces it and the clay turns orange, which takes the colour from the balloon.
 */
const GOLDEN = { elevationDeg: 7, offsetDeg: -40 };
/**
 * Near: the camera looks this far off the line of the route, so the trail runs across the picture
 * rather than straight up behind the balloon; less when the start must show through the haze.
 */
const SKEW_DEG = 25;
const SKEW_NEAR_DEG = 11;
/** Up to this far from start to landing the live scene draws the card; beyond it, a card world. */
export const NEAR_START_KM = 28;
/** Far: the horizon, the start and the landing, as fractions of the frame from its top. */
const FAR = { horizonY: 0.14, startY: 0.25, landingY: 0.58, skewDeg: 8 };
/** Far: the plain's sea and land (Contour's deep water and a mid sage). */
const PLAIN_SEA = '#2b7fb0';
const PLAIN_LAND = '#a0c078';
/** Far: how long the card world may take to draw before the picture is taken anyway. */
const FAR_WAIT_MS = 20000;
/** The trail is sampled this often along the route. */
const TRAIL_STEP_MS = 2 * 60e3;
const D2R = Math.PI / 180;

/** Which way to look from the landing: toward the route a little way back, else toward the start. */
export function lookBack(route: Route, km = 15): number {
  const pts = route.points;
  const last = pts[pts.length - 1];
  for (let i = pts.length - 2; i >= 0; i--) {
    if (haversineKm(last, pts[i]) >= km) return bearingDeg(last, pts[i]);
  }
  return haversineKm(last, pts[0]) > 0.05 ? bearingDeg(last, pts[0]) : 0;
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const sunFor = (viewDeg: number) => ({ elevationDeg: GOLDEN.elevationDeg, azimuthDeg: (viewDeg + GOLDEN.offsetDeg + 360) % 360 });

/** Near: where the card's camera looks (degrees from north) and where the golden-hour sun stands. */
export function cardView(route: Route): { viewDeg: number; sun: { elevationDeg: number; azimuthDeg: number } } {
  const pts = route.points;
  const near = haversineKm(pts[0], pts[pts.length - 1]) <= NEAR_START_KM;
  const viewDeg = (lookBack(route) + (near ? SKEW_NEAR_DEG : SKEW_DEG)) % 360;
  return { viewDeg, sun: sunFor(viewDeg) };
}

// ---- far: the shot ----

/** The far shot, in metres in the landing's frame (x east, z south; the landing at 0, 0). */
export type FarShot = {
  landing: LatLon;
  /** Unit view direction on the ground. */
  dir: { x: number; z: number };
  viewDeg: number;
  /** The camera stands `back` m behind the landing (along -dir) and `up` m above its ground. */
  back: number;
  up: number;
  /** Turned up by this much after looking at the landing, so the landing sits at FAR.landingY. */
  pitchUp: number;
  fogNear: number;
  fogFar: number;
  sun: { elevationDeg: number; azimuthDeg: number };
};

const toLocal = (o: LatLon, p: LatLon) => {
  let dLon = p.lon - o.lon;
  dLon -= 360 * Math.round(dLon / 360);
  return { x: dLon * M_PER_DEG * Math.cos(o.lat * D2R), z: -(p.lat - o.lat) * M_PER_DEG };
};
const fromLocal = (o: LatLon, x: number, z: number): LatLon => ({ lat: o.lat - z / M_PER_DEG, lon: ((o.lon + x / (M_PER_DEG * Math.cos(o.lat * D2R)) + 540) % 360) - 180 });

/**
 * A camera high and far enough back that the landing sits low in the picture and the start just
 * under the horizon: with the pitch fixed by where the horizon goes, the landing's and the start's
 * depression angles give the height (about 8% of the distance) and the distance back (about 3.4
 * times the height).
 */
export function farShot(route: Route): FarShot {
  const pts = route.points;
  const last = pts[pts.length - 1];
  const landing = { lat: last.lat, lon: last.lon };
  const s = toLocal(landing, pts[0]);
  const ls = Math.max(1, Math.hypot(s.x, s.z));
  const toStartDeg = (Math.atan2(s.x, -s.z) / D2R + 360) % 360;
  const viewDeg = (toStartDeg + FAR.skewDeg) % 360;
  const dir = { x: Math.sin(viewDeg * D2R), z: -Math.cos(viewDeg * D2R) };
  const tanHalf = Math.tan((FOV / 2) * D2R);
  const pitch = Math.atan((0.5 - FAR.horizonY) * 2 * tanHalf);
  const depL = pitch + Math.atan((FAR.landingY - 0.5) * 2 * tanHalf);
  const depS = pitch - Math.atan((0.5 - FAR.startY) * 2 * tanHalf);
  const along = ls * Math.cos(FAR.skewDeg * D2R);
  const up = Math.max(600, along / (1 / Math.tan(depS) - 1 / Math.tan(depL)));
  const back = up / Math.tan(depL);
  const landSlant = Math.hypot(back, up);
  const startSlant = Math.hypot(along + back, up);
  return {
    landing,
    dir,
    viewDeg,
    back,
    up,
    pitchUp: Math.atan((FAR.landingY - 0.5) * 2 * tanHalf),
    fogNear: Math.max(landSlant * 1.25, startSlant * 0.3),
    fogFar: startSlant * 1.35,
    sun: sunFor(viewDeg),
  };
}

/** The far shot's camera, in the landing's frame, the landing's ground at groundM. */
export function farCamera(shot: FarShot, groundM: number, aspect = ASPECT): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(FOV, aspect, Math.max(2, shot.up * 0.01), shot.fogFar * 1.25);
  cam.position.set(-shot.dir.x * shot.back, groundM + shot.up, -shot.dir.z * shot.back);
  cam.lookAt(0, groundM, 0);
  cam.rotateX(shot.pitchUp);
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld();
  return cam;
}

/**
 * The z7 tiles under the far view, in the order they are worth drawing: the landing's, the start's,
 * those under the trail (nearest the landing first), then the rest of the ground the frame sees, from
 * its bottom edge out to a little past the start (nearest the trail first). If the time runs out, the
 * two ends and the line between them are drawn and the haze plain shows at the sides.
 */
export function corridorTiles(route: Route, shot: FarShot, z = 7): TileKey[] {
  const n = 2 ** z;
  const keyOf = (p: LatLon): TileKey => {
    const t = lonLatToTile(Math.max(-85.05, Math.min(85.05, p.lat)), p.lon, z);
    return { z, x: ((Math.floor(t.x) % n) + n) % n, y: Math.max(0, Math.min(n - 1, Math.floor(t.y))) };
  };
  const rank = new Map<string, { t: TileKey; r: number }>();
  const add = (p: LatLon, r: number) => {
    const t = keyOf(p);
    const k = tileKey(t);
    const had = rank.get(k);
    if (!had || r < had.r) rank.set(k, { t, r });
  };
  add(shot.landing, 0);
  add(route.points[0], 1);
  // under the trail, every few km
  const trail: LatLon[] = [];
  for (let i = route.points.length - 1; i >= 0; i -= 3) trail.push(route.points[i]);
  for (const p of trail) add(p, 2 + haversineKm(shot.landing, p) / 1e5);
  // the rest of the view
  const tanHalf = Math.tan((FOV / 2) * D2R);
  const pitch = Math.atan((0.5 - FAR.horizonY) * 2 * tanHalf);
  const near = shot.up / Math.tan(pitch + Math.atan(tanHalf)); // where the frame's bottom meets the ground
  const s = toLocal(shot.landing, route.points[0]);
  const far = (Math.hypot(s.x, s.z) + shot.back) * 1.15;
  const cx = -shot.dir.x * shot.back, cz = -shot.dir.z * shot.back;
  const rx = -shot.dir.z, rz = shot.dir.x;
  const step = Math.max(8000, (far - near) / 40);
  for (let f = near; f <= far; f += step) {
    const half = Math.hypot(f, shot.up) * tanHalf * ASPECT * 1.1 + 10000;
    for (let side = -half; side <= half; side += step) {
      const p = fromLocal(shot.landing, cx + shot.dir.x * f + rx * side, cz + shot.dir.z * f + rz * side);
      let dTrail = Infinity;
      for (const q of trail) dTrail = Math.min(dTrail, haversineKm(p, q));
      add(p, 10 + dTrail / 1e4);
    }
  }
  return [...rank.values()].sort((a, b) => a.r - b.r).map((v) => v.t);
}

// ---- drawing ----

export function cardScene(live: LiveScene): CardScene {
  return {
    cardFrame: (route, w, h) => {
      const pts = route.points;
      return haversineKm(pts[0], pts[pts.length - 1]) <= NEAR_START_KM ? cardFrame(live, route, w, h) : farFrame(live, route, w, h);
    },
  };
}

/** Render `scene` from `camera` into a w x h picture (right way up, warm slopes calmed). */
function picture(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, w: number, h: number): HTMLCanvasElement | null {
  const target = renderer.getRenderTarget();
  const rt = new THREE.WebGLRenderTarget(w, h, { samples: 4, depthBuffer: true, colorSpace: THREE.SRGBColorSpace });
  (rt as unknown as { isXRRenderTarget: boolean }).isXRRenderTarget = true;
  rt.texture.internalFormat = 'RGBA8';
  const px = new Uint8Array(w * h * 4);
  try {
    renderer.shadowMap.needsUpdate = true;
    renderer.setRenderTarget(rt);
    renderer.clear();
    renderer.render(scene, camera);
    renderer.readRenderTargetPixels(rt, 0, 0, w, h, px);
  } finally {
    renderer.setRenderTarget(target);
    rt.dispose();
    renderer.shadowMap.needsUpdate = true; // the live frame redraws its own shadows next
  }
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const img = ctx.createImageData(w, h);
  const row = w * 4;
  for (let y = 0; y < h; y++) img.data.set(px.subarray((h - 1 - y) * row, (h - y) * row), y * row);
  tameWarm(img.data); // the balloon stays the one bright thing
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/** The route's ground track, the start and the landing, projected onto the picture. */
function project(
  route: Route,
  camera: THREE.Camera,
  w: number,
  h: number,
  toScene: (p: LatLon) => { x: number; z: number },
  groundAt: (p: LatLon) => number,
  clarity: (d: number) => number,
): Omit<CardFrame, 'image'> {
  const trail: CardFrame['trail'] = [];
  let line: CardFrame['trail'][number] = [];
  const v = new THREE.Vector3();
  const at = (p: LatLon, lift: number) => {
    const s = toScene(p);
    v.set(s.x, groundAt(p) + lift, s.z);
    const d = v.distanceTo(camera.position);
    v.project(camera);
    return d;
  };
  const end = route.release + (route.points[route.points.length - 1].tSec ?? 0) * 1000;
  for (let t = route.release; t <= end + 1; t += TRAIL_STEP_MS) {
    const a = clarity(at(positionAt(route, Math.min(t, end)), 2));
    const inside = v.z > -1 && v.z < 1 && Math.abs(v.x) < 1.6 && v.y > -1.6 && a > 0.02;
    if (!inside) {
      if (line.length > 1) trail.push(line);
      line = [];
      continue;
    }
    line.push({ x: ((v.x + 1) / 2) * w, y: ((1 - v.y) / 2) * h, a });
  }
  if (line.length > 1) trail.push(line);
  const d0 = at(route.points[0], 2);
  const start = v.z > -1 && v.z < 1 && Math.abs(v.x) < 0.97 && v.y > -0.97 && v.y < 0.97 ? { x: ((v.x + 1) / 2) * w, y: ((1 - v.y) / 2) * h, a: clarity(d0) } : null;
  at(route.points[route.points.length - 1], 0);
  const landing = v.z > -1 && v.z < 1 ? { x: ((v.x + 1) / 2) * w, y: ((1 - v.y) / 2) * h } : null;
  return { trail, landing, start };
}

/** Near: how clear the trail is at distance d through the card's haze: never quite gone until past it. */
const nearClarity = (d: number) => (1 - 0.85 * smooth(FOG_NEAR * 0.6, FOG_FAR * 0.9, d)) * (1 - smooth(FOG_FAR, FOG_FAR * 1.3, d));

/** Near: the live scene, from 520 m up behind the landing. */
export function cardFrame(live: LiveScene, route: Route, w: number, h: number): CardFrame | null {
  const { renderer, scene, stream, sky } = live;
  const last = route.points[route.points.length - 1];
  const landing: LatLon = { lat: last.lat, lon: last.lon };
  const { viewDeg: look, sun } = cardView(route);
  const g = stream.groundAt(landing);

  // the camera: behind the landing, high, pitched so the landing sits at LANDING_Y
  const tanHalf = Math.tan((FOV / 2) * D2R);
  const above = Math.atan((0.5 - LANDING_Y) * 2 * tanHalf); // the landing above the frame's centre
  const depression = 9.5 * D2R;
  const back = CAM_UP_M / Math.tan(depression) / 1000;
  const camLL = destination(landing, (look + 180) % 360, back);
  const camGround = stream.groundAt(camLL);
  const camera = new THREE.PerspectiveCamera(FOV, w / h, 1, FOG_FAR * 1.4);
  const c = stream.toScene(camLL);
  camera.position.set(c.x, Math.max(g + CAM_UP_M, camGround + 200), c.z);
  const l = stream.toScene(landing);
  camera.lookAt(l.x, g, l.z);
  camera.rotateX(-above);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();

  // what is changed for the frame, to put back
  const prev = { sun: { ...sky.sun }, moon: sky.moon ? { ...sky.moon } : null, rising: sky.rising };
  // the live balloon and person (the card draws its balloon), and the clouds, placed round the live camera
  const hidden: THREE.Object3D[] = [];
  for (const o of [live.balloon.root, live.person?.root, live.clouds.mesh]) if (o?.visible) hidden.push(o);
  let image: HTMLCanvasElement | null;
  try {
    const L = sky.apply(sun, null, false);
    stream.materials.setGroundTint(L.groundTint);
    stream.setNight(L.night);
    sky.setView(camera, FOG_FAR, h / 2);
    sky.fog.near = FOG_NEAR;
    sky.place(new THREE.Vector3(l.x, g, l.z));
    for (const o of hidden) o.visible = false;
    image = picture(renderer, scene, camera, w, h);
  } finally {
    for (const o of hidden) o.visible = true;
    const L = sky.apply(prev.sun, prev.moon, prev.rising);
    stream.materials.setGroundTint(L.groundTint);
    stream.setNight(L.night);
  }
  if (!image) return null;
  return { image, ...project(route, camera, w, h, (p) => stream.toScene(p), (p) => stream.groundAt(p), nearClarity) };
}

/** Far: the plain of sea and land under the card world (a grid over the ground the frame sees). */
async function seaPlain(route: Route, shot: FarShot, y: number): Promise<THREE.Mesh> {
  const tanHalf = Math.tan((FOV / 2) * D2R);
  const pitch = Math.atan((0.5 - FAR.horizonY) * 2 * tanHalf);
  const near = (shot.up / Math.tan(pitch + Math.atan(tanHalf))) * 0.7;
  const s = toLocal(shot.landing, route.points[0]);
  const far = (Math.hypot(s.x, s.z) + shot.back) * 1.4;
  const cx = -shot.dir.x * shot.back, cz = -shot.dir.z * shot.back;
  const rx = -shot.dir.z, rz = shot.dir.x;
  const NF = 120, NS = 80;
  const pos = new Float32Array((NF + 1) * (NS + 1) * 3);
  const col = new Float32Array(pos.length);
  const nor = new Float32Array(pos.length);
  const sea = new THREE.Color(PLAIN_SEA), land = new THREE.Color(PLAIN_LAND);
  const jobs: Promise<void>[] = [];
  for (let i = 0; i <= NF; i++) {
    const f = near * (far / near) ** (i / NF); // closer rows nearer the camera
    const half = Math.hypot(f, shot.up) * tanHalf * ASPECT * 1.3 + 20000;
    for (let j = 0; j <= NS; j++) {
      const side = -half + (2 * half * j) / NS;
      const x = cx + shot.dir.x * f + rx * side, z = cz + shot.dir.z * f + rz * side;
      const k = (i * (NS + 1) + j) * 3;
      pos[k] = x;
      pos[k + 1] = y;
      pos[k + 2] = z;
      nor[k + 1] = 1;
      jobs.push(
        seaAt(fromLocal(shot.landing, x, z)).then(
          (wet) => void (wet ? sea : land).toArray(col, k),
          () => void land.toArray(col, k),
        ),
      );
    }
  }
  await Promise.all(jobs);
  const index: number[] = [];
  for (let i = 0; i < NF; i++)
    for (let j = 0; j < NS; j++) {
      const a = i * (NS + 1) + j, b = a + NS + 1;
      index.push(a, a + 1, b, a + 1, b + 1, b);
    }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(index);
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, fog: true }));
  mesh.frustumCulled = false;
  return mesh;
}

/** The last card world: how many tiles it wanted, how many were drawn, and how long it took (for checks). */
export const farStats = { tiles: 0, settled: 0, failed: 0, ms: 0 };

/** Far: a card world of its own, drawn once and disposed. */
export async function farFrame(live: LiveScene, route: Route, w: number, h: number): Promise<CardFrame | null> {
  const shot = farShot(route);
  const g = live.stream.groundAt(shot.landing);
  const scene = new THREE.Scene();
  const sky = new Sky(scene, { shadow: { radius: 700, mapSize: 512, snap: 100, upM: 60, downM: 40 } });
  const L = sky.apply(shot.sun, null, false);
  const camera = farCamera(shot, g, w / h);
  // under everything, a plain of sea and land from the place-name grid (about 5 km cells): wherever a
  // map tile is not drawn in time, the coast still reads, softened by the haze, never a hole
  const plain = await seaPlain(route, shot, Math.min(0, g) - 300);
  scene.add(plain);
  const camGround = fromLocal(shot.landing, camera.position.x, camera.position.z);
  const lod = { lat: camGround.lat, lon: camGround.lon, altM: camera.position.y, headingDeg: shot.viewDeg };
  // the coarse corridor, plus the usual finer rings round the camera's ground point (shorter routes)
  const tiles = corridorTiles(route, shot);
  const keys = new Set(tiles.map(tileKey));
  for (const t of tilesFor(lod, 40)) if (!keys.has(tileKey(t))) tiles.push(t);
  const stream = new WorldStream(scene, live.pool, regionStyle, {
    haze: sky.haze,
    groundTint: L.groundTint,
    origin: shot.landing,
    fallbackGround: (p) => routeGround.peek?.(p),
    want: () => tiles,
    maxTiles: tiles.length + 4,
    fadeMs: 1,
    recentreM: 1e12,
  });
  try {
    // the stream is told it stands at the landing, so its origin (and the shot's frame) stays there
    const here = { lat: shot.landing.lat, lon: shot.landing.lon, altM: camera.position.y, headingDeg: shot.viewDeg };
    const t0 = performance.now();
    let calm = 0;
    while (performance.now() - t0 < FAR_WAIT_MS) {
      stream.update(here, performance.now());
      calm = stream.stats().ready ? calm + 1 : 0;
      if (calm >= 2) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    stream.update(here, performance.now() + 1000);
    const st = stream.stats();
    Object.assign(farStats, { tiles: tiles.length, settled: st.settled, failed: st.failed, ms: Math.round(performance.now() - t0) });
    sky.setView(camera, shot.fogFar, h / 2);
    sky.fog.near = shot.fogNear;
    sky.place(new THREE.Vector3(0, g, 0));
    const image = picture(live.renderer, scene, camera, w, h);
    if (!image) return null;
    // the trail clear by the landing, fading with the haze toward the start but never lost
    const clarity = (d: number) => 1 - 0.65 * smooth(shot.fogNear * 0.8, shot.fogFar, d);
    const out = project(route, camera, w, h, (p) => stream.toScene(p), (p) => Math.max(0, stream.groundAt(p)), clarity);
    if (out.start) out.start.a = Math.max(0.7, out.start.a);
    return { image, ...out };
  } finally {
    stream.dispose();
    sky.dispose();
    plain.geometry.dispose();
    (plain.material as THREE.Material).dispose();
  }
}
