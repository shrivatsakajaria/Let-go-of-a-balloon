/**
 * The 2D fallback (spec 6.7: "No WebGL or a very weak phone: show a simple 2D fallback of the route
 * and the landing card"). The same flight as the 3D world (Let go, a shared link, "Your balloons"), drawn
 * as a flat map: the land and sea from OpenFreeMap's low-zoom vector tiles, the route as a string from
 * the start to the landing ring, the flown part solid and the forecast part dashed, and the balloon
 * where it is now. The live HUD and facts sit over it, with "Your phone can't show the 3D world, so
 * here is the route on a map." where the view switch would be. No three.js is loaded.
 *
 * Two canvases: the coastline (drawn once per view, fading in when its tiles are in) and the route
 * (redrawn once a second as the balloon moves). The landing card is not built here: `onCard` is
 * called once when the balloon has landed (or a landed link opens), and `mapImage` draws the map for
 * the card's picture.
 */
import './fallback.css';
import { encodeBalloon, linkFor, type SavedBalloon } from '../flight/codec';
import { positionAt, type Route } from '../flight/route';
import { balloonId, store } from '../flight/store';
import { haversineKm } from '../geo/coords';
import { factsFor, landingPlace } from '../geo/facts';
import { GENERIC_LAND, nearestPlace, type Place } from '../geo/gazetteer';
import { overText, placeOver, townAhead } from '../geo/places';
import { COPY } from '../ui/copy';
import { mountHud, type Hud } from '../ui/hud';
import { announcement, landedOver, midnightTicks, sceneLabel, type AnnounceState } from '../ui/hudmath';
import { showNotice, type Notice } from '../ui/notice';
import { closeCardView } from '../ui/cardview';
import { homeFor } from '../app/landingcard';
import { luminance, type StartChoice } from '../ui/start';
import { BALLOON_HEX } from '../config';
import { CONTOUR } from '../world/palette';
import { fetchVectorTile, vectorTileTemplate } from '../world/vector';
import { landedAt, linkRoute, releaseRoute, warm } from '../app/data';
import type { LiveDeps } from '../app/live';
import type { Flight, World } from '../app/world';
import { SHADE_FAINT, decodeCoast, fitView, freeBand, mercX, mercY, pickZoom, tilesFor, toPx, unwrapLons, type Band, type Coast, type MapTile, type MapView, type Size } from './map2d';

const LAND = CONTOUR.land[1];
const SEA = CONTOUR.waterDeep;
const PAPER = '#f7f3ec';
const INK = '10, 14, 28';
/** Sharpness of the map: like the 3D world's cap, a little higher because lines are all it draws. */
const DPR_CAP = 2;
const TICK_MS = 1000;
const PLACE_EVERY_MS = 6000;

export type FallbackDeps = LiveDeps;

// ---- the coastline tiles (decoded once per page) ----

const coastCache = new Map<string, Promise<Coast | null>>();

function coastTile(t: MapTile): Promise<Coast | null> {
  const key = `${t.z}/${t.x}/${t.y}`;
  let p = coastCache.get(key);
  if (!p) {
    p = vectorTileTemplate()
      .then((tpl) => fetchVectorTile(tpl, t.z, t.x, t.y))
      .then((bytes) => (bytes ? decodeCoast(bytes) : null))
      .catch(() => null);
    p.then((c) => {
      if (!c) coastCache.delete(key); // a failure is asked again next time
    });
    coastCache.set(key, p);
  }
  return p;
}

// ---- drawing ----

