/**
 * Landmark check (lmview.html): one landmark model alone on flat Contour ground, under a fixed sun
 * (golden hour by default, or dusk with its dials and lights lit), drawn by the real LandmarkLayer
 * with the shared Contour materials. A dev page for the people making models, not the product: the
 * dev server serves it, and a build includes it only with the other proof pages (preview branches,
 * DEBUG_PAGES=1; vite.config.ts), never on the live site.
 *
 * Query:
 *   id=<site id>        the landmark (default the first site; an unknown id lists them all)
 *   light=golden|dusk|day|night   the sun (default golden: 8 deg up, from the west-south-west)
 *   el=deg az=deg       the sun's elevation and compass bearing, overriding `light`
 *   cam=bearing,dist,h  the camera: compass bearing from the landmark, metres away, metres up
 *                       (default in front of it and a little to its right, by its size)
 *   look=h              aim this many metres above the landmark's ground (default a third of its height)
 *   fov=deg             vertical field of view (default 40)
 *   utc=ms|ISO          the time animate is given (clock hands; default 2026-06-21 19:10 UTC)
 *   clean=1             no caption
 *
 * window.__lm reports { ready, id, triangles, frames }.
 */
import * as THREE from 'three';
import { createRenderer } from '../world/render';
import { Sky } from '../world/sky';
import { ContourMaterials, noCoverage } from '../world/materials';
import { CONTOUR } from '../world/palette';
import { LandmarkLayer } from '../landmarks/layer';
import { SITES } from '../landmarks/registry';
import { countTriangles, linearColour } from '../landmarks/kit';
import type { LatLon } from '../geo/coords';

const D2R = Math.PI / 180;
const q = new URLSearchParams(location.search);
const num = (k: string, d: number) => {
  const v = q.get(k);
  const n = v === null || v === '' ? NaN : Number(v);
  return Number.isFinite(n) ? n : d;
};
if (q.get('clean') === '1') document.body.classList.add('clean');
const caption = document.getElementById('caption') as HTMLElement;

const asked = q.get('id');
const site = SITES.find((s) => s.id === asked) ?? SITES[0];
const hook = { ready: false, id: site.id, triangles: 0, frames: 0 };
(window as unknown as { __lm: typeof hook }).__lm = hook;

const LIGHTS: Record<string, [number, number]> = { golden: [8, 250], dusk: [-3, 290], day: [40, 200], night: [-14, 300] };
const [el0, az0] = LIGHTS[q.get('light') ?? 'golden'] ?? LIGHTS.golden;
const utcQ = q.get('utc');
const utc = utcQ ? (Number.isFinite(Number(utcQ)) ? Number(utcQ) : Date.parse(utcQ)) : Date.UTC(2026, 5, 21, 19, 10);

const canvas = document.getElementById('scene') as HTMLCanvasElement;
const renderer = createRenderer(canvas);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(num('fov', 40), 1, 1, 30000);
const sky = new Sky(scene, { shadow: { radius: Math.max(150, site.footprintRadiusM * 1.6), mapSize: 2048, snap: 50, upM: 200, downM: 80 } });
const L = sky.apply({ elevationDeg: num('el', el0), azimuthDeg: num('az', az0) });
const materials = new ContourMaterials(sky.haze, noCoverage(), { groundTint: L.groundTint });

// flat ground in the Contour sage
const plane = new THREE.PlaneGeometry(8000, 8000).rotateX(-Math.PI / 2);
const sage = linearColour(CONTOUR.land[1]);
plane.setAttribute('color', new THREE.BufferAttribute(new Float32Array(plane.getAttribute('position').count * 3).map((_, i) => sage[i % 3]), 3));
const ground = new THREE.Mesh(plane, materials.solid.ground);
ground.receiveShadow = true;
scene.add(ground);

// the landmark's own frame: the site at the scene's origin, flat ground at 0
const cos = Math.cos(site.at.lat * D2R);
const toScene = (p: LatLon, out = { x: 0, z: 0 }) => {
  out.x = (p.lon - site.at.lon) * 111320 * cos;
  out.z = -(p.lat - site.at.lat) * 111320;
  return out;
};
const layer = new LandmarkLayer({ scene, toScene, groundAt: () => 0, materials }, { sites: [site], fadeMs: 1 });

const r = site.footprintRadiusM;
const [cb, cd, ch] = (q.get('cam') ?? '').split(',').map(Number);
const bearing = (Number.isFinite(cb) ? cb : site.headingDeg + 25) * D2R;
const dist = Number.isFinite(cd) ? cd : Math.max(70, r * 2.6);
const height = Number.isFinite(ch) ? ch : dist * 0.3;
camera.position.set(Math.sin(bearing) * dist, height, -Math.cos(bearing) * dist);

const say = (top: number) => {
  const known = asked === null || asked === site.id ? '' : ` (no landmark "${asked}"; ids: ${SITES.map((s) => s.id).join(', ')})`;
  caption.textContent = `${site.name} · ${site.id} · ${hook.triangles} triangles · ${top.toFixed(1)} m${known}`;
};

const focus = new THREE.Vector3();
let shown = 0;
function frame(): void {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / Math.max(1, h);
  layer.update(site.at, utc, L);
  const g = layer.groupOf(site.id);
  let top = 30;
  if (g) top = new THREE.Box3().setFromObject(g).max.y;
  camera.lookAt(0, num('look', top / 3), 0);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  sky.setView(camera, 20000, renderer.getDrawingBufferSize(new THREE.Vector2()).y / 2);
  if (sky.place(focus) || shown < 5) renderer.shadowMap.needsUpdate = true;
  renderer.render(scene, camera);
  hook.frames++;
  if (g && g.visible) {
    if (!shown) {
      hook.triangles = countTriangles(g);
      say(top);
    }
    shown++;
    hook.ready = shown > 6;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
