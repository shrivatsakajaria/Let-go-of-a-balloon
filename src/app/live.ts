/**
 * The live flight, loaded after the start screen has painted (three.js and the world are the heavy
 * part of the page). It owns the 3D scene, the HUD and the flight's state:
 *
 *   start --Let go--> launch --hand opens--> launch (released) --camera settles (12-40 s)--> flight --72 h--> landed
 *   launch --winds fail, or not ready by 6 s--> error --Try again--> launch
 *                                              error --Cancel--> start
 *   (a link or a saved balloon) --> flight or landed;  flight/landed --Let go of another/your own--> start
 *
 * The page's view (start, launch, flight, error) is set on <html data-view>, and the chrome's fades
 * follow it in CSS (spec 8: chrome fades out over 300 ms on Let go, the HUD in over 600 ms when Ride settles).
 */
import { Vector3 } from 'three';
import type { DirectorEvent, DirectorMode } from '../camera/director';
import { encodeBalloon, linkFor, type SavedBalloon } from '../flight/codec';
import { positionAt, type Route } from '../flight/route';
import { balloonId, store } from '../flight/store';
import { haversineKm, type LatLon } from '../geo/coords';
import { factsFor, landingPlace } from '../geo/facts';
import { nearestPlace, type Place } from '../geo/gazetteer';
import { overText, placeOver, townAhead } from '../geo/places';
import { COPY } from '../ui/copy';
import { mountHud, type Hud } from '../ui/hud';
import { announcement, landedOver, midnightTicks, sceneLabel, startLabel, type AnnounceState } from '../ui/hudmath';
import { showNotice, type Notice } from '../ui/notice';
import { playReplay, replayNames, type ReplayName } from '../ui/replay';
import { landmarkHeading } from '../ui/featured';
import type { StartChoice, StartScreen } from '../ui/start';
import { landedAt, linkRoute, releaseRoute, surfaceWind, warm } from './data';
import { LiveScene, type SceneFrame } from './scene';
import { cardHook, homeFor, prepareCard, presentCard } from './landingcard';
import { cardScene, farStats, isFarRoute, settledWorld } from './cardshot';
import { closeCardView } from '../ui/cardview';
import { watchContextLoss, type ContextWatch } from './contextloss';
import { resumeAction, savedFor, type Handover } from './world';

export type View = 'start' | 'launch' | 'flight' | 'error' | 'link' | 'broken';

export type LiveDeps = {
  start: StartScreen;
  /** The scene layer (#scene); the canvas goes inside it. */
  sceneEl: HTMLElement;
  hudEl: HTMLElement;
  noticeEl: HTMLElement;
  setView(v: View): void;
  /** The WebGL context was lost twice (or never came back): the page moves to the 2D map. */
  onNoWebGL?(h: Handover): void;
  /** The WebGL context was lost and has come back: the page builds the 3D world again from h. */
  onReload?(h: Handover): void;
  /** Contexts the page lost before this world was built. */
  contextLosses?: number;
};

type Flight = { route: Route; home: { name: string; lat: number; lon: number }; own: boolean; launched: boolean; saved: SavedBalloon; carded?: boolean };

const PLACE_EVERY_MS = 6000;
const HOLD_MS = 1200;
/** The landing card comes up this long after touchdown, once the balloon has settled. */
const CARD_AFTER_MS = 1500;

