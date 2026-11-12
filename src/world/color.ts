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
