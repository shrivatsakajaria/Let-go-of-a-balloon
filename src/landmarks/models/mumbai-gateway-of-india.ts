/**
 * The Gateway of India (1924), Apollo Bunder: a 26 m triumphal arch of honey-coloured basalt on the
 * harbour wall. The central block (20 m square, 22 m to its cornice) is pierced by the great pointed
 * arch, framed by an alfiz and flanked on both faces by octagonal turrets that end in onion-domed
 * kiosks; a screen wall rings the shallow central dome (15 m across); lower wings with arched halls
 * run out to either side (44 m across in all), each with a small dome; steps go down to the water on
 * the harbour side. Faceted honey stone, Contour colours. The arch's soffit is in the glow bucket: it
 * lights warm from dusk, as the floodlit arch does.
 *
 * Model frame (types.ts): origin on the ground at the centre of the arch, front (local -z) the
 * harbour face (OSM way 28845634: the frontage runs at 52/232 deg, so the arch's axis is 142 deg);
 * the plaza face, which the launch spot sees, is +z. Local +x is the south-west wing.
 */
import { Kit, LANDMARK_COLOURS as C } from '../kit';
import type { LandmarkModel } from '../types';

/** Half the central block's width and depth, m. */
const B = 10;
/** The great arch: half span, springing and apex heights, m. */
const AW = 4.6;
const SPRING = 10;
const APEX = 17.6;
/** Cornice of the central block, m. */
const TOP = 22;
/** Wings: outer end (x), half depth (z), wall height, m. */
const WX = 22;
const WZ = 7;
const WH = 15.5;

/** The left half of the pointed arch, springing to apex: two arcs struck from centres on the springing line. */
/** The left arc's centre (x, on the springing line). */
const ARCH_C = ((APEX - SPRING) ** 2 - AW * AW) / (2 * AW);
function archHalf(n: number): [number, number][] {
  const rise = APEX - SPRING;
  const c = ARCH_C;
  const r = AW + c;
  const t1 = Math.atan2(rise, -c);
  const pts: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const t = Math.PI + ((t1 - Math.PI) * i) / n;
    pts.push([c + r * Math.cos(t), SPRING + r * Math.sin(t)]);
  }
  pts[n] = [0, APEX];
  return pts;
}
const ARCH = archHalf(5);

/** A dark arched opening (door or window) on the -z face at depth z: a w by h panel with a pointed head. */
function opening(k: Kit, colour: string, x: number, y: number, w: number, h: number, z: number): void {
  const a = x - w / 2, b = x + w / 2;
  k.quad('plain', colour, [a, y, z], [b, y, z], [b, y + h, z], [a, y + h, z], [0, 0, -1]);
  k.tri('plain', colour, a, y + h, z, b, y + h, z, x, y + h + w * 0.6, z, 0, 0, -1);
}

/** An octagonal turret on (x, z) from y0 to the cornice, then the kiosk and its onion dome (to about 26 m). */
function turret(k: Kit, x: number, z: number, r: number, y0: number, top: number): void {
  k.prism('plain', C.stone, x, y0, z, r, top - y0, 8, { top: false });
  k.prism('plain', C.chalk, x, SPRING - 0.4, z, r + 0.2, 0.6, 8, { top: false });
  k.prism('plain', C.chalk, x, top - 0.6, z, r, 0.6, 8, { r1: r + 0.25 });
  // the open kiosk reads dark between its posts
  k.prism('plain', C.stoneDeep, x, top, z, r * 0.85, 1.9, 8, { top: false });
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2 + Math.PI / 8;
    k.box('plain', C.stone, x + Math.sin(a) * r * 0.85, top, z - Math.cos(a) * r * 0.85, 0.35, 1.9, 0.35, { top: false });
  }
  k.prism('plain', C.chalk, x, top + 1.9, z, r * 0.85, 0.35, 8, { r1: r + 0.25 });
  // onion: swells, then draws in to a point
  k.prism('plain', C.sand, x, top + 2.25, z, r * 0.9, 0.6, 8, { r1: r * 1.15, top: false });
  k.prism('plain', C.sand, x, top + 2.85, z, r * 1.15, 0.7, 8, { r1: r * 0.8, top: false });
  k.spire('plain', C.sand, x, top + 3.55, z, r * 0.8, 1.3, 8);
  k.prism('plain', C.gilt, x, top + 4.75, z, 0.08, 0.7, 4);
}