/** What the page's test hooks can read (no state of the page is changed through it). */
export type LiveHook = {
  state: string;
  person: string | null;
  aglM: number;
  shot: string;
  /** Seconds since Let go while the launch shot runs (0 otherwise). */
  launchS: number;
  paused: boolean;
  camera: number[];
  target: number[];
  fact: string;
  over: string;
  frames: number;
  route: { altM: number; groundM: number; tSec?: number } | null;
  /** While waiting: where the person's feet and the top of the held balloon are on screen (CSS px from the top). */
  subjectPx: [number, number] | null;
  /** The last release: how long its route took (ms), or why it failed. */
  routeMs: number | null;
  routeError: string | null;
  groundM: number;
  feetM: number;
  /** The whole-trip replay is on, its trail is in the scene, and the time the scene shows (UTC ms). */
  replay: boolean;
  trail: boolean;
  now: number;
  /** The last replay: ms from the tap to its end (onEnd), or null. */
  replayMs: number | null;
  /** Floating-origin re-centres so far. */
  recentres: number;
  /** What the last frame drew (renderer.info, shadow pass included): for the performance checks. */
  triangles: number;
  calls: number;
  /** WebGL context losses so far. */
  contextLosses: number;
};

export class Live {
  readonly scene: LiveScene;
  readonly hud: Hud;
  state: 'start' | 'launch' | 'flight' | 'error' = 'start';
  private choice: StartChoice;
  private flight: Flight | null = null;
  private notice: Notice | null = null;
  private placeAt = -Infinity;
  private placeBusy = false;
  private landing: Place | null = null;
  private landingFor: Route | null = null;
  private over = '';
  private overKind: string | null = null;
  private lastTown: string | null = null;
  private lastCountry: string | null = null;
  private said: AnnounceState | null = null;
  private sunUp: boolean | null = null;
  private windAsk = 0;
  /** Counts cards asked for, so only the latest one opens. */
  private cardTicket = 0;
  /** Counts balloons being opened, so a slow one never takes over after the visitor has moved on. */
  private opening = 0;
  private readonly canvas: HTMLCanvasElement;
  private readonly reduced: boolean;
  /** The whole-trip replay on screen (aborted by Back to live), and its names worked out in the background. */
  private replayRun: AbortController | null = null;
  private replayPrep: { route: Route; names: Promise<ReplayName[]>; landing: Promise<Place | null>; ac: AbortController } | null = null;
  private overLine = '';
  /** Pause as it was before the replay (the replay plays; Back to live puts it back). */
  private pausedBefore = false;
  /**
   * Where the whole-trip replay ends (it then holds on the landing): the landing card opens over it
   * ("Expected to land near ...", the card the replay began making), and owns Escape from then; until it
   * is up, Escape still goes back to live (and a card that cannot be made leaves the replay's own Back to
   * live on screen). Closing the card ("Back to live") returns to live at now.
   */
  onReplayEnd: (route: Route, landed?: boolean) => void = (route, landed) => {
    const run = this.replayRun;
    const onKey = (e: KeyboardEvent) => {
      if (this.replayRun !== run) return removeEventListener('keydown', onKey);
      if (e.key === 'Escape') this.backToLive();
    };
    addEventListener('keydown', onKey);
    // once the card is up it owns Escape; if it never comes, Escape stays with the held replay
    void this.showCard(route, { closeLabel: COPY.backToLive, onClose: () => this.backToLive(), waitMs: 0, landed, while: () => this.replayRun === run }).then((up) => {
      if (up) removeEventListener('keydown', onKey);
    });
  };
  /** Browser tests set window.__lgoabTest before the page loads; only then is window.__live kept up to date. */
  private unwatch: () => void = () => {};
  private readonly testing = !!(window as unknown as { __lgoabTest?: boolean }).__lgoabTest;
  private readonly hookRoute = { altM: 0, groundM: 0, tSec: 0 };
  private readonly subject: [number, number] = [0, 0];
  private readonly v1 = new Vector3();
  private readonly v2 = new Vector3();
  readonly hook: LiveHook = { state: 'start', person: null, aglM: 0, shot: '', launchS: 0, paused: false, camera: [0, 0, 0], target: [0, 0, 0], fact: '', over: '', frames: 0, route: null, groundM: 0, feetM: 0, subjectPx: null, routeMs: null, routeError: null, triangles: 0, calls: 0, contextLosses: 0, replay: false, trail: false, now: 0, replayMs: null, recentres: 0 };
  private readonly context: ContextWatch;

