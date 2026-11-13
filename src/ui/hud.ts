/**
 * The live flight HUD (spec 7.1, 7.3): quiet off-white text over soft ink shading, no boxes.
 *
 * Top left: the local clock (44 px, condensed bold, tabular) with "Over the Lake District" under it.
 * Top right: height and speed (28 px condensed values, 13 px labels), away from the clock so the
 * top left stays calm.
 * Bottom, in order: the fact line (rotates every 6 s, aria-live off), the string line (the balloon's
 * string: an off-white track, the orange flown part ending in a knot, ticks at each local midnight,
 * a hollow ring at 72 h) with "Day 1 of 3 · 14 h aloft" and Pause under it, the view switch, the
 * main action, and the small print.
 * A visually hidden polite status region carries only the launch, a change of country and the landing.
 */
import type { DirectorMode } from '../camera/director';
import { FACT_ROTATE_MS } from '../config';
import { COPY } from './copy';
import { clockText, dayLine, heightText, progress, speedText } from './hudmath';
import type { LatLon } from '../geo/coords';

export type HudHandlers = {
  onView(mode: DirectorMode): void;
  onPause(paused: boolean): void;
  /** "Let go of another" (own balloon) or "Let go of your own" (a shared link). */
  onAgain(): void;
  /** "Show me the whole trip" and, during the replay, "Back to live" (Task 18). */
  onTrip?(): void;
  onBack?(): void;
};

export type HudFrame = { now: number; point: LatLon; aglM: number; speedMs: number; landed: boolean };

const VIEWS: [DirectorMode, string][] = [['film', 'Film'], ['ride', 'Ride'], ['above', 'Above'], ['side', 'Side-on']];

