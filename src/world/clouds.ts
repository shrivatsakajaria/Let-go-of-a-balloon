/**
 * Fair-weather clouds (spec 6.7: long sea crossings stay alive): 8 to 14 soft, faceted cumulus in a
 * band 600 to 1,200 m above the ground, below the balloon's cruise, drifting with the wind and
 * recycled around the focus (the balloon) as it moves: a cloud that falls behind comes back ahead,
 * out in the haze, growing in.
 *
 * - One instanced draw (about 450 triangles a cloud), lit like the world, fading into the haze.
 * - Shadows: not shadow-map casters. Each cloud's shadow is a soft disc projected along the sun onto
 *   whatever is below, in the world materials' shader (haze.ts CLOUD_SHADE_GLSL), through the
 *   shared haze uniforms. A lower sun puts it further from its cloud (it stays a round, soft disc on
 *   level ground); it fades out below about 4 deg of sun and at night. Nothing above the cloud is
 *   shaded, and fragments out in the full haze skip the work.
 * - The camera is never inside a cloud (spec 8): clearOf(p, r) each frame keeps a sphere free. A
 *   cloud that comes within r shrinks away and returns elsewhere; one that holds p itself goes at
 *   once. New clouds never appear in a kept sphere.
 */
import * as THREE from 'three';
import { HAZE_GLSL, CLOUD_MAX, type HazeUniforms } from './haze';

/** Heights above the ground the whole cloud stays within, metres. */
export const CLOUD_BAND = { base: 600, top: 1200 };
export const CLOUD_MIN = 8;

export type Cloud = {
  x: number;
  /** Height of the cloud's middle (absolute). */
  cy: number;
  z: number;
  /** Half extents, metres (before `scale`). */
  rx: number;
  ry: number;
  rz: number;
  /** Turn about the vertical, radians. */
  rot: number;
  /** 0..1: grows in when born, shrinks when it leaves. */
  scale: number;
  leaving: boolean;
  /** Seconds to shrink away when leaving. */
  shrinkS: number;
  /** Ground height under the cloud (re-read about once a second as it drifts). */
  ground: number;
  /** Seconds until the ground is read again. */
  groundIn: number;
};

export type CloudOptions = {
  /** Shared haze uniforms: the clouds' haze and where their shadows go. */
  haze: HazeUniforms;
  count?: number;
  seed?: number;
  /** Ground height (absolute) under a scene point; default sea level. */
  groundAt?: (x: number, z: number) => number;
  /** Clouds live within this distance of the focus (default 14 km: the ride camera sees 2 to 20 km ahead). */
  radiusM?: number;
};

const GROW_S = 6;
const SHRINK_S = 1.2;
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * One cumulus: a big middle puff with smaller ones round it and a smaller one on top, faceted, flat
 * underneath, fitted to [-1, 1] on each axis.
 */
