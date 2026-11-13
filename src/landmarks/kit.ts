/**
 * The landmark kit: faceted, flat-shaded Contour geometry for hand-made landmark models.
 *
 *   const k = new Kit();
 *   k.box('walls', LANDMARK_COLOURS.stone, 0, -3, 0, 12, 55, 12);      // centre x, base y, centre z, w, h, d
 *   k.push(0, 55, 0, 45);                                               // move and turn what follows
 *   k.spire('plain', LANDMARK_COLOURS.iron, 0, 0, 0, 8, 30, 4);
 *   k.pop();
 *   const group = k.group('my-landmark');                               // one mesh per bucket used
 *
 * Coordinates are model-frame metres (types.ts): y up, the front toward -z. `push(x, y, z, turnDeg)`
 * moves the origin and turns by turnDeg clockwise seen from above (as a compass heading does), so
 * turnDeg 90 points the front east. Every triangle is wound and lit outward (MeshBuilder's hint).
 * Colours are '#rrggbb' sRGB from LANDMARK_COLOURS or the region style (contourColours lists the
 * allowed set; `kit.colours` records what was used, for the Contour-only check); the kit stores
 * them linear, as three.js wants vertex colours.
 */
import * as THREE from 'three';
import { CONTOUR, ROADS, lerpHex, type Color, type RegionStyle } from '../world/palette';
import { MeshBuilder, type RGB } from '../world/geom';
import { srgbToLinear } from '../world/color';
import { LANDMARK_BUCKETS, type LandmarkBucket } from './types';

const D2R = Math.PI / 180;

/**
 * The landmark palette, all from the Contour palette (spec 7) or mixes of it: chalk and warm
 * limestone, with slate and dark iron for roofs and spires. Calm, so the balloon stays the only
 * saturated thing.
 */
export const LANDMARK_COLOURS = {
  /** Contour chalk, the palest stone (#f4efe5). */
  chalk: CONTOUR.building[0],
  /** Contour chalk, a shade deeper (#ebe3d4). */
  chalkShade: CONTOUR.building[1],
  /** Warm limestone: chalk toward the Contour sand. */
  stone: lerpHex(CONTOUR.building[1], CONTOUR.land[0], 0.4),
  /** Limestone in the shade of deep carving and buttress faces. */
  stoneDeep: lerpHex(lerpHex(CONTOUR.building[1], CONTOUR.land[0], 0.4), CONTOUR.cliff, 0.35),
  sand: CONTOUR.land[0],
  clay: CONTOUR.cliff,
  /** Contour slate roof (#9fa6aa). */
  slate: CONTOUR.roof[2],
  /** Dark iron and lead: Contour slate, deeper. */
  iron: lerpHex(CONTOUR.roof[2], '#000000', 0.4),
  /** Muted gilt (clock frames, finials): Contour sand toward clay. */
  gilt: lerpHex(CONTOUR.land[0], CONTOUR.cliff, 0.45),
  /** Contour pale stone road colour, for paving and plinths. */
  paving: ROADS.small,
  /** Grey limestone and steel: the Contour rail grey (#b4aea2). */
  limestone: ROADS.rail,
  /** Verdigris copper (domes, the Liver Birds): the Contour pale sea-green (#8fd3cf). */
  copper: CONTOUR.waterShallow,
  /**
   * Red sandstone: the UK and Ireland's muted brick (palette.ts, the UK walls' first colour), fixed,
   * so it reads the same whatever region style a model is built with.
   */
  redStone: '#a58b80',
  /** Lawn and planting: the Contour sages. */
  grass: CONTOUR.land[2],
  sage: CONTOUR.land[3],
} satisfies Record<string, Color>;

/** Every colour a landmark may use: the Contour palette, the region's walls and roofs, and the landmark palette. */
export function contourColours(style: RegionStyle): Color[] {
  const all = [
    ...CONTOUR.land, CONTOUR.cliff, CONTOUR.waterDeep, CONTOUR.waterShallow, ...CONTOUR.building, ...CONTOUR.roof,
    ...Object.values(ROADS), ...style.walls, ...style.roofs, ...(style.tallWalls ?? []), ...Object.values(LANDMARK_COLOURS),
  ];
  return [...new Set(all.map((c) => c.toLowerCase()))];
}

/** A '#rrggbb' sRGB colour as linear 0..1 floats (vertex colours). */
export function linearColour(hex: Color): RGB {
  const n = parseInt(hex.slice(1), 16);
  return [srgbToLinear(((n >> 16) & 255) / 255), srgbToLinear(((n >> 8) & 255) / 255), srgbToLinear((n & 255) / 255)];
}