  constructor(private readonly deps: LiveDeps, choice: StartChoice) {
    this.choice = choice;
    const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.reduced = reduced;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'world';
    this.canvas.setAttribute('role', 'img');
    this.canvas.setAttribute('aria-label', startLabel(choice));
    deps.sceneEl.append(this.canvas);
    this.scene = new LiveScene(this.canvas, choice, { reducedMotion: reduced });
    this.scene.onFirstFrame = () => {
      deps.sceneEl.dataset.live = '1';
      deps.sceneEl.removeAttribute('aria-hidden');
      this.canvas.classList.add('on');
    };
    this.scene.onLuminance = (top, bottom) => deps.start.setBackdropLuminance(top, bottom);
    this.scene.onFrame = (f) => this.frame(f);
    this.hud = mountHud(
      deps.hudEl,
      {
        onView: (m: DirectorMode) => this.scene.setView(m),
        onPause: (p) => this.scene.setPaused(p),
        onAgain: () => this.backToStart(),
        onTrip: () => this.showTrip(),
        onBack: () => this.backToLive(),
      },
      { reducedMotion: reduced },
    );
    if (this.testing) {
      // read when asked, not per frame: a starved renderer can go seconds without one
      Object.defineProperty(this.hook, 'replay', { enumerable: true, get: () => this.replayRun !== null });
      Object.defineProperty(this.hook, 'trail', { enumerable: true, get: () => !!this.scene.scene.getObjectByName('replay-trail') });
      (window as unknown as { __live: LiveHook }).__live = this.hook;
      // for the browser test of dispose: how many objects are left in the 3D scene afterwards
      (window as unknown as { __liveDispose: () => number }).__liveDispose = () => {
        const hook = this.hook;
        this.dispose();
        (window as unknown as { __live: LiveHook }).__live = hook;
        return this.scene.scene.children.length;
      };
    }
    this.hook.contextLosses = deps.contextLosses ?? 0;
    this.context = watchContextLoss(
      this.canvas,
      {
        // a replay stops cleanly (its trail, timer and key listener go; Pause as it was comes back)
        onLost: () => {
          this.hook.contextLosses++;
          this.backToLive();
        },
        onRestored: () => deps.onReload?.(this.handover()),
        onGiveUp: () => deps.onNoWebGL?.(this.handover()),
      },
      { losses: deps.contextLosses ?? 0 },
    );
    this.watchBand();
    this.setStart(choice);
  }

  // ---- the start screen ----

  /** The start place changed: the person goes there, and its winds and ground start loading. */
  setStart(c: StartChoice): void {
    this.choice = c;
    warm(c);
    if (this.state !== 'start') return;
    this.scene.setStart(c, landmarkHeading(c.cityId));
    this.askWind(c);
  }

  private askWind(c: StartChoice): void {
    const ask = ++this.windAsk;
    surfaceWind(c).then((w) => {
      if (w && ask === this.windAsk && this.state === 'start') this.scene.setWind(w);
    });
  }

  /** Frame the waiting shot in the band the start screen leaves free (spec 6.1). */
  private watchBand(): void {
    const top = document.querySelector('.start .top');
    const bottom = document.querySelector('.start .bottom');
    if (!top || !bottom) return;
    const fit = () => {
      const H = window.innerHeight || 1;
      const a = top.getBoundingClientRect().bottom + 8;
      const b = bottom.getBoundingClientRect().top - 8;
      if (!(b > a)) return;
      const mid = (a + b) / 2;
      this.scene.setWaitFrame({ centerY: 1 - (2 * mid) / H, spanY: (2 * (b - a)) / H });
    };
    fit();
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(fit) : null;
    ro?.observe(top);
    ro?.observe(bottom);
    window.addEventListener('resize', fit);
    this.unwatch = () => {
      ro?.disconnect();
      window.removeEventListener('resize', fit);
    };
  }