/** Everything on one face of the central block and its wings (the -z face of the current frame). */
function face(k: Kit): void {
  const z = -B;
  // spandrels between the arch and its square head, and the soffit (glow: floodlit from dusk)
  for (const s of [-1, 1]) {
    for (let i = 0; i < ARCH.length - 1; i++) {
      const [x0, y0] = ARCH[i], [x1, y1] = ARCH[i + 1];
      const X0 = s * x0, X1 = s * x1;
      k.quad('plain', C.stone, [X0, y0, z], [X1, y1, z], [X1, APEX, z], [X0, APEX, z], [0, 0, -1]);
      // the soffit faces the arc's centre (mirrored for the right half): down and into the opening
      const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
      k.quad('glow', C.chalkShade, [X0, y0, z], [X1, y1, z], [X1, y1, 0], [X0, y0, 0], [s * (ARCH_C - mx), SPRING - my, 0]);
    }
  }
  // the opening's sides below the springing (the soffit's straight part)
  for (const s of [-1, 1]) {
    const x = s * (AW - 0.05);
    k.quad('glow', C.chalkShade, [x, 0, z], [x, SPRING, z], [x, SPRING, 0], [x, 0, 0], [-s, 0, 0]);
  }
  // the alfiz: a raised frame round the arch, and a carved panel over it
  for (const s of [-1, 1]) k.box('plain', C.chalk, s * (AW + 0.5), 0, z - 0.15, 1.0, APEX + 1.0, 0.3);
  k.box('plain', C.chalk, 0, APEX, z - 0.15, 2 * AW + 2, 1.0, 0.3);
  k.box('plain', C.sand, 0, APEX + 1.0, z - 0.08, 2 * AW + 2, 2.4, 0.16, { top: false });
  for (const x of [-3.4, -1.1, 1.1, 3.4]) opening(k, C.stoneDeep, x, APEX + 1.3, 1.2, 1.2, z - 0.18);
  // the turrets flanking the arch
  for (const s of [-1, 1]) turret(k, s * 7.6, z + 1.1, 1.6, -1, TOP + 0.6);
  // a niche on each outer pier
  for (const s of [-1, 1]) opening(k, C.stoneDeep, s * 9.5, 3, 0.7, 6, z - 0.05);
  // the screen wall over the arch (24.5 m) and the cornice parapet
  k.box('plain', C.chalkShade, 0, TOP, -8, 16.5, 2.5, 0.5);
  for (const x of [-5.5, -2.75, 0, 2.75, 5.5]) k.prism('plain', C.sand, x, TOP + 2.5, -8, 0.35, 0.8, 4, { rot: 45 });
  k.box('plain', C.chalkShade, 0, TOP + 0.2, z + 0.25, 2 * B, 1.1, 0.5);
  // the wings' halls: arched doors below, windows above (and on the wing's end)
  for (const s of [-1, 1]) {
    for (const x of [13.2, 18.8]) opening(k, C.iron, s * x, 0, 2.6, 5.4, -WZ - 0.05);
    for (const x of [12.6, 16, 19.4]) opening(k, C.stoneDeep, s * x, 8.6, 1.6, 3.4, -WZ - 0.05);
    for (const x of [12.6, 16, 19.4]) opening(k, C.stoneDeep, s * x, 13.1, 1.0, 0.9, -WZ - 0.05);
    // a band at the halls' floor line
    k.box('plain', C.chalk, s * (B + (WX - B) / 2), 7.4, -WZ - 0.1, WX - B, 0.5, 0.2, { top: false });
  }
}

export const model: LandmarkModel = {
  build() {
    const k = new Kit();
    // the platform on the harbour wall, and the steps down to the water on the harbour side
    k.box('plain', C.stoneDeep, 0, -4, 0, 2 * B + 2.4, 4.6, 2 * B + 2.4, { topColour: C.paving });
    k.box('plain', C.stoneDeep, 0, -4, 0, 2 * WX + 2.6, 4.6, 2 * WZ + 2.6, { topColour: C.paving });
    for (let i = 0; i < 4; i++) k.box('plain', C.paving, 0, -4, -B - 1.8 - i * 1.2, 16, 4.1 - i * 0.5, 1.2, { topColour: C.paving });
    // the central block: two piers, the mass over the arch, the cornice
    for (const s of [-1, 1]) k.box('plain', C.stone, s * (AW + (B - AW) / 2), -1, 0, B - AW, TOP + 1, 2 * B, { top: false });
    k.box('plain', C.stone, 0, APEX, 0, 2 * AW, TOP - APEX, 2 * B, { top: false });
    k.box('plain', C.chalk, 0, TOP - 0.2, 0, 2 * B + 0.8, 0.6, 2 * B + 0.8, { topColour: C.paving, bottom: true });
    // the shallow central dome inside its screen
    k.prism('plain', C.sand, 0, TOP + 0.4, 0, 7.4, 0.9, 12, { r1: 6.4, top: false });
    k.prism('plain', C.sand, 0, TOP + 1.3, 0, 6.4, 0.8, 12, { r1: 4.2, top: false });
    k.spire('plain', C.sand, 0, TOP + 2.1, 0, 4.2, 1.0, 12);
    // the screen's sides
    for (const s of [-1, 1]) k.box('plain', C.chalkShade, s * 8, TOP, 0, 0.5, 2.5, 15.5);
    // the wings, their parapets, small domes and corner turrets
    for (const s of [-1, 1]) {
      const cx = s * (B + (WX - B) / 2);
      k.box('plain', C.stone, cx, -1, 0, WX - B, WH + 1, 2 * WZ, { top: false });
      k.box('plain', C.chalk, cx, WH - 0.3, 0, WX - B + 0.6, 0.5, 2 * WZ + 0.6, { topColour: C.paving, bottom: true });
      k.box('plain', C.chalkShade, cx, WH + 0.2, 0, WX - B + 0.2, 1.0, 2 * WZ + 0.2, { top: false });
      k.prism('plain', C.sand, s * 16.3, WH + 0.2, 0, 2.6, 0.9, 10, { r1: 2.3, top: false });
      k.prism('plain', C.sand, s * 16.3, WH + 1.1, 0, 2.3, 0.8, 10, { r1: 1.3, top: false });
      k.spire('plain', C.sand, s * 16.3, WH + 1.9, 0, 1.3, 0.9, 10);
      for (const t of [-1, 1]) {
        k.prism('plain', C.stone, s * WX, -1, t * WZ, 0.75, WH + 2.2, 8);
        k.spire('plain', C.sand, s * WX, WH + 1.2, t * WZ, 0.85, 1.4, 8);
      }
      // the wing's end wall: a tall window
      k.push(s * WX, 0, 0, s * 90);
      opening(k, C.stoneDeep, 0, 8.6, 1.8, 3.4, -0.05);
      opening(k, C.iron, 0, 0, 2.6, 5.4, -0.05);
      k.pop();
    }
    for (let i = 0; i < 2; i++) {
      k.push(0, 0, 0, i * 180);
      face(k);
      k.pop();
    }
    return k.group('mumbai-gateway-of-india');
  },
};
