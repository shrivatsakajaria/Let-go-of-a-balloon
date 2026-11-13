/**
 * The Shibuya scramble crossing: a place, not a tower. The dark roadway with its zebra crossings
 * (four round the junction and the long diagonal from the station side to the far corner), the
 * corner buildings that face it with their big video screens (the curved glass front on the north
 * corner, the screen stacks on the station-front block and the corners west and east), and the
 * crowds that stream across all at once when the lights stop the traffic (the CSV's animated
 * touch). No logos and no text anywhere: the screens are plain panels that light from dusk.
 *
 * Model frame (types.ts): origin on the ground in the middle of the junction; the front (local -z)
 * looks toward Hachiko Square and the station (170.8 deg: the launch spot looks back along 350.8),
 * +x to the west (Dogenzaka). Plan from OpenStreetMap (the crossing ways and the corner buildings'
 * outlines, 2026-11), in this frame.
 */
import * as THREE from 'three';
import { Kit, LANDMARK_COLOURS as C } from '../kit';
import type { LandmarkModel } from '../types';
import type { Color } from '../../world/palette';

type P = [number, number];

/** Walls start this far below the junction (Dogenzaka climbs to the west). */
const B = -6;
/** The roadway's top above the junction's ground point: high enough to stay over the map's own streets where the junction is not quite level. */
const ROAD = 1.0;

/** A prism on a plan outline (star-shaped about its centroid): walls from y0 to y1 and a flat top. */
function extrude(k: Kit, b: 'walls' | 'plain', colour: Color, pts: P[], y0: number, y1: number, top: Color | null): void {
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length, cz = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  for (let i = 0; i < pts.length; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[(i + 1) % pts.length];
    let nx = bz - az, nz = -(bx - ax);
    // outward: away from the centroid
    if (nx * ((ax + bx) / 2 - cx) + nz * ((az + bz) / 2 - cz) < 0) (nx = -nx), (nz = -nz);
    k.quad(b, colour, [ax, y0, az], [bx, y0, bz], [bx, y1, bz], [ax, y1, az], [nx, 0, nz]);
  }
  if (top) for (let i = 0; i < pts.length; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[(i + 1) % pts.length];
    k.tri('plain', top, cx, y1, cz, ax, y1, az, bx, y1, bz, 0, 1, 0);
  }
}

/** A video screen on the outline edge a-b (outer side, away from (ox, oz)): an iron frame and the panel. */
function screen(k: Kit, a: P, b: P, y0: number, y1: number, o: P = [0, 0], inset = 0.12): void {
  const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz);
  let nx = dz / len, nz = -dx / len;
  if (nx * ((a[0] + b[0]) / 2 - o[0]) + nz * ((a[1] + b[1]) / 2 - o[1]) < 0) (nx = -nx), (nz = -nz);
  const at = (t: number, off: number, y: number): [number, number, number] => [a[0] + dx * t + nx * off, y, a[1] + dz * t + nz * off];
  k.quad('plain', C.iron, at(inset, 0.3, y0), at(1 - inset, 0.3, y0), at(1 - inset, 0.3, y1), at(inset, 0.3, y1), [nx, 0, nz]);
  const m = inset + 0.6 / len;
  k.quad('glow', C.chalk, at(m, 0.45, y0 + 0.6), at(1 - m, 0.45, y0 + 0.6), at(1 - m, 0.45, y1 - 0.6), at(m, 0.45, y1 - 0.6), [nx, 0, nz]);
}

/** A zebra crossing from a to b, w wide: bars across the walk, 0.6 m wide every 1.2 m. */
function zebra(k: Kit, a: P, b: P, w: number): void {
  const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz);
  const ux = dx / len, uz = dz / len, vx = -uz * (w / 2), vz = ux * (w / 2);
  const y = ROAD + 0.03;
  for (let s = 0.9; s + 0.6 < len - 0.6; s += 1.2) {
    const x0 = a[0] + ux * s, z0 = a[1] + uz * s, x1 = x0 + ux * 0.6, z1 = z0 + uz * 0.6;
    k.quad('plain', C.chalk, [x0 - vx, y, z0 - vz], [x0 + vx, y, z0 + vz], [x1 + vx, y, z1 + vz], [x1 - vx, y, z1 - vz], [0, 1, 0]);
  }
}

/** The crossings (curb to curb, model frame) and their widths. */
const CROSSINGS: [P, P, number][] = [
  [[22.4, 16.5], [29.6, -2.6], 6], // west, over Dogenzaka
  [[-4.6, 19.6], [-21.2, 12.3], 6], // north, over Jingu-dori
  [[-18.4, -17.2], [-24.6, 1.2], 6], // east, toward the station's west exit
  [[23.2, -11.4], [-2.6, -21.4], 7], // south, from Hachiko Square
  [[-10.6, -17.1], [3.6, 15.2], 6], // the diagonal, station corner to the north corner
];

/** The roadway of the junction (dark asphalt under the white bars). */
const ROADWAY: P[] = [[32, -4], [26, 19], [-4, 23], [-24, 16], [-28, -1], [-21, -20], [-2, -25], [25, -14]];

/** Corner buildings (outlines from OSM, simplified) with height and the screens on their crossing faces. */
const QFRONT: P[] = [[17.3, 60.0], [-10.9, 46.8], [-9.8, 44.3], [-4.2, 31.0], [1.6, 30.6], [7.8, 30.6], [13.5, 32.3], [24.7, 47.7]];
const MAGNET: P[] = [[-45.2, 64.4], [-59.7, 53.6], [-51.7, 19.0], [-48.9, 1.8], [-32.1, 5.4], [-26.6, 15.6]];
const EKIMAE: P[] = [[65.9, 1.2], [49.1, -2.1], [41.2, -15.7], [52.6, -46.6], [62.5, -48.3], [74.0, -25.0], [72.8, -16.7]];
const WEST: P[] = [[81.9, 64.2], [91.9, 37.1], [68.8, 30.9], [61.7, 58.1]];
const NORTHWEST: P[] = [[55.2, 64.8], [51.0, 64.9], [28.9, 34.3], [36.1, 29.6], [64.4, 31.1]];

