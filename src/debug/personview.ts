/**
 * Person check (personview.html): the person and the balloon alone on flat Contour ground under a
 * fixed sun, posed at a chosen moment of the launch. A dev page for the character and the release,
 * not the product: the dev server serves it, and a build includes it only with the other proof pages
 * (preview branches, DEBUG_PAGES=1; vite.config.ts), never on the live site.
 *
 * Query:
 *   t=s                 seconds after the tap (the hand opens at 1.2 s); negative: the start screen's idle
 *   light=golden|day    the sun (default day)
 *   cam=bearing,dist,h  the camera: degrees round from the person's front (90: their left side as
 *                       seen by them... i.e. the camera on their right), metres away, metres up
 *   aim=body|hand|knot|head   what the camera looks at (default body)
 *   target=x,y,z        or a fixed point (the camera then stands round it, like hand and knot)
 *   fov=deg             vertical field of view (default 35)
 *   at=lat,lon          the start place (it picks the outfit)
 *   outfit=n            or this outfit (0 to 3)
 *   reduced=1           reduced motion
 *   clean=1             no caption
 *
 * window.__pv: { ready, triangles, calls, seek(t) } (seek steps the scene at 60 Hz to t and draws it).
 */
import * as THREE from 'three';
import { createRenderer } from '../world/render';
import { Sky } from '../world/sky';
import { ContourMaterials, noCoverage } from '../world/materials';
import { CONTOUR } from '../world/palette';
import { linearColour } from '../landmarks/kit';
import { Person } from '../balloon/person';
import { Balloon } from '../balloon/balloon';
import { CLIMB_RATE_MS } from '../config';
import type { RoutePoint } from '../flight/route';

const D2R = Math.PI / 180;
const q = new URLSearchParams(location.search);
const num = (k: string, d: number) => {
  const v = q.get(k);
  const n = v === null || v === '' ? NaN : Number(v);
  return Number.isFinite(n) ? n : d;
};
if (q.get('clean') === '1') document.body.classList.add('clean');
const caption = document.getElementById('caption') as HTMLElement;

const LIGHTS: Record<string, [number, number]> = { golden: [7, 250], day: [42, 200] };
const [el, az] = LIGHTS[q.get('light') ?? 'day'] ?? LIGHTS.day;
const [lat, lon] = (q.get('at') ?? '48.8584,2.2945').split(',').map(Number);
const reduced = q.get('reduced') === '1';

const canvas = document.getElementById('scene') as HTMLCanvasElement;
const renderer = createRenderer(canvas);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(num('fov', 35), 1, 0.05, 30000);
const sky = new Sky(scene, { shadow: { radius: 12, mapSize: 2048, snap: 1, upM: 20, downM: 10 } });
const L = sky.apply({ elevationDeg: el, azimuthDeg: az });
const materials = new ContourMaterials(sky.haze, noCoverage(), { groundTint: L.groundTint });
const plane = new THREE.PlaneGeometry(4000, 4000).rotateX(-Math.PI / 2);
const sage = linearColour(CONTOUR.land[1]);
plane.setAttribute('color', new THREE.BufferAttribute(new Float32Array(plane.getAttribute('position').count * 3).map((_, i) => sage[i % 3]), 3));
const ground = new THREE.Mesh(plane, materials.solid.ground);
ground.receiveShadow = true;
scene.add(ground);

const facing = 0; // the person faces north (-z)
const person = new Person(scene, { lat, lon }, facing, { x: 0, y: 0, z: 0 }, { reducedMotion: reduced, wind: { speedMs: 4, headingDeg: 200 }, outfit: q.has('outfit') ? num('outfit', 0) : undefined });
const balloon = new Balloon(scene, { reducedMotion: reduced });
balloon.hold(person.hand, person);

const DT = 1 / 60;
let now = -2.5; // the idle start screen runs a little first
let played = false;
let releasedAt = Number.NaN;
let releaseY = 0;
const pt: RoutePoint = { tSec: 0, lat, lon, altM: Number.NaN, groundM: Number.NaN, speedMs: 4, headingDeg: 200 };
const pos = new THREE.Vector3();

function step(): void {
  if (!played && now >= 0) {
    played = true;
    person.play(() => {
      releasedAt = now;
      releaseY = balloon.mesh.position.y;
      balloon.release();
    });
  }
  person.update(DT);
  now += DT;
  if (Number.isFinite(releasedAt)) {
    // a stand-in route: from where the hand let go, climbing and drifting with a light wind
    const s = now - releasedAt;
    const h = pt.headingDeg * D2R;
    pos.set(Math.sin(h) * pt.speedMs * s, releaseY + CLIMB_RATE_MS * s, -Math.cos(h) * pt.speedMs * s);
    pt.altM = pos.y;
    pt.groundM = 0;
  } else pos.set(0, 1.5, 0);
  balloon.setState(pt, DT, L, { pos, camera: camera.position });
  person.lookAt(balloon.mesh.position);
}

const [cb, cd, ch] = (q.get('cam') ?? '').split(',').map(Number);
const target = new THREE.Vector3();
function aim(): void {
  const a = q.get('aim') ?? 'body';
  const fixed = (q.get('target') ?? '').split(',').map(Number);
  if (fixed.length === 3 && fixed.every(Number.isFinite)) target.set(fixed[0], fixed[1], fixed[2]);
  else if (a === 'hand') target.copy(person.hand);
  else if (a === 'knot') balloon.stringPoint(0, target).add(new THREE.Vector3(0, 0.04, 0));
  else if (a === 'head') target.set(0, 1.5, 0);
  else target.set(0, 0.95, 0);
  const b = (Number.isFinite(cb) ? cb : 35) * D2R;
  const d = Number.isFinite(cd) ? cd : 3.2;
  const hgt = Number.isFinite(ch) ? ch : 1.2;
  // bearing 0: in front of the person (they face -z), going round clockwise seen from above
  const near = a === 'knot' || a === 'hand' || q.has('target');
  const base = near ? target : new THREE.Vector3(0, 0, 0);
  camera.position.set(base.x + Math.sin(b) * d, (near ? target.y : 0) + hgt, base.z - Math.cos(b) * d);
  camera.lookAt(target);
}

function draw(): void {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / Math.max(1, h);
  camera.updateProjectionMatrix();
  aim();
  camera.updateMatrixWorld();
  sky.setView(camera, 3000, renderer.getDrawingBufferSize(new THREE.Vector2()).y / 2);
  sky.place(target);
  renderer.shadowMap.needsUpdate = true;
  renderer.render(scene, camera);
}

let tris = 0;
person.root.traverse((o) => {
  if (o instanceof THREE.Mesh) {
    const g = o.geometry as THREE.BufferGeometry;
    tris += (g.index ? g.index.count : g.getAttribute('position').count) / 3;
  }
});
let calls = 0;
person.root.traverse((o) => {
  if (o instanceof THREE.Mesh) calls++;
});
const hook = {
  ready: false,
  triangles: Math.round(tris),
  calls,
  seek(t: number): void {
    while (now < t - 1e-9) step();
    draw();
  },
};
(window as unknown as { __pv: typeof hook }).__pv = hook;
hook.seek(num('t', -0.01));
caption.textContent = `t ${now.toFixed(2)} s · ${hook.triangles} triangles · ${calls} meshes`;
hook.ready = true;
