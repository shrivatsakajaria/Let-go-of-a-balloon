/**
 * Making and showing a balloon's landing card: names the start and the landing, lets the picture's
 * world finish drawing (`settle`), renders the card from `scene`, and opens the card view. The 3D
 * flight (Live.showCard, with the live scene) and the 2D map (mapcard.ts, with the map) both call it:
 * when the balloon comes down, when a landed link opens, and from "Show the card"; the replay calls
 * Live.showCard at its end. No three.js here: the 2D map loads it without the 3D world.
 */
import { encodeBalloon, linkFor, type SavedBalloon } from '../flight/codec';
import type { Route } from '../flight/route';
import type { LatLon } from '../geo/coords';
import { nearestPlace, type Place } from '../geo/gazetteer';
import { cardFacts, cardWords, paintCard, startName, type CardPicture, type CardPlan, type CardScene, type CardWords, drawCard, isInAppBrowser, toPng, type Landing } from '../ui/card';
import { showCardView, type CardReveal, type CardView } from '../ui/cardview';
import { lastSpots } from '../ui/cardplace';
import { COPY } from '../ui/copy';
import { landedAt } from './data';

/** Read-only state for the page's tests. */
export type CardHook = {
  state: 'idle' | 'waiting' | 'open' | 'closed' | 'failed';
  sentence: string;
  kicker: string;
  shareText: string;
  /** The kicker's time ("Thu 12 Nov, 18:48") and the comparison line, as on the card. */
  when: string;
  compare: string | null;
  /** The two big names and where they went (card px), and the map's names kept. */
  names: { text: string; box: [number, number, number, number]; size: number }[];
  places: string[];
  /** The names' candidate spots and their scores (lower is better). */
  spots: string[];
  frame: 'scene' | 'sketch' | '';
  /** How the card came in: the reveal played, the reduced-motion cross-fade, or straight (a card opened again). */
  reveal: 'played' | 'faded' | 'none' | '';
  /** The reveal has ended and the buttons are up. */
  revealed: boolean;
  bytes: number;
  inApp: boolean;
  waitedMs: number;
  /** How many cards have been rendered (a card is made once per landed route and kept). */
  renders: number;
  /** When the last card was asked for, and when it opened (UTC ms). */
  startedAt: number;
  openedAt: number;
  /** The card world: tiles wanted, drawn, failed, and ms to draw them (set by the 3D flight). */
  world: Record<string, number | string>;
};

export const cardHook: CardHook = { state: 'idle', sentence: '', kicker: '', shareText: '', when: '', compare: null, names: [], places: [], spots: [], frame: '', reveal: '', revealed: false, bytes: 0, inApp: false, waitedMs: 0, renders: 0, startedAt: 0, openedAt: 0, world: {} };
// only for browser tests, as window.__live is (they set window.__lgoabTest before the page loads)
if (typeof window !== 'undefined' && (window as unknown as { __lgoabTest?: boolean }).__lgoabTest) (window as unknown as { __card: CardHook }).__card = cardHook;

/** A "Use my location" start goes by the place it is in (startName), never "Your location". */
async function homeName(saved: SavedBalloon): Promise<string> {
  if (saved.name !== COPY.yourLocation) return saved.name;
  return startName(saved.start, await nearestPlace(saved.start).catch(() => null));
}

type NearPlace = Parameters<typeof startName>[1];

/**
 * The start's name in the flight (the HUD's facts, the status region): "your location" only on the
 * visitor's own "Use my location" balloon; someone opening a shared one sees the place (startName).
 */
export async function homeFor(saved: SavedBalloon, own: boolean, near: (p: LatLon) => Promise<NearPlace | null> = nearestPlace): Promise<string> {
  if (saved.name !== COPY.yourLocation) return saved.name;
  if (own) return COPY.yourLocation.toLowerCase();
  return startName(saved.start, await near(saved.start).catch(() => null));
}

/** A result being made (or made) and whether its maker is still there to finish it. */
export type Once<V> = { p: Promise<V | null>; alive: () => boolean; done: boolean };

