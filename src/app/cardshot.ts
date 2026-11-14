/**
 * The landing card's picture from the 3D world (spec 6.5, design A): a card world of its own
 * (cardworld.ts) on the live worker pool, drawn once for the still and kept, when asked, for the
 * reveal that rises from the landed balloon to the card's framing; then thrown away.
 *
 * The world waits for its tiles (FAR_WAIT_MS at the most; the replay's end cuts the wait short and
 * takes what is in). Its picture is drawn on its own canvas with a clear sky, warm slopes calmed
 * (tameWarm) so the balloon stays the one bright thing, and handed to the card with what the 2D layer
 * draws over it, projected.
 */
import type { Route } from '../flight/route';
import { FLIGHT_HOURS } from '../config';
import { tameWarm, type CardPicture, type CardScene } from '../ui/card';
import { poseAt, poseCamera, type CardPose } from './cardframe';
import { CardWorld, type CardView } from './cardworld';
import type { LiveScene } from './scene';

/** How long the card world may take to draw before the picture is taken anyway. */
const FAR_WAIT_MS = 20000;
/** And this much longer for the reveal's tiles (round the balloon, on the way up); later than that, no reveal. */
const REVEAL_WAIT_MS = 20000;
/** The still's size: the card's picture. */
const W = 1080, H = 1000;

/**
 * Step until `ready` has said yes twice running, the time is up, `stop` says the moment has come (the
 * replay's end: the picture is taken with what is in), or `alive` says the visitor has moved on
 * (checked before every step, so a cancelled card world stops at once).
 */
export async function pumpUntil(ready: () => boolean, o: { maxMs: number; everyMs: number; alive: () => boolean; stop?: () => boolean }): Promise<'ready' | 'timeout' | 'cancelled' | 'stopped'> {
  const t0 = performance.now();
  let calm = 0;
  for (;;) {
    if (!o.alive()) return 'cancelled';
    if (o.stop?.()) return 'stopped';
    calm = ready() ? calm + 1 : 0;
    if (calm >= 2) return 'ready';
    if (performance.now() - t0 >= o.maxMs) return 'timeout';
    await new Promise((r) => setTimeout(r, o.everyMs));
  }
}

/** The last card world: how many tiles it wanted, how many were drawn, and how long it took (for checks). */
export const farStats = { tiles: 0, settled: 0, failed: 0, ms: 0, readyAt: 0, compiledAt: 0, gateAt: 0, how: '' };

/**
 * The reveal's frames from a card world: the world drawn from a share k of the way up (its canvas, w x
 * h) and what is drawn over it, in card pixels. Disposing it lets the world go.
 */
export type RevealSource = {
  frame(k: number, w: number, h: number): CardPicture | null;
  /** How big the balloon is drawn at a share k of the way up (larger close to it). */
  balloonScale(k: number): number;
  dispose(): void;
};

function picture(view: CardView, image: CanvasImageSource | null, world: CardWorld, route: Route): CardPicture {
  const L = world.look.light;
  return {
    image,
    sky: { top: L.skyTop, horizon: L.skyHorizon, night: world.look.night },
    route: view.route,
    routeSec: route.points.map((p) => p.tSec),
    start: view.start,
    landing: view.landing,
    horizon: view.horizon,
    places: view.places,
    towns: view.towns,
  };
}

/** The still, from the card's framing: drawn, read back, warm slopes calmed. */
function still(world: CardWorld, route: Route): CardPicture | null {
  const gl = world.draw(world.shot, W, H);
  if (!gl) return null;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  // in the same task as the draw: the drawing buffer is still there
  ctx.drawImage(gl, 0, 0);
  const img = ctx.getImageData(0, 0, W, H);
  tameWarm(img.data);
  ctx.putImageData(img, 0, 0);
  return picture(world.view(world.shot, W, H), c, world, route);
}

export type CardSceneOpts = {
  /** Keep the world for the reveal: the picture comes with a RevealSource (the caller disposes it). */
  reveal?: boolean;
};

/** A picture made for the card, and the world kept for its reveal (when asked and its tiles all came in). */
export type CardShotPicture = CardPicture & { reveal?: RevealSource | null };

export function cardScene(live: LiveScene, opts: CardSceneOpts = {}): CardScene {
  return {
    cardPicture: async (route, alive = () => true, gate) => {
      if (live.gone) return null;
      const going = () => !live.gone && alive();
      let world: CardWorld;
      try {
        world = new CardWorld(live.pool, route, { sunAt: route.release + FLIGHT_HOURS * 3600e3, reveal: opts.reveal });
      } catch (e) {
        console.warn('the card world could not be made', e);
        return null;
      }
      let kept = false;
      try {
        const t0 = performance.now();
        Object.assign(farStats, { readyAt: 0, compiledAt: 0, gateAt: 0, how: '' });
        let opened = false;
        void gate?.then(() => {
          opened = true;
          farStats.gateAt = Date.now();
        });
        const how = await world.load({ maxMs: FAR_WAIT_MS, alive: going, stop: () => opened });
        farStats.how = how;
        if (how === 'cancelled') return null;
        farStats.readyAt = Date.now();
        // the reveal's tiles (round the balloon, on the way up), while the replay plays where there is one;
        // the reveal only over a whole world: a late one gives the card without it, never holes
        let more: Awaited<ReturnType<CardWorld['loadReveal']>> | null = null;
        if (opts.reveal && how === 'ready') {
          more = await world.loadReveal({ maxMs: REVEAL_WAIT_MS, alive: going });
          farStats.how = `${how}+${more}`;
          if (more === 'cancelled') return null;
        }
        // the picture waits for its moment (the end of the replay), the land drawing meanwhile
        if (gate) {
          await world.renderer.compileAsync(world.scene, poseCamera(world.shot)).catch(() => {});
          farStats.compiledAt = Date.now();
          await gate;
          await world.load({ maxMs: 0, alive: going });
        }
        if (!going()) return null;
        const st = world.stream.stats();
        Object.assign(farStats, { tiles: st.wanted, settled: st.settled, failed: st.failed, ms: Math.round(performance.now() - t0) });
        const pic: CardShotPicture | null = still(world, route);
        if (!pic) return null;
        if (more === 'ready') {
          kept = true;
          pic.reveal = revealFrom(world, route);
        }
        return pic;
      } finally {
        if (!kept) world.dispose();
      }
    },
  };
}

function revealFrom(world: CardWorld, route: Route): RevealSource {
  let gone = false;
  return {
    frame(k, w, h) {
      if (gone) return null;
      const pose: CardPose = poseAt(world.start, world.shot, k);
      const image = world.draw(pose, w, h);
      if (!image) return null;
      return picture(world.view(pose, W, H), image, world, route);
    },
    balloonScale: (k) => 1 + 1.6 * (1 - Math.min(1, k * 1.4)) ** 2,
    dispose() {
      gone = true;
      world.dispose();
    },
  };
}
