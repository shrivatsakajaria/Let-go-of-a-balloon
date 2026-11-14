import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { LatLon } from '../geo/coords';

/**
 * The person's figure (Task 26d, ruling R62): anonymous and faceless, so anyone can see themselves
 * in them, and warm through silhouette, colour and posture rather than detail. Slightly stylised (a
 * touch larger head and hands, soft rounded forms), low-poly and flat-shaded like the rest of the
 * world, but every part is a turned, bevelled shape (no bare cylinders or balls).
 *
 * Outfits: a coat in a warm muted tone, a contrasting scarf, a hat or a hair shape, dark trousers.
 * Every colour stays far below the balloon's chroma, so the balloon is still the one bright thing.
 * The outfit is chosen from the start place (outfitFor), so a place always shows the same person.
 *
 * The rig: one skinned mesh (a single draw call), each part rigidly on one bone. Bones, in bone-local
 * metres (the model faces -z, x is the person's right, y up; arms hang along -y):
 *   base (feet on the ground) > feet (pivot at the balls of the feet), body (sway, rise) > torso (hips,
 *   y 0.92) > neck (y 1.47) | tail1 > tail2 (the scarf's end) | shoulder > roll > elbow > wrist >
 *   thumb, finger1 > finger2 (each side).
 */
export type Headwear = 'beanie' | 'bob' | 'cap' | 'bun';
export type Outfit = {
  name: string;
  coat: string;
  /** Belt, cuffs and buttons. */
  trim: string;
  scarf: string;
  trousers: string;
  shoes: string;
  skin: string;
  hair: string;
  /** The hat's colour (beanie, cap). */
  hat: string;
  headwear: Headwear;
};

export const OUTFITS: readonly Outfit[] = [
  { name: 'camel', coat: '#b48e6a', trim: '#8f6e50', scarf: '#4d6585', trousers: '#555b68', shoes: '#2e2b2a', skin: '#e3c2a6', hair: '#5a4334', hat: '#4d6585', headwear: 'beanie' },
  { name: 'plum', coat: '#93707a', trim: '#765860', scarf: '#e8dcc4', trousers: '#4f566b', shoes: '#2a2627', skin: '#c79676', hair: '#3a2b25', hat: '#3a2b25', headwear: 'bob' },
  { name: 'ochre', coat: '#ab8b56', trim: '#8a6c40', scarf: '#3e6b6e', trousers: '#5f5a53', shoes: '#2b2b2d', skin: '#8f6249', hair: '#241d1a', hat: '#4b4b52', headwear: 'cap' },
  { name: 'chestnut', coat: '#8c6a56', trim: '#6e5242', scarf: '#9bb3c4', trousers: '#55565c', shoes: '#262424', skin: '#d9ab8c', hair: '#1f1a18', hat: '#1f1a18', headwear: 'bun' },
];

/** The outfit for a start place: the same place always gets the same one. */
export function outfitFor(at: LatLon): number {
  const lat = Math.round(at.lat * 1e4) / 1e4, lon = Math.round(at.lon * 1e4) / 1e4;
  const h = Math.sin(lat * 12.9898 + lon * 78.233) * 43758.5453;
  const f = h - Math.floor(h);
  return Math.min(OUTFITS.length - 1, Math.floor(f * OUTFITS.length));
}

export type BoneName =
  | 'base' | 'feet' | 'body' | 'torso' | 'neck' | 'tail1' | 'tail2'
  | 'shoulderR' | 'rollR' | 'elbowR' | 'wristR' | 'thumbR' | 'finger1R' | 'finger2R'
  | 'shoulderL' | 'rollL' | 'elbowL' | 'wristL' | 'thumbL' | 'finger1L' | 'finger2L';

/** Bone rest positions, relative to the parent bone. */
export const SHOULDER_Y = 1.395;
export const HIP_Y = 0.92;
export const NECK_Y = 1.47;
export const UPPER_ARM_M = 0.28;
export const FOREARM_M = 0.25;
export const PALM_M = 0.092;
export const FINGER1_M = 0.048;
export const FINGER2_M = 0.044;
const BALL_Z = -0.14; // the balls of the feet

export type Rig = {
  mesh: THREE.SkinnedMesh;
  bones: Record<BoneName, THREE.Bone>;
  /** Where the string sits in each fist (on the first finger segment) and where it leaves the fingertips (on the second). */
  gripIn: THREE.Object3D;
  gripOut: THREE.Object3D;
  material: THREE.MeshStandardMaterial;
  triangles: number;
};