  /** Take the live flight down: the scene and its GL context, the HUD and its timer, the listeners. */
  dispose(): void {
    this.backToLive(); // a running replay: its key listener and end timer go with it
    this.cancelReplayPrep();
    this.opening++;
    this.windAsk++;
    // the landing card: one being made never opens, one on screen closes, a delayed one never comes
    this.cardTicket++;
    closeCardView();
    this.flight = null;
    this.unwatch();
    this.context.dispose();
    this.clearNotice();
    this.hud.destroy();
    this.scene.dispose();
    this.canvas.remove();
    delete this.deps.sceneEl.dataset.live;
    if (this.testing) delete (window as unknown as { __live?: LiveHook }).__live;
  }

  // ---- Let go ----

  letGo(c: StartChoice): void {
    if (this.state === 'launch' || this.state === 'flight') return;
    this.clearNotice();
    const moved = c.lat !== this.choice.lat || c.lon !== this.choice.lon;
    this.choice = c;
    if (moved) this.scene.setStart(c, landmarkHeading(c.cityId));
    this.state = 'launch';
    this.deps.setView('launch');
    this.hud.setPaused(false);
    this.hud.setView('film');
    this.scene.setPaused(false);
    const t0 = Date.now();
    const route = releaseRoute(c, t0 + HOLD_MS, this.scene.startLift());
    this.hook.routeMs = this.hook.routeError = null;
    route.then(
      () => (this.hook.routeMs = Date.now() - t0),
      (e) => (this.hook.routeError = `${(e as Error)?.name}: ${(e as Error)?.message}`),
    );
    // a failure known at once still lets the chrome fade and the hand reach its moment first
    const ready = route.catch(async (e) => {
      await new Promise((r) => setTimeout(r, Math.max(0, t0 + HOLD_MS - Date.now())));
      throw e;
    });
    this.hud.setFlight({ release: t0 + HOLD_MS, ticks: [], own: true });
    this.scene.launch(
      ready,
      (r) => this.released(r, c),
      () => this.windError(),
    );
  }

  private released(route: Route, c: StartChoice): void {
    if (this.state !== 'launch') return;
    const home = { name: c.kind === 'gps' ? COPY.yourLocation.toLowerCase() : c.name, lat: c.lat, lon: c.lon };
    const saved: SavedBalloon = { v: 1, name: c.kind === 'gps' ? COPY.yourLocation : c.name, start: { lat: c.lat, lon: c.lon }, release: route.release, hourly: route.hourly, runId: route.runId };
    this.beginFlight(route, home, true, true, saved);
    store.add(saved);
    this.deps.start.refresh();
    encodeBalloon(saved)
      .then((payload) => {
        if (this.flight?.route === route) history.replaceState(null, '', linkFor(payload));
      })
      .catch(() => {});
  }

  private windError(): void {
    this.state = 'error';
    this.scene.rewind();
    this.deps.setView('error');
    this.notice = showNotice(this.deps.noticeEl, COPY.windsUnavailable, [
      { label: COPY.tryAgain, primary: true, onClick: () => this.letGo(this.choice) },
      { label: COPY.cancel, onClick: () => this.backToStart() },
    ]);
  }

  private clearNotice(): void {
    this.notice?.remove();
    this.notice = null;
  }

  // ---- a balloon from a link or from "Your balloons" ----

  async open(b: SavedBalloon): Promise<void> {
    this.backToLive();
    // a launch still waiting for its route never lets go now: this balloon takes over
    if (this.state === 'launch' || this.state === 'error') this.scene.cancelLaunch();
    this.clearNotice();
    this.state = 'flight';
    this.deps.setView('link');
    const own = store.list().some((x) => x.id === balloonId(b));
    const ticket = ++this.opening;
    let route: Route;
    let name: string;
    try {
      // "your location" only on the visitor's own balloon; a shared one is named for its place
      [route, name] = await Promise.all([linkRoute(b), homeFor(b, own)]);
    } catch (e) {
      if (ticket === this.opening) this.state = 'start';
      throw e;
    }
    if (ticket !== this.opening || this.state !== 'flight') return; // the visitor moved on meanwhile
    const home = { name, lat: b.start.lat, lon: b.start.lon };
    // a landed balloon is seen from the side, in its field or on its sea, not from straight above
    const mode: DirectorMode = Date.now() >= landedAt(route) ? 'side' : 'film';
    this.scene.fly(route, mode);
    this.hud.setPaused(false);
    this.hud.setView(mode);
    this.beginFlight(route, home, own, false, b);
    this.deps.setView('flight');
    encodeBalloon(b).then((payload) => history.replaceState(null, '', linkFor(payload))).catch(() => {});
  }

