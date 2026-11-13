/**
 * Streaming world check: a camera flies a straight line over the real map at a fixed height above
 * the ground, and the world streams around it (WorldStream, lod.ts) in the Contour look, under the
 * sky of a real time (Sky) or the tile proof's golden hour, with drifting clouds (Clouds). A check
 * page, not the product.
 *
 * Query:
 *   from=lat,lon   start (default Albert Square, Manchester)
 *   alt=metres     height above the ground (default 1500)
 *   speed=m/s      ground speed (default 15; 0 holds still)
 *   heading=deg    compass heading of the flight and the view (default 78, toward the North Sea)
 *   pitch=deg      view pitch, negative looks down (default by height: the ride camera's look)
 *   fov=deg        vertical field of view (default 50, the ride camera's)
 *   shadow=metres  radius of the shadowed ground (default by height)
 *   stop=km        stop after flying this far (default: never)
 *   fps=1          numbers panel: frame rate, draw calls and triangles with and without the shadow pass
 *   clean=1        no caption
 *   utc=time       the real sun and moon at this time (ISO or ms; the clock then runs on in real
 *                  time); default the tile proof's fixed golden hour
 *   wind=u,v       wind at cruise for the clouds, m/s east and north (default 4,2)
 *   clouds=0       no clouds
 *
 * window.__world reports progress and renderer numbers for screenshots.
 */
import * as THREE from 'three';
import { destination, type LatLon } from '../geo/coords';
import { regionStyle } from '../world/palette';
import { WorkerPool } from '../world/workerpool';
import type { BuildReply, BuildRequest } from '../world/worker';
import { createRenderer } from '../world/render';
import { Sky } from '../world/sky';
import { Clouds } from '../world/clouds';
import { WorldStream } from '../world/stream';
import { hazeFarM } from '../world/lod';
import { StatsOverlay } from './overlay';

// ---- parameters ----

const params = new URLSearchParams(location.search);
const num = (k: string, d: number) => {
  const v = params.get(k);
  const n = v === null || v === '' ? NaN : Number(v);
  return Number.isFinite(n) ? n : d;
};
const parseFrom = (): LatLon => {
  const [lat, lon] = (params.get('from') ?? '').split(',').map(Number);
  return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 85 ? { lat, lon } : { lat: 53.4794, lon: -2.2453 };
};
const FROM = parseFrom();
const ALT = Math.max(2, num('alt', 1500));
const SPEED = Math.max(0, num('speed', 15));
const HEADING = num('heading', 78);
/** The ride camera looks a little down at cruise; near the ground it looks almost level. */
const PITCH = num('pitch', ALT < 100 ? -3 : ALT < 800 ? -9 : -8);
const FOV = Math.min(90, Math.max(20, num('fov', 50)));
const STOP_M = params.has('stop') ? Math.max(0, num('stop', 0) * 1000) : Infinity;
if (params.get('clean') === '1') document.documentElement.classList.add('clean');
const UTC = (() => {
  const v = params.get('utc');
  if (!v) return null;
  const t = /^-?\d+$/.test(v) ? Number(v) : Date.parse(v);
  return Number.isFinite(t) ? t : null;
})();
const WIND = (() => {
  const [u, v] = (params.get('wind') ?? '4,2').split(',').map(Number);
  return { u: Number.isFinite(u) ? u : 4, v: Number.isFinite(v) ? v : 2 };
})();
const CLOUDS = params.get('clouds') !== '0';

// ---- the look: a real time's sky, or the tile proof's golden hour ----

const SUN_ELEVATION = 8;
const SUN_AZIMUTH = 250;

const canvas = document.getElementById('scene') as HTMLCanvasElement;
const statusEl = document.getElementById('status') as HTMLElement;
const renderer = createRenderer(canvas);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(FOV, 1, 1, 30000);

/**
 * Shadows on a disc of ground just ahead of the camera, moved in 100 m steps: 700 m radius at
 * street level (buildings close the view), 900 m at a few hundred metres, 600 m at cruise (only
 * full-detail tiles within 1.5 km cast them, and the ride camera looks past them).
 */