// ---- shapes ----

type Prof = [number, number][]; // [radius, y]

/** A turned shape: the profile (radius, y) turned about y in `segs` facets; sx and sz scale it to an oval. */
function lathe(prof: Prof, segs: number, o: { sx?: number; sz?: number; phi0?: number; phiLen?: number } = {}): THREE.BufferGeometry {
  const g = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(Math.max(r, 1e-4), y)), segs, o.phi0 ?? 0, o.phiLen ?? Math.PI * 2);
  g.scale(o.sx ?? 1, 1, o.sz ?? 1);
  return g;
}

/** A bevelled block of half-sizes hx, hz, from y = 0 down to y = -len (a finger, a palm). */
function block(hx: number, hz: number, len: number, bevel: number, segs = 8, top = 0): THREE.BufferGeometry {
  const b = Math.min(bevel, len / 3);
  const prof: Prof = [
    [0, top + b * 0.3],
    [0.72, top],
    [1, -b],
    [1, -len + b],
    [0.72, -len],
    [0, -len - b * 0.3],
  ];
  // an octagon (rotated so its flats face the axes) scaled to the block's section
  const g = lathe(prof, segs, { phi0: Math.PI / segs });
  const k = 1 / Math.cos(Math.PI / segs);
  g.scale(hx * k, 1, hz * k);
  return g;
}

class Parts {
  readonly geos: THREE.BufferGeometry[] = [];
  add(g: THREE.BufferGeometry, hex: string, bone: number, m?: THREE.Matrix4): void {
    const ng = g.index ? g.toNonIndexed() : g;
    if (ng !== g) g.dispose();
    if (m) ng.applyMatrix4(m);
    ng.deleteAttribute('uv');
    ng.deleteAttribute('normal');
    const n = ng.getAttribute('position').count;
    const c = new THREE.Color(hex); // sRGB hex to the working (linear) space
    const col = new Float32Array(n * 3);
    const si = new Uint16Array(n * 4);
    const sw = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
      si[i * 4] = bone;
      sw[i * 4] = 1;
    }
    ng.setAttribute('color', new THREE.BufferAttribute(col, 3));
    ng.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    ng.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
    this.geos.push(ng);
  }
}

const M = () => new THREE.Matrix4();
const T = (x: number, y: number, z: number) => M().makeTranslation(x, y, z);
const RX = (a: number) => M().makeRotationX(a);
const RZ = (a: number) => M().makeRotationZ(a);
const mul = (...ms: THREE.Matrix4[]) => ms.reduce((a, b) => a.multiply(b), M());

