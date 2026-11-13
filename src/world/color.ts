/** sRGB hex helpers. No three.js here: this also runs inside a Web Worker. */
export type Color = string; // '#rrggbb'

export function parseHex(hex: Color): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function toHex(rgb: readonly [number, number, number]): Color {
  const h = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${h(rgb[0])}${h(rgb[1])}${h(rgb[2])}`;
}

/** Linear mix in sRGB space. */
export function lerpHex(a: Color, b: Color, f: number): Color {
  const [ar, ag, ab] = parseHex(a);
  const [br, bg, bb] = parseHex(b);
  return toHex([ar + (br - ar) * f, ag + (bg - ag) * f, ab + (bb - ab) * f]);
}

/** HSL of a hex colour: hue in degrees [0,360), saturation and lightness in [0,1]. */
export function hslOf(hex: Color): { h: number; s: number; l: number } {
  const [r, g, b] = parseHex(hex).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: h * 60, s, l };
}
