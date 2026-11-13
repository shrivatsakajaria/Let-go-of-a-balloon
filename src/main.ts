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

/** The world, loaded once; a failed load (a flaky connection, a new deploy) is tried again next time. */
function loadLive(): Promise<Live> {
  liveP ??= import('./app/live')
    .then((m) => {
      live = m.createLive({ start, sceneEl, hudEl, noticeEl, setView }, latest ?? start.start);
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

// the world loads once the first frame of the chrome is on screen
requestAnimationFrame(() => setTimeout(() => void loadLive().catch(() => {}), 0));