/** Land and sea for the tiles that came in; a tile that did not leaves the sky showing. */
export function drawCoast(ctx: CanvasRenderingContext2D, v: MapView, tiles: { t: MapTile; coast: Coast | null }[]): void {
  const at = (t: MapTile) => {
    const n = 2 ** t.z;
    const a = toPx(v, t.tx / n, t.y / n);
    return { x: a.x, y: a.y, s: v.scale / n };
  };
  ctx.fillStyle = LAND;
  for (const { t, coast } of tiles) {
    if (!coast) continue;
    const a = at(t);
    // snapped outwards so neighbouring tiles meet without a hairline
    ctx.fillRect(Math.floor(a.x), Math.floor(a.y), Math.ceil(a.x + a.s) - Math.floor(a.x), Math.ceil(a.y + a.s) - Math.floor(a.y));
  }
  ctx.fillStyle = SEA;
  for (const { t, coast } of tiles) {
    if (!coast) continue;
    const a = at(t);
    for (const poly of coast.water) {
      ctx.beginPath();
      for (const ring of poly) {
        for (let i = 0; i < ring.length; i += 2) {
          const x = a.x + ring[i] * a.s, y = a.y + ring[i + 1] * a.s;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
      }
      ctx.fill('evenodd');
    }
  }
  ctx.strokeStyle = `rgba(${INK}, 0.28)`;
  ctx.lineWidth = 1;
  ctx.lineJoin = 'round';
  for (const { t, coast } of tiles) {
    if (!coast) continue;
    const a = at(t);
    ctx.beginPath();
    for (const line of coast.borders) {
      for (let i = 0; i < line.length; i += 2) {
        const x = a.x + line[i] * a.s, y = a.y + line[i + 1] * a.s;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
  }
}

/** The route's points on screen (x unwrapped across the date line). */
export function routePx(route: Route, v: MapView): Float64Array {
  const lons = unwrapLons(route.points.map((p) => p.lon));
  const out = new Float64Array(route.points.length * 2);
  route.points.forEach((p, i) => {
    const q = toPx(v, mercX(lons[i]), mercY(p.lat));
    out[i * 2] = q.x;
    out[i * 2 + 1] = q.y;
  });
  return out;
}

/** The route, flown part solid to the balloon, the rest dashed to the landing ring. */
export function drawRoute(ctx: CanvasRenderingContext2D, route: Route, px: Float64Array, nowMs: number): void {
  const n = px.length / 2;
  if (n < 2) return;
  const tNow = (nowMs - route.release) / 1000;
  let k = 0; // the last point at or before now
  while (k < n - 1 && route.points[k + 1].tSec <= tNow) k++;
  const landed = k >= n - 1;
  // where the balloon is, between point k and k + 1
  let bx = px[k * 2], by = px[k * 2 + 1];
  if (!landed) {
    const a = route.points[k], b = route.points[k + 1];
    const f = Math.min(1, Math.max(0, (tNow - a.tSec) / Math.max(1e-6, b.tSec - a.tSec)));
    bx += (px[k * 2 + 2] - bx) * f;
    by += (px[k * 2 + 3] - by) * f;
  }
  const path = (from: number, to: number, end?: [number, number]) => {
    ctx.beginPath();
    ctx.moveTo(px[from * 2], px[from * 2 + 1]);
    for (let i = from + 1; i <= to; i++) ctx.lineTo(px[i * 2], px[i * 2 + 1]);
    if (end) ctx.lineTo(end[0], end[1]);
  };
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // a soft ink casing keeps the off-white line readable over pale land
  path(0, n - 1);
  ctx.strokeStyle = `rgba(${INK}, 0.32)`;
  ctx.lineWidth = 5;
  ctx.setLineDash([]);
  ctx.stroke();
  if (!landed) {
    ctx.beginPath();
    ctx.moveTo(bx, by);
    for (let i = k + 1; i < n; i++) ctx.lineTo(px[i * 2], px[i * 2 + 1]);
    ctx.strokeStyle = 'rgba(247, 243, 236, 0.8)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 5]);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  path(0, k, landed ? undefined : [bx, by]);
  ctx.strokeStyle = PAPER;
  ctx.lineWidth = 3;
  ctx.stroke();
  // the start, and the hollow ring where it lands (the string line's ring at 72 h)
  const dot = (x: number, y: number, r: number) => {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
  };
  dot(px[0], px[1], 3.5);
  ctx.fillStyle = PAPER;
  ctx.fill();
  ctx.strokeStyle = `rgba(${INK}, 0.5)`;
  ctx.lineWidth = 1;
  ctx.stroke();
  dot(px[n * 2 - 2], px[n * 2 - 1], 6);
  ctx.strokeStyle = `rgba(${INK}, 0.32)`;
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.strokeStyle = PAPER;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  // the balloon: the one bright thing on the map
  dot(bx, by, 6.5);
  ctx.fillStyle = BALLOON_HEX;
  ctx.fill();
  ctx.strokeStyle = PAPER;
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

// ---- the controller ----

export class Fallback implements World {
  /** Called once when the balloon has landed (or a landed balloon is opened): the landing card. */
  onCard: ((route: Route) => void) | null = null;
  state: 'start' | 'launch' | 'flight' | 'error' = 'start';
  readonly hud: Hud;
  private choice: StartChoice;
  private flight: Flight | null = null;
  private notice: Notice | null = null;
  private readonly wrap: HTMLDivElement;
  private readonly base: HTMLCanvasElement;
  private readonly top: HTMLCanvasElement;
  private px: Float64Array | null = null;
  private size: Size = { w: 0, h: 0 };
  private dpr = 1;
  private drawn = 0;
  private timer = 0;
  private placeAt = -Infinity;
  private placeBusy = false;
  private landing: Place | null = null;
  private landingFor: Route | null = null;
  private lastCountry: string | null = null;
  private said: AnnounceState | null = null;
  private carded: Route | null = null;
  private opening = 0;
  private launching = 0;

  constructor(private readonly deps: FallbackDeps, choice: StartChoice) {
    this.choice = choice;
    const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.wrap = document.createElement('div');
    this.wrap.className = 'map2d';
    this.wrap.setAttribute('role', 'img');
    this.wrap.setAttribute('aria-label', 'A map of the balloon’s route');
    this.base = document.createElement('canvas');
    this.base.className = 'map2d-coast';
    this.top = document.createElement('canvas');
    this.top.className = 'map2d-route';
    this.wrap.append(this.base, this.top);
    deps.sceneEl.append(this.wrap);
    this.hud = mountHud(
      deps.hudEl,
      { onView: () => {}, onPause: () => {}, onAgain: () => this.backToStart() },
      { reducedMotion: reduced, note: COPY.noWebGL },
    );
    window.addEventListener('resize', this.onResize);
    // the shading is sized to the text, which comes in after the map is laid out: lay it out again
    for (const el of [this.deps.hudEl.querySelector('.hud-shade'), this.deps.hudEl.querySelector('.hud-top'), document.querySelector('.shade-top')]) if (el) this.chromeRo?.observe(el);
    this.setStart(choice);
  }

  // ---- the start screen ----

  setStart(c: StartChoice): void {
    this.choice = c;
    warm(c);
  }

  letGo(c: StartChoice): void {
    if (this.state === 'launch' || this.state === 'flight') return;
    this.clearNotice();
    this.choice = c;
    this.state = 'launch';
    this.deps.setView('launch');
    const t0 = Date.now();
    const ticket = ++this.launching;
    this.hud.setFlight({ release: t0, ticks: [], own: true });
    this.hud.frame({ now: t0, point: c, aglM: 0, speedMs: 0, landed: false });
    releaseRoute(c, t0).then(
      (route) => {
        if (ticket !== this.launching || this.state !== 'launch') return;
        const home = { name: c.kind === 'gps' ? COPY.yourLocation.toLowerCase() : c.name, lat: c.lat, lon: c.lon };
        this.show({ route, home, own: true, launched: true });
        const saved: SavedBalloon = { v: 1, name: c.kind === 'gps' ? COPY.yourLocation : c.name, start: { lat: c.lat, lon: c.lon }, release: route.release, hourly: route.hourly, runId: route.runId };
        store.add(saved);
        this.deps.start.refresh();
        encodeBalloon(saved)
          .then((payload) => {
            if (this.flight?.route === route) history.replaceState(null, '', linkFor(payload));
          })
          .catch(() => {});
      },
      () => {
        if (ticket !== this.launching || this.state !== 'launch') return;
        this.windError();
      },
    );
  }

  private windError(): void {
    this.state = 'error';
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
    if (ticket !== this.opening || this.state !== 'flight') return;
    // "your location" only on the visitor's own balloon; a shared one is named for its place
    const home = { name: await homeFor(b, own), lat: b.start.lat, lon: b.start.lon };
    if (ticket !== this.opening || this.state !== 'flight') return;
    this.show({ route, home, own, launched: false, saved: b });
    encodeBalloon(b).then((payload) => history.replaceState(null, '', linkFor(payload))).catch(() => {});
  }

  /** Show a flight on the map (also what the 3D world hands over when it gives up mid-flight). */
  show(fl: Flight): void {
    this.clearNotice();
    closeCardView();
    this.hud.setCard(null);
    this.flight = fl;
    this.state = 'flight';
    this.said = null;
    this.lastCountry = null;
    this.placeAt = -Infinity;
    this.hud.setFlight({ release: fl.route.release, ticks: midnightTicks(fl.route), own: fl.own });
    this.hud.setOver('');
    this.deps.setView('flight');
    this.wrap.classList.add('on');
    document.documentElement.dataset.map = '2d'; // the bottom shading narrows to the stack on wide screens
    // the map is bright land and sea: the shading behind the text darkens to match (spec 7.1)
    const L = Math.max(luminance(LAND), luminance(SEA));
    this.deps.start.setBackdropLuminance(L, L);
    this.layout();
    clearInterval(this.timer);
    this.timer = window.setInterval(() => this.tick(), TICK_MS);
    this.tick();
  }

  backToStart(): void {
    this.opening++;
    this.launching++;
    this.clearNotice();
    closeCardView();
    this.hud.setCard(null);
    clearInterval(this.timer);
    this.flight = null;
    this.px = null;
    this.state = 'start';
    this.wrap.classList.remove('on', 'coast-in');
    delete document.documentElement.dataset.map;
    history.replaceState(null, '', '/');
    this.deps.start.refresh();
    this.deps.setView('start');
  }

  /** The flight on the map (the landing card reads it). */
  get shown(): Flight | null {
    return this.flight;
  }

  /** The map at w x h CSS px (for the landing card's picture): the coastline that is in, and the route. */
  async mapImage(w: number, h: number, band: Band = { left: w * 0.08, right: w * 0.92, top: h * 0.08, bottom: h * 0.92 }): Promise<HTMLCanvasElement> {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const fl = this.flight;
    if (!fl) return c;
    const ctx = c.getContext('2d')!;
    const v = fitView(fl.route.points, band);
    const z = pickZoom(v, { w, h });
    const tiles = tilesFor(v, { w, h }, z);
    const coasts = await Promise.all(tiles.map(coastTile));
    drawCoast(ctx, v, tiles.map((t, i) => ({ t, coast: coasts[i] })));
    drawRoute(ctx, fl.route, routePx(fl.route, v), Date.now());
    return c;
  }

  /**
   * The landing card's map (design A on the 2D map): land and sea only, the route fitted into `band`;
   * the card draws the route, the markers and the words over it. The route's points on it, w x h px.
   */
  async cardMap(w: number, h: number, band: Band): Promise<{ image: HTMLCanvasElement; px: Float64Array } | null> {
    const fl = this.flight;
    if (!fl) return null;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    const v = fitView(fl.route.points, band);
    const z = pickZoom(v, { w, h });
    const tiles = tilesFor(v, { w, h }, z);
    const coasts = await Promise.all(tiles.map(coastTile));
    // land where no coastline tile came in (the card has no sky to show through)
    ctx.fillStyle = LAND;
    ctx.fillRect(0, 0, w, h);
    drawCoast(ctx, v, tiles.map((t, i) => ({ t, coast: coasts[i] })));
    return { image: c, px: routePx(fl.route, v) };
  }

  dispose(): void {
    this.opening++;
    this.launching++;
    this.flight = null; // a landing card being made for it never opens
    closeCardView();
    clearInterval(this.timer);
    window.removeEventListener('resize', this.onResize);
    this.chromeRo?.disconnect();
    this.hud.destroy();
    this.wrap.remove();
    delete document.documentElement.dataset.map;
  }

  // ---- internals ----

  private readonly onResize = () => {
    if (this.flight) this.layout();
  };

  /** The band laid out for last (as text), so a change in the chrome lays the map out again only when it moves the band. */
  private bandKey = '';
  private readonly chromeRo = typeof ResizeObserver === 'function'
    ? new ResizeObserver(() => {
        if (!this.flight) return;
        const { w, h } = this.size;
        if (JSON.stringify(this.band(w, h)) !== this.bandKey) this.layout();
      })
    : null;

  /** Fit the route into the band the HUD leaves free, then draw the coast for that view. */
  private layout(): void {
    const fl = this.flight;
    if (!fl) return;
    const w = this.deps.sceneEl.clientWidth || window.innerWidth;
    const h = this.deps.sceneEl.clientHeight || window.innerHeight;
    this.size = { w, h };
    this.dpr = Math.min(DPR_CAP, window.devicePixelRatio || 1);
    for (const c of [this.base, this.top]) {
      c.width = Math.round(w * this.dpr);
      c.height = Math.round(h * this.dpr);
    }
    const band = this.band(w, h);
    this.bandKey = JSON.stringify(band);
    const v = fitView(fl.route.points, band);
    this.px = routePx(fl.route, v);
    this.drawTop();
    const drawn = ++this.drawn;
    this.wrap.classList.remove('coast-in');
    const tiles = tilesFor(v, this.size, pickZoom(v, this.size));
    Promise.all(tiles.map(coastTile)).then((coasts) => {
      if (drawn !== this.drawn) return;
      const ctx = this.base.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      drawCoast(ctx, v, tiles.map((t, i) => ({ t, coast: coasts[i] })));
      this.wrap.dataset.coast = String(coasts.filter(Boolean).length);
      this.wrap.classList.add('coast-in');
    });
  }

  /** The part of the screen the chrome and its shading leave clear (map2d.freeBand). */
  private band(w: number, h: number): Band {
    const rect = (el: Element | null | undefined) => el?.getBoundingClientRect();
    const stack = rect(this.deps.hudEl.querySelector('.hud-bottom'));
    const shade = rect(this.deps.hudEl.querySelector('.hud-shade'));
    return freeBand({
      w,
      h,
      hudTop: rect(this.deps.hudEl.querySelector('.hud-top'))?.bottom ?? 0,
      shadeTop: rect(document.querySelector('.shade-top'))?.bottom ?? 0,
      stackTop: stack?.top ?? h,
      stackRight: Math.max(stack?.right ?? w, shade?.right ?? w),
      narrowShade: !!shade && shade.width > 0 && shade.right < w - 1,
      shadeBottomTop: shade && shade.height > 0 ? shade.top + SHADE_FAINT * shade.height : undefined,
    });
  }

  private drawTop(): void {
    const fl = this.flight;
    const ctx = this.top.getContext('2d');
    if (!fl || !this.px || !ctx) return;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.size.w, this.size.h);
    drawRoute(ctx, fl.route, this.px, Date.now());
  }

  private tick(): void {
    const fl = this.flight;
    if (!fl) return;
    const now = Date.now();
    const p = positionAt(fl.route, now);
    const landed = now >= landedAt(fl.route);
    this.hud.frame({ now, point: p, aglM: Math.max(0, p.altM - p.groundM), speedMs: landed ? 0 : p.speedMs, landed });
    this.drawTop();
    if (landed && this.carded !== fl.route) {
      this.carded = fl.route;
      this.onCard?.(fl.route);
    }
    if (now - this.placeAt > PLACE_EVERY_MS && !this.placeBusy) {
      this.placeAt = now;
      this.placeBusy = true;
      this.refreshPlace(fl, now).finally(() => (this.placeBusy = false));
    }
  }

  /** "Over ...", the facts, the status region and the map's label, as in the 3D world (no map labels here). */
  private async refreshPlace(fl: Flight, now: number): Promise<void> {
    const here = positionAt(fl.route, now);
    const landed = now >= landedAt(fl.route);
    try {
      if (this.landingFor !== fl.route) {
        this.landing = await landingPlace(fl.route).catch(() => null);
        this.landingFor = fl.route;
      }
      const [over, town, place] = await Promise.all([
        placeOver(here, []).catch(() => ''),
        landed ? Promise.resolve(null) : townAhead(here).catch(() => null),
        nearestPlace(here).catch(() => null),
      ]);
      if (this.flight !== fl) return;
      const landing = this.landing ? { name: this.landing.name, kind: this.landing.kind } : undefined;
      this.hud.setOver(landed ? landedOver(landing ?? null) : over ? overText(over) : '');
      this.hud.setFacts(factsFor({ route: fl.route, nowUtcMs: now, home: fl.home, here, nearestTown: town ?? undefined, landing }));
      const country = place?.kind === 'town' ? place.country ?? null : null;
      const next: AnnounceState = { phase: landed ? 'landed' : 'flying', home: fl.home.name, country, lastCountry: this.lastCountry, landing: landing ?? null, own: fl.own, launched: fl.launched ?? false };
      const say = announcement(this.said, next);
      if (say) this.hud.announce(say);
      this.said = next;
      if (country) this.lastCountry = country;
      this.wrap.setAttribute(
        'aria-label',
        sceneLabel({ own: fl.own, over: over || GENERIC_LAND, km: haversineKm(fl.home, here), home: fl.home.name, landed: landed ? landedOver(landing ?? null) : null }),
      );
    } catch {
      /* names are a nicety: the map goes on without them */
    }
  }
}

/**
 * Switch the page to the 2D map. With a flight (the 3D world gave up mid-flight), it is shown at once;
 * without one, the start screen stays as it is and Let go, links and "Your balloons" use the map.
 */
export function startFallback(flight: Flight | undefined, deps: FallbackDeps, choice: StartChoice): Fallback {
  const f = new Fallback(deps, choice);
  if (flight) f.show(flight);
  return f;
}
