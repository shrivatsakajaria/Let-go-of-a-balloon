/**
 * The landing card's reveal, as numbers (spec 6.5, design A): when the trip ends, the camera starts on
 * the landed balloon and rises and pulls back in one calm move to the card's framing while the route
 * draws in from the start to the landing; a beat of stillness; the names fade in; the numbers count
 * up and land exactly on their final values; the card's buttons appear. Pure.
 */

/** Seconds from the start of the reveal. */
export const REVEAL = {
  /** The camera's move, and the route drawing in with it. */
  move: [0, 3.6],
  /** The country and sea names come in as the move settles. */
  places: [2.6, 3.6],
  /** A beat of stillness, then the names (and the panel's words) fade in. */
  names: [4.2, 4.8],
  /** The numbers count up. */
  count: [4.9, 6.1],
  /** The card's buttons appear. */
  buttons: 6.3,
  end: 6.6,
} as const;

/** With reduced motion: no move and no count-up, a short cross-fade to the finished card. */
export const REDUCED_FADE_S = 0.4;

/** cubic-bezier(x1, y1, x2, y2) as a function of x (the interface's one easing curve by default). */
export function bezier(x1 = 0.22, y1 = 1, x2 = 0.36, y2 = 1): (x: number) => number {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sx = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sy = (t: number) => ((ay * t + by) * t + cy) * t;
  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let a = 0, b = 1, t = x;
    for (let i = 0; i < 40; i++) {
      t = (a + b) / 2;
      if (sx(t) < x) a = t;
      else b = t;
    }
    return sy(t);
  };
}

/** The interface's easing (spec 8): no overshoot. */
export const easeUi = bezier();
/** The camera's: slow out of the balloon and slow into the card (a calm rise, smootherstep). */
export const easeMove = (x: number): number => {
  const t = Math.max(0, Math.min(1, x));
  return t * t * t * (t * (t * 6 - 15) + 10);
};

/** How far through a span [a, b] the time t is, 0..1. */
export const span = (t: number, [a, b]: readonly [number, number]): number => Math.max(0, Math.min(1, (t - a) / (b - a)));

/** The reveal at time t (s): how far each part has come, 0..1. */
export type RevealState = { move: number; route: number; places: number; names: number; count: number; buttons: boolean; done: boolean };

export function revealAt(t: number): RevealState {
  const move = easeMove(span(t, REVEAL.move));
  return {
    move,
    // the route draws in with the rise, a little ahead of it so it is whole as the camera settles
    route: easeUi(span(t, [REVEAL.move[0] + 0.3, REVEAL.move[1] - 0.2])),
    places: easeUi(span(t, REVEAL.places)),
    names: easeUi(span(t, REVEAL.names)),
    count: easeUi(span(t, REVEAL.count)),
    buttons: t >= REVEAL.buttons,
    done: t >= REVEAL.end,
  };
}

/** The finished card. */
export const REVEALED: RevealState = { move: 1, route: 1, places: 1, names: 1, count: 1, buttons: true, done: true };

/**
 * A number counting up to `value` (k from 0 to 1), shown as the card shows it: grouped thousands
 * ("1,587"), with `decimals` places; exactly the final text at k = 1.
 */
export function countText(value: number, decimals: number, k: number): string {
  const v = k >= 1 ? value : value * Math.max(0, k);
  const f = 10 ** decimals;
  const shown = k >= 1 ? value : Math.floor(v * f) / f;
  return shown.toLocaleString('en-GB', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}