/**
 * One result per key: a request while one is being made waits on it, unless its maker has gone (a
 * disposed 3D flight), when it starts afresh; a result that is null (not made: cancelled or failed) or
 * that `keep` turns down is not kept, so the next request tries again.
 */
export function onceFor<K extends object, V>(cache: WeakMap<K, Once<V>>, key: K, make: () => Promise<V | null>, keep: (v: V) => boolean, alive: () => boolean): Promise<V | null> {
  const had = cache.get(key);
  if (had && (had.done || had.alive())) return had.p;
  const entry: Once<V> = { p: Promise.resolve(null), alive, done: false };
  entry.p = make().then(
    (v) => {
      if (cache.get(key) === entry) {
        if (v === null || !keep(v)) cache.delete(key);
        else entry.done = true;
      }
      return v;
    },
    (e) => {
      if (cache.get(key) === entry) cache.delete(key);
      throw e;
    },
  );
  cache.set(key, entry);
  return entry.p;
}

/** Whether a card for `route` is a "Landed" one: by the time, unless the request says (a replay keeps the state it began with). */
export function landedFor(route: Route, now: number, given?: boolean): boolean {
  return given ?? now >= landedAt(route);
}

export type PresentOpts = {
  /** What draws the card's picture: the 3D scene, the 2D map, or none (a sketch of the route). */
  scene: CardScene | null;
  /** Let the picture's world finish drawing first; resolves with how long it waited (ms). */
  settle?(): Promise<number>;
  route: Route;
  saved: SavedBalloon;
  own: boolean;
  landing: Promise<Place | null>;
  /** False once this request is out of date (a newer one, another balloon, the start screen): it opens nothing. */
  isCurrent(): boolean;
  /** False once the balloon itself is off the screen: the card stops being made (a newer request for it shares it). */
  alive?(): boolean;
  /** Hold the picture back until this resolves (the replay makes its card while it plays, and takes the picture at its end). */
  gate?: Promise<void>;
  /** Make the "Landed" card (true) or the "Expected to" one (false), whatever the time (default: by the time). */
  landed?: boolean;
  closeLabel?: string;
  onClose?(): void;
  /** Where focus goes when the card closes and what had it before is gone (see CardViewOpts). */
  fallbackFocus?(): HTMLElement | null;
  /** Play the reveal (when the card's world was kept for it): the trip's end, not "Show the card". */
  reveal?: boolean;
};

let latest = 0;

/** What a scene's picture may bring for the reveal (cardshot.ts RevealSource; three.js stays out of here). */
type RevealSource = { frame(k: number, w: number, h: number): CardPicture | null; balloonScale(k: number): number; dispose(): void };
/**
 * A card made for a route: kept, so "Show the card" opens it again at once. Its reveal (the card world
 * kept for it) plays the first time it is shown, and is let go then or after REVEAL_KEEP_MS unused.
 */
type Made = { blob: Blob; words: CardWords; link: string; plan: CardPlan; picture: CardPicture; frame: 'scene' | 'sketch'; reveal: RevealSource | null };
const REVEAL_KEEP_MS = 90_000;
/** Cards being made or made, by route: one set for "Expected to" cards and one for "Landed" ones. */
const made = { air: new WeakMap<Route, Once<Made>>(), down: new WeakMap<Route, Once<Made>>() };

/** The country the balloon was let go in (the comparison line), when the start is in a town's reach. */
async function startCountry(saved: SavedBalloon): Promise<string | null> {
  const p = await nearestPlace(saved.start).catch(() => null);
  return p?.kind === 'town' ? p.country ?? null : null;
}

