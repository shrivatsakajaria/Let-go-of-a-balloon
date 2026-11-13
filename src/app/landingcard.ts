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
import { cardFacts, cardWords, startName, type CardLayout, type CardScene, type CardWords, drawCard, isInAppBrowser, toPng, type Landing } from '../ui/card';
import { showCardView, type CardView } from '../ui/cardview';
import { COPY } from '../ui/copy';
import { landedAt } from './data';

/** Read-only state for the page's tests. */
export type CardHook = {
  state: 'idle' | 'waiting' | 'open' | 'closed' | 'failed';
  sentence: string;
  kicker: string;
  shareText: string;
  headline: { size: number; lines: string[]; widths: number[] };
  frame: 'scene' | 'sketch' | '';
  bytes: number;
  inApp: boolean;
  waitedMs: number;
  /** How many cards have been rendered (a card is made once per landed route and kept). */
  renders: number;
  /** When the last card was asked for, and when it opened (UTC ms). */
  startedAt: number;
  openedAt: number;
  /** The card world of a long route: tiles wanted, drawn, failed, and ms to draw them (set by the 3D flight). */
  world: Record<string, number>;
};

export const cardHook: CardHook = { state: 'idle', sentence: '', kicker: '', shareText: '', headline: { size: 0, lines: [], widths: [] }, frame: '', bytes: 0, inApp: false, waitedMs: 0, renders: 0, startedAt: 0, openedAt: 0, world: {} };
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

/**
 * One result per key: a request while one is being made waits on it; a result that is null (not
 * made: cancelled or failed) or that `keep` turns down is not kept, so the next request tries again.
 */
export function onceFor<K extends object, V>(cache: WeakMap<K, Promise<V | null>>, key: K, make: () => Promise<V | null>, keep: (v: V) => boolean): Promise<V | null> {
  const had = cache.get(key);
  if (had) return had;
  const p = make().then(
    (v) => {
      if (v === null || !keep(v)) cache.delete(key);
      return v;
    },
    (e) => {
      cache.delete(key);
      throw e;
    },
  );
  cache.set(key, p);
  return p;
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
  closeLabel?: string;
  onClose?(): void;
};

let latest = 0;

/** A card made for a route: kept, so "Show the card" opens it again at once. */
type Made = { blob: Blob; words: CardWords; link: string; layout: CardLayout; frame: 'scene' | 'sketch' };
/** Cards being made or made, by route: one set for "Expected to" cards and one for "Landed" ones. */
const made = { air: new WeakMap<Route, Promise<Made | null>>(), down: new WeakMap<Route, Promise<Made | null>>() };

async function makeCard(o: PresentOpts): Promise<Made | null> {
  const alive = o.alive ?? o.isCurrent;
  const [home, place] = await Promise.all([homeName(o.saved), o.landing.catch(() => null)]);
  const landing: Landing | null = place ? { name: place.name, kind: place.kind } : null;
  cardHook.waitedMs = o.settle ? await o.settle() : 0;
  if (!alive()) return null;
  const words = cardWords(cardFacts(o.route, { home, landing, own: o.own, now: Date.now() }));
  const drawn = await drawCard(o.route, o.scene, words, alive, o.gate);
  if (!alive()) return null;
  cardHook.renders++;
  const blob = await toPng(drawn.canvas);
  const link = new URL(linkFor(await encodeBalloon(o.saved)), location.origin).href;
  return { blob, words, link, layout: drawn.layout, frame: drawn.frame };
}

/** Start making the card for a route without showing it (a later presentCard for the route waits on it). */
export function prepareCard(o: PresentOpts): Promise<unknown> {
  const landed = Date.now() >= landedAt(o.route);
  return onceFor(landed ? made.down : made.air, o.route, () => makeCard(o), (c) => c.frame !== 'sketch').catch(() => null);
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
    const landed = Date.now() >= landedAt(o.route);
    const card = await onceFor(landed ? made.down : made.air, o.route, () => makeCard(o), (c) => c.frame !== 'sketch');
    if (!card || !o.isCurrent()) return abort();
    const { blob, words, link } = card;
    const ua = navigator.userAgent;
    const inApp = isInAppBrowser(ua);
    const view = await showCardView({
      blob,
      words,
      link,
      inApp,
      ua,
      isCurrent: o.isCurrent,
      closeLabel: o.closeLabel,
      onClose: () => {
        cardHook.state = 'closed';
        o.onClose?.();
      },
    });
    if (!view) return abort();
    const L = card.layout;
    const heads = L.headline.lines.map((l) => l.map((s) => s.text).join(''));
    const widths = L.headline.lines.map((_, i) => lineWidthOf(L, i));
    Object.assign(cardHook, { openedAt: Date.now(), state: 'open', sentence: words.sentence, kicker: words.kicker, shareText: words.shareText, headline: { size: L.headline.size, lines: heads, widths }, frame: card.frame, bytes: blob.size, inApp });
    return view;
  } catch (e) {
    cardHook.state = 'failed';
    console.warn('the landing card could not be made', e);
    return null;
  }
}

/** The drawn width of headline line i (its segments sit on one baseline, left to right). */
function lineWidthOf(L: CardLayout, i: number): number {
  const heads = L.texts.filter((t) => t.role === 'headline');
  const ys = [...new Set(heads.map((t) => t.y))].sort((a, b) => a - b);
  const on = heads.filter((t) => t.y === ys[i]);
  return on.length ? Math.max(...on.map((t) => t.x + t.width)) - Math.min(...on.map((t) => t.x)) : 0;
}