function shadowRadius(aboveGroundM: number): number {
  const a = aboveGroundM;
  const r = a <= 100 ? 700 : a <= 450 ? 700 + ((a - 100) / 350) * 200 : 900 - ((a - 450) / 1050) * 300;
  return Math.round(Math.min(900, Math.max(600, r)));
}
const SHADOW_R = params.has('shadow') ? Math.max(100, num('shadow', 800)) : shadowRadius(ALT);
const sky = new Sky(scene, { shadow: { radius: SHADOW_R, mapSize: 2048, snap: 100, upM: 60, downM: 40 } });
const haze = sky.haze;
let L = UTC !== null ? sky.update(UTC, FROM) : sky.apply({ elevationDeg: SUN_ELEVATION, azimuthDeg: SUN_AZIMUTH });
const t0 = performance.now();
let skyAt = -Infinity;

const pool = new WorkerPool<BuildRequest, BuildReply>(
  () => new Worker(new URL('../world/worker.ts', import.meta.url), { type: 'module' }),
  Math.min(4, Math.max(1, (navigator.hardwareConcurrency || 2) - 1)),
  { timeoutMs: 20000 },
);
const stream = new WorldStream(scene, pool, regionStyle, { haze, groundTint: L.groundTint, origin: FROM });
stream.setNight(L.night);

const clouds = CLOUDS
  ? new Clouds(scene, { haze, seed: 11, groundAt: (x, z) => stream.groundAt(stream.fromScene(x, z)) })
  : null;
stream.onRecentre = (e) => clouds?.shift(e.dx, e.dz);

let shadowAsked = 0;
stream.onChange = () => {
  shadowAsked = performance.now();
};

// ---- flight ----

const hook = {
  frames: 0, flownM: 0, groundM: 0, cameraY: 0,
  calls: 0, triangles: 0, plain: { calls: 0, triangles: 0 }, shadow: { calls: 0, triangles: 0 },
  geometries: 0, textures: 0,
  alive: 0, loading: 0, settled: 0, wanted: 0, built: 0, failed: 0, cancelled: 0, recentres: 0, ready: false, stopped: false,
  sunEl: 0, night: 0, clouds: 0, boats: 0, lamps: 0, cloudsNear: [] as number[][], boatsNear: [] as number[][],
  tileTriangles: 0, arriveMsMax: 0, byZoom: {} as Record<number, number>,
  /** Set to redraw the shadow map on the next frame (to read the shadow pass's numbers). */
  redrawShadows: false,
  /** Triangles in view by zoom and bucket (frustum test on each mesh's bounds, like the renderer's). */
  drawn: {} as Record<string, number>,
  /** The same for the shadow pass. */
  casters: {} as Record<string, number>,
  /** Triangles of every live tile by zoom and bucket (in view or not). */
  aliveTris: {} as Record<string, number>,
};
(window as unknown as { __world: typeof hook }).__world = hook;
const overlay = params.get('fps') === '1' ? new StatsOverlay() : null;

let flown = 0;
let groundS = NaN;
let lastNow = performance.now();
let shadowDrawnAt = -Infinity;
const pos = { x: 0, z: 0 };
const look = new THREE.Vector3();
const focus = new THREE.Vector3();
const D2R = Math.PI / 180;

function resize() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (renderer.domElement.width === Math.round(w * renderer.getPixelRatio()) && renderer.domElement.height === Math.round(h * renderer.getPixelRatio())) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / Math.max(1, h);
  camera.updateProjectionMatrix();
}