/** Triangles in every mesh under an object. */
export function countTriangles(o: THREE.Object3D): number {
  let n = 0;
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    if (!m.isMesh) return;
    const g = m.geometry;
    n += (g.index ? g.index.count : g.getAttribute('position').count) / 3;
  });
  return n;
}

/** Placeholder materials until the layer gives the meshes the shared Contour ones (one per bucket). */
let placeholders: Record<LandmarkBucket, THREE.MeshStandardMaterial> | null = null;
function placeholder(b: LandmarkBucket): THREE.MeshStandardMaterial {
  placeholders ??= Object.fromEntries(
    LANDMARK_BUCKETS.map((k) => [k, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95, metalness: 0, name: `landmark-${k}` })]),
  ) as Record<LandmarkBucket, THREE.MeshStandardMaterial>;
  return placeholders[b];
}

type Frame = { x: number; y: number; z: number; c: number; s: number; deg: number };

export class Kit {
  /** Every colour given to the kit. */
  readonly colours = new Set<Color>();
  private readonly parts = new Map<LandmarkBucket, MeshBuilder>();
  private readonly cache = new Map<Color, RGB>();
  private f: Frame = { x: 0, y: 0, z: 0, c: 1, s: 0, deg: 0 };
  private readonly stack: Frame[] = [];

  get triangles(): number {
    let n = 0;
    for (const b of this.parts.values()) n += b.triangles;
    return n;
  }

  /** Move the origin to (x, y, z) of the current frame and turn by turnDeg (clockwise from above). */
  push(x: number, y: number, z: number, turnDeg = 0): this {
    const f = this.f;
    this.stack.push(f);
    const deg = f.deg + turnDeg;
    this.f = { x: f.x + x * f.c - z * f.s, y: f.y + y, z: f.z + x * f.s + z * f.c, c: Math.cos(deg * D2R), s: Math.sin(deg * D2R), deg };
    return this;
  }

  /**
   * Put an object (the pivot of a part turned in animate, such as a clock hand) at (x, y, z) of the
   * current frame, turned with the frame: its -z is the frame's front.
   */
  place<T extends THREE.Object3D>(o: T, x = 0, y = 0, z = 0): T {
    const f = this.f;
    o.position.set(f.x + x * f.c - z * f.s, f.y + y, f.z + x * f.s + z * f.c);
    o.rotation.set(0, -f.deg * D2R, 0);
    return o;
  }

  pop(): this {
    const f = this.stack.pop();
    if (!f) throw new Error('Kit.pop without push');
    this.f = f;
    return this;
  }

  /** Triangle a, b, c (current frame), lit and wound to face direction (hx, hy, hz). */
  tri(b: LandmarkBucket, colour: Color, ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number, hx: number, hy: number, hz: number): void {
    const f = this.f;
    const X = (x: number, z: number) => f.x + x * f.c - z * f.s;
    const Z = (x: number, z: number) => f.z + x * f.s + z * f.c;
    this.builder(b).tri(
      X(ax, az), f.y + ay, Z(ax, az),
      X(bx, bz), f.y + by, Z(bx, bz),
      X(cx, cz), f.y + cy, Z(cx, cz),
      this.rgb(colour),
      hx * f.c - hz * f.s, hy, hx * f.s + hz * f.c,
    );
  }

  /** Quad a, b, c, d (in order round its edge) facing (hx, hy, hz). */
  quad(b: LandmarkBucket, colour: Color, a: Vec3, bb: Vec3, c: Vec3, d: Vec3, h: Vec3): void {
    this.tri(b, colour, a[0], a[1], a[2], bb[0], bb[1], bb[2], c[0], c[1], c[2], h[0], h[1], h[2]);
    this.tri(b, colour, a[0], a[1], a[2], c[0], c[1], c[2], d[0], d[1], d[2], h[0], h[1], h[2]);
  }