  private beginFlight(route: Route, home: Flight['home'], own: boolean, launched: boolean, saved: SavedBalloon): void {
    this.backToLive();
    this.cancelReplayPrep();
    closeCardView();
    this.cardTicket++;
    this.hud.setCard(null);
    this.flight = { route, home, own, launched, saved };
    this.overLine = '';
    // a link is in flight at once: its replay names are worked out when the page is idle; a launch waits
    // until the camera has settled (frame), so the lookups never compete with the launch's tiles
    if (!launched) this.prepareReplaySoon();
    this.hud.setTrip(true);
    this.hud.setFlight({ release: route.release, ticks: midnightTicks(route), own });
    this.said = null;
    this.lastCountry = null;
    this.lastTown = null;
    this.overKind = null;
    this.sunUp = null;
    this.placeAt = -Infinity;
    this.over = '';
    this.hud.setOver('');
  }

  backToStart(): void {
    this.backToLive();
    this.cancelReplayPrep();
    this.hud.setTrip(false);
    this.opening++;
    this.cardTicket++;
    closeCardView();
    this.clearNotice();
    this.flight = null;
    this.state = 'start';
    this.hud.setPaused(false);
    this.scene.setPaused(false);
    history.replaceState(null, '', '/');
    this.deps.start.refresh();
    this.deps.setView('start');
    this.scene.setStart(this.choice, landmarkHeading(this.choice.cityId));
    this.askWind(this.choice);
    this.canvas.setAttribute('aria-label', startLabel(this.choice));
  }

  // ---- the whole trip ----

  /** "Show me the whole trip": the forecast route in 20 seconds, then the landing (spec 6.4). */
  showTrip(): void {
    const fl = this.flight;
    if (!fl || this.replayRun || this.state !== 'flight') return;
    const ctl = new AbortController();
    this.replayRun = ctl;
    // a card on its way (a landed link's) never opens over the replay
    this.cardTicket++;
    const t0 = performance.now();
    this.hook.replayMs = null;
    // names and the landing arrive in the background (asked now if they were not yet); the first name is
    // not due until the climb is over, the landing not until the descent
    const prep = this.prepareReplay();
    const names: ReplayName[] = [];
    prep.names.then((n) => this.replayRun === ctl && names.push(...n));
    const landing = prep.landing.then((l) => (l ? { name: l.name, kind: l.kind } : null));
    this.deps.start.setBackdropLuminance(1, 1);
    // a paused camera would not climb: the replay plays (it has Back to live, not Pause), and Back to live
    // puts Pause back as it was
    this.pausedBefore = this.hud.paused;
    this.hud.setPaused(false);
    this.scene.setPaused(false);
    this.canvas.setAttribute('aria-label', `The forecast route of ${fl.own ? 'your' : 'this'} balloon from ${fl.home.name}`);
    const top = this.hud.el.querySelector('.hud-top'), bottom = this.hud.el.querySelector('.hud-bottom');
    // the landing card is made while the replay plays (its land loads meanwhile) and pictured at the end,
    // so it is ready as the replay holds on the landing; Back to live before the end cancels it
    let ended = () => {};
    const gate = new Promise<void>((r) => (ended = r));
    ctl.signal.addEventListener('abort', () => ended());
    const replaying = () => this.replayRun === ctl && this.flight === fl && !this.scene.gone;
    // the card for the state the replay began in: a balloon that lands meanwhile still ends on this one
    const landed = Date.now() >= landedAt(fl.route);
    void prepareCard({ scene: cardScene(this.scene), route: fl.route, saved: fl.saved, own: fl.own, landing: prep.landing, isCurrent: replaying, alive: replaying, gate, landed });
    void playReplay(fl.route, {
      host: {
        scene: this.scene,
        hud: this.hud,
        layer: this.deps.sceneEl,
        band: () => ({ top: (top?.getBoundingClientRect().bottom ?? 120) + 16, bottom: (bottom?.getBoundingClientRect().top ?? innerHeight - 220) - 16 }),
        reducedMotion: this.reduced,
        exit: () => this.backToLive(),
      },
      names,
      landing,
      home: fl.home.name,
      signal: ctl.signal,
      onEnd: () => {
        ended();
        this.hook.replayMs = performance.now() - t0;
        this.onReplayEnd(fl.route, landed);
      },
    });
  }

