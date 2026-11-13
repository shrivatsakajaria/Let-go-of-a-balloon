/**
 * The live flight, loaded after the start screen has painted (three.js and the world are the heavy
 * part of the page). It owns the 3D scene, the HUD and the flight's state:
 *
 *   start --Let go--> launch --hand opens--> launch (released) --camera settles (20 s)--> flight --72 h--> landed
 *   launch --winds fail, or not ready by 6 s--> error --Try again--> launch
 *                                              error --Cancel--> start
 *   (a link or a saved balloon) --> flight or landed;  flight/landed --Let go of another/your own--> start
 *
 * The page's view (start, launch, flight, error) is set on <html data-view>, and the chrome's fades
 * follow it in CSS (spec 8: chrome fades out over 300 ms on Let go, the HUD in over 600 ms at 20 s).
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
import { landmarkHeading } from '../ui/featured';
import type { StartChoice, StartScreen } from '../ui/start';
import { landedAt, linkRoute, releaseRoute, surfaceWind, warm } from './data';
import { LiveScene, type SceneFrame } from './scene';

export type View = 'start' | 'launch' | 'flight' | 'error' | 'link' | 'broken';

export type LiveDeps = {
  start: StartScreen;
  /** The scene layer (#scene); the canvas goes inside it. */
  sceneEl: HTMLElement;
  hudEl: HTMLElement;
  noticeEl: HTMLElement;
  setView(v: View): void;
};

type Flight = { route: Route; home: { name: string; lat: number; lon: number }; own: boolean; launched: boolean };

const PLACE_EVERY_MS = 6000;
const HOLD_MS = 1200;

/** What the page's test hooks can read (no state of the page is changed through it). */
export type LiveHook = {
  state: string;
  person: string | null;
  aglM: number;
  shot: string;
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
  /** Counts balloons being opened, so a slow one never takes over after the visitor has moved on. */
  private opening = 0;
  private readonly canvas: HTMLCanvasElement;
  /** Browser tests set window.__lgoabTest before the page loads; only then is window.__live kept up to date. */
  private unwatch: () => void = () => {};
  private readonly testing = !!(window as unknown as { __lgoabTest?: boolean }).__lgoabTest;
  private readonly hookRoute = { altM: 0, groundM: 0, tSec: 0 };
  private readonly subject: [number, number] = [0, 0];
  private readonly v1 = new Vector3();
  private readonly v2 = new Vector3();
  readonly hook: LiveHook = { state: 'start', person: null, aglM: 0, shot: '', paused: false, camera: [0, 0, 0], target: [0, 0, 0], fact: '', over: '', frames: 0, route: null, groundM: 0, feetM: 0, subjectPx: null, routeMs: null, routeError: null };

  constructor(private readonly deps: LiveDeps, choice: StartChoice) {
    this.choice = choice;
    const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
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
      },
      { reducedMotion: reduced },
    );
    if (this.testing) {
      (window as unknown as { __live: LiveHook }).__live = this.hook;
      // for the browser test of dispose: how many objects are left in the 3D scene afterwards
      (window as unknown as { __liveDispose: () => number }).__liveDispose = () => {
        const hook = this.hook;
        this.dispose();
        (window as unknown as { __live: LiveHook }).__live = hook;
        return this.scene.scene.children.length;
      };
    }
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
    this.opening++;
    this.windAsk++;
    this.unwatch();
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
    this.beginFlight(route, home, true, true);
    const saved: SavedBalloon = { v: 1, name: c.kind === 'gps' ? COPY.yourLocation : c.name, start: { lat: c.lat, lon: c.lon }, release: route.release, hourly: route.hourly, runId: route.runId };
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
    // a launch still waiting for its route never lets go now: this balloon takes over
    if (this.state === 'launch' || this.state === 'error') this.scene.cancelLaunch();
    this.clearNotice();
    this.state = 'flight';
    this.deps.setView('link');
    const own = store.list().some((x) => x.id === balloonId(b));
    const ticket = ++this.opening;
    let route: Route;
    try {
      route = await linkRoute(b);
    } catch (e) {
      if (ticket === this.opening) this.state = 'start';
      throw e;
    }
    if (ticket !== this.opening || this.state !== 'flight') return; // the visitor moved on meanwhile
    const home = { name: b.name === COPY.yourLocation ? COPY.yourLocation.toLowerCase() : b.name, lat: b.start.lat, lon: b.start.lon };
    // a landed balloon is seen from the side, in its field or on its sea, not from straight above
    const mode: DirectorMode = Date.now() >= landedAt(route) ? 'side' : 'film';
    this.scene.fly(route, mode);
    this.hud.setPaused(false);
    this.hud.setView(mode);
    this.beginFlight(route, home, own, false);
    this.deps.setView('flight');
    encodeBalloon(b).then((payload) => history.replaceState(null, '', linkFor(payload))).catch(() => {});
  }

  private beginFlight(route: Route, home: Flight['home'], own: boolean, launched: boolean): void {
    this.flight = { route, home, own, launched };
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
    this.opening++;
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

  // ---- every frame ----

  /** The read-only test hook (only when a test asked for it): reused arrays and vectors, nothing per frame. */
  private updateHook(f: SceneFrame): void {
    const h = this.hook;
    h.frames++;
    h.state = this.state;
    h.person = this.scene.person?.state ?? null;
    h.aglM = f.aglM;
    h.shot = f.shot;
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
  }

  private frame(f: SceneFrame): void {
    if (this.testing) this.updateHook(f);

    this.scene.measurePaused = this.state === 'launch';
    if (this.state === 'launch' && f.released && f.settled) {
      this.state = 'flight';
      this.deps.setView('flight');
    }
    if (this.state === 'start' || this.state === 'error') return;
    this.hud.frame({ now: f.now, point: f.point, aglM: f.aglM, speedMs: f.point.speedMs, landed: f.landed });
    if (!this.flight) return;

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
      if (this.flight !== fl) return;
      this.over = over;
      const landing = this.landing ? { name: this.landing.name, kind: this.landing.kind } : undefined;
      this.hud.setOver(landed ? landedOver(landing ?? null) : over ? overText(over) : '');
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