/** Build the person in an outfit: bones in their rest pose, the skinned mesh bound to them. */
export function buildFigure(outfit: Outfit): Rig {
  const bones = {} as Record<BoneName, THREE.Bone>;
  const order: BoneName[] = [];
  const bone = (name: BoneName, parent: BoneName | null, x: number, y: number, z: number) => {
    const b = new THREE.Bone();
    b.name = name;
    b.position.set(x, y, z);
    if (parent) bones[parent].add(b);
    bones[name] = b;
    order.push(name);
    return b;
  };
  bone('base', null, 0, 0, 0);
  bone('feet', 'base', 0, 0, BALL_Z);
  bone('body', 'base', 0, 0, 0);
  bone('torso', 'body', 0, HIP_Y, 0);
  bone('neck', 'torso', 0, NECK_Y - HIP_Y, 0);
  bone('tail1', 'torso', -0.05, NECK_Y - HIP_Y - 0.015, 0.1);
  bone('tail2', 'tail1', 0, -0.15, 0);
  for (const [s, side] of [['R', 1], ['L', -1]] as const) {
    bone(`shoulder${s}`, 'torso', 0.185 * side, SHOULDER_Y - HIP_Y, 0.005);
    bone(`roll${s}`, `shoulder${s}`, 0, 0, 0);
    bone(`elbow${s}`, `roll${s}`, 0, -UPPER_ARM_M, 0);
    bone(`wrist${s}`, `elbow${s}`, 0, -FOREARM_M, 0);
    bone(`thumb${s}`, `wrist${s}`, -0.022 * side, -0.028, -0.036);
    bone(`finger1${s}`, `wrist${s}`, 0, -PALM_M, 0);
    bone(`finger2${s}`, `finger1${s}`, 0, -FINGER1_M, 0);
  }
  const idx = (n: BoneName) => order.indexOf(n);
  const o = outfit;
  const P = new Parts();

  // feet: rounded shoes with flat soles, from the heel (+z) to the toe (-z), pivoting at the balls
  for (const side of [1, -1]) {
    const shoe = lathe([[0, -0.15], [0.04, -0.145], [0.055, -0.11], [0.058, 0], [0.054, 0.07], [0.04, 0.1], [0, 0.11]], 8, { sx: 1, sz: 0.85 });
    shoe.applyMatrix4(RX(-Math.PI / 2)); // length along z, toe toward -z
    const p = shoe.getAttribute('position');
    for (let i = 0; i < p.count; i++) p.setY(i, Math.max(-0.006, p.getY(i))); // the sole: flat
    shoe.scale(1, 1.2, 1);
    P.add(shoe, o.shoes, idx('feet'), T(0.095 * side, 0.007, 0.06));
  }

  // legs: trousers, tapering to the ankle, up into the coat
  for (const side of [1, -1]) {
    const leg = lathe([[0.05, 0.06], [0.054, 0.1], [0.061, 0.33], [0.059, 0.5], [0.07, 0.72], [0.078, 0.94], [0.03, 0.98]], 8, { sz: 0.92 });
    P.add(leg, o.trousers, idx('body'), T(0.088 * side, 0, 0.005));
  }

  // the coat: A-line to above the knee, soft shoulders; a belt, three buttons
  const coatZ = 0.7;
  const coat = lathe(
    [[0, 0.585], [0.165, 0.57], [0.204, 0.585], [0.2, 0.66], [0.182, 0.84], [0.166, 0.99], [0.172, 1.08], [0.186, 1.2], [0.192, 1.29], [0.182, 1.36], [0.155, 1.42], [0.1, 1.46], [0, 1.475]],
    12,
    { sz: coatZ },
  );
  P.add(coat, o.coat, idx('torso'), T(0, -HIP_Y, 0));
  const belt = lathe([[0.17, 0.99], [0.178, 0.996], [0.178, 1.045], [0.172, 1.052]], 12, { sz: coatZ * 1.04 });
  P.add(belt, o.trim, idx('torso'), T(0, -HIP_Y, 0));
  for (const [y, r] of [[1.12, 0.177], [1.2, 0.186], [1.28, 0.192]]) {
    const button = lathe([[0, 0.006], [0.011, 0], [0, -0.006]], 6);
    P.add(button, o.trim, idx('torso'), mul(T(0.022, y - HIP_Y, -r * coatZ - 0.002), RX(Math.PI / 2)));
  }

  // the scarf: a chunky wrap round the neck, one end down the front, one over the back on the wind
  const wrap = lathe([[0.062, 1.42], [0.1, 1.425], [0.115, 1.45], [0.108, 1.484], [0.084, 1.502], [0.056, 1.505]], 10, { sz: 0.92 });
  P.add(wrap, o.scarf, idx('torso'), mul(T(0, -HIP_Y, 0), T(0, 1.47, 0), RX(0.12), T(0, -1.47, 0)));
  const front = block(0.034, 0.011, 0.25, 0.01, 6);
  P.add(front, o.scarf, idx('torso'), mul(T(-0.055, 1.46 - HIP_Y, -0.112), RZ(-0.08), RX(0.16)));
  const tail1 = block(0.034, 0.012, 0.16, 0.01, 6, 0.02);
  P.add(tail1, o.scarf, idx('tail1'));
  const tail2 = block(0.031, 0.011, 0.13, 0.01, 6, 0.01);
  P.add(tail2, o.scarf, idx('tail2'));
  // a little fringe at the end
  const fringe = block(0.033, 0.008, 0.03, 0.006, 6);
  P.add(fringe, o.scarf, idx('tail2'), T(0, -0.13, 0));

  // the head: a faceless, slightly large egg on a neck that clears the scarf
  const HC = 0.176; // head centre above the neck bone
  const neck = lathe([[0.046, -0.02], [0.043, 0.05], [0.047, 0.095]], 8);
  P.add(neck, o.skin, idx('neck'));
  const headProf: Prof = [[0, -0.112], [0.05, -0.104], [0.083, -0.07], [0.099, -0.02], [0.102, 0.025], [0.092, 0.07], [0.064, 0.108], [0.03, 0.124], [0, 0.128]];
  const head = lathe(headProf, 12, { sx: 1.03, sz: 1.08 });
  P.add(head, o.skin, idx('neck'), T(0, HC, 0.006));
  // no features, only a slightly lighter oval where a face would be, so which way they look reads
  const cap: Prof = [];
  for (let i = 0; i <= 3; i++) {
    const a = (0.6 * i) / 3;
    cap.push([0.104 * Math.sin(a), 0.104 * Math.cos(a)]);
  }
  const face = lathe(cap.reverse(), 10, { sx: 0.94 });
  face.applyMatrix4(RX(-Math.PI / 2)); // the cap's axis toward the front (-z)
  face.scale(1, 1.14, 1.08);
  P.add(face, lighten(o.skin, 0.13), idx('neck'), T(0, HC - 0.014, 0.006));
  addHeadwear(P, o, idx('neck'), HC);

  // arms: soft sleeves with a turned-back cuff, big friendly hands (palm, thumb, four fingers in two
  // segments that curl round the string)
  for (const s of ['R', 'L'] as const) {
    const upper = lathe([[0, 0.034], [0.04, 0.028], [0.058, 0.004], [0.06, -0.04], [0.057, -0.16], [0.052, -0.26], [0.03, -0.3], [0, -0.305]], 8, { sz: 0.94 });
    P.add(upper, o.coat, idx(`roll${s}`));
    const fore = lathe([[0, 0.035], [0.042, 0.03], [0.05, 0.0], [0.048, -0.12], [0.045, -0.19]], 8, { sz: 0.94 });
    P.add(fore, o.coat, idx(`elbow${s}`));
    const cuff = lathe([[0.044, -0.18], [0.054, -0.19], [0.055, -0.235], [0.046, -0.245], [0.034, -0.245]], 8, { sz: 0.94 });
    P.add(cuff, o.trim, idx(`elbow${s}`));
    const wristG = lathe([[0.03, 0.012], [0.028, -0.01], [0.02, -0.02]], 6);
    P.add(wristG, o.skin, idx(`wrist${s}`));
    const palm = block(0.022, 0.046, PALM_M + 0.004, 0.012, 8, -0.004);
    P.add(palm, o.skin, idx(`wrist${s}`));
    const thumb = block(0.013, 0.015, 0.06, 0.007, 6, 0.008);
    P.add(thumb, o.skin, idx(`thumb${s}`));
    // four fingers, the middle ones a little longer, with a hair of a gap between them
    const fz = [-0.0345, -0.0115, 0.0115, 0.0345];
    const fl = [1, 1.06, 1.0, 0.86];
    for (let f = 0; f < 4; f++) {
      const z = fz[f];
      const p1 = block(0.016, 0.0105, FINGER1_M * fl[f] + 0.004, 0.006, 4, 0.004);
      P.add(p1, o.skin, idx(`finger1${s}`), T(0, 0, z));
      const p2 = block(0.0145, 0.0098, FINGER2_M * fl[f] * 0.92, 0.009, 4, 0.004);
      P.add(p2, o.skin, idx(`finger2${s}`), T(0, (1 - fl[f]) * FINGER1_M, z));
    }
  }

  const geo = mergeGeometries(P.geos, false)!;
  for (const g of P.geos) g.dispose();
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0, flatShading: true, side: THREE.DoubleSide });
  const mesh = new THREE.SkinnedMesh(geo, material);
  mesh.frustumCulled = false; // a small figure whose arms move past its rest bounds
  const list = order.map((n) => bones[n]);
  mesh.add(bones.base);
  // the rest pose, in world space at bind: the geometry is authored bone-local, so place each part there
  mesh.updateMatrixWorld(true);
  bindLocal(geo, list);
  mesh.bind(new THREE.Skeleton(list));

  // the string in the right fist: inside the curl of the first finger segment, and out at the top
  // of the fingertips (the index side, -z)
  const gripIn = new THREE.Object3D();
  gripIn.position.set(0.011, -0.036, 0);
  bones.finger1R.add(gripIn);
  const gripOut = new THREE.Object3D();
  gripOut.position.set(-0.006, -FINGER2_M * 0.9, -0.05);
  bones.finger2R.add(gripOut);

  return { mesh, bones, gripIn, gripOut, material, triangles: geo.getAttribute('position').count / 3 };
}