  /** Back to live from the replay (or nothing, if none is on): the live clock and view, at now. */
  backToLive(): void {
    const run = this.replayRun;
    if (!run) return;
    this.replayRun = null;
    run.abort();
    if (this.pausedBefore) {
      this.hud.setPaused(true);
      this.scene.setPaused(true);
    }
    this.pausedBefore = false;
    this.hud.setOver(this.overLine);
    this.placeAt = -Infinity; // the facts, the label and "Over ..." for now, straight away
  }

  /** The replay's names and landing for this flight: asked once, cancelled when the flight goes. */
  private prepareReplay(): NonNullable<Live['replayPrep']> {
    const fl = this.flight!;
    if (this.replayPrep?.route === fl.route) return this.replayPrep;
    this.cancelReplayPrep();
    const ac = new AbortController();
    const landing = landingPlace(fl.route).catch(() => null);
    const names = landing
      .then((l) => (ac.signal.aborted ? [] : replayNames(fl.route, { home: fl.home.name, landing: l?.name, signal: ac.signal })))
      .catch(() => [] as ReplayName[]);
    this.replayPrep = { route: fl.route, names, landing, ac };
    return this.replayPrep;
  }

  /** In idle time (or shortly), for the flight on screen now. */
  private prepareReplaySoon(): void {
    const fl = this.flight;
    // the flight checked when it runs: a later flight or the start screen makes it a no-op
    const go = () => {
      if (this.flight === fl && fl) this.prepareReplay();
    };
    const w = window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
    if (w.requestIdleCallback) w.requestIdleCallback(go, { timeout: 3000 });
    else window.setTimeout(go, 500);
  }

  private cancelReplayPrep(): void {
    this.replayPrep?.ac.abort();
    this.replayPrep = null;
  }

  /** What the 2D map needs to carry on from here. */
  handover(): Handover {
    // during a replay, Pause as it was before it (the replay itself plays unpaused)
    return { choice: this.choice, state: this.state, flight: this.flight, paused: this.replayRun ? this.pausedBefore : this.hud.paused };
  }

  /**
   * Carry on from what a world before this one was showing (its context was lost and came back): the
   * flight, seen as open() would show it (a landed balloon from the side); a launch that had not let go
   * yet starts again; anything else goes back to the start screen.
   */
  resume(h: Handover): void {
    const a = resumeAction(h, Date.now());
    if (a.kind === 'fly' && h.flight) {
      const { route, home, own } = h.flight;
      this.state = 'flight';
      this.scene.fly(route, a.mode);
      this.hud.setPaused(!!h.paused);
      this.scene.setPaused(!!h.paused);
      this.hud.setView(a.mode);
      this.beginFlight(route, home, own, h.flight.launched ?? false, savedFor(h.flight));
      this.deps.setView('flight');
      // a launched flight's names are otherwise asked when its launch settles, which a resumed one skips
      this.prepareReplaySoon();
    } else if (a.kind === 'launch') this.letGo(h.choice);
    else if (a.kind === 'start') this.backToStart();
    // 'stay': the start screen as it was (the constructor has already set the start place)
  }

