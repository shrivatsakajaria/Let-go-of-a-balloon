/**
 * The page. The start screen (or, from a shared link, nothing but the sky) paints first, from a small
 * script; the 3D world and the live flight (app/live.ts: three.js, the streamed map, the HUD) load
 * straight after and fade in behind the chrome.
 *
 * - A link (`#b=…`, or the older `?b=…`) opens that balloon's flight, with "Let go of your own" as the
 *   second action; a link that cannot be read says "This balloon link is broken." with a way on.
 * - Let go works at once: if the world is still loading, the launch starts as soon as it is in.
 * - <html data-view> says which chrome shows: start, launch, flight, error, link, broken.
 */
import './ui/styles.css';
import { decodeBalloon, payloadFromLocation, type SavedBalloon } from './flight/codec';
import { COPY } from './ui/copy';
import { showNotice, type Notice } from './ui/notice';
import { mountStart, type StartChoice } from './ui/start';
import type { Live, View } from './app/live';

const params = new URLSearchParams(location.search);
const html = document.documentElement;
const sceneEl = document.getElementById('scene')!;
const hudEl = document.getElementById('hud')!;
const noticeEl = document.getElementById('notice')!;
const setView = (v: View) => {
  html.dataset.view = v;
};

let live: Live | null = null;
let liveP: Promise<Live> | null = null;
let latest: StartChoice | null = null;
let broken: Notice | null = null;

/**
 * Start loading what a release from c needs (the winds manifest and tiles round it, the terrain archive's
 * header and the start's ground) straight away, from a small chunk with no three.js in it, rather than
 * after the 3D world has arrived.
 */
function warmup(c: StartChoice) {
  import('./app/data').then((d) => d.warm(c)).catch(() => {});
}

/** Why the world is not here: it could not be fetched, or this browser cannot draw it (no WebGL). */
class WorldError extends Error {
  constructor(readonly kind: 'fetch' | 'webgl') {
    super(kind);
  }
}

function hasWebGL(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') ?? c.getContext('webgl'));
  } catch {
    return false;
  }
}

/** The world, loaded once; a failed load (a flaky connection, a new deploy) is tried again next time. */
function loadLive(): Promise<Live> {
  liveP ??= (hasWebGL() ? import('./app/live') : Promise.reject(new WorldError('webgl')))
    .catch((e) => {
      throw e instanceof WorldError ? e : new WorldError('fetch');
    })
    .then((m) => {
      try {
        live = m.createLive({ start, sceneEl, hudEl, noticeEl, setView }, latest ?? start.start);
      } catch {
        throw new WorldError('webgl'); // the 3D context could not be made
      }
      return live;
    })
    .catch((e) => {
      liveP = null;
      throw e;
    });
  return liveP;
}

/** Back to the start screen from a notice, with the address cleared of any balloon link. */
function toStart() {
  noticeEl.replaceChildren();
  if (live) return live.backToStart();
  history.replaceState(null, '', '/');
  setView('start');
}

/**
 * The world, or a balloon, could not be shown: say which plainly (never that the winds failed), and
 * offer Try again where it can help. Spec 6.7's map fallback for browsers with no WebGL replaces the
 * second message (Task 22).
 */
function cannotShow(e: unknown, retry: () => void) {
  setView('error');
  if (e instanceof WorldError && e.kind === 'webgl') {
    showNotice(noticeEl, COPY.noWorld, [{ label: COPY.cancel, onClick: toStart }]);
    return;
  }
  showNotice(noticeEl, COPY.didNotLoad, [
    { label: COPY.tryAgain, primary: true, onClick: () => { noticeEl.replaceChildren(); retry(); } },
    { label: COPY.cancel, onClick: toStart },
  ]);
}

function letGo(c: StartChoice) {
  if (live) return live.letGo(c);
  setView('launch');
  loadLive().then((l) => l.letGo(c), (e) => cannotShow(e, () => letGo(c)));
}

function open(b: SavedBalloon) {
  if (!live) setView('link');
  const opening = live ? live.open(b) : loadLive().then((l) => l.open(b));
  opening.catch((e) => cannotShow(e, () => open(b)));
}

const start = mountStart(
  document.getElementById('app')!,
  {
    onLetGo: letGo,
    onOpenBalloon: open,
    onStartChange(c) {
      latest = c;
      warmup(c);
      live?.setStart(c);
    },
  },
  { backdrop: params.get('backdrop') },
);

function showBroken() {
  setView('broken');
  broken = showNotice(noticeEl, COPY.brokenLink, [
    {
      label: COPY.letGoNewOne,
      primary: true,
      onClick: () => {
        broken?.remove();
        broken = null;
        history.replaceState(null, '', '/');
        if (live) live.backToStart();
        else setView('start');
      },
    },
  ]);
}

/** Open whatever link the address holds. */
function route() {
  const payload = payloadFromLocation(location);
  if (!payload) return false;
  setView('link');
  decodeBalloon(payload).then(open, showBroken);
  return true;
}

if (!route()) setView('start');
// a link pasted into the address bar of an open page
window.addEventListener('hashchange', () => {
  broken?.remove();
  broken = null;
  if (route()) return;
  // the link was taken out of the address: back to the start screen from a link's screens
  const v = html.dataset.view;
  if (v === 'broken' || v === 'link' || v === 'flight') {
    if (live) live.backToStart();
    else setView('start');
  }
});

// the world loads once the first frame of the chrome is on screen (not under a ?backdrop= test colour,
// which the contrast checks need to see)
if (!params.has('backdrop')) requestAnimationFrame(() => setTimeout(() => void loadLive().catch(() => {}), 0));