async function makeCard(o: PresentOpts, landed: boolean): Promise<Made | null> {
  const alive = o.alive ?? o.isCurrent;
  const [home, place, country] = await Promise.all([homeName(o.saved), o.landing.catch(() => null), startCountry(o.saved)]);
  const landing: Landing | null = place ? { name: place.name, kind: place.kind } : null;
  cardHook.waitedMs = o.settle ? await o.settle() : 0;
  if (!alive()) return null;
  // the words for the state asked for ("Expected to" stays so for a replay that began before the landing)
  const at = landed ? Math.max(Date.now(), landedAt(o.route)) : Math.min(Date.now(), landedAt(o.route) - 1);
  const words = cardWords(cardFacts(o.route, { home, landing, own: o.own, now: at, country }));
  const drawn = await drawCard(o.route, o.scene, words, alive, o.gate);
  const reveal = (drawn.picture as CardPicture & { reveal?: RevealSource | null }).reveal ?? null;
  if (!alive()) {
    reveal?.dispose();
    return null;
  }
  cardHook.renders++;
  const blob = await toPng(drawn.canvas);
  const link = new URL(linkFor(await encodeBalloon(o.saved)), location.origin).href;
  const made: Made = { blob, words, link, plan: drawn.plan, picture: drawn.picture, frame: drawn.frame, reveal };
  if (reveal)
    setTimeout(() => {
      if (made.reveal === reveal) {
        made.reveal = null;
        reveal.dispose();
      }
    }, REVEAL_KEEP_MS);
  return made;
}

/** The reveal for the card view: each frame the world from a share of the way up, the card painted over it. */
function revealFor(card: Made, src: RevealSource): CardReveal {
  return {
    draw(ctx, st, w, h) {
      const pic = st.move >= 1 ? card.picture : src.frame(st.move, w, h) ?? card.picture;
      paintCard(ctx, pic, card.words, card.plan, st, src.balloonScale(st.move));
    },
    dispose: () => src.dispose(),
  };
}

/** Start making the card for a route without showing it (a later presentCard for the route waits on it). */
export function prepareCard(o: PresentOpts): Promise<unknown> {
  return getCard(o).catch(() => null);
}

/** The card for a request: being made already (by a maker still there), made, or made now. */
function getCard(o: PresentOpts): Promise<Made | null> {
  const landed = landedFor(o.route, Date.now(), o.landed);
  return onceFor(landed ? made.down : made.air, o.route, () => makeCard(o, landed), (c) => c.frame !== 'sketch', o.alive ?? o.isCurrent);
}

export async function presentCard(o: PresentOpts): Promise<CardView | null> {
  const id = ++latest;
  // the visitor moved on: nothing opens, and the hook says so (unless a newer card is on its way)
  const abort = () => {
    if (id === latest) cardHook.state = 'idle';
    return null;
  };
  cardHook.state = 'waiting';
  cardHook.startedAt = Date.now();
  try {
    // a card made before the balloon was down says "Expected to"; once landed it is made again. A
    // plain sketch (the picture could not be made) is not kept: "Show the card" tries again.
    const card = await getCard(o);
    if (!card || !o.isCurrent()) return abort();
    const { blob, words, link } = card;
    const ua = navigator.userAgent;
    const inApp = isInAppBrowser(ua);
    // the reveal plays once, the first time the card is shown at the trip's end; its world goes after it
    const src = o.reveal ? card.reveal : null;
    if (card.reveal && !src) card.reveal.dispose();
    card.reveal = null;
    Object.assign(cardHook, { revealed: false, reveal: '' });
    const view = await showCardView({
      blob,
      words,
      link,
      inApp,
      ua,
      isCurrent: o.isCurrent,
      closeLabel: o.closeLabel,
      fallbackFocus: o.fallbackFocus,
      reveal: src ? revealFor(card, src) : undefined,
      onRevealed: (how) => Object.assign(cardHook, { revealed: true, reveal: how }),
      onClose: () => {
        cardHook.state = 'closed';
        o.onClose?.();
      },
    });
    if (!view) {
      src?.dispose();
      return abort();
    }
    const P = card.plan;
    const names = [P.start, P.landing].filter((n): n is NonNullable<typeof n> => !!n).map((n) => ({ text: n.block.text, box: [n.at.box.x0, n.at.box.y0, n.at.box.x1, n.at.box.y1] as [number, number, number, number], size: n.block.size }));
    Object.assign(cardHook, { openedAt: Date.now(), state: 'open', sentence: words.sentence, kicker: words.kicker, when: words.when, compare: words.compare, shareText: words.shareText, names, places: P.places.map((p) => p.text), spots: [...lastSpots], frame: card.frame, bytes: blob.size, inApp });
    return view;
  } catch (e) {
    cardHook.state = 'failed';
    console.warn('the landing card could not be made', e);
    return null;
  }
}