  // ---- every frame ----

  /** The read-only test hook (only when a test asked for it): reused arrays and vectors, nothing per frame. */
  private updateHook(f: SceneFrame): void {
    const h = this.hook;
    h.frames++;
    h.state = this.state;
    h.person = this.scene.person?.state ?? null;
    h.aglM = f.aglM;
    h.shot = f.shot;
    h.launchS = this.scene.director.launchSeconds;
    h.paused = this.hud.paused;
    this.scene.camera.position.toArray(h.camera);
    this.scene.balloon.mesh.position.toArray(h.target);
    h.fact = this.hud.fact;
    h.over = this.over;
    if (f.released) {
      h.route = this.hookRoute;
      this.hookRoute.altM = f.point.altM;
      this.hookRoute.groundM = f.point.groundM;
      this.hookRoute.tSec = f.point.tSec;
    } else h.route = null;
    h.groundM = f.groundM;
    h.feetM = f.feetM;
    h.now = f.now;
    h.recentres = this.scene.stream.stats().recentres;
    const person = this.scene.person;
    if (f.waiting && person?.root.visible) {
      const cam = this.scene.camera;
      const px = (v: Vector3) => ((1 - v.project(cam).y) / 2) * window.innerHeight;
      const top = this.scene.balloon.mesh.getWorldPosition(this.v1);
      top.y += 0.2;
      this.subject[0] = px(top);
      this.subject[1] = px(person.root.getWorldPosition(this.v2));
      h.subjectPx = this.subject;
    } else h.subjectPx = null;
    const info = this.scene.renderer.info.render;
    h.triangles = info.triangles;
    h.calls = info.calls;
  }

  private frame(f: SceneFrame): void {
    if (this.testing) this.updateHook(f);

    // nor in the replay, whose scene changes faster than a reading a second can follow: its shading stays
    // at full strength (set in showTrip), and no read-back stalls its 20 seconds
    this.scene.measurePaused = this.state === 'launch' || this.replayRun !== null;
    if (this.state === 'launch' && f.released && f.settled) {
      this.state = 'flight';
      this.deps.setView('flight');
      this.prepareReplaySoon(); // the launch's tiles are in: the replay's names can be looked up now
    }
    if (this.state === 'start' || this.state === 'error') return;
    this.hud.frame({ now: f.now, point: f.point, aglM: f.aglM, speedMs: f.point.speedMs, landed: f.landed });
    if (!this.flight || this.replayRun) return;

    // down: the landing card, once per flight (a landed link opens on it too), a moment after touchdown
    if (f.landed && !this.flight.carded) {
      const fl = this.flight;
      fl.carded = true;
      this.hud.setCard(() => void this.showCard(fl.route));
      setTimeout(() => {
        if (this.flight === fl && !this.replayRun) void this.showCard(fl.route);
      }, CARD_AFTER_MS);
    }

    // the sun crossing the horizon is a film event
    const up = f.sunElevationDeg > 0;
    if (this.sunUp !== null && up !== this.sunUp) this.event(up ? 'sunrise' : 'sunset');
    this.sunUp = up;

    if (f.now - this.placeAt > PLACE_EVERY_MS && !this.placeBusy) {
      this.placeAt = f.now;
      this.placeBusy = true;
      this.refreshPlace(this.flight, f).finally(() => (this.placeBusy = false));
    }
  }

