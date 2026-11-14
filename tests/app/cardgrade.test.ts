import { describe, expect, test } from 'vitest';
import { cardGroundTint, gradedColours, SEA_MID_LINEAR, type CardLook } from '../../src/app/cardworld';
import { lightFor } from '../../src/world/palette';
import { srgbToLinear } from '../../src/world/color';

const look = (el: number): CardLook => {
  const light = lightFor(el);
  return { light, night: light.night, sunElevationDeg: el };
};
const LOOKS: [string, CardLook][] = [['golden hour', look(5)], ['day', look(22)], ['night', look(-16)]];

/** CIE Lab of an sRGB colour (0..1), D65. */
function lab(c: number[]): [number, number, number] {
  const [r, g, b] = c.map(srgbToLinear);
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047, y = 0.2126 * r + 0.7152 * g + 0.0722 * b, z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}
const deltaE = (a: number[], b: number[]) => Math.hypot(...lab(a).map((v, i) => v - lab(b)[i]));
const hue = (c: number[]) => {
  const [, A, B] = lab(c);
  return ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360;
};

describe('the card\'s sea and land stay apart under its grade', () => {
  test.each(LOOKS)('at %s the sea is clearly water: blue to teal, and far from the land', (_, l) => {
    const { sea, land } = gradedColours(l);
    // Lab hue of teal to blue (teal ~170-200, blue ~280); never the olive or khaki of the land (~100-130)
    const h = hue(sea);
    expect(h).toBeGreaterThan(160);
    expect(h).toBeLessThan(290);
    expect(deltaE(sea, land)).toBeGreaterThan(18);
  });

  test('at night the sea stays darker than the land', () => {
    const { sea, land } = gradedColours(look(-16));
    expect(lab(sea)[0]).toBeLessThan(lab(land)[0] - 3);
    expect(cardGroundTint(look(-16))).not.toBe(lightFor(-16).groundTint);
  });

  test('the calmed sea\'s tone is in linear light, as the tiles\' vertex colours are (not the pale sRGB values)', () => {
    // the shallows #8fd3cf mixed a third toward waterDeep #2b7fb0 is about (0.44, 0.73, 0.77) in sRGB
    expect(SEA_MID_LINEAR[0]).toBeCloseTo(srgbToLinear(0.4394), 2);
    expect(SEA_MID_LINEAR[2]).toBeCloseTo(srgbToLinear(0.7737), 2);
    expect(SEA_MID_LINEAR[2]).toBeGreaterThan(SEA_MID_LINEAR[0] * 2);
  });
});
