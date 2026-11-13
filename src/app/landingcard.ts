/**
 * Making and showing a balloon's landing card from the live page: names the start and the landing,
 * lets the landing area finish drawing (up to a few seconds), renders the card from the live scene,
 * and opens the card view. The live flight calls it when the balloon comes down, when a landed link
 * opens, and from "Show the card"; the replay calls it at its end (Live.showCard).
 */
import { encodeBalloon, linkFor, type SavedBalloon } from '../flight/codec';
import type { Route } from '../flight/route';
import { nearestPlace, type Place } from '../geo/gazetteer';
import { cardFacts, cardWords, startName, type CardLayout, type CardWords, drawCard, isInAppBrowser, toPng, type Landing } from '../ui/card';
import { showCardView, type CardView } from '../ui/cardview';
import { COPY } from '../ui/copy';
import { cardScene, farStats } from './cardshot';
import type { LiveScene } from './scene';
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
  /** When the last card was asked for (UTC ms). */
  startedAt: number;
  /** The card world of a long route: tiles wanted, drawn, failed, and ms to draw them. */
  world: typeof farStats;
};

export const cardHook: CardHook = { state: 'idle', sentence: '', kicker: '', shareText: '', headline: { size: 0, lines: [], widths: [] }, frame: '', bytes: 0, inApp: false, waitedMs: 0, renders: 0, startedAt: 0, world: farStats };
// only for browser tests, as window.__live is (they set window.__lgoabTest before the page loads)
if (typeof window !== 'undefined' && (window as unknown as { __lgoabTest?: boolean }).__lgoabTest) (window as unknown as { __card: CardHook }).__card = cardHook;

/** A "Use my location" start goes by the place it is in (startName), never "Your location". */
async function homeName(saved: SavedBalloon): Promise<string> {
  if (saved.name !== COPY.yourLocation) return saved.name;
  return startName(saved.start, await nearestPlace(saved.start).catch(() => null));
}

/** Until the world round the camera has drawn (or `maxMs` has passed). */
async function settled(live: LiveScene, maxMs: number, isCurrent: () => boolean): Promise<number> {
  const t0 = performance.now();
  let calm = 0;
  while (performance.now() - t0 < maxMs && isCurrent()) {
    calm = live.stream.stats().ready ? calm + 1 : 0;
    if (calm >= 2) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  return performance.now() - t0;
}

export type PresentOpts = {
  live: LiveScene;
  route: Route;
  saved: SavedBalloon;
  own: boolean;
  landing: Promise<Place | null>;
  /** False once the visitor has moved on (another balloon, the start screen). */
  isCurrent(): boolean;
  /** How long to let the landing area draw first (default 8 s). */
  waitMs?: number;
  closeLabel?: string;
  onClose?(): void;
};

let latest = 0;

/** A card made for a route: kept, so "Show the card" opens it again at once. */
type Made = { blob: Blob; words: CardWords; link: string; layout: CardLayout; frame: 'scene' | 'sketch'; landed: boolean };
const made = new WeakMap<Route, Made>();

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
    let card = made.get(o.route);
    // a card made before the balloon was down says "Expected to"; once landed it is made again
    if (card && card.landed !== Date.now() >= landedAt(o.route)) card = undefined;
    if (!card) {
      const [home, place] = await Promise.all([homeName(o.saved), o.landing.catch(() => null)]);
      const landing: Landing | null = place ? { name: place.name, kind: place.kind } : null;
      cardHook.waitedMs = await settled(o.live, o.waitMs ?? 8000, o.isCurrent);
      if (!o.isCurrent()) return abort();
      const facts = cardFacts(o.route, { home, landing, own: o.own, now: Date.now() });
      const words = cardWords(facts);
      const drawn = await drawCard(o.route, cardScene(o.live), words);
      cardHook.renders++;
      const blob = await toPng(drawn.canvas);
      const link = new URL(linkFor(await encodeBalloon(o.saved)), location.origin).href;
      card = { blob, words, link, layout: drawn.layout, frame: drawn.frame, landed: facts.landed };
      made.set(o.route, card);
    }
    if (!o.isCurrent()) return abort();
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
    Object.assign(cardHook, { state: 'open', sentence: words.sentence, kicker: words.kicker, shareText: words.shareText, headline: { size: L.headline.size, lines: heads, widths }, frame: card.frame, bytes: blob.size, inApp });
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