/** The people: crowds that wait at the curbs and cross together when the traffic stops. */
const CYCLE_S = 90;
const WALK_S = 34;
const CROSS_S = 22;
const PER_FLOW = 22;

type Flow = { mesh: THREE.Mesh; ax: number; az: number; dx: number; dz: number; delay: number };

/** A crowd of PER_FLOW people round (0, 0): small figures, mostly dark coats, wound along +z. */
function crowd(seed: number, w: number): Kit {
  const k = new Kit();
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const coats: Color[] = [C.iron, C.iron, C.slate, C.iron, C.chalkShade, C.stoneDeep];
  for (let i = 0; i < PER_FLOW; i++) {
    const x = (rnd() - 0.5) * w * 0.8, z = (rnd() - 0.5) * 7;
    k.spire('plain', coats[Math.floor(rnd() * coats.length)], x, ROAD, z, 0.38, 1.7, 4, 45);
  }
  return k;
}

export const model: LandmarkModel = {
  build(style) {
    const k = new Kit();
    const wall = (i: number) => style.walls[i % style.walls.length];
    const roof = style.roofs[0];
    // the junction: asphalt, then the bars
    extrude(k, 'plain', C.iron, ROADWAY, -2, ROAD, C.iron);
    for (const [a, b, w] of CROSSINGS) zebra(k, a, b, w);

    // the north corner: the tall curved glass front and its great screen
    extrude(k, 'walls', wall(0), QFRONT, B, 45.9, roof);
    extrude(k, 'plain', C.slate, [[-4, 44], [4, 40], [14, 46], [8, 52]], 45.9, 49, C.slate);
    for (let i = 3; i < 6; i++) screen(k, QFRONT[i], QFRONT[i + 1], 14, 41, [6, 43], 0.02);
    screen(k, QFRONT[6], QFRONT[7], 20, 36, [6, 43]);
    // the east corner: a screen on its corner face and a billboard frame on the roof
    extrude(k, 'walls', wall(1), MAGNET, B, 34.2, roof);
    screen(k, MAGNET[4], MAGNET[5], 12, 30, [-46, 38]);
    screen(k, MAGNET[3], MAGNET[4], 22, 31, [-46, 38]);
    k.box('plain', C.iron, -40, 34.2, 6, 1, 8, 1);
    // the station-front block: three screens stacked on its corner face
    extrude(k, 'walls', wall(2), EKIMAE, B, 35.1, roof);
    for (const [y0, y1] of [[8, 16], [17.5, 25.5], [27, 34.5]]) screen(k, EKIMAE[1], EKIMAE[2], y0, y1, [58, -21]);
    // the west corner block, a big screen standing on its roof toward the crossing
    extrude(k, 'walls', wall(0), WEST, B, 37.8, roof);
    k.box('plain', C.iron, 66, 37.8, 46, 4, 2, 22);
    screen(k, [64.8, 57.5], [70.8, 34.5], 39.8, 52, [80, 48], 0.02);
    // the north-west corner between the shopping streets
    extrude(k, 'walls', wall(1), NORTHWEST, B, 24.1, roof);
    screen(k, NORTHWEST[2], NORTHWEST[3], 8, 22, [49, 51], 0.05);

    const g = k.group('tokyo-shibuya-crossing');
    // the crowds: two flows on every crossing, one each way, a little apart
    const flows: Flow[] = [];
    CROSSINGS.forEach(([a, b, w], i) => {
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const ux = (b[0] - a[0]) / len, uz = (b[1] - a[1]) / len;
      for (const dir of [1, -1]) {
        const [s, e] = dir === 1 ? [a, b] : [b, a];
        const mesh = crowd(7 + i * 31 + (dir === 1 ? 0 : 17), w).mesh('plain', `crowd-${i}-${dir}`)!;
        mesh.castShadow = false;
        // the crowd's long side along the walk
        mesh.rotation.y = Math.atan2(-ux, -uz);
        const side = dir * w * 0.22;
        const ax = s[0] - uz * side, az = s[1] + ux * side;
        mesh.position.set(ax, 0, az);
        flows.push({ mesh, ax, az, dx: e[0] - s[0], dz: e[1] - s[1], delay: ((i * 3 + (dir === 1 ? 0 : 2)) % 5) * 0.8 });
        g.add(mesh);
      }
    });
    g.userData.flows = flows;
    return g;
  },

  animate(group, utcMs) {
    const flows = group.userData.flows as Flow[] | undefined;
    if (!flows) return;
    const t = (((utcMs / 1000) % CYCLE_S) + CYCLE_S) % CYCLE_S;
    for (let i = 0; i < flows.length; i++) {
      const f = flows[i];
      // waiting at the curb, then over in CROSS_S (eased), then gone into the streets until the crowd gathers again
      const w = t - f.delay;
      let p = 0;
      if (w >= 0 && w < WALK_S) p = Math.min(1, w / CROSS_S);
      const crossed = w >= CROSS_S && w < CROSS_S + 6;
      f.mesh.visible = !(w >= CROSS_S + 6 && w < WALK_S + 24);
      const e = p * p * (3 - 2 * p);
      const q = crossed ? 1 : e;
      f.mesh.position.set(f.ax + f.dx * q, 0, f.az + f.dz * q);
    }
  },
};
