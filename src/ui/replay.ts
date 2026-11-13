/**
 * "Show me the whole trip" (spec 6.4, 7.3, 8): the 72-hour forecast route in 20 seconds.
 *
 *   flight --Show me the whole trip--> replay: climb 2 s, travel 15 s, descent 2 s, hold 1 s --> onEnd
 *   replay (at any point, or after its end) --Back to live / Escape--> flight, at now
 *
 * The scene plays it (app/scene.ts startReplay): a high, wide camera behind the balloon, an off-white
 * trail drawn behind it, the sky at the route's own time so night sweeps across, and the balloon
 * settling onto the landing. Here: the clock that drives it, the label ("Forecast route, 72 hours in 20
 * seconds", under the clock), at most five large place names as they are crossed (in the fact line's
 * place at the top of the bottom stack), and the landing place and time as it comes down. When it ends
 * it calls `onEnd` (the landing card, once there is one; by default back to live) and holds on the
 * landing until the visitor goes back to live.
 *
 * Reduced motion: no camera move and no time-lapse. The route is drawn in place over 2 s as a flat
 * line with its names, the balloon's place on it now, and a ring where it is expected to land, over
 * the live scene (dimmed), then it holds long enough to read.
 *
 * Names come from the gazetteer, worked out in the background (`replayNames`) before the replay starts,
 * so nothing waits on them mid-frame.
 */
import { FLIGHT_HOURS } from '../config';
import type { SceneReplay } from '../app/scene';
import type { Route } from '../flight/route';
import { lonDelta } from '../geo/coords';
import { nearestPlace, townsNear } from '../geo/gazetteer';
import { withArticle } from '../geo/places';
import { COPY } from './copy';
import type { Hud } from './hud';
import {
  easeOut,
  landingLines,
  nameOpacity,
  pickNames,
  reducedFrame,
  replayFrame,
  type NameCandidate,
  type ReplayName,
} from './replaymath';

const H = 3600e3;
const FLIGHT_MS = FLIGHT_HOURS * H;
/** A town counts as crossed within this distance of the route. */
const CROSS_KM = 10;
/** The route is looked at every half hour for names (145 looks, from cached gazetteer tiles). */
const SAMPLE_S = 1800;
/** The landing lines fade in over the first part of the descent. */
const LANDING_IN_S = 0.6;

export type { ReplayName } from './replaymath';

/**
 * The names to show on the way: towns within 10 km of the route, named seas and regions under it, the
 * biggest at most five, never the start or the landing. Offline (no gazetteer): none.
 */
export async function replayNames(route: Route, opts: { home: string; landing?: string | null }): Promise<ReplayName[]> {
  const cands: NameCandidate[] = [];
  const pts = route.points;
  const end = pts[pts.length - 1]?.tSec ?? FLIGHT_MS / 1000;
  let at = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (p.tSec < at && i !== pts.length - 1) continue;
    at = p.tSec + SAMPLE_S;
    try {
      const [towns, place] = await Promise.all([townsNear(p, CROSS_KM), nearestPlace(p)]);
      const big = towns.reduce<(typeof towns)[number] | null>((m, t) => (!m || t.population > m.population ? t : m), null);
      if (big) cands.push({ name: big.name, kind: 'town', population: big.population, tSec: p.tSec });
      if (place.kind === 'sea' && !place.generic) cands.push({ name: place.name, kind: 'sea', tSec: p.tSec });
      const region = place.kind === 'region' && !place.generic ? place.name : place.region;
      if (region) cands.push({ name: region, kind: 'region', tSec: p.tSec });
    } catch {
      /* a name is a nicety */
    }
  }
  // a place is shown when it is crossed: the middle of the stretch it is named for
  const firstLast = new Map<string, { c: NameCandidate; t0: number; t1: number }>();
  for (const c of cands) {
    const k = `${c.kind}:${c.name}`;
    const e = firstLast.get(k);
    if (!e) firstLast.set(k, { c, t0: c.tSec, t1: c.tSec });
    else if (c.tSec - e.t1 <= 2 * SAMPLE_S) e.t1 = c.tSec; // the same crossing goes on
  }
  const crossed = [...firstLast.values()].map(({ c, t0, t1 }) => ({ ...c, tSec: (t0 + t1) / 2 }));
  return pickNames(crossed, { exclude: [opts.home, opts.landing ?? ''].filter(Boolean), flightSec: end });
}