  /**
   * A box w (x) by d (z) standing on y0, h tall, centred on (cx, cz): four sides and a top
   * (no bottom unless asked). `taper` scales the top (1: straight sides; 0.8: battered walls).
   */
  box(b: LandmarkBucket, colour: Color, cx: number, y0: number, cz: number, w: number, h: number, d: number, o: { top?: boolean; bottom?: boolean; taper?: number; topColour?: Color } = {}): void {
    const t = o.taper ?? 1;
    const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2;
    const u0 = cx - (w * t) / 2, u1 = cx + (w * t) / 2, v0 = cz - (d * t) / 2, v1 = cz + (d * t) / 2;
    const y1 = y0 + h;
    this.quad(b, colour, [x0, y0, z0], [x1, y0, z0], [u1, y1, v0], [u0, y1, v0], [0, 0, -1]);
    this.quad(b, colour, [x1, y0, z0], [x1, y0, z1], [u1, y1, v1], [u1, y1, v0], [1, 0, 0]);
    this.quad(b, colour, [x1, y0, z1], [x0, y0, z1], [u0, y1, v1], [u1, y1, v1], [0, 0, 1]);
    this.quad(b, colour, [x0, y0, z1], [x0, y0, z0], [u0, y1, v0], [u0, y1, v1], [-1, 0, 0]);
    if (o.top ?? true) this.quad(b, o.topColour ?? colour, [u0, y1, v0], [u1, y1, v0], [u1, y1, v1], [u0, y1, v1], [0, 1, 0]);
    if (o.bottom) this.quad(b, colour, [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0]);
  }

  /**
   * An upright n-sided prism of circumradius r on (cx, y0, cz), h tall; `r1` the top's radius (a
   * frustum), `rot` turns it (default: a flat side toward -z). Top cap unless top: false; a bottom
   * cap (facing down) if bottom: true, for parts the eye can see from below (overhangs, cornices).
   */
  prism(b: LandmarkBucket, colour: Color, cx: number, y0: number, cz: number, r: number, h: number, sides: number, o: { top?: boolean; bottom?: boolean; r1?: number; rot?: number; topColour?: Color } = {}): void {
    const r1 = o.r1 ?? r;
    const a0 = (o.rot ?? 0) * D2R + Math.PI / sides;
    const y1 = y0 + h;
    if (o.bottom && r > 0) {
      const p = (i: number): Vec3 => {
        const a = a0 + (i * 2 * Math.PI) / sides;
        return [cx + r * Math.sin(a), y0, cz - r * Math.cos(a)];
      };
      const p0 = p(0);
      for (let i = 1; i < sides - 1; i++) {
        const p1 = p(i), p2 = p(i + 1);
        this.tri(b, colour, p0[0], p0[1], p0[2], p2[0], p2[1], p2[2], p1[0], p1[1], p1[2], 0, -1, 0);
      }
    }
    for (let i = 0; i < sides; i++) {
      const a = a0 + (i * 2 * Math.PI) / sides, b2 = a0 + ((i + 1) * 2 * Math.PI) / sides, m = (a + b2) / 2;
      const s0 = Math.sin(a), c0 = -Math.cos(a), s1 = Math.sin(b2), c1 = -Math.cos(b2);
      this.quad(b, colour, [cx + r * s0, y0, cz + r * c0], [cx + r * s1, y0, cz + r * c1], [cx + r1 * s1, y1, cz + r1 * c1], [cx + r1 * s0, y1, cz + r1 * c0], [Math.sin(m), 0, -Math.cos(m)]);
    }
    if ((o.top ?? true) && r1 > 0) {
      const tc = o.topColour ?? colour;
      const p = (i: number): Vec3 => {
        const a = a0 + (i * 2 * Math.PI) / sides;
        return [cx + r1 * Math.sin(a), y1, cz - r1 * Math.cos(a)];
      };
      const p0 = p(0);
      for (let i = 1; i < sides - 1; i++) {
        const p1 = p(i), p2 = p(i + 1);
        this.tri(b, tc, p0[0], p0[1], p0[2], p1[0], p1[1], p1[2], p2[0], p2[1], p2[2], 0, 1, 0);
      }
    }
  }

  /** An n-sided spire (pyramid) of circumradius r on (cx, y0, cz), h tall; default a flat face toward -z. */
  spire(b: LandmarkBucket, colour: Color, cx: number, y0: number, cz: number, r: number, h: number, sides: number, rot = 0): void {
    const a0 = rot * D2R + Math.PI / sides;
    for (let i = 0; i < sides; i++) {
      const a = a0 + (i * 2 * Math.PI) / sides, b2 = a0 + ((i + 1) * 2 * Math.PI) / sides, m = (a + b2) / 2;
      // the face's normal leans out by the spire's slope
      const k = r * Math.cos(Math.PI / sides);
      this.tri(b, colour, cx + r * Math.sin(a), y0, cz - r * Math.cos(a), cx + r * Math.sin(b2), y0, cz - r * Math.cos(b2), cx, y0 + h, cz, Math.sin(m) * h, k, -Math.cos(m) * h);
    }
  }

