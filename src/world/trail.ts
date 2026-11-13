/**
 * The whole-trip replay's trail (spec 6.4): an off-white ribbon along the route flown so far, at the
 * balloon's height, ending at the balloon as drawn, and a small orange marker that keeps the balloon a
 * few pixels wide when the camera is tens of kilometres up (the balloon itself is drawn at most 40x
 * real size, which is under a pixel from there).
 *
 * The ribbon is rebuilt on the CPU every frame (at most 434 points): each point's two edges sit across
 * the route and across the view, a constant width in pixels, so it reads the same near the balloon and
 * far down the trail; the haze takes it into the distance like the land. Positions come from the
 * stream's floating origin each frame, so the origin moving (it does, every frame, at replay speed)
 * needs no bookkeeping here.
 */
import * as THREE from 'three';
import type { Route } from '../flight/route';
import type { LatLon } from '../geo/coords';

/** The trail's width on screen (CSS px). */
export const TRAIL_PX = 3;
/** The marker's radius on screen (CSS px). */
export const MARKER_PX = 5;
const PAPER = '#f7f3ec';
const BALLOON = '#ff5a12';

export type TrailFrame = {
  route: Route;
  /** Route time now (s after release): points before it are drawn. */
  tSec: number;
  toScene(p: LatLon, out: { x: number; z: number }): { x: number; z: number };
  /** The balloon as drawn: the trail ends here and the marker sits on it. */
  head: THREE.Vector3;
  camera: THREE.PerspectiveCamera;
  /** The canvas height in CSS px. */
  viewportH: number;
  /** The drawn balloon's radius (m): the marker steps aside once the balloon is bigger. */
  balloonRadiusM: number;
};

export class ReplayTrail {
  readonly group = new THREE.Group();
  readonly ribbon: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  readonly marker: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  /** Points in the ribbon last frame (route points so far, plus the head). */
  points = 0;
  private readonly pos: Float32Array;
  private readonly cap: number;
  private centres: Float32Array;
  private readonly xz = { x: 0, z: 0 };
  private readonly a = new THREE.Vector3();
  private readonly t = new THREE.Vector3();
  private readonly v = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly lastSide = new THREE.Vector3(1, 0, 0);

  constructor(scene: THREE.Scene, maxPoints = 440) {
    this.cap = maxPoints;
    this.pos = new Float32Array(maxPoints * 2 * 3);
    this.centres = new Float32Array(maxPoints * 3);
    const idx = new Uint32Array((maxPoints - 1) * 6);
    for (let i = 0; i < maxPoints - 1; i++) {
      const a = 2 * i;
      idx.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], i * 6);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.setDrawRange(0, 0);
    this.ribbon = new THREE.Mesh(
      g,
      new THREE.MeshBasicMaterial({ color: PAPER, transparent: true, opacity: 0.92, depthWrite: false, side: THREE.DoubleSide, fog: true, toneMapped: false }),
    );
    this.ribbon.name = 'replay-trail-ribbon';
    this.ribbon.frustumCulled = false;
    this.ribbon.renderOrder = 2;
    this.marker = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshBasicMaterial({ color: BALLOON, fog: false, toneMapped: false }));
    this.marker.name = 'replay-trail-marker';
    this.marker.visible = false;
    this.marker.renderOrder = 3;
    this.group.name = 'replay-trail';
    this.group.add(this.ribbon, this.marker);
    scene.add(this.group);
  }

  update(f: TrailFrame): void {
    const pts = f.route.points;
    const cam = f.camera;
    const pxToM = (2 * Math.tan((cam.fov * Math.PI) / 360)) / Math.max(1, f.viewportH);
    // the centre line: route points flown so far, then the balloon as drawn
    let n = 0;
    const c = this.centres;
    for (let i = 0; i < pts.length && n < this.cap - 1; i++) {
      const p = pts[i];
      if (!(p.tSec < f.tSec)) break;
      const s = f.toScene(p, this.xz);
      c[3 * n] = s.x;
      c[3 * n + 1] = p.altM;
      c[3 * n + 2] = s.z;
      n++;
    }
    c[3 * n] = f.head.x;
    c[3 * n + 1] = f.head.y;
    c[3 * n + 2] = f.head.z;
    n++;
    this.points = n;

    // the edges, across the route and across the view, TRAIL_PX wide
    for (let i = 0; i < n; i++) {
      const i0 = Math.max(0, i - 1), i1 = Math.min(n - 1, i + 1);
      this.a.set(c[3 * i], c[3 * i + 1], c[3 * i + 2]);
      this.t.set(c[3 * i1] - c[3 * i0], c[3 * i1 + 1] - c[3 * i0 + 1], c[3 * i1 + 2] - c[3 * i0 + 2]);
      this.v.copy(cam.position).sub(this.a);
      const dist = this.v.length();
      this.s.crossVectors(this.t, this.v);
      const len = this.s.length();
      if (len > 1e-9) this.lastSide.copy(this.s).divideScalar(len);
      const half = (TRAIL_PX / 2) * dist * pxToM;
      const o = 6 * i;
      this.pos[o] = this.a.x + this.lastSide.x * half;
      this.pos[o + 1] = this.a.y + this.lastSide.y * half;
      this.pos[o + 2] = this.a.z + this.lastSide.z * half;
      this.pos[o + 3] = this.a.x - this.lastSide.x * half;
      this.pos[o + 4] = this.a.y - this.lastSide.y * half;
      this.pos[o + 5] = this.a.z - this.lastSide.z * half;
    }
    const g = this.ribbon.geometry;
    const attr = g.getAttribute('position') as THREE.BufferAttribute;
    attr.clearUpdateRanges();
    attr.addUpdateRange(0, n * 6);
    attr.needsUpdate = true;
    g.setDrawRange(0, n > 1 ? (n - 1) * 6 : 0);

    // the marker: MARKER_PX on screen, while that is bigger than the balloon itself
    const d = cam.position.distanceTo(f.head);
    const r = MARKER_PX * d * pxToM;
    this.marker.visible = r > f.balloonRadiusM * 1.15;
    this.marker.position.copy(f.head);
    this.marker.scale.setScalar(r);
  }

  dispose(): void {
    this.group.removeFromParent();
    this.ribbon.geometry.dispose();
    this.ribbon.material.dispose();
    this.marker.geometry.dispose();
    this.marker.material.dispose();
  }
}