export type ReplayHost = {
  scene: { startReplay(d: SceneReplay): void; stopReplay(): void };
  hud: Pick<Hud, 'setReplay' | 'replaySlot' | 'setOver'>;
  /** Where the still route view goes (reduced motion): over the scene, under the HUD. */
  layer: HTMLElement;
  /** The free band between the HUD's top and bottom text (CSS px from the top). */
  band(): { top: number; bottom: number };
  reducedMotion: boolean;
  /** Back to live: the default end. */
  exit(): void;
};

export type ReplayOpts = {
  /** 20 (spec 8). */
  seconds?: number;
  host: ReplayHost;
  /** From replayNames, worked out before. */
  names?: ReplayName[];
  /** Where it is expected to come down (gazetteer), when known. */
  landing?: { name: string; kind: string } | null;
  /** The start's name, for the still route view. */
  home?: string;
  /** Aborted by Back to live: the replay goes and the live view comes back. */
  signal?: AbortSignal;
  /** Called once when the replay reaches its end (the landing card); by default back to live. */
  onEnd?: () => void;
  /** A clock in ms (performance.now). */
  clock?: () => number;
};

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * Play the whole trip. Resolves when it has reached its end (after `onEnd`) or was stopped by the
 * signal, whichever is first; stopping (the signal) is what takes it off the screen.
 */
