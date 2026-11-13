/**
 * The page. The start screen (or, from a shared link, nothing but the sky) paints first, from a small
 * script; the 3D world and the live flight (app/live.ts: three.js, the streamed map, the HUD) load
 * straight after and fade in behind the chrome.
 *
 * - A link (`#b=…`, or the older `?b=…`) opens that balloon's flight, with "Let go of your own" as the
 *   second action; a link that cannot be read says "This balloon link is broken." with a way on.
 * - Let go works at once: if the world is still loading, the launch starts as soon as it is in.
 * - <html data-view> says which chrome shows: start, launch, flight, error, link, broken.
 * - No WebGL (or a phone that loses it twice): the same flight on a 2D map (fallback/fallback2d.ts).
 * - `?fps=1` shows a frame counter, for checking smoothness on a real phone.
 */
import './ui/styles.css';
import { decodeBalloon, payloadFromLocation, type SavedBalloon } from './flight/codec';
import { COPY } from './ui/copy';
import { showNotice, type Notice } from './ui/notice';
import { mountStart, type StartChoice } from './ui/start';
import type { Live, View } from './app/live';
import type { Handover, World } from './app/world';
import { canUseWebGL } from './fallback/detect';

const params = new URLSearchParams(location.search);
const html = document.documentElement;
const sceneEl = document.getElementById('scene')!;
const hudEl = document.getElementById('hud')!;
const noticeEl = document.getElementById('notice')!;
const setView = (v: View) => {
  html.dataset.view = v;
};

let live: World | null = null;
let liveP: Promise<World> | null = null;
/** False once the 3D world cannot be drawn here: the 2D map is used instead. */
let webgl = canUseWebGL();
let latest: StartChoice | null = null;
let broken: Notice | null = null;

const deps = (contextLosses = 0) => ({ start, sceneEl, hudEl, noticeEl, setView, onNoWebGL: toMap, onReload: reloadWorld, contextLosses });

/** The 2D map in place of the 3D world, showing whatever flight the 3D world handed over. */
function loadMap(h?: Handover): Promise<World> {
  return import('./fallback/fallback2d').then((m) => {
    const f = m.startFallback(h?.flight ?? undefined, deps(), h?.choice ?? latest ?? start.start);
    if (h?.state === 'launch') f.letGo(h.choice);
    else if (h && !h.flight) setView('start');
    live = f;
    return f;
  });
}

/** The 3D world lost its WebGL context and got it back: build it again and carry on where it was. */
function reloadWorld(h: Handover) {
  (live as Live | null)?.dispose();
  live = null;
  noticeEl.replaceChildren();
  liveP = import('./app/live').then((m) => {
    try {
      const l = m.createLive(deps(1), h.choice);
      l.resume(h);
      live = l;
      return l;
    } catch {
      return loadMap(h);
    }
  });
  liveP.catch(() => toMap(h));
}

/** The 3D world gave up (its context was lost twice): carry on on the 2D map. */
function toMap(h: Handover) {
  (live as Live | null)?.dispose?.();
  live = null;
  webgl = false;
  noticeEl.replaceChildren();
  liveP = loadMap(h);
  liveP.catch(() => {
    liveP = null;
  });
}

/** The world, loaded once; a failed load (a flaky connection, a new deploy) is tried again next time. */
function loadLive(): Promise<World> {
  liveP ??= (webgl ? import('./app/live') : Promise.resolve(null))
    .then((m) => {
      if (!m) return loadMap();
      try {
        live = m.createLive(deps(), latest ?? start.start);
      } catch {
        // the context could not be made after all: the 2D map
        sceneEl.querySelector('canvas.world')?.remove();
        webgl = false;
        return loadMap();
      }
      return live;
    })
    .catch((e) => {
      liveP = null;
      throw e;
    });
  return liveP;
}

/** The world could not load: say so plainly, and let the visitor try again. */
function cannotLoad(retry: () => void) {
  setView('error');
  showNotice(noticeEl, COPY.windsUnavailable, [
    { label: COPY.tryAgain, primary: true, onClick: retry },
    { label: COPY.cancel, onClick: () => { noticeEl.replaceChildren(); setView('start'); } },
  ]);
}

function letGo(c: StartChoice) {
  if (live) return live.letGo(c);
  setView('launch');
  loadLive().then((l) => l.letGo(c), () => cannotLoad(() => letGo(c)));
}

function open(b: SavedBalloon) {
  if (live) return void live.open(b);
  setView('link');
  loadLive().then((l) => l.open(b), () => cannotLoad(() => open(b)));
}

const start = mountStart(
  document.getElementById('app')!,
  {
    onLetGo: letGo,
    onOpenBalloon: open,
    onStartChange(c) {
      latest = c;
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
  route();
});

// the world loads once the first frame of the chrome is on screen (not under a ?backdrop= test colour,
// which the contrast checks need to see)
if (!params.has('backdrop')) requestAnimationFrame(() => setTimeout(() => void loadLive().catch(() => {}), 0));
if (params.get('fps') === '1') void import('./ui/fps').then((m) => m.mountFps());
