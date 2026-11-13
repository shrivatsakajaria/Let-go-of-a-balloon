/**
 * The Spire of Dublin (Monument of Light), 2003: a stainless-steel cone 121.2 m tall, 3 m across at
 * the street and 15 cm at the tip. The lowest 10 m are shot-peened in a darker pattern, and the top
 * 12 m are pierced with small holes lit from inside, so the tip shines from dusk (the glow bucket).
 * It stands on a round bronze-ringed base set into the paving of O'Connell Street.
 *
 * Model frame (types.ts): origin on the street at the Spire's axis. A cone looks alike from every
 * side; 24 facets keep it round at street level without spending triangles. Steel is the Contour
 * rail grey (the palest metal grey in the palette) over a slate foot.
 */
import { Kit, LANDMARK_COLOURS as C } from '../kit';
import type { LandmarkModel } from '../types';

/** Height, base and tip radii, m. */
const H = 121.2;
const R0 = 1.5;
const R1 = 0.075;
const SIDES = 24;
/** Steel: the Contour rail grey (palette ROADS.rail), the palest metal grey the palette has. */
const STEEL = '#b4aea2';
const r = (y: number) => R0 + ((R1 - R0) * y) / H;

export const model: LandmarkModel = {
  build() {
    const k = new Kit();
    // the base: a low paving disc with a bronze ring round the foot of the cone
    k.prism('plain', C.paving, 0, -3, 0, 2.6, 3.15, SIDES, { topColour: C.paving });
    k.prism('plain', C.gilt, 0, 0.15, 0, 1.75, 0.12, SIDES);
    // the cone in stages: the darker shot-peened foot, the polished shaft, the lit crown, the tip
    const stages: [number, number, string, 'plain' | 'glow'][] = [
      [-0.2, 10, C.slate, 'plain'],
      [10, 109, STEEL, 'plain'],
      [109, 120.4, C.chalk, 'glow'],
      [120.4, H, C.slate, 'plain'],
    ];
    for (const [y0, y1, colour, bucket] of stages) {
      const top = y1 >= H;
      if (top) k.spire(bucket, colour, 0, y0, 0, r(y0), y1 - y0, SIDES);
      else k.prism(bucket, colour, 0, y0, 0, r(y0), y1 - y0, SIDES, { r1: r(y1), top: false });
    }
    return k.group('dublin-spire');
  },
};