export function playReplay(route: Route, opts: ReplayOpts): Promise<void> {
  const { host } = opts;
  const total = opts.seconds ?? 20;
  const clock = opts.clock ?? (() => performance.now());
  const onEnd = opts.onEnd ?? (() => host.exit());
  const names = opts.names ?? [];
  const last = route.points[route.points.length - 1];
  const landedMs = route.release + FLIGHT_MS;
  const landing = opts.landing ? landingLines(opts.landing, last, landedMs, Date.now() >= landedMs) : null;
  const still = host.reducedMotion;

  host.hud.setReplay(true);
  host.hud.setOver(still ? COPY.replayLabelStill : COPY.replayLabel);
  const slot = host.hud.replaySlot;
  slot.innerHTML = `<p class="replay-kicker"></p><p class="replay-name"></p><p class="replay-when"></p>`;
  const [kickerEl, nameEl, whenEl] = Array.from(slot.children) as HTMLElement[];
  slot.classList.toggle('is-still', still);
  const t0 = clock();
  const t = () => (clock() - t0) / 1000;
  let map: { el: HTMLElement; draw(frac: number): void } | null = null;

  if (still) map = routeMap(route, names, opts.home ?? '', opts.landing ?? null, host);
  else {
    host.scene.startReplay({
      now: () => route.release + replayFrame(t(), total).routeFrac * FLIGHT_MS,
      wide: () => replayFrame(t(), total).wide,
      landing: () => replayFrame(t(), total).landing,
    });
  }

  let shown = '';
  const write = (kicker: string, name: string, when: string, opacity: number) => {
    const key = `${kicker}|${name}|${when}`;
    if (key !== shown) {
      shown = key;
      kickerEl.textContent = kicker;
      nameEl.textContent = name;
      whenEl.textContent = when;
    }
    slot.style.opacity = opacity.toFixed(3);
  };

  return new Promise<void>((resolve) => {
    let raf = 0;
    let ended = false;
    let gone = false;
    const finish = () => {
      if (gone) return;
      gone = true;
      cancelAnimationFrame(raf);
      removeEventListener('keydown', onKey);
      opts.signal?.removeEventListener('abort', finish);
      if (!still) host.scene.stopReplay();
      map?.el.remove();
      slot.style.opacity = '';
      slot.classList.remove('is-still');
      host.hud.setReplay(false);
      resolve();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') host.exit();
    };
    addEventListener('keydown', onKey);
    if (opts.signal?.aborted) return finish();
    opts.signal?.addEventListener('abort', finish);

    const tick = () => {
      if (gone) return;
      const s = t();
      let done: boolean;
      if (still) {
        const f = reducedFrame(s);
        map!.draw(f.routeFrac);
        done = f.done;
      } else {
        const f = replayFrame(s, total);
        const k = total / 20;
        if (landing && (f.phase === 'descent' || f.phase === 'hold' || f.phase === 'done')) {
          write(landing.kicker, landing.name, landing.when, easeOut((s - 17 * k) / LANDING_IN_S));
        } else {
          const n = names.find((x) => nameOpacity(s, x.atS) > 0);
          if (n) write('', n.name, '', nameOpacity(s, n.atS));
          else slot.style.opacity = '0';
        }
        done = f.done;
      }
      if (done && !ended) {
        ended = true;
        onEnd();
        resolve(); // still on screen, holding on the landing, until Back to live
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  });
}

/**
 * The still route (reduced motion): the route as a flat line fitted into the free band, its start, the
 * names on the way, the balloon where it is now (orange: the balloon), and a ring where it is expected
 * to land. `draw(frac)` reveals the line up to frac and the names it has reached.
 */
function routeMap(route: Route, names: ReplayName[], home: string, landing: { name: string; kind: string } | null, host: ReplayHost): { el: HTMLElement; draw(frac: number): void } {
  const W = Math.max(200, innerWidth);
  const band = host.band();
  const top = Math.max(0, band.top), bottom = Math.max(top + 160, band.bottom);
  const h = bottom - top;
  const pad = { x: 24, y: 28 };
  const gutter = 16;
  const w = W - 2 * gutter;

  // a flat local projection: longitude unwrapped along the route (it may cross 180 degrees)
  const pts = route.points;
  let lon = pts[0].lon;
  const raw: [number, number][] = [];
  let latSum = 0;
  for (let i = 0; i < pts.length; i++) {
    if (i > 0) lon += lonDelta(pts[i - 1].lon, pts[i].lon);
    raw.push([lon, pts[i].lat]);
    latSum += pts[i].lat;
  }
  const cos = Math.max(0.05, Math.cos(((latSum / pts.length) * Math.PI) / 180));
  const xs = raw.map(([x]) => x * cos), ys = raw.map(([, y]) => -y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const sc = Math.min((w - 2 * pad.x) / Math.max(1e-6, maxX - minX), (h - 2 * pad.y) / Math.max(1e-6, maxY - minY));
  const ox = gutter + w / 2 - ((minX + maxX) / 2) * sc, oy = h / 2 - ((minY + maxY) / 2) * sc;
  const at = (i: number): [number, number] => [ox + xs[i] * sc, oy + ys[i] * sc];
  const atFrac = (f: number) => at(Math.round(Math.min(1, Math.max(0, f)) * (pts.length - 1)));
  const d = pts.map((_, i) => `${i ? 'L' : 'M'}${at(i)[0].toFixed(1)} ${at(i)[1].toFixed(1)}`).join('');

  const label = (x: number, y: number, text: string, cls = '') => {
    const right = x < W - 130;
    return `<text class="${cls}" x="${(x + (right ? 9 : -9)).toFixed(1)}" y="${(y + 4).toFixed(1)}" text-anchor="${right ? 'start' : 'end'}">${esc(text)}</text>`;
  };
  const [sx, sy] = at(0);
  const [lx, ly] = at(pts.length - 1);
  const nowF = Math.min(1, Math.max(0, (Date.now() - route.release) / FLIGHT_MS));
  const [bx, by] = atFrac(nowF);
  const marks = names
    .map((n) => {
      const [x, y] = atFrac(n.frac);
      return `<g class="replay-mark" data-frac="${n.frac.toFixed(4)}"><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.5"/>${label(x, y, n.name)}</g>`;
    })
    .join('');
  const el = document.createElement('div');
  el.className = 'replay-map';
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = `<svg width="${W}" height="${h}" viewBox="0 0 ${W} ${h}" style="top:${top}px">
    <path class="replay-line" d="${d}" pathLength="1" stroke-dasharray="1 1" stroke-dashoffset="1"/>
    <g class="replay-mark" data-frac="0"><circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="3.5"/>${home ? label(sx, sy, home) : ''}</g>
    ${marks}
    <g class="replay-mark" data-frac="1"><circle class="ring" cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="5"/>${landing ? label(lx, ly, withArticle(landing.name, landing.kind), 'strong') : ''}</g>
    <circle class="replay-balloon" cx="${bx.toFixed(1)}" cy="${by.toFixed(1)}" r="4.5"/>
  </svg>`;
  host.layer.append(el);
  const path = el.querySelector('path')!;
  const groups = Array.from(el.querySelectorAll<SVGGElement>('.replay-mark'));
  return {
    el,
    draw(frac) {
      path.setAttribute('stroke-dashoffset', String(1 - frac));
      for (const g of groups) g.classList.toggle('on', Number(g.dataset.frac) <= frac + 1e-6);
    },
  };
}