/** A hex colour a little toward white. */
function lighten(hex: string, f: number): string {
  return '#' + new THREE.Color(hex).lerp(new THREE.Color('#ffffff'), f).getHexString();
}

/** Move each vertex from its bone's local frame to where that bone sits in the rest pose. */
function bindLocal(geo: THREE.BufferGeometry, bones: THREE.Bone[]): void {
  const p = geo.getAttribute('position') as THREE.BufferAttribute;
  const si = geo.getAttribute('skinIndex') as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).applyMatrix4(bones[si.getX(i)].matrixWorld);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  p.needsUpdate = true;
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
}

function addHeadwear(P: Parts, o: Outfit, neck: number, HC: number): void {
  // hair: a crown over the top, and (by style) a skirt round the back and sides, open at the front
  const crown = (top: number, down: number, r: number) =>
    lathe([[r * 0.98, down], [r * 1.04, (down + top) * 0.5], [r * 0.9, top - 0.03], [r * 0.55, top], [0, top + 0.008]], 12, { sz: 1.08 });
  const skirt = (from: number, to: number, r: number, open = 1.9) =>
    lathe([[r * 0.98, to], [r * 1.05, (from + to) * 0.5], [r * 1.04, from]], 10, { phi0: open / 2 - Math.PI, phiLen: Math.PI * 2 - open, sz: 1.08 }); // round the back (+z), open at the face
  const at = T(0, HC, 0.008);
  if (o.headwear === 'beanie') {
    // hair just showing at the back, a knitted beanie with a turned-up cuff and a small bobble
    P.add(skirt(0.0, -0.06, 0.1, 2.6), o.hair, neck, at);
    const dome = lathe([[0.104, 0.012], [0.108, 0.05], [0.1, 0.095], [0.078, 0.128], [0.04, 0.146], [0, 0.15]], 12, { sz: 1.08 });
    P.add(dome, o.hat, neck, mul(at, RX(0.2)));
    const cuff = lathe([[0.1, -0.006], [0.112, -0.002], [0.115, 0.022], [0.112, 0.042], [0.104, 0.046]], 12, { sz: 1.08 });
    P.add(cuff, o.hat, neck, mul(at, RX(0.2)));
    const bobble = lathe([[0, -0.022], [0.018, -0.016], [0.024, 0], [0.018, 0.016], [0, 0.022]], 6);
    P.add(bobble, o.hat, neck, mul(at, RX(0.2), T(0, 0.16, 0)));
  } else if (o.headwear === 'bob') {
    // a chin-length bob with a soft side fringe
    P.add(crown(0.138, 0.02, 0.106), o.hair, neck, at);
    P.add(skirt(0.03, -0.085, 0.108, 1.7), o.hair, neck, at);
    const fringe = lathe([[0.104, 0.03], [0.11, 0.07], [0.095, 0.11]], 8, { phi0: Math.PI - 0.95, phiLen: 1.9, sz: 1.08 });
    P.add(fringe, o.hair, neck, mul(at, RZ(0.12)));
  } else if (o.headwear === 'cap') {
    // short hair under a flat cap with a little peak
    P.add(skirt(0.02, -0.05, 0.101, 2.4), o.hair, neck, at);
    const cap = lathe([[0.104, 0.02], [0.112, 0.05], [0.112, 0.075], [0.09, 0.112], [0.04, 0.128], [0, 0.13]], 12, { sz: 1.1 });
    P.add(cap, o.hat, neck, mul(at, RX(0.22)));
    const peak = lathe([[0.1, 0.0], [0.155, -0.004], [0.158, 0.002], [0.1, 0.012]], 8, { phi0: Math.PI - 0.95, phiLen: 1.9, sz: 1.0 });
    P.add(peak, o.hat, neck, mul(at, RX(0.22), T(0, 0.045, 0)));
  } else {
    // hair drawn back into a bun
    P.add(crown(0.134, 0.0, 0.105), o.hair, neck, at);
    P.add(skirt(0.01, -0.045, 0.104, 2.3), o.hair, neck, at);
    const bun = lathe([[0, -0.036], [0.03, -0.028], [0.042, 0], [0.032, 0.026], [0, 0.036]], 8);
    P.add(bun, o.hair, neck, mul(at, T(0, 0.1, 0.075), RX(0.7)));
  }
}