export function cloudGeometry(seed = 3): THREE.BufferGeometry {
  let s = seed >>> 0 || 1;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const pos: number[] = [];
  // [x, y, z, radius] of each puff, then a little jitter
  const puffs = [
    [0, 0.12, 0, 0.55], [-0.55, 0, 0.1, 0.4], [0.55, 0, -0.08, 0.42], [0.15, 0.42, 0.05, 0.36],
    [-0.25, 0.05, -0.32, 0.33], [0.3, 0.02, 0.33, 0.32], [-0.95, -0.05, -0.05, 0.25], [0.95, -0.06, 0.06, 0.24],
  ];
  for (const [x, y, z, r0] of puffs) {
    const r = r0 * (0.9 + 0.2 * rnd());
    const g = new THREE.IcosahedronGeometry(r, 1);
    g.translate(x + (rnd() - 0.5) * 0.08, y + r * 0.2, z + (rnd() - 0.5) * 0.08);
    const p = g.getAttribute('position');
    for (let k = 0; k < p.count; k++) pos.push(p.getX(k), Math.max(-0.08, p.getY(k)), p.getZ(k));
    g.dispose();
  }
  const arr = Float32Array.from(pos);
  const box = new THREE.Box3().setFromArray(arr);
  const c = box.getCenter(new THREE.Vector3()), h = box.getSize(new THREE.Vector3()).multiplyScalar(0.5);
  for (let k = 0; k < arr.length; k += 3) {
    arr[k] = (arr[k] - c.x) / h.x;
    arr[k + 1] = (arr[k + 1] - c.y) / h.y;
    arr[k + 2] = (arr[k + 2] - c.z) / h.z;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  geo.computeVertexNormals();
  return geo;
}

/**
 * Soft white, lit like the world: a little warm light of its own (so the shade side stays a pale
 * blue-grey, never lilac), facets toward the silhouette fading out (a soft edge), and the haze.
 */
function cloudMaterial(haze: HazeUniforms): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1, metalness: 0, flatShading: true, emissive: '#fff4e6', emissiveIntensity: 0.22, transparent: true });
  m.name = 'contour-clouds';
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, haze);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWP;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        vWP = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vWP;\n${HAZE_GLSL}`)
      .replace('#include <fog_fragment>', `
        #ifdef USE_FOG
          float far = smoothstep(fogNear, fogFar, vFogDepth);
        #else
          float far = 0.0;
        #endif
        gl_FragColor.rgb = mix(gl_FragColor.rgb, hazeCol(normalize(vWP - cameraPosition)), far);
        float facing = abs(dot(normal, normalize(vViewPosition)));
        gl_FragColor.a *= smoothstep(0.05, 0.4, facing);`);
  };
  m.customProgramCacheKey = () => 'contour-clouds';
  return m;
}

export class Clouds {
  readonly mesh: THREE.InstancedMesh;
  readonly radiusM: number;
  private readonly haze: HazeUniforms;
  private readonly groundAt: (x: number, z: number) => number;
  private readonly items: Cloud[] = [];
  private readonly focus = new THREE.Vector3();
  private readonly focusVel = new THREE.Vector2();
  private focusSet = false;
  /** Where the camera looks (xz, unit), when known: most clouds gather in that half. */
  private readonly look = new THREE.Vector2();
  private hasLook = false;
  /** Placed for the first focus and look yet. */
  private placed = false;
  /**
   * Spheres to keep free: this frame's, and the last frame's for new clouds. Pooled: the two arrays
   * swap each update and their vectors are reused (no garbage per frame).
   */
  private keep: THREE.Vector4[] = [];
  private keepN = 0;
  private kept: THREE.Vector4[] = [];
  private keptN = 0;
  private seed: number;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();

  constructor(scene: THREE.Scene, opts: CloudOptions) {
    this.haze = opts.haze;
    this.groundAt = opts.groundAt ?? (() => 0);
    this.radiusM = opts.radiusM ?? 14000;
    this.seed = (opts.seed ?? 1) >>> 0 || 1;
    const n = Math.min(CLOUD_MAX, Math.max(CLOUD_MIN, Math.round(opts.count ?? 11)));
    for (let i = 0; i < n; i++) {
      const c: Cloud = { x: 0, cy: 0, z: 0, rx: 0, ry: 0, rz: 0, rot: 0, scale: 1, leaving: false, shrinkS: SHRINK_S, ground: 0, groundIn: (i % 10) * 0.1 };
      this.spawn(c, null);
      this.items.push(c);
    }
    this.mesh = new THREE.InstancedMesh(cloudGeometry(5), cloudMaterial(opts.haze), n);
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.frustumCulled = false; // they move every frame; 14 instances are cheap to draw
    this.mesh.name = 'clouds';
    this.write();
    scene.add(this.mesh);
  }

  /** The clouds now (for checks). */
  list(): readonly Cloud[] {
    return this.items;
  }

  /**
   * The point the clouds gather around (the balloon), scene metres, and optionally where the
   * camera looks: then most clouds sit in a wide wedge ahead of it, where a narrow phone view
   * can see them, and the ones left far behind drift out and return ahead.
   */
  setFocus(p: THREE.Vector3, look?: THREE.Vector3): void {
    if (this.focusSet) this.focusVel.set(p.x - this.focus.x, p.z - this.focus.z);
    this.focus.copy(p);
    this.focusSet = true;
    if (look && Math.hypot(look.x, look.z) > 1e-6) {
      this.look.set(look.x, look.z).normalize();
      this.hasLook = true;
    }
  }

  /** Keep a sphere free of cloud (the balloon, the camera): call every frame. */
  clearOf(p: THREE.Vector3, radius: number): void {
    if (this.keepN === this.keep.length) this.keep.push(new THREE.Vector4());
    this.keep[this.keepN++].set(p.x, p.y, p.z, radius);
  }

  /** The floating origin moved: (dx, dz) is the new origin in the old frame. */
  shift(dx: number, dz: number): void {
    for (const c of this.items) {
      c.x -= dx;
      c.z -= dz;
    }
    this.focus.x -= dx;
    this.focus.z -= dz;
    for (let i = 0; i < this.keepN; i++) {
      this.keep[i].x -= dx;
      this.keep[i].z -= dz;
    }
    for (let i = 0; i < this.keptN; i++) {
      this.kept[i].x -= dx;
      this.kept[i].z -= dz;
    }
    this.write();
  }

  /** Advance: drift with the wind at cruise (m/s, u east, v north), recycle, keep clear, shadows. */
  update(dtSec: number, wind: { u: number; v: number }): void {
    const dt = Math.max(0, dtSec);
    const R = this.radiusM;
    // where clouds drift relative to the focus, per second (focusVel is per update)
    const relX = wind.u - (dt > 0 ? this.focusVel.x / dt : 0);
    const relZ = -wind.v - (dt > 0 ? this.focusVel.y / dt : 0);
    const relLen = Math.hypot(relX, relZ);
    this.focusVel.set(0, 0);
    if (!this.placed && this.focusSet) {
      // the first frame with a focus: spread them out around it (and ahead of the look)
      this.placed = true;
      for (const c of this.items) this.spawn(c, null);
    }
    for (const c of this.items) {
      c.x += wind.u * dt;
      c.z -= wind.v * dt;
      if (c.leaving) {
        c.scale -= dt / c.shrinkS;
        if (c.scale <= 0) this.spawn(c, { x: relX, z: relZ });
        continue;
      }
      if (c.scale < 1) c.scale = Math.min(1, c.scale + dt / GROW_S);
      // drifting over rising ground: re-read it now and then and ease back into the band above it
      c.groundIn -= dt;
      if (c.groundIn <= 0) {
        c.groundIn += 1;
        c.ground = this.groundAt(c.x, c.z);
      }
      const lo = c.ground + CLOUD_BAND.base + c.ry, hi = c.ground + CLOUD_BAND.top - c.ry;
      const target = Math.min(hi, Math.max(lo, c.cy));
      c.cy += (target - c.cy) * Math.min(1, dt / 2);
      const dx = c.x - this.focus.x, dz = c.z - this.focus.z;
      const far = Math.hypot(dx, dz) > R * 1.2;
      // well behind the view, or behind a balloon outrunning the clouds: shrink slowly away
      const behind = this.hasLook ? dx * this.look.x + dz * this.look.y < -R * 0.3 : relLen > 0.5 && (dx * relX + dz * relZ) / relLen > R * 0.35;
      if (far) this.spawn(c, { x: relX, z: relZ });
      else if (this.blocks(c, this.keep, this.keepN, 0)) {
        // something must be kept clear here: a cloud that holds the point itself goes at once
        if (this.blocks(c, this.keep, this.keepN, -1)) this.spawn(c, { x: relX, z: relZ });
        else this.leave(c, SHRINK_S);
      } else if (behind) this.leave(c, GROW_S);
    }
    const swap = this.kept;
    this.kept = this.keep;
    this.keptN = this.keepN;
    this.keep = swap;
    this.keepN = 0;
    this.write();
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.dispose();
    for (const u of this.haze.uClouds.value) u.set(0, 0, 0, 0);
    this.haze.uCloudSun.value.w = 0;
  }

  // ---- internals ----

  private leave(c: Cloud, seconds: number): void {
    c.leaving = true;
    c.shrinkS = seconds;
  }

  private rnd(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  /**
   * Does cloud c reach into any kept sphere? grow 0: the sphere's own radius; -1: only whether
   * the sphere's centre is inside the cloud.
   */
  private blocks(c: Cloud, spheres: THREE.Vector4[], n: number, grow: number): boolean {
    const s = Math.max(1e-6, c.scale);
    const cs = Math.cos(c.rot), sn = Math.sin(c.rot);
    for (let i = 0; i < n; i++) {
      const k = spheres[i];
      const r = grow < 0 ? 0 : k.w;
      const dx = k.x - c.x, dz = k.z - c.z;
      const lx = dx * cs - dz * sn, lz = dx * sn + dz * cs, ly = k.y - c.cy;
      if ((lx / (c.rx * s + r)) ** 2 + (ly / (c.ry * s + r)) ** 2 + (lz / (c.rz * s + r)) ** 2 < 1) return true;
    }
    return false;
  }

  /**
   * A new cloud. First time (rel null): anywhere in the disc around the focus. Afterwards: out
   * toward where clouds come from relative to the focus (ahead of a balloon outrunning them),
   * growing in from nothing.
   */
  private spawn(c: Cloud, rel: { x: number; z: number } | null): void {
    const R = this.radiusM;
    const relLen = rel ? Math.hypot(rel.x, rel.z) : 0;
    for (let tries = 0; tries < 24; tries++) {
      let ang: number, dist: number;
      if (this.hasLook && this.rnd() < 0.8) {
        ang = Math.atan2(this.look.y, this.look.x) + (this.rnd() - 0.5) * 1.2; // within about 35 deg
        dist = rel ? R * (0.45 + 0.6 * this.rnd()) : 1500 + (R - 1500) * Math.sqrt(this.rnd());
      } else if (!rel) {
        ang = this.rnd() * Math.PI * 2;
        dist = R * Math.sqrt(0.02 + 0.98 * this.rnd());
      } else {
        const from = relLen > 0.5 ? Math.atan2(-rel.z, -rel.x) : this.rnd() * Math.PI * 2; // upstream
        ang = from + (this.rnd() - 0.5) * (relLen > 0.5 ? Math.PI * 0.9 : Math.PI * 2);
        dist = R * (0.75 + 0.4 * this.rnd());
      }
      c.x = this.focus.x + Math.cos(ang) * dist;
      c.z = this.focus.z + Math.sin(ang) * dist;
      c.rx = 380 + 520 * this.rnd();
      c.rz = c.rx * (0.45 + 0.35 * this.rnd());
      c.ry = 70 + 90 * this.rnd();
      c.rot = this.rnd() * Math.PI * 2;
      const ground = this.groundAt(c.x, c.z);
      c.ground = ground;
      c.groundIn = 1;
      const room = CLOUD_BAND.top - CLOUD_BAND.base - 2 * c.ry;
      c.cy = ground + CLOUD_BAND.base + c.ry + room * this.rnd();
      c.scale = rel ? 0 : 1;
      c.leaving = false;
      const was = c.scale;
      c.scale = 1; // test the full-grown cloud against the kept spheres
      const clear = !this.blocks(c, this.kept, this.keptN, 0) && !this.blocks(c, this.keep, this.keepN, 0);
      c.scale = was;
      if (clear) return;
    }
    c.scale = 0; // nowhere free: wait unseen and try again next time round
    this.leave(c, SHRINK_S);
  }

  /** Instance matrices and the shadow uniforms. */
  private write(): void {
    const u = this.haze.uClouds.value;
    const sun = this.haze.uSunDir.value;
    for (let i = 0; i < this.items.length; i++) {
      const c = this.items[i];
      const s = Math.max(0.001, c.scale);
      this.q.setFromAxisAngle(this.up, c.rot);
      this.m.compose(this.p.set(c.x, c.cy, c.z), this.q, this.s.set(c.rx * s, c.ry * s, c.rz * s));
      this.mesh?.setMatrixAt(i, this.m);
      u[i].set(c.x, c.cy, c.z, c.scale > 0.01 ? 0.8 * Math.sqrt(c.rx * c.rz) * c.scale : 0);
    }
    for (let i = this.items.length; i < u.length; i++) u[i].set(0, 0, 0, 0);
    if (this.mesh) this.mesh.instanceMatrix.needsUpdate = true;
    const night = this.haze.uNight.value;
    const strength = 0.3 * smooth(0.07, 0.3, sun.y) * (1 - night);
    // their own soft light fades at night: dim blue-grey shapes against the ink sky, not lamps
    const mat = this.mesh?.material as THREE.MeshStandardMaterial | undefined;
    if (mat) {
      mat.emissiveIntensity = 0.22 * (1 - smooth(0.05, 0.4, night)) + 0.02;
      mat.color.setScalar(1 - 0.6 * night);
    }
    this.haze.uCloudSun.value.set(sun.x, Math.max(0.05, sun.y), sun.z, strength);
  }
}
