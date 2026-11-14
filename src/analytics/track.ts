/**
 * Anonymous counts of what visitors do (spec 16): a few words of JSON to this site's own /api/e
 * (functions/api/e.ts), sent with sendBeacon, never anything that says who or where someone is.
 *
 * - Only the live site sends: the pages.dev address and the address in src/config.ts. Previews,
 *   localhost and the browser tests send nothing; nor does a browser driven by a script.
 * - Global Privacy Control on: nothing at all is sent.
 * - No cookies, no storage, no ids: each event stands alone.
 * - At most CAP events a page, the last one kept for the visit's length (session_end, on pagehide).
 * - Every event is checked against the whitelist (analytics/events.ts) before it goes.
 */
import { FLIGHT_HOURS } from '../config';
import type { SavedBalloon } from '../flight/codec';
import type { StartChoice } from '../ui/start';
import { CITIES, parseEvent, refHost, secsBucket, type AnalyticsEvent, type City } from './events';
import { isProductionHost } from './hosts';

export { PRODUCTION_HOSTS, isProductionHost } from './hosts';

export const ENDPOINT = '/api/e';
export const CAP = 30;

export type TrackEnv = {
  host: string;
  /** navigator.globalPrivacyControl */
  gpc: boolean;
  /** navigator.webdriver: a browser driven by a script */
  bot: boolean;
  send(body: string): void;
};

export type Tracker = {
  readonly enabled: boolean;
  /** Send one event (true if it went). */
  track(ev: AnalyticsEvent): boolean;
  /** A page back from the back-forward cache: a new visit, with its own allowance. */
  reset(): void;
};

export function createTracker(env: TrackEnv, cap = CAP): Tracker {
  const enabled = isProductionHost(env.host) && !env.gpc && !env.bot;
  let n = 0;
  return {
    enabled,
    track(ev) {
      if (!enabled) return false;
      // the last place is kept for the visit's length
      if (n >= (ev.e === 'session_end' ? cap : cap - 1)) return false;
      const ok = parseEvent(ev);
      if (!ok) return false;
      n++;
      try {
        env.send(JSON.stringify(ok));
      } catch {
        // counting never breaks the page
      }
      return true;
    },
    reset() {
      n = 0;
    },
  };
}

/** Send the visit's length (as a bucket) once, when the page goes away. */
export function armSessionEnd(t: Tracker, page: EventTarget, now: () => number): void {
  if (!t.enabled) return;
  let t0 = now();
  let sent = false;
  page.addEventListener('pagehide', () => {
    if (sent) return;
    sent = true;
    t.track({ e: 'session_end', secs: secsBucket((now() - t0) / 1000) });
  });
  page.addEventListener('pageshow', (e) => {
    if (!(e as PageTransitionEvent).persisted) return;
    t.reset();
    t0 = now();
    sent = false;
  });
}

/** Let go, by the kind of start only: a featured city by its id; a searched place or "my location" never by name or position. */
export function letGoEvent(c: StartChoice): AnalyticsEvent {
  if ((c.kind === 'featured' || c.kind === 'default') && (CITIES as readonly string[]).includes(c.cityId ?? '')) return { e: 'let_go', source: 'featured', city: c.cityId as City };
  return { e: 'let_go', source: c.kind === 'gps' ? 'location' : 'search' };
}

/** The start screen seen first: and the referring site's bare hostname, or 'direct'. */
export function startViewEvent(referrer: string, ownHost: string): AnalyticsEvent {
  return { e: 'start_view', ref: refHost(referrer, ownHost) };
}

/** A shared link opened: only whether its balloon has landed, and the referring site's bare hostname. */
export function linkOpenEvent(b: SavedBalloon, now: number, referrer: string, ownHost: string): AnalyticsEvent {
  return { e: 'link_open', landed: now >= b.release + FLIGHT_HOURS * 3600e3, ref: refHost(referrer, ownHost) };
}

function beacon(body: string): void {
  // text/plain keeps the beacon a simple request; the counter reads the text as JSON
  const blob = new Blob([body], { type: 'text/plain;charset=UTF-8' });
  if (typeof navigator.sendBeacon === 'function' && navigator.sendBeacon(ENDPOINT, blob)) return;
  void fetch(ENDPOINT, { method: 'POST', body, keepalive: true, credentials: 'omit', headers: { 'content-type': 'text/plain;charset=UTF-8' } }).catch(() => {});
}

let page: Tracker | null = null;

/** This page's tracker (made on first use from the browser). */
function tracker(): Tracker {
  if (page) return page;
  try {
    const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
    page = createTracker({ host: location.hostname, gpc: nav.globalPrivacyControl === true, bot: nav.webdriver === true, send: beacon });
  } catch {
    page = createTracker({ host: '', gpc: true, bot: true, send: () => {} });
  }
  return page;
}

/**
 * Count one event (does nothing off the live site, with GPC on, or past the cap). Pass a function to
 * build the event: if building it throws, nothing is counted and the caller carries on.
 */
export function track(ev: AnalyticsEvent | (() => AnalyticsEvent)): void {
  try {
    tracker().track(typeof ev === 'function' ? ev() : ev);
  } catch {
    // never breaks the page
  }
}

/** Once, at load: the visit's length is sent when the page goes away. */
export function startTracking(): void {
  try {
    armSessionEnd(tracker(), window, () => performance.now());
  } catch {
    // never breaks the page
  }
}