  /** A rectangular pyramid w by d on (cx, y0, cz), h tall (a hipped tower roof). */
  pyramid(b: LandmarkBucket, colour: Color, cx: number, y0: number, cz: number, w: number, d: number, h: number): void {
    const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2, ty = y0 + h;
    this.tri(b, colour, x0, y0, z0, x1, y0, z0, cx, ty, cz, 0, w / 2, -h);
    this.tri(b, colour, x1, y0, z0, x1, y0, z1, cx, ty, cz, h, d / 2, 0);
    this.tri(b, colour, x1, y0, z1, x0, y0, z1, cx, ty, cz, 0, w / 2, h);
    this.tri(b, colour, x0, y0, z1, x0, y0, z0, cx, ty, cz, -h, d / 2, 0);
  }

  /**
   * A pitched roof w (x) by d (z) on y0, its ridge h above, running along z: two slopes and two gable
   * ends (in `ends`, default the roof colour). `hip` > 0 hips the ends in by that many metres instead.
   */
  gable(b: LandmarkBucket, colour: Color, cx: number, y0: number, cz: number, w: number, d: number, h: number, o: { ends?: Color; endsBucket?: LandmarkBucket; hip?: number } = {}): void {
    const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2, ty = y0 + h;
    const hip = Math.min(o.hip ?? 0, d / 2);
    const r0 = z0 + hip, r1 = z1 - hip;
    this.quad(b, colour, [x0, y0, z0], [x0, y0, z1], [cx, ty, r1], [cx, ty, r0], [-h, w / 2, 0]);
    this.quad(b, colour, [x1, y0, z1], [x1, y0, z0], [cx, ty, r0], [cx, ty, r1], [h, w / 2, 0]);
    const eb = o.endsBucket ?? b, ec = o.ends ?? colour;
    // a gable end is upright; a hipped end leans back by the roof's slope
    const ey = hip > 0 ? hip : 0, ez = hip > 0 ? h : 1;
    this.tri(eb, ec, x1, y0, z0, x0, y0, z0, cx, ty, r0, 0, ey, -ez);
    this.tri(eb, ec, x0, y0, z1, x1, y0, z1, cx, ty, r1, 0, ey, ez);
  }

  /** A flat n-gon of radius r centred on (cx, cy, cz), facing direction n (a clock face, a rose window). */
  disc(b: LandmarkBucket, colour: Color, cx: number, cy: number, cz: number, r: number, sides: number, n: Vec3): void {
    // two axes across the normal
    const [nx, ny, nz] = n;
    const len = Math.hypot(nx, ny, nz) || 1;
    const N: Vec3 = [nx / len, ny / len, nz / len];
    const up: Vec3 = Math.abs(N[1]) > 0.9 ? [0, 0, -1] : [0, 1, 0];
    const u: Vec3 = norm(cross(up, N));
    const v = cross(N, u);
    let px = cx + r * v[0], py = cy + r * v[1], pz = cz + r * v[2];
    for (let i = 1; i <= sides; i++) {
      const a = (i * 2 * Math.PI) / sides;
      const s = Math.sin(a) * r, c = Math.cos(a) * r;
      const qx = cx + u[0] * s + v[0] * c, qy = cy + u[1] * s + v[1] * c, qz = cz + u[2] * s + v[2] * c;
      this.tri(b, colour, cx, cy, cz, px, py, pz, qx, qy, qz, N[0], N[1], N[2]);
      px = qx; py = qy; pz = qz;
    }
  }

  /** One bucket's triangles as a mesh (with a placeholder material until the layer swaps it), or null if empty. */
  mesh(b: LandmarkBucket, name: string): THREE.Mesh | null {
    const mb = this.parts.get(b);
    if (!mb || mb.triangles === 0) return null;
    const buf = mb.build();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(buf.position, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(buf.normal, 3));
    g.setAttribute('color', new THREE.BufferAttribute(buf.color, 3));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, placeholder(b));
    m.name = `${name}-${b}`;
    m.userData.bucket = b;
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  }

  /** Every bucket used, one mesh each, in a group named `name`. */
  group(name: string): THREE.Group {
    const g = new THREE.Group();
    g.name = name;
    for (const b of LANDMARK_BUCKETS) {
      const m = this.mesh(b, name);
      if (m) g.add(m);
    }
    return g;
  }

  private builder(b: LandmarkBucket): MeshBuilder {
    let mb = this.parts.get(b);
    if (!mb) this.parts.set(b, (mb = new MeshBuilder(512)));
    return mb;
  }

  private rgb(c: Color): RGB {
    let v = this.cache.get(c);
    if (!v) {
      this.colours.add(c.toLowerCase());
      this.cache.set(c, (v = linearColour(c)));
    }
    return v;
  }
}

export type Vec3 = [number, number, number];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
