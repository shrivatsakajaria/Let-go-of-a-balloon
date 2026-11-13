/**
 * The landing card's picture (spec 6.5): a fresh frame of the landing area at golden hour, drawn from
 * the live scene into an offscreen render target and read back, without touching the live view.
 *
 * The camera stands high behind the landing point and looks back along the route, so the trail runs
 * from the balloon toward the start and into the haze (both ends show when the route is short enough
 * for the haze; a long route's start lies beyond the horizon and the trail fades toward it).
 *
 * For the one frame the sky is set to golden hour (sun 7 degrees up, ahead and to the left),
 * the live balloon and person are hidden (the card draws its own balloon at the landing point), and
 * everything is put back before the call returns, in the same task, so no live frame ever sees it.
 *
 * The render target is marked as an XR target with an sRGB texture stored as plain RGBA8: three.js
 * then tone-maps and encodes exactly as it does for the screen (the same shader programs, no
 * recompiling) and the bytes read back are the picture as it would show. It is disposed at once.
 */
import * as THREE from 'three';
import type { Route } from '../flight/route';
import { positionAt } from '../flight/route';
import { bearingDeg, destination, haversineKm, type LatLon } from '../geo/coords';
import type { CardFrame, CardScene } from '../ui/card';
import type { LiveScene } from './scene';

/** How high above the landing ground the camera stands, m. */
const CAM_UP_M = 520;
/** The landing point sits this far down from the frame's top (the horizon lands at about 0.16). */
const LANDING_Y = 0.42;
const FOV = 36;
/** Haze for the card: clear to 6 km, gone at 30 km. */
const FOG_FAR = 30000;
const FOG_NEAR = 6000;
/**
 * The sun 7 degrees up, 40 degrees left of where the camera looks: low light across and toward the
 * camera, so slopes read by their shading and keep their sage and chalk. With the sun behind the
 * camera every slope faces it and the clay turns orange, which takes the colour from the balloon.
 */
const GOLDEN = { elevationDeg: 7, offsetDeg: -40 };
/**
 * The camera looks this far off the line of the route, so the trail runs across the picture rather
 * than straight up behind the balloon; less when the start is close enough to show through the haze,
 * so both ends are in the picture.
 */
const SKEW_DEG = 25;
const SKEW_NEAR_DEG = 11;
const NEAR_START_KM = 28;
/** The trail is sampled this often along the route. */
const TRAIL_STEP_MS = 2 * 60e3;

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

/** Where the card's camera looks (degrees from north) and where the golden-hour sun stands. */
export function cardView(route: Route): { viewDeg: number; sun: { elevationDeg: number; azimuthDeg: number } } {
  const pts = route.points;
  const near = haversineKm(pts[0], pts[pts.length - 1]) <= NEAR_START_KM;
  const viewDeg = (lookBack(route) + (near ? SKEW_NEAR_DEG : SKEW_DEG)) % 360;
  return { viewDeg, sun: { elevationDeg: GOLDEN.elevationDeg, azimuthDeg: (viewDeg + GOLDEN.offsetDeg + 360) % 360 } };
}

/** How clear the trail is at distance d through the card's haze: never quite gone until past the haze. */
const clarity = (d: number) => (1 - 0.85 * smooth(FOG_NEAR * 0.6, FOG_FAR * 0.9, d)) * (1 - smooth(FOG_FAR, FOG_FAR * 1.3, d));

export function cardScene(live: LiveScene): CardScene {
  return { cardFrame: (route, w, h) => cardFrame(live, route, w, h) };
}

