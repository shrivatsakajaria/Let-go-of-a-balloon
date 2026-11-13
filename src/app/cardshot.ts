/**
 * The landing card's picture (spec 6.5): a fresh frame of the landing area at golden hour, drawn from
 * the live scene into an offscreen render target and read back, without touching the live view.
 *
 * The camera stands high behind the landing point and looks back along the route, so the trail runs
 * from the balloon toward the start and into the haze (both ends show when the route is short enough
 * for the haze; a long route's start lies beyond the horizon and the trail fades toward it).
 *
 * For the one frame the sky is set to golden hour (sun 7 degrees up, from behind the camera's right),
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
const GOLDEN = { elevationDeg: 7, offsetDeg: 140 };
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

export function cardScene(live: LiveScene): CardScene {
  return { cardFrame: (route, w, h) => cardFrame(live, route, w, h) };
}

export function cardFrame(live: LiveScene, route: Route, w: number, h: number): CardFrame | null {
  const { renderer, scene, stream, sky } = live;
  const last = route.points[route.points.length - 1];
  const landing: LatLon = { lat: last.lat, lon: last.lon };
  const look = lookBack(route);
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
  const hidden: THREE.Object3D[] = [];
  for (const o of [live.balloon.root, live.person?.root]) if (o?.visible) hidden.push(o);
  const target = renderer.getRenderTarget();
  const rt = new THREE.WebGLRenderTarget(w, h, { samples: 4, depthBuffer: true, colorSpace: THREE.SRGBColorSpace });
  (rt as unknown as { isXRRenderTarget: boolean }).isXRRenderTarget = true;
  rt.texture.internalFormat = 'RGBA8';
  const px = new Uint8Array(w * h * 4);
  try {
    const L = sky.apply({ elevationDeg: GOLDEN.elevationDeg, azimuthDeg: (look + 180 + GOLDEN.offsetDeg) % 360 }, null, false);
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
    const a = 1 - smooth(FOG_NEAR * 0.5, FOG_FAR * 0.85, d);
    const inside = v.z > -1 && v.z < 1 && Math.abs(v.x) < 1.6 && v.y > -1.6 && a > 0.02;
    if (!inside) {
      if (line.length > 1) trail.push(line);
      line = [];
      continue;
    }
    line.push({ x: ((v.x + 1) / 2) * w, y: ((1 - v.y) / 2) * h, a });
  }
  if (line.length > 1) trail.push(line);
  v.set(l.x, g, l.z).project(camera);
  const landingPx = v.z > -1 && v.z < 1 ? { x: ((v.x + 1) / 2) * w, y: ((1 - v.y) / 2) * h } : null;
  return { image: canvas, trail, landing: landingPx };
}