const drawSize = new THREE.Vector2();
const lookDir = new THREE.Vector3();
const boatM = new THREE.Matrix4();
const boatP = new THREE.Vector3();
const frustum = new THREE.Frustum();
const projView = new THREE.Matrix4();
const BUCKET_NAMES = ['ground', 'water', 'waterways', 'roads', 'buildings', 'roofs', 'trees', 'boats', 'lamps', 'clouds'];
function drawnByZoom(cam: THREE.Camera = camera, casters = false, all = false): Record<string, number> {
  cam.updateMatrixWorld();
  projView.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
  frustum.setFromProjectionMatrix(projView);
  const out: Record<string, number> = {};
  for (const t of stream.tiles()) {
    const g = stream.groupOf(t.key);
    if (!g || !g.visible) continue;
    const z = t.key.split('/')[0];
    for (const m of g.children as THREE.Mesh[]) {
      if (casters ? !m.castShadow : !m.layers.isEnabled(0)) continue;
      if (!m.visible) continue;
      if ((m as unknown as THREE.Points).isPoints) {
        const k = `z${z}.lamps`;
        out[k] = (out[k] ?? 0) + m.geometry.getAttribute('position').count;
        continue;
      }
      if (!all && !m.intersectsFrustum(frustum)) continue;
      const name = (Array.isArray(m.material) ? m.material[0] : m.material).name.split('-')[1] ?? '?';
      const per = Math.min(m.geometry.drawRange.count, m.geometry.getAttribute('position').count) / 3;
      const n = (m as THREE.InstancedMesh).isInstancedMesh ? per * (m as THREE.InstancedMesh).count : per;
      const k = `z${z}.${BUCKET_NAMES.includes(name) ? name : '?'}`;
      out[k] = (out[k] ?? 0) + Math.round(n);
      out[`z${z}`] = (out[`z${z}`] ?? 0) + Math.round(n);
    }
  }
  return out;
}

function showStatus(text: string) {
  statusEl.textContent = text;
  statusEl.hidden = !text;
}