export function cardFrame(live: LiveScene, route: Route, w: number, h: number): CardFrame | null {
  const { renderer, scene, stream, sky } = live;
  const last = route.points[route.points.length - 1];
  const landing: LatLon = { lat: last.lat, lon: last.lon };
  const { viewDeg: look, sun } = cardView(route);
  const g = stream.groundAt(landing);

  // the camera: behind the landing, high, pitched so the landing sits at LANDING_Y
  const tanHalf = Math.tan(((FOV / 2) * Math.PI) / 180);
  const above = Math.atan((0.5 - LANDING_Y) * 2 * tanHalf); // the landing above the frame's centre
  const depression = 9.5 * (Math.PI / 180);
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
  const target = renderer.getRenderTarget();
  const rt = new THREE.WebGLRenderTarget(w, h, { samples: 4, depthBuffer: true, colorSpace: THREE.SRGBColorSpace });
  (rt as unknown as { isXRRenderTarget: boolean }).isXRRenderTarget = true;
  rt.texture.internalFormat = 'RGBA8';
  const px = new Uint8Array(w * h * 4);
  try {
    const L = sky.apply(sun, null, false);
    stream.materials.setGroundTint(L.groundTint);
    stream.setNight(L.night);
    sky.setView(camera, FOG_FAR, h / 2);
    sky.fog.near = FOG_NEAR;
    sky.place(new THREE.Vector3(l.x, g, l.z));
    for (const o of hidden) o.visible = false;
    renderer.shadowMap.needsUpdate = true;
    renderer.setRenderTarget(rt);
    renderer.clear();
    renderer.render(scene, camera);
    renderer.readRenderTargetPixels(rt, 0, 0, w, h, px);
  } finally {
    renderer.setRenderTarget(target);
    rt.dispose();
    for (const o of hidden) o.visible = true;
    const L = sky.apply(prev.sun, prev.moon, prev.rising);
    stream.materials.setGroundTint(L.groundTint);
    stream.setNight(L.night);
    renderer.shadowMap.needsUpdate = true; // the live frame redraws its own shadows next
  }

  // the picture, right way up
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const img = ctx.createImageData(w, h);
  const row = w * 4;
  for (let y = 0; y < h; y++) img.data.set(px.subarray((h - 1 - y) * row, (h - y) * row), y * row);
  ctx.putImageData(img, 0, 0);

  // the trail along the drawn ground, projected; points behind the camera or past the haze break it
  const trail: CardFrame['trail'] = [];
  let line: CardFrame['trail'][number] = [];
  const v = new THREE.Vector3();
  const end = route.release + (route.points[route.points.length - 1].tSec ?? 0) * 1000;
  for (let t = route.release; t <= end + 1; t += TRAIL_STEP_MS) {
    const p = positionAt(route, Math.min(t, end));
    const s = stream.toScene(p);
    v.set(s.x, stream.groundAt(p) + 2, s.z);
    const d = v.distanceTo(camera.position);
    v.project(camera);
    // clear near the balloon, fading into the haze but never quite gone (the line still leads home)
    const a = clarity(d);
    const inside = v.z > -1 && v.z < 1 && Math.abs(v.x) < 1.6 && v.y > -1.6 && a > 0.02;
    if (!inside) {
      if (line.length > 1) trail.push(line);
      line = [];
      continue;
    }
    line.push({ x: ((v.x + 1) / 2) * w, y: ((1 - v.y) / 2) * h, a });
  }
  if (line.length > 1) trail.push(line);
  const s0 = stream.toScene(route.points[0]);
  v.set(s0.x, stream.groundAt(route.points[0]) + 2, s0.z);
  const d0 = v.distanceTo(camera.position);
  v.project(camera);
  const start = v.z > -1 && v.z < 1 && Math.abs(v.x) < 0.97 && v.y > -0.97 && v.y < 0.97 ? { x: ((v.x + 1) / 2) * w, y: ((1 - v.y) / 2) * h, a: clarity(d0) } : null;
  v.set(l.x, g, l.z).project(camera);
  const landingPx = v.z > -1 && v.z < 1 ? { x: ((v.x + 1) / 2) * w, y: ((1 - v.y) / 2) * h } : null;
  return { image: canvas, trail, landing: landingPx, start };
}
