/**
 * Sun and skylight in the Contour look, tuned in the tile proof (Task 9): the palette's light
 * values render too dark under three.js physical light units, so the sun runs at 2x the palette
 * intensity, 15% toward white (clay roofs and grass stay calm), and the skylight takes 35% of the
 * warm horizon (at golden hour most of the sky is not the zenith).
 *
 * One directional light casts shadows, in a box around a focus point only (spec 12: live shadows
 * near the balloon). The box snaps to a grid as the focus moves, so the shadow map is redrawn only
 * when it jumps or the sun moves noticeably (the renderer does not redraw it on its own).
 */
import * as THREE from 'three';
import { lerpHex, type Light } from './palette';
import { SHADOW_LAYER } from './tileview';

export const SUN_GAIN = 2.0;
export const SKY_LIGHT = 2.2;

export type ShadowBox = {
  /** Half width of the shadowed ground, metres. */
  radius: number;
  mapSize: number;
  /** The box moves in steps of this many metres. */
  snap: number;
  /**
   * Heights the box keeps above and below the ground disc, in metres (default 160 each). Up: the
   * tallest receivers (roofs) still shadowed at the disc's far edge. Down: terrain below the focus.
   * Casters toward the sun need no extra room: they sit on the same sun ray as the ground they
   * shade, so a smaller margin is a shorter box on the ground and fewer casters in the shadow pass.
   */
  upM?: number;
  downM?: number;
};

/** Unit vector toward the sun from elevation and compass azimuth (degrees), scene axes (x east, z south). */
export function sunDirection(elevationDeg: number, azimuthDeg: number, out = new THREE.Vector3()): THREE.Vector3 {
  const az = (azimuthDeg * Math.PI) / 180, el = (elevationDeg * Math.PI) / 180;
  return out.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
}

export class SunLight {
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly dir: THREE.Vector3;
  private box: ShadowBox;
  private readonly centre = new THREE.Vector3(NaN, NaN, NaN);
  private readonly lastDir = new THREE.Vector3();

  constructor(light: Light, dir: THREE.Vector3, box: ShadowBox = { radius: 1150, mapSize: 2048, snap: 0 }) {
    this.dir = dir.clone().normalize();
    this.box = box;
    this.sun = new THREE.DirectionalLight();
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(box.mapSize, box.mapSize);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.8;
    // shadow-only meshes (tileview.ts: near tiles cast a sixteenth of a tile at a time)
    this.sun.shadow.camera.layers.enable(SHADOW_LAYER);
    this.hemi = new THREE.HemisphereLight();
    this.setLight(light);
    this.fitBox();
  }

  addTo(scene: THREE.Scene): void {
    scene.add(this.sun, this.sun.target, this.hemi);
  }

  setLight(L: Light): void {
    this.sun.color.set(lerpHex(L.sun, '#ffffff', 0.15));
    this.sun.intensity = L.sunIntensity * SUN_GAIN;
    this.hemi.color.set(lerpHex(L.hemiSky, L.skyHorizon, 0.35));
    this.hemi.groundColor.set(L.hemiGround);
    this.hemi.intensity = SKY_LIGHT;
  }

  /**
   * Point the sun along `dir` and box its shadows around `focus` (snapped). Returns true when the
   * shadow map must be redrawn: the box moved, or the sun turned by more than about half a degree.
   */
  place(focus: THREE.Vector3, dir: THREE.Vector3 = this.dir): boolean {
    const s = this.box.snap;
    const cx = s > 0 ? Math.round(focus.x / s) * s : focus.x;
    const cz = s > 0 ? Math.round(focus.z / s) * s : focus.z;
    const cy = s > 0 ? Math.round(focus.y / s) * s : focus.y;
    const turned = this.lastDir.dot(dir) < Math.cos((0.5 * Math.PI) / 180);
    const moved = cx !== this.centre.x || cy !== this.centre.y || cz !== this.centre.z;
    if (!moved && !turned) return false;
    this.dir.copy(dir).normalize();
    this.lastDir.copy(this.dir);
    this.centre.set(cx, cy, cz);
    this.sun.target.position.copy(this.centre);
    this.sun.position.copy(this.centre).addScaledVector(this.dir, 4000);
    this.sun.target.updateMatrixWorld();
    this.sun.updateMatrixWorld();
    if (turned) this.fitBox();
    return true;
  }

  /** Shadow a disc of this radius around the focus from now on; true when the box changed (redraw). */
  setRadius(radius: number): boolean {
    if (Math.abs(radius - this.box.radius) < 1) return false;
    this.box = { ...this.box, radius };
    this.fitBox();
    return true;
  }

  /** A low sun sees the ground disc as wide and short: a tall thin box (about 1 m x 0.3 m per texel). */
  private fitBox(): void {
    const R = this.box.radius;
    const c = this.sun.shadow.camera;
    c.left = -R;
    c.right = R;
    const ground = R * Math.max(0.05, this.dir.y);
    const cos = Math.sqrt(Math.max(0, 1 - this.dir.y * this.dir.y));
    c.top = ground + (this.box.upM !== undefined ? this.box.upM * cos : 160);
    c.bottom = -(ground + (this.box.downM !== undefined ? this.box.downM * cos : 160));
    c.near = 2000;
    c.far = 6000;
    c.updateProjectionMatrix();
  }
}
