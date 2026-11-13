/**
 * The sky over the balloon, from the real sun and moon for its place and time (spec 7): the sky
 * dome and haze in the palette of the moment (dawn, day, golden hour, dusk, night), a sun disc and a
 * moon disc (with its phase) where they really are, stars that come out with the night, and the
 * key light and skylight.
 *
 * - Key light: the real sun direction by day (never from below the horizon: it grazes at 2 deg
 *   at most). As night falls it turns to a cool, dim moonlight from the moon's direction, scaled by
 *   how much of the moon is lit; with the moon down it comes from high in the sky, dimmer still,
 *   but never nothing, so the scene still reads (spec 6.7).
 * - Strengths: palette stageLight (the tile proof's approved values), so every page matches.
 * - Haze: fog from 20% of the far distance to the far distance (setView); the land fades into the
 *   sky colour by view direction (haze.ts).
 *
 * `uNight` in the shared haze uniforms drives the lit windows, lamps and city glow of the world
 * materials (materials.ts).
 */
import * as THREE from 'three';
import { moonPosition, sunPosition } from '../geo/sun';
import type { LatLon } from '../geo/coords';
import { lerpHex, lightFor, parseHex, stageLight, type Color, type Light } from './palette';
import { createHaze, setHazeLight, type HazeUniforms } from './haze';
import { SkyDome } from './skydome';
import { SunLight, sunDirection, type ShadowBox } from './sunlight';

export type Body = { elevationDeg: number; azimuthDeg: number };
export type Moon = Body & { illumination: number };

export type KeyLight = {
  /** Unit vector the light comes from (scene axes: x east, y up, z south). */
  dir: THREE.Vector3;
  color: Color;
  intensity: number;
  /** 0: the sun is the key; 1: the night key (the moon, or the night sky). */
  night: number;
};

/** The sun's light never comes from lower than this (it grazes the land instead). */
export const SUN_MIN_EL = 2;
/** Moonlight comes from at least this high, so night shadows stay short and soft. */
export const MOON_MIN_EL = 18;
/** With the moon down, the night key comes from this high, on the side of the sun (the last of the twilight). */
const NIGHT_SKY_EL = 55;
/** The night key is at least this share of the palette's night strength (no moon at all). */
const NIGHT_FLOOR = 0.3;

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** The key light for a sun, a moon (or null) and the palette light of the sun's elevation. */
export function keyLight(sun: Body, moon: Moon | null, L: Light): KeyLight {
  const stage = stageLight(L);
  const w = smooth(0.12, 0.8, L.night); // 0 at and above the horizon, 1 by nautical dusk
  const sunDir = sunDirection(Math.max(SUN_MIN_EL, sun.elevationDeg), sun.azimuthDeg);
  const moonUp = moon ? smooth(-2, 6, moon.elevationDeg) : 0;
  const skyDir = sunDirection(NIGHT_SKY_EL, sun.azimuthDeg);
  const nightDir = moon && moonUp > 0 ? skyDir.lerp(sunDirection(Math.max(MOON_MIN_EL, moon.elevationDeg), moon.azimuthDeg), moonUp).normalize() : skyDir;
  const dir = w <= 0 ? sunDir : w >= 1 ? nightDir : sunDir.lerp(nightDir, w).normalize();
  const m = NIGHT_FLOOR + (1 - NIGHT_FLOOR) * (moon ? moon.illumination : 0) * moonUp;
  return { dir, color: stage.sunColor, intensity: stage.sunIntensity * (1 + (m - 1) * w), night: w };
}

/** sRGB hex to a linear THREE.Color-free triple for shader uniforms. */
const rgb = (hex: string, out: THREE.Vector3) => {
  const [r, g, b] = parseHex(hex);
  return out.set(r / 255, g / 255, b / 255);
};

const DISC_VERT = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

function sunDiscMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'sky-sun',
    uniforms: { uColor: { value: new THREE.Vector3(1, 1, 1) }, uAlpha: { value: 1 } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    fog: false,
    vertexShader: DISC_VERT,
    fragmentShader: `uniform vec3 uColor; uniform float uAlpha; varying vec2 vUv;
      void main(){
        float r = length(vUv - 0.5) * 2.0;
        float core = 1.0 - smoothstep(0.24, 0.27, r);
        float halo = pow(1.0 - smoothstep(0.2, 1.0, r), 2.0) * 0.28;
        gl_FragColor = vec4(uColor * (core * 0.85 + halo) * uAlpha, 1.0);
      }`,
  });
}

function moonDiscMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'sky-moon',
    uniforms: { uColor: { value: new THREE.Vector3(0.9, 0.92, 0.94) }, uAlpha: { value: 1 }, uSun: { value: new THREE.Vector3(0, 0, 1) } },
    transparent: true,
    depthWrite: false,
    toneMapped: false,
    fog: false,
    vertexShader: DISC_VERT,
    fragmentShader: `uniform vec3 uColor; uniform float uAlpha; uniform vec3 uSun; varying vec2 vUv;
      void main(){
        vec2 p = (vUv - 0.5) * 2.0;
        float r2 = dot(p, p);
        float edge = 1.0 - smoothstep(0.86, 1.0, r2);
        if (edge <= 0.0) discard;
        vec3 n = vec3(p, sqrt(max(0.0, 1.0 - r2)));
        float lit = smoothstep(-0.06, 0.06, dot(n, uSun));
        gl_FragColor = vec4(uColor * (0.06 + 0.94 * lit), edge * uAlpha * (0.25 + 0.75 * lit));
      }`,
  });
}

/** Stars on the upper half of a unit sphere, a brightness each, fading toward the horizon haze. */
function starField(count: number): THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial> {
  const pos = new Float32Array(count * 3), bright = new Float32Array(count);
  let s = 12345;
  const rnd = () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296);
  for (let i = 0; i < count; i++) {
    const y = 0.02 + 0.98 * Math.sqrt(rnd()), a = rnd() * Math.PI * 2, r = Math.sqrt(1 - y * y);
    pos.set([Math.cos(a) * r, y, Math.sin(a) * r], i * 3);
    bright[i] = 0.25 + 0.75 * Math.pow(rnd(), 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aBright', new THREE.BufferAttribute(bright, 1));
  const m = new THREE.ShaderMaterial({
    name: 'sky-stars',
    uniforms: { uAlpha: { value: 0 }, uPx: { value: 1 } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    fog: false,
    vertexShader: `attribute float aBright; uniform float uPx; varying float vB;
      void main(){
        vB = aBright * smoothstep(0.02, 0.22, position.y);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = (1.2 + 1.6 * aBright) * uPx;
      }`,
    fragmentShader: `uniform float uAlpha; varying float vB;
      void main(){
        float r = length(gl_PointCoord - 0.5) * 2.0;
        float a = (1.0 - smoothstep(0.3, 1.0, r)) * vB * uAlpha;
        if (a < 0.004) discard;
        gl_FragColor = vec4(vec3(0.9, 0.93, 1.0) * a, 1.0);
      }`,
  });
  const p = new THREE.Points(g, m);
  p.frustumCulled = false;
  p.visible = false;
  return p;
}

export type SkyOptions = {
  /** Shared haze uniforms (default: new ones); pass them to the world's materials. */
  haze?: HazeUniforms;
  /** The key light's shadow box (sunlight.ts). */
  shadow?: ShadowBox;
  stars?: number;
};

/** Angular radius of the drawn discs, degrees (larger than life, as in a picture book). */
const SUN_DISC_DEG = 1.4;
const MOON_DISC_DEG = 1.1;

export class Sky {
  readonly haze: HazeUniforms;
  readonly light: SunLight;
  readonly dome: SkyDome;
  readonly fog: THREE.Fog;
  readonly stars: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  readonly sunDisc: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  readonly moonDisc: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  /** The palette light of the moment (also returned by update). */
  current: Light;
  key: KeyLight;
  sun: Body = { elevationDeg: 30, azimuthDeg: 180 };
  moon: Moon | null = null;
  /** Toward the real sun (not clamped), scene axes. */
  readonly sunDir = new THREE.Vector3(0, 1, 0);
  readonly moonDir = new THREE.Vector3(0, -1, 0);

  constructor(scene: THREE.Scene, opts: SkyOptions = {}) {
    this.current = lightFor(30);
    this.key = keyLight(this.sun, null, this.current);
    this.haze = opts.haze ?? createHaze(this.current, this.key.dir);
    this.light = new SunLight(this.current, this.key.dir, opts.shadow);
    this.light.addTo(scene);
    this.fog = new THREE.Fog(new THREE.Color(this.current.skyHorizon), 2000, 20000);
    scene.fog = this.fog;
    this.dome = new SkyDome(this.haze);
    this.stars = starField(opts.stars ?? 800);
    this.stars.renderOrder = -1;
    this.sunDisc = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), sunDiscMaterial());
    this.moonDisc = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), moonDiscMaterial());
    for (const d of [this.sunDisc, this.moonDisc]) {
      d.frustumCulled = false;
      d.renderOrder = -1;
    }
    scene.add(this.dome.mesh, this.stars, this.sunDisc, this.moonDisc);
  }

  /** The sky for a real place and time. */
  update(utcMs: number, p: LatLon): Light {
    return this.apply(sunPosition(utcMs, p), moonPosition(utcMs, p));
  }

  /** The sky for a given sun (and moon, or none): for fixed looks such as the tile proof's. */
  apply(sun: Body, moon: Moon | null = null): Light {
    this.sun = { ...sun };
    this.moon = moon ? { ...moon } : null;
    const L = lightFor(sun.elevationDeg);
    this.current = L;
    sunDirection(sun.elevationDeg, sun.azimuthDeg, this.sunDir);
    if (moon) sunDirection(moon.elevationDeg, moon.azimuthDeg, this.moonDir);
    this.key = keyLight(sun, moon, L);

    // haze and sky: the glow toward the sun dies away once it is well below the horizon
    setHazeLight(this.haze, L);
    rgb(lerpHex(L.skyHorizon, L.sun, smooth(-10, -1, sun.elevationDeg)), this.haze.uSunCol.value);
    this.haze.uSunDir.value.copy(this.sunDir);
    this.haze.uNight.value = L.night;
    this.fog.color.set(L.skyHorizon);

    // key light and skylight
    this.light.setLight(L);
    this.light.sun.color.set(this.key.color);
    this.light.sun.intensity = this.key.intensity;

    // stars come out in the dark; the discs show above the horizon
    const starA = smooth(0.45, 1, L.night) * 0.9;
    this.stars.material.uniforms.uAlpha.value = starA;
    this.stars.visible = starA > 0.002;
    const sunA = smooth(-1.5, 1, sun.elevationDeg);
    this.sunDisc.visible = sunA > 0.002;
    rgb(lerpHex(stageLight(L).sunColor, '#ffffff', 0.55), this.sunDisc.material.uniforms.uColor.value);
    this.sunDisc.material.uniforms.uAlpha.value = sunA;
    const moonA = moon ? smooth(-1, 2, moon.elevationDeg) * (0.35 + 0.65 * L.night) : 0;
    this.moonDisc.visible = moonA > 0.002;
    this.moonDisc.material.uniforms.uAlpha.value = moonA;
    return L;
  }

  /**
   * Follow the camera: the dome, stars and discs sit around it inside the far plane. With
   * `farM`, the haze runs from 20% of that distance (fog near) to all of it (fog far).
   * `pxPerUnit` (half the drawing buffer's height) sizes the stars and the lamps.
   */
  setView(camera: THREE.PerspectiveCamera, farM?: number, pxPerUnit?: number): void {
    if (farM !== undefined) {
      this.fog.far = farM;
      this.fog.near = farM * 0.2;
    }
    this.dome.follow(camera);
    const R = camera.far * 0.85;
    this.stars.position.copy(camera.position);
    this.stars.scale.setScalar(R);
    if (pxPerUnit !== undefined) {
      this.haze.uPxScale.value = pxPerUnit;
      this.stars.material.uniforms.uPx.value = Math.max(1, pxPerUnit / 600);
    }
    this.placeDisc(this.sunDisc, this.sunDir, camera, R * 0.98, SUN_DISC_DEG / 0.27);
    this.placeDisc(this.moonDisc, this.moonDir, camera, R * 0.97, MOON_DISC_DEG);
    if (this.moonDisc.visible) {
      // the sun in the moon disc's own axes: its lit side faces the sun
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
      const back = new THREE.Vector3(0, 0, 1).applyQuaternion(camera.quaternion);
      this.moonDisc.material.uniforms.uSun.value.set(this.sunDir.dot(right), this.sunDir.dot(up), this.sunDir.dot(back));
    }
  }

  /** Shadows around `focus` from the key light; true when the shadow map must be redrawn. */
  place(focus: THREE.Vector3): boolean {
    return this.light.place(focus, this.key.dir);
  }

  dispose(): void {
    this.dome.dispose();
    for (const o of [this.stars, this.sunDisc, this.moonDisc]) {
      o.removeFromParent();
      o.geometry.dispose();
      o.material.dispose();
    }
    this.light.sun.removeFromParent();
    this.light.sun.target.removeFromParent();
    this.light.hemi.removeFromParent();
    this.light.sun.dispose();
  }

  private placeDisc(d: THREE.Mesh, dir: THREE.Vector3, camera: THREE.PerspectiveCamera, dist: number, radiusDeg: number): void {
    d.position.copy(camera.position).addScaledVector(dir, dist);
    d.quaternion.copy(camera.quaternion);
    d.scale.setScalar(dist * Math.tan((radiusDeg * Math.PI) / 180));
  }
}
