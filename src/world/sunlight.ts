/**
 * Sun and skylight in the Contour look, at the strengths SK approved in the tile proof (palette
 * stageLight: sun x2, 15% toward white, skylight 2.2 with 35% of the warm horizon).
 *
 * One directional light casts shadows, in a box around a focus point only (spec 12: live shadows
 * near the balloon). The box snaps to a grid as the focus moves, so the shadow map is redrawn only
 * when it jumps or the sun moves noticeably (the renderer does not redraw it on its own).
 *
 * The shadow pass has a budget (spec 12: the whole frame under 600,000 triangles and 250 draw calls):
 * `fit` shrinks the disc, from the one asked for, until what the pass would draw fits, so a dense
 * city centre gets a smaller disc and open country the whole one.
 */
import * as THREE from 'three';
import { stageLight, type Light } from './palette';
import { SHADOW_LAYER, drawTriangles } from './tileview';

export { SUN_GAIN, SKY_LIGHT } from './palette';

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

/** What a shadow pass draws. */
export type PassCount = { triangles: number; calls: number };

/**
 * What a whole frame may draw, the view and the shadow pass together: under spec 12's hard caps
 * (600,000 triangles, 250 draw calls) with room for the view changing between frames.
 */
export const FRAME_BUDGET: PassCount = { triangles: 540_000, calls: 220 };
/**
 * The most the view may draw in a frame (stream.ts fitView leaves the farthest buildings out of the
 * frame past it), so the view and the smallest shadow pass stay inside FRAME_BUDGET.
 */
export const VIEW_CAP = 490_000;
/** Trees cast shadows only this close to the shadow focus (a tile's trees are tens of thousands of triangles). */
export const TREE_SHADOW_M = 300;

/** The shadow pass's share of the frame: what the view (last plain frame) leaves, within sane bounds. */
export function shadowBudget(view: PassCount, frame: PassCount = FRAME_BUDGET): PassCount {
  return {
    triangles: Math.min(250_000, Math.max(30_000, frame.triangles - view.triangles)),
    calls: Math.min(140, Math.max(16, frame.calls - view.calls)),
  };
}

/** Each step of `fit` takes this share off the disc's radius. */
const FIT_STEP = 0.8;
/** The disc grows back a step only when the bigger one would use no more than this share of the budget. */
const GROW_SHARE = 0.85;

export class SunLight {
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly dir: THREE.Vector3;
  private box: ShadowBox;
  /** The disc asked for (setRadius); `fit` may draw a smaller one. */
  private want: number;
  /** `fit` never goes below this radius (m). */
  readonly minRadius: number;
  /** The casters `fit` and `casters` collect (parallel arrays, kept between redraws), and their reused results. */
  private readonly casterMesh: THREE.Mesh[] = [];
  private readonly casterTris: number[] = [];
  private readonly counted: PassCount = { triangles: 0, calls: 0 };
  private readonly fitted = { triangles: 0, calls: 0, radius: 0 };
  /** `fit` has been called: from then on the disc drawn is fit's, which setRadius only shrinks at once. */
  private fitting = false;
  private readonly centre = new THREE.Vector3(NaN, NaN, NaN);
  private readonly lastDir = new THREE.Vector3();

  constructor(light: Light, dir: THREE.Vector3, box: ShadowBox = { radius: 1150, mapSize: 2048, snap: 0 }) {
    this.dir = dir.clone().normalize();
    this.box = { ...box };
    this.want = box.radius;
    this.minRadius = Math.min(box.radius, 200);
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
    const s = stageLight(L);
    this.sun.color.set(s.sunColor);
    this.sun.intensity = s.sunIntensity;
    this.hemi.color.set(s.hemiSky);
    this.hemi.groundColor.set(s.hemiGround);
    this.hemi.intensity = s.hemiIntensity;
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
    if (Math.abs(radius - this.want) < 1) return false;
    this.want = radius;
    // once fitted, a smaller disc asked for takes effect at once; a bigger one waits for fit's room
    this.setBox(this.fitting ? Math.min(this.box.radius, radius) : radius);
    return true;
  }

  /** The radius of the disc shadowed now. */
  get radius(): number {
    return this.box.radius;
  }

  /** What the shadow pass would draw now: three's own test (visible, castShadow, layers, box in frustum). */
  casters(scene: THREE.Object3D): PassCount {
    this.collect(scene);
    return this.count();
  }

  /**
   * Before a redraw: fit the shadow pass to `budget`. From the disc drawn last time, it shrinks a step
   * at a time (x0.8, never below minRadius) while the pass is over, and grows back toward the disc
   * asked for (setRadius) only while the bigger one would use at most 85% of the budget, so the radius
   * does not flip between steps. Returns the radius used and what the pass will draw (one reused object).
   */
  fit(scene: THREE.Object3D, budget: PassCount): PassCount & { radius: number } {
    this.fitting = true;
    this.collect(scene);
    const over = (c: PassCount, share = 1) => c.triangles > budget.triangles * share || c.calls > budget.calls * share;
    // from the disc drawn last time (hysteresis: it shrinks only when over, grows only with room to spare)
    let r = Math.max(Math.min(this.box.radius, this.want), Math.min(this.minRadius, this.want));
    this.setBox(r);
    let c = this.count();
    if (over(c)) {
      while (over(c) && r > this.minRadius) {
        r = Math.max(this.minRadius, Math.round(r * FIT_STEP));
        this.setBox(r);
        c = this.count();
      }
    } else {
      while (r < this.want) {
        const bigger = Math.min(this.want, Math.round(r / FIT_STEP));
        this.setBox(bigger);
        const cb = this.count();
        if (over(cb, GROW_SHARE)) {
          this.setBox(r);
          c = this.count();
          break;
        }
        r = bigger;
        c = cb;
      }
    }
    const out = this.fitted;
    out.triangles = c.triangles;
    out.calls = c.calls;
    out.radius = r;
    return out;
  }

  private setBox(radius: number): void {
    if (radius === this.box.radius) return;
    this.box.radius = radius;
    this.fitBox();
  }

  /** Every shadow caster in the scene, as the shadow pass walks it (an invisible group hides its children). */
  private collect(scene: THREE.Object3D): void {
    this.casterMesh.length = this.casterTris.length = 0;
    this.walk(scene, this.sun.shadow.camera.layers);
  }

  private walk(o: THREE.Object3D, layers: THREE.Layers): void {
    if (!o.visible) return;
    if ((o as THREE.Mesh).isMesh && o.castShadow && o.layers.test(layers)) {
      this.casterMesh.push(o as THREE.Mesh);
      this.casterTris.push(drawTriangles(o as THREE.Mesh));
    }
    const ch = o.children;
    for (let i = 0; i < ch.length; i++) this.walk(ch[i], layers);
  }

  /** What the shadow pass draws of the collected casters with the box as it is (one reused object). */
  private count(): PassCount {
    const shadow = this.sun.shadow;
    this.sun.updateMatrixWorld();
    this.sun.target.updateMatrixWorld();
    shadow.updateMatrices(this.sun);
    const frustum = shadow.getFrustum();
    let triangles = 0, calls = 0;
    const meshes = this.casterMesh, tris = this.casterTris;
    for (let i = 0; i < meshes.length; i++) {
      const o = meshes[i];
      if (tris[i] === 0 || (o.frustumCulled && !o.intersectsFrustum(frustum))) continue;
      triangles += tris[i];
      calls++;
    }
    const out = this.counted;
    out.triangles = triangles;
    out.calls = calls;
    return out;
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