  /**
   * The landing card for the balloon on show (spec 6.5): when it comes down, when a landed link opens,
   * from "Show the card", and at the end of the replay. Resolves once the card is on screen (true), or
   * with false when it was not made (the visitor moved on meanwhile, or it could not be).
   */
  async showCard(route?: Route, opts: { closeLabel?: string; onClose?: () => void; waitMs?: number; landed?: boolean; while?: () => boolean } = {}): Promise<boolean> {
    const fl = this.flight;
    if (!fl) return false;
    const r = route ?? fl.route;
    const ticket = ++this.cardTicket;
    const landing = this.landingFor === r && this.landing ? Promise.resolve(this.landing) : landingPlace(r).catch(() => null);
    const isCurrent = () => ticket === this.cardTicket && this.flight === fl && (opts.while?.() ?? true);
    cardHook.world = farStats;
    const view = await presentCard({
      scene: cardScene(this.scene),
      // a long route's card world is its own: no wait for the live world round the landing
      settle: isFarRoute(r) ? undefined : () => settledWorld(this.scene, opts.waitMs ?? 8000, isCurrent),
      route: r,
      saved: fl.saved,
      own: fl.own,
      landing,
      isCurrent,
      // the card goes on being made while this balloon is on screen (a newer request shares it)
      alive: () => this.flight === fl && !this.scene.gone,
      closeLabel: opts.closeLabel,
      onClose: opts.onClose,
      landed: opts.landed,
    });
    return view !== null;
  }

  private event(kind: DirectorEvent): void {
    this.scene.director.event(kind);
  }

  /**
   * What the balloon is over, the town ahead, the landing place and the country, asked in the background
   * (place names come from the gazetteer files and the map labels loaded under the balloon), then the
   * facts, the status region and the canvas label.
   */
  private async refreshPlace(fl: Flight, f: SceneFrame): Promise<void> {
    const now = f.now;
    const here = positionAt(fl.route, now);
    const landed = now >= landedAt(fl.route);
    try {
      if (this.landingFor !== fl.route) {
        this.landing = await landingPlace(fl.route).catch(() => null);
        this.landingFor = fl.route;
      }
      const [over, town, place] = await Promise.all([
        placeOver(here, this.scene.labelsNear(here)).catch(() => ''),
        landed ? Promise.resolve(null) : townAhead(here).catch(() => null),
        nearestPlace(here).catch(() => null),
      ]);
      if (this.flight !== fl || this.replayRun) return;
      this.over = over;
      const landing = this.landing ? { name: this.landing.name, kind: this.landing.kind } : undefined;
      this.overLine = landed ? landedOver(landing ?? null) : over ? overText(over) : '';
      this.hud.setOver(this.overLine);
      this.hud.setFacts(factsFor({ route: fl.route, nowUtcMs: now, home: fl.home, here, over: over || 'open country', nearestTown: town ?? undefined, landing }));

      // film events: a coast crossed, a town reached
      const kind = place ? (place.kind === 'sea' ? 'sea' : 'land') : null;
      if (kind && this.overKind && kind !== this.overKind) this.event('coast');
      if (kind) this.overKind = kind;
      const townNow = place?.kind === 'town' && (place.distanceKm ?? 99) < 5 ? place.name : null;
      if (townNow && townNow !== this.lastTown && this.lastTown !== null) this.event('city');
      if (townNow) this.lastTown = townNow;
      else if (this.lastTown === null) this.lastTown = '';

      // the status region: the launch, a change of country, the landing
      const country = place?.kind === 'town' ? place.country ?? null : null;
      const next: AnnounceState = { phase: landed ? 'landed' : 'flying', home: fl.home.name, country, lastCountry: this.lastCountry, landing: landing ?? null, own: fl.own, launched: fl.launched };
      const say = announcement(this.said, next);
      if (say) this.hud.announce(say);
      this.said = next;
      if (country) this.lastCountry = country;

      this.canvas.setAttribute(
        'aria-label',
        sceneLabel({ own: fl.own, over: over || 'open country', km: haversineKm(fl.home, here), home: fl.home.name, landed: landed ? landedOver(landing ?? null) : null }),
      );
    } catch {
      /* names are a nicety: the flight goes on without them */
    }
  }
}

export function createLive(deps: LiveDeps, choice: StartChoice): Live {
  return new Live(deps, choice);
}

export type { LatLon };