function frame(now: number) {
  const dt = Math.min(0.25, Math.max(0, (now - lastNow) / 1000));
  lastNow = now;
  resize();

  flown = Math.min(STOP_M, flown + SPEED * dt);
  const p = destination(FROM, HEADING, flown / 1000);

  // Height: above the ground under the camera, and above any roof right there, eased so a tile
  // arriving with better ground does not jolt the camera.
  const ground = Math.max(stream.groundAt(p), stream.buildingTopAt(p, 12) - ALT + 4);
  groundS = Number.isNaN(groundS) ? ground : groundS + (ground - groundS) * (1 - Math.exp(-dt / 0.8));
  const y = groundS + ALT;

  stream.update({ lat: p.lat, lon: p.lon, altM: y, headingDeg: HEADING }, now);

  stream.toScene(p, pos);
  camera.position.set(pos.x, y, pos.z);
  const h = HEADING * D2R, pt = PITCH * D2R;
  look.set(Math.sin(h) * Math.cos(pt), Math.sin(pt), -Math.cos(h) * Math.cos(pt)).add(camera.position);
  camera.lookAt(look);

  // The sky of the moment (the clock runs on from ?utc= in real time), here.
  if (UTC !== null && now - skyAt > 1000) {
    skyAt = now;
    L = sky.update(UTC + (now - t0), p);
    stream.materials.setGroundTint(L.groundTint);
    stream.setNight(L.night);
  }

  // Haze: the land runs to the horizon and fades into the sky colour (spec 7), from 20% of the
  // far distance.
  const far = hazeFarM(y);
  camera.near = Math.max(0.5, Math.min(20, ALT * 0.02));
  camera.far = far * 1.25;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  sky.setView(camera, far * 0.75, renderer.getDrawingBufferSize(drawSize).y / 2);

  // Clouds drift with the wind around the camera, and never take it in.
  if (clouds) {
    clouds.setFocus(camera.position, camera.getWorldDirection(lookDir));
    clouds.clearOf(camera.position, 300);
    clouds.update(dt, WIND);
  }

  // Live shadows just ahead of the camera (where the balloon's shadow falls in the product).
  const ahead = Math.min(900, ALT * 0.6);
  focus.set(pos.x + Math.sin(h) * ahead, groundS, pos.z - Math.cos(h) * ahead);
  let redraw = sky.place(focus);
  // tiles arrived or settled: redraw the shadows, at most four times a second
  if (shadowAsked > shadowDrawnAt && now - shadowDrawnAt > 250) redraw = true;
  if (hook.redrawShadows) {
    hook.redrawShadows = false;
    redraw = true;
  }
  if (redraw) {
    renderer.shadowMap.needsUpdate = true;
    shadowDrawnAt = now;
  }

  renderer.render(scene, camera);
  const info = renderer.info.render;
  if (redraw) hook.shadow = { calls: info.calls, triangles: info.triangles };
  else hook.plain = { calls: info.calls, triangles: info.triangles };
  if (hook.frames === 0) canvas.classList.add('on');

  const s = stream.stats();
  hook.frames++;
  hook.flownM = flown;
  hook.groundM = groundS;
  hook.cameraY = y;
  hook.calls = info.calls;
  hook.triangles = info.triangles;
  hook.geometries = renderer.info.memory.geometries;
  hook.textures = renderer.info.memory.textures;
  hook.alive = s.alive;
  hook.loading = s.loading;
  hook.settled = s.settled;
  hook.wanted = s.wanted;
  hook.built = s.built;
  hook.failed = s.failed;
  hook.cancelled = s.cancelled;
  hook.recentres = s.recentres;
  hook.ready = s.ready;
  hook.stopped = flown >= STOP_M || SPEED === 0;
  hook.tileTriangles = s.triangles;
  hook.arriveMsMax = s.arriveMsMax;
  hook.sunEl = sky.sun.elevationDeg;
  hook.night = L.night;
  hook.clouds = clouds ? clouds.list().length : 0;
  if (clouds && hook.frames % 30 === 1)
    hook.cloudsNear = clouds.list().map((c) => [Math.round(c.x - camera.position.x), Math.round(c.cy - camera.position.y), Math.round(c.z - camera.position.z), Math.round(c.rx), +c.scale.toFixed(2)]);
  if (hook.frames % 30 === 1) {
    const byZoom: Record<number, number> = {};
    for (const t of stream.tiles()) {
      const z = Number(t.key.split('/')[0]);
      byZoom[z] = (byZoom[z] ?? 0) + 1;
    }
    hook.byZoom = byZoom;
    hook.drawn = drawnByZoom();
    hook.casters = drawnByZoom(sky.light.sun.shadow.camera, true);
    hook.aliveTris = drawnByZoom(camera, false, true);
    let boats = 0, lamps = 0;
    const boatsNear: number[][] = [];
    for (const t of stream.tiles()) {
      stream.groupOf(t.key)?.traverse((o) => {
        if ((o as THREE.InstancedMesh).isInstancedMesh && ((o as THREE.Mesh).material as THREE.Material).name.includes('boats')) {
          const im = o as THREE.InstancedMesh;
          boats += im.count;
          for (let i = 0; i < im.count; i++) {
            im.getMatrixAt(i, boatM);
            boatP.setFromMatrixPosition(boatM).applyMatrix4(im.matrixWorld).sub(camera.position);
            boatsNear.push([Math.round(boatP.x), Math.round(boatP.y), Math.round(boatP.z), t.visible ? 1 : 0, Number(t.key.split('/')[0])]);
          }
        }
        if ((o as THREE.Points).isPoints) lamps += (o as THREE.Points).geometry.getAttribute('position').count;
      });
    }
    hook.boats = boats;
    hook.boatsNear = boatsNear;
    hook.lamps = lamps;
  }
  if (s.built === 0 && s.failed >= 6) showStatus('The map did not load. Check the connection and reload the page.');
  else if (s.built > 0) showStatus('');

  overlay?.frame(renderer, redraw, {
    tiles: `${s.alive} (${s.loading} loading)`,
    alt: `${Math.round(y)} m`,
    flown: `${(flown / 1000).toFixed(2)} km`,
  });
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

addEventListener('pagehide', () => {
  stream.dispose();
  pool.terminate();
});
