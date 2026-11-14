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
import { shadeBottomPx, shadeTopPx } from './shade';
import { MAP_LINE, creditHtml } from './credits';
import { VIEW_TABS, clockFor, dayLine, heightText, progress, speedText, viewTab } from './hudmath';
import { downloadIcs, landingEvent } from './ics';
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

/** Film · Above · Side-on (owner's decision, 14 November 2026: Ride is one of Film's shots, not a tab of its own). */
const VIEW_LABELS: Record<(typeof VIEW_TABS)[number], string> = { film: 'Film', above: 'Above', side: 'Side-on' };
const VIEWS = VIEW_TABS.map((m) => [m, VIEW_LABELS[m]] as const);
/** "About" in the small print opens the start screen's About sheet (start.ts listens for it). */
const ABOUT_EVENT = 'lgoab:about';

export type Hud = {
  readonly el: HTMLElement;
  /**
   * A new flight: its release time, its midnight ticks (0..1), whether it is the visitor's own, and the start
   * place as said in a sentence (for "Add to calendar": "My balloon from London lands").
   */
  setFlight(f: { release: number; ticks: number[]; own: boolean; home?: string }): void;
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
  /** "Show the card" once the balloon is down (null hides it). */
  setCard(open: (() => void) | null): void;
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

/**
 * `note`: a sentence in place of the view switch, for the 2D map, which has no camera views
 * ("Your phone can't show the 3D world, so here is the route on a map.").
 */
export function mountHud(root: HTMLElement, handlers: HudHandlers, opts: { reducedMotion?: boolean; note?: string } = {}): Hud {
  root.classList.add('hud');
  root.innerHTML = `
    <div class="hud-shade ink-bottom" aria-hidden="true"></div>
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
        <button type="button" class="link cal" hidden>${COPY.addToCalendar}</button>
        <button type="button" class="link pause">${COPY.pause}</button>
      </div>
      ${opts.note ? `<p class="hud-note">${esc(opts.note)}</p>` : `<div class="views" role="group" aria-label="${COPY.view}">
        ${VIEWS.map(([m, label], i) => `${i ? '<span class="dot" aria-hidden="true">·</span>' : ''}<button type="button" class="link view" data-view="${m}" aria-pressed="${m === 'film'}">${label}</button>`).join('')}
      </div>`}
      <div class="actions">
        <button type="button" class="trip main-action" hidden>${COPY.wholeTrip}</button>
        <button type="button" class="back main-action" hidden>${COPY.backToLive}</button>
        <button type="button" class="link show-card" hidden>${COPY.showCard}</button>
        <button type="button" class="link again"></button>
      </div>
      <p class="small fineprint"><span class="notice">${COPY.simulation} · <button type="button" class="about-btn" aria-haspopup="dialog">${COPY.about}</button></span><span class="map-credit">${creditHtml(MAP_LINE)}</span></p>
    </div>
    <p class="sr status" role="status" aria-live="polite"></p>`;

  const $ = <T extends HTMLElement>(sel: string) => root.querySelector(sel) as T;
  const clock = $('.clock-time'), over = $('.over'), height = $('.height'), speed = $('.speed');
  const fact = $('.fact'), day = $('.day'), fill = $('.fill'), knot = $('.knot'), ticksEl = $('.ticks');
  const pauseBtn = $<HTMLButtonElement>('.pause'), again = $<HTMLButtonElement>('.again'), status = $('.status');
  const bottom = $('.hud-bottom');
  const showCard = $<HTMLButtonElement>('.show-card');
  const cal = $<HTMLButtonElement>('.cal');
  $<HTMLButtonElement>('.about-btn').addEventListener('click', () => document.dispatchEvent(new Event(ABOUT_EVENT)));
  let cardOpen: (() => void) | null = null;
  showCard.addEventListener('click', () => cardOpen?.());

  let clockNow = clockFor();
  let release = 0;
  let own = false;
  let home = '';
  /** "It flies on for three days...": shown first, once, when a flight of the visitor's own settles. */
  let lead = '';
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
    }, 160);
  };
  const timer = window.setInterval(() => {
    if (paused || facts.length === 0) return;
    idx = (idx + 1) % facts.length;
    show(facts[idx]);
  }, FACT_ROTATE_MS);

  // ---- the shading fits the text: the bottom band the stack, the top band the clock and "Over ..." ----
  const where = $('.where');
  const fit = () => {
    root.style.setProperty('--hud-shade-h', `${shadeBottomPx(bottom.getBoundingClientRect().height)}px`);
    // the top band is the page's one .shade-top (the start screen's), at this height in the launch and flight
    document.documentElement.style.setProperty('--shade-top-hud', `${shadeTopPx(where.getBoundingClientRect().bottom)}px`);
  };
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(fit) : null;
  ro?.observe(bottom);
  ro?.observe(where);

  // ---- controls ----
  const setView = (mode: DirectorMode) => {
    const tab = viewTab(mode);
    root.querySelectorAll<HTMLButtonElement>('.view').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === tab)));
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
  // the landing as a calendar event, with this balloon's own link (the address once the flight is on screen)
  cal.addEventListener('click', () => {
    const link = /^#b=/.test(location.hash) ? location.href : `${location.origin}/`;
    const uid = `${Math.round(release / 60e3)}-${location.hash.slice(3, 27) || 'balloon'}`;
    downloadIcs(landingEvent({ release, home: home || 'here', own, link, now: Date.now(), uid }));
  });
  const trip = $<HTMLButtonElement>('.trip'), back = $<HTMLButtonElement>('.back'), replaySlot = $('.replay-slot');
  let tripOn = false;
  trip.addEventListener('click', () => handlers.onTrip?.());
  back.addEventListener('click', () => handlers.onBack?.());

  return {
    el: root,
    setFlight(f) {
      clockNow = clockFor(); // another balloon may be in another time zone
      release = f.release;
      own = f.own;
      home = f.home ?? '';
      // only while it is new: a balloon of your own opened again on day 3 does not need telling
      lead = f.own && f.home && Date.now() - f.release < 6 * 3600e3 ? COPY.next : '';
      cal.hidden = !f.home;
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
      text(clock, clockNow(f.now, f.point));
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
        if (f.landed) cal.hidden = true; // nothing left to remind anyone of
        else if (home) cal.hidden = false;
      }
    },
    setOver(s) {
      text(over, s);
    },
    setFacts(list) {
      // the first facts of a flight of your own start with what happens next; it then rotates out
      if (lead && shown && shown !== lead) lead = '';
      facts = lead && list.length && !root.classList.contains('is-landed') ? [lead, ...list] : list;
      list = facts;
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
    setCard(open) {
      cardOpen = open;
      showCard.hidden = !open;
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
