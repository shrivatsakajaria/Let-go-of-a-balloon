/**
 * The Library of Birmingham (Mecanoo, 2013), 60 m: a stack of offset boxes over Centenary Square.
 * A glazed ground floor (lit from dusk), the silver box that cantilevers over the square, the
 * Discovery Terrace on its roof, the gold box above it, the smaller silver box with the Secret
 * Garden beside it, and the gold rotunda (the Shakespeare Memorial Room) on top; every box wrapped
 * in the filigree of interlocking metal rings the building is known by. Faceted, Contour colours.
 *
 * Model frame (types.ts): origin on the ground at the centre of the ground-floor box, front (local
 * -z) over Centenary Square, +x toward the Rep. Plan positions follow the OpenStreetMap building
 * parts (2026-11).
 */
import { Kit, LANDMARK_COLOURS as C } from '../kit';
import type { LandmarkModel } from '../types';
import type { Color, RegionStyle } from '../../world/palette';

/** Everything stands on this (below the square, so slopes never show under it). */
const B = -4;
const RING_SIDES = 8;

/**
 * Interlocking rings over the -z face of the current frame: x from -w/2 to w/2, y from y0 to y0+h,
 * standing `off` out from the face at z. Rings of radius r overlap their neighbours; alternate rows
 * are shifted by half a step.
 */
function rings(k: Kit, colour: Color, w: number, y0: number, h: number, z: number, r0: number, off = 0.12): void {
  const step = 1.55 * r0, rowStep = 1.3 * r0;
  const rows = Math.max(1, Math.floor((h - 2 * r0) / rowStep) + 1);
  const ry0 = y0 + (h - (rows - 1) * rowStep) / 2;
  for (let j = 0; j < rows; j++) {
    const shift = j % 2 ? step / 2 : 0;
    const cols = Math.floor((w - 2 * r0 - shift) / step) + 1;
    const x0 = -((cols - 1) * step) / 2;
    for (let i = 0; i < cols; i++) {
      const cx = x0 + i * step, cy = ry0 + j * rowStep, cz = z - off;
      // every third ring a size smaller, so the filigree is not a plain chain
      const r = (i + 2 * j) % 3 === 1 ? r0 * 0.72 : r0, inner = 0.8 * r;
      for (let s = 0; s < RING_SIDES; s++) {
        const a0 = (s / RING_SIDES) * 2 * Math.PI, a1 = ((s + 1) / RING_SIDES) * 2 * Math.PI;
        const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
        k.quad('plain', colour, [cx + r * c0, cy + r * s0, cz], [cx + inner * c0, cy + inner * s0, cz], [cx + inner * c1, cy + inner * s1, cz], [cx + r * c1, cy + r * s1, cz], [0, 0, -1]);
      }
    }
  }
}

/**
 * A clad box: (cx, cz) centre, w by d, from y0 to y0+h, its four faces wrapped in rings. `faces`
 * leaves out the faces hidden against a neighbour (0: -z, 1: +x, 2: +z, 3: -x).
 */
function clad(k: Kit, body: Color, ring: Color, cx: number, y0: number, cz: number, w: number, h: number, d: number, r: number, faces = [0, 1, 2, 3]): void {
  k.box('plain', body, cx, y0, cz, w, h, d, { topColour: C.paving, bottom: true });
  for (const i of faces) {
    const side = i % 2 ? d : w, depth = i % 2 ? w : d;
    k.push(cx, 0, cz, i * 90);
    rings(k, ring, side, y0, h, -depth / 2, r);
    k.pop();
  }
}

/** Planting on a terrace: low beds in the Contour sages. */
function beds(k: Kit, y: number, x0: number, x1: number, z0: number, z1: number): void {
  for (let x = x0 + 3; x < x1 - 2; x += 7) {
    k.box('plain', C.sage, x, y, (z0 + z1) / 2, 3, 0.9, z1 - z0 - 3);
  }
}

export const model: LandmarkModel = {
  build(_style: RegionStyle) {
    const k = new Kit();
    const silver = C.chalkShade, gold = C.gilt;
    // the glazed ground floor (lights from dusk) on its plinth
    k.box('plain', C.paving, 0.5, B, 0, 56, -B, 50.5);
    k.box('glow', C.slate, 0.5, 0, 0, 55.5, 12.5, 50, { top: false });
    for (let x = -26; x <= 27; x += 5.3) k.box('plain', C.chalk, x, 0, -25.15, 0.4, 12.5, 0.3, { top: false });
    // the silver box over the square (cantilevered 10 m at the front)
    clad(k, silver, C.slate, -2.25, 12.5, -3, 61.5, 12.5, 64, 3.1);
    // a glazed band, the gold box, the Discovery Terrace on the silver box in front of it
    k.box('plain', C.slate, 2.5, 25, 5.5, 52, 4, 46, { top: false });
    clad(k, gold, C.clay, 2.5, 29, 5.5, 53, 15, 47, 3.3);
    beds(k, 25, -30, 26, -32, -21);
    k.box('plain', C.chalk, -2.25, 25, -35.1, 61.5, 1.2, 0.3, { top: false });
    // the upper silver box, the Secret Garden beside it on the gold box
    clad(k, silver, C.slate, -5, 44, 1, 38, 8, 40, 2.8);
    beds(k, 44, 15, 28, -14, 26);
    // the gold rotunda on top
    k.prism('plain', gold, -13, 52, -8, 8, 8, 16, { topColour: C.paving });
    k.prism('plain', C.sand, -13, 59.4, -8, 8.3, 0.6, 16, { top: false });
    for (let i = 0; i < 16; i++) {
      const a = (i * Math.PI) / 8;
      k.box('plain', C.sand, -13 + Math.sin(a) * 8.05, 52, -8 - Math.cos(a) * 8.05, 0.5, 7.4, 0.5, { top: false });
    }
    return k.group('birmingham-library-of-birmingham');
  },
};