export type Hud = {
  readonly el: HTMLElement;
  /** A new flight: its release time, its midnight ticks (0..1) and whether it is the visitor's own. */
  setFlight(f: { release: number; ticks: number[]; own: boolean }): void;
  /** Every frame (cheap: text is only written when it changes). */
  frame(f: HudFrame): void;
  /** "Over the North Sea", or "Landed near Bergen". */
  setOver(text: string): void;
  /** The facts that apply now; the line moves on to the next one every 6 s unless paused. */
  setFacts(facts: string[]): void;
  setView(mode: DirectorMode): void;
  setPaused(p: boolean): void;
  readonly paused: boolean;
  /** Say something in the polite status region. */
  announce(text: string): void;
  /** The fact on show (for checks). */
  readonly fact: string;
  /** Show "Show me the whole trip" (once a flight's route is in). */
  setTrip(on: boolean): void;
  /** The replay's chrome: its label under the clock, the names slot, "Back to live" for the main action. */
  setReplay(on: boolean): void;
  /** Where the replay writes its place names (at the top of the bottom stack, in the fact line's place). */
  readonly replaySlot: HTMLElement;
  destroy(): void;
};

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function mountHud(root: HTMLElement, handlers: HudHandlers, opts: { reducedMotion?: boolean } = {}): Hud {
  root.classList.add('hud');
  root.innerHTML = `
    <div class="hud-shade" aria-hidden="true"></div>
    <div class="hud-top">
      <div class="where">
        <p class="clock"><span class="sr">Local time </span><span class="clock-time"></span></p>
        <p class="over"></p>
      </div>
      <dl class="stats">
        <div class="stat"><dt>Height</dt><dd class="height"></dd></div>
        <div class="stat"><dt>Speed</dt><dd class="speed"></dd></div>
      </dl>
    </div>
    <div class="hud-bottom">
      <div class="replay-slot" aria-hidden="true"></div>
      <p class="fact" aria-live="off"></p>
      <div class="string" aria-hidden="true">
        <span class="track"></span><span class="fill"></span><span class="ticks"></span><span class="ring"></span><span class="knot"></span>
      </div>
      <div class="day-row">
        <p class="day"></p>
        <button type="button" class="link pause">${COPY.pause}</button>
      </div>
      <div class="views" role="group" aria-label="${COPY.view}">
        ${VIEWS.map(([m, label], i) => `${i ? '<span class="dot" aria-hidden="true">·</span>' : ''}<button type="button" class="link view" data-view="${m}" aria-pressed="${m === 'film'}">${label}</button>`).join('')}
      </div>
      <div class="actions">
        <button type="button" class="trip main-action" hidden>${COPY.wholeTrip}</button>
        <button type="button" class="back main-action" hidden>${COPY.backToLive}</button>
        <button type="button" class="link again"></button>
      </div>
      <div class="fineprint">
        <p class="small notice">${esc(COPY.notice)}</p>
        <p class="small map-credit"><a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">© OpenMapTiles</a> <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">Data from OpenStreetMap</a> <a href="https://mapterhorn.com/attribution" target="_blank" rel="noopener">© Mapterhorn</a></p>
      </div>
    </div>
    <p class="sr status" role="status" aria-live="polite"></p>`;

  const $ = <T extends HTMLElement>(sel: string) => root.querySelector(sel) as T;
  const clock = $('.clock-time'), over = $('.over'), height = $('.height'), speed = $('.speed');
  const fact = $('.fact'), day = $('.day'), fill = $('.fill'), knot = $('.knot'), ticksEl = $('.ticks');
  const pauseBtn = $<HTMLButtonElement>('.pause'), again = $<HTMLButtonElement>('.again'), status = $('.status');
  const bottom = $('.hud-bottom');

  let release = 0;
  let facts: string[] = [];
  let idx = 0;
  let paused = false;
  let shown = '';
  let lastP = -1;
  const text = (el: HTMLElement, s: string) => {
    if (el.textContent !== s) el.textContent = s;
  };

  // ---- the fact line ----
  let swap = 0;
  const show = (s: string) => {
    if (s === shown) return;
    shown = s;
    clearTimeout(swap);
    if (opts.reducedMotion || !fact.textContent) {
      fact.textContent = s;
      fact.classList.remove('out');
      return;
    }
    fact.classList.add('out');
    swap = window.setTimeout(() => {
      fact.textContent = s;
      fact.classList.remove('out');
    }, 220);
  };
  const timer = window.setInterval(() => {
    if (paused || facts.length === 0) return;
    idx = (idx + 1) % facts.length;
    show(facts[idx]);
  }, FACT_ROTATE_MS);

  // ---- the bottom shading fits the stack ----
  const fit = () => {
    const h = bottom.getBoundingClientRect().height;
    // tall enough that the fact line, the top of the stack, still sits where the shading is at 80% (the
    // 79% stop), which keeps 16 px text at 4.5:1 over snow
    root.style.setProperty('--hud-shade-h', `${Math.max(300, Math.ceil(h / 0.78))}px`);
  };
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(fit) : null;
  ro?.observe(bottom);

  // ---- controls ----
  const setView = (mode: DirectorMode) => {
    root.querySelectorAll<HTMLButtonElement>('.view').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === mode)));
  };
  root.querySelectorAll<HTMLButtonElement>('.view').forEach((b) =>
    b.addEventListener('click', () => {
      const m = b.dataset.view as DirectorMode;
      setView(m);
      handlers.onView(m);
    }),
  );
  const setPaused = (p: boolean) => {
    paused = p;
    pauseBtn.textContent = p ? COPY.resume : COPY.pause;
    root.classList.toggle('is-paused', p);
  };
  pauseBtn.addEventListener('click', () => {
    setPaused(!paused);
    handlers.onPause(paused);
  });
  again.addEventListener('click', () => handlers.onAgain());
  const trip = $<HTMLButtonElement>('.trip'), back = $<HTMLButtonElement>('.back'), replaySlot = $('.replay-slot');
  let tripOn = false;
  trip.addEventListener('click', () => handlers.onTrip?.());
  back.addEventListener('click', () => handlers.onBack?.());

  return {
    el: root,
    setFlight(f) {
      release = f.release;
      lastP = -1;
      again.textContent = f.own ? COPY.letGoAnother : COPY.letGoYourOwn;
      ticksEl.innerHTML = f.ticks.map((t) => `<i style="left:${(t * 100).toFixed(3)}%"></i>`).join('');
      facts = [];
      idx = 0;
      shown = '';
      clearTimeout(swap);
      fact.textContent = '';
      fact.classList.remove('out');
      requestAnimationFrame(fit);
    },
    frame(f) {
      text(clock, clockText(f.now, f.point));
      text(height, f.landed ? '0 m' : heightText(f.aglM));
      text(speed, speedText(f.landed ? 0 : f.speedMs));
      text(day, dayLine(release, f.now, { forecast: root.classList.contains('is-replay') }));
      const p = progress(release, f.now);
      if (Math.abs(p - lastP) > 1e-5) {
        lastP = p;
        const pc = `${(p * 100).toFixed(3)}%`;
        fill.style.width = pc;
        knot.style.left = pc;
        root.classList.toggle('is-landed', f.landed);
      }
    },
    setOver(s) {
      text(over, s);
    },
    setFacts(list) {
      facts = list;
      if (!list.length) return;
      if (!shown) {
        idx = 0;
        show(list[0]);
      } else if (idx >= list.length) idx = 0;
    },
    setView,
    setPaused,
    get paused() {
      return paused;
    },
    announce(s) {
      // cleared first so the same words twice are read twice
      status.textContent = '';
      requestAnimationFrame(() => (status.textContent = s));
    },
    get fact() {
      return shown;
    },
    setTrip(on) {
      tripOn = on && !!handlers.onTrip;
      if (!root.classList.contains('is-replay')) trip.hidden = !tripOn;
    },
    setReplay(on) {
      const had = root.contains(document.activeElement) && (document.activeElement === trip || document.activeElement === back);
      root.classList.toggle('is-replay', on);
      trip.hidden = on || !tripOn;
      again.hidden = on;
      back.hidden = !on;
      if (!on) replaySlot.replaceChildren();
      // the button pressed goes away: keyboard focus moves to the one in its place
      if (had) (on ? back : tripOn ? trip : again).focus({ preventScroll: true });
    },
    replaySlot,
    destroy() {
      clearInterval(timer);
      clearTimeout(swap);
      ro?.disconnect();
      root.replaceChildren();
    },
  };
}
