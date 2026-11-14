/**
 * The anonymous events the page may count, and the one place that says what each may carry (spec
 * 16). The page (analytics/track.ts) and the counter (functions/api/e.ts) both check every event
 * against this whitelist: an event name or value not listed here is never sent, and never stored.
 *
 * Nothing here can say who someone is or where they are: no ids, no times, no coordinates, no place
 * names, except a featured city's id (one of seven places on the start screen, picked by everyone).
 * A searched place and "Use my location" are counted only by kind. The country comes from
 * Cloudflare's edge, not from the page.
 *
 * Kept free of imports: the counter on Cloudflare bundles it.
 */

/** London (the first start) and the start screen's six (ui/featured.ts FEATURED_IDS; a test keeps them equal). */
export const CITIES = ['london', 'paris', 'new-york', 'tokyo', 'sydney', 'rio-de-janeiro', 'cappadocia-goreme'] as const;
/** The HUD's view buttons (ui/hudmath.ts VIEW_TABS; a test keeps them equal). */
export const VIEWS = ['film', 'above', 'side'] as const;
export const SOURCES = ['featured', 'search', 'location'] as const;
export const SHARE_METHODS = ['share', 'save', 'copy'] as const;
/** How long a visit lasted, in six coarse buckets (never the time itself). */
export const SECS_BUCKETS = ['<10s', '10-30s', '30-60s', '1-3m', '3-10m', '10m+'] as const;

export type City = (typeof CITIES)[number];
export type ViewName = (typeof VIEWS)[number];
export type Source = (typeof SOURCES)[number];
export type ShareMethod = (typeof SHARE_METHODS)[number];
export type SecsBucket = (typeof SECS_BUCKETS)[number];

export type AnalyticsEvent =
  | { e: 'start_view'; ref: Ref }
  | { e: 'let_go'; source: 'featured'; city: City }
  | { e: 'let_go'; source: 'search' | 'location' }
  | { e: 'link_open'; landed: boolean; ref: Ref }
  | { e: 'replay_done' }
  | { e: 'card_shown' }
  | { e: 'card_share'; method: ShareMethod }
  | { e: 'calendar_add' }
  | { e: 'view_change'; view: ViewName }
  | { e: 'session_end'; secs: SecsBucket };

/**
 * Where a visit came from: the referring site's bare hostname (lower case, no path or query), 'direct'
 * (no referrer, or this site itself), or 'other' (not a plain public hostname, or over 64 characters).
 */
export type Ref = string;
const HOSTNAME = /^(?=.{1,64}$)[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.[a-z][a-z0-9-]*[a-z0-9]$/;
const IPV4 = /^\d+(\.\d+){3}$/;
export const isRef = (v: unknown): v is Ref => v === 'direct' || v === 'other' || (typeof v === 'string' && HOSTNAME.test(v) && !IPV4.test(v));

/** The page's document.referrer as a Ref: only the hostname ever leaves the page. */
export function refHost(referrer: string, ownHost: string): Ref {
  if (!referrer) return 'direct';
  let host: string;
  try {
    const u = new URL(referrer);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return 'other';
    host = u.hostname.toLowerCase();
  } catch {
    return 'other';
  }
  if (host === ownHost.toLowerCase()) return 'direct';
  return isRef(host) && host !== 'direct' && host !== 'other' ? host : 'other';
}

export const DEVICES = ['mobile', 'tablet', 'desktop'] as const;
export type Device = (typeof DEVICES)[number];

/** The device class, from the User-Agent at the edge (the User-Agent itself is never kept). */
export function deviceClass(ua: string | null | undefined): Device {
  if (!ua) return 'desktop';
  if (/iPad|Tablet|PlayBook|Silk|Kindle/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua))) return 'tablet';
  if (/Mobi|iPhone|iPod|Android|Windows Phone/i.test(ua)) return 'mobile';
  return 'desktop';
}

/** The largest body the counter reads, in characters. The longest event is about 110. */
export const MAX_BODY = 160;

const oneOf = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === 'string' && (list as readonly string[]).includes(v);

/** The event's own fields are exactly these (no more, none missing). */
function hasExactly(o: Record<string, unknown>, keys: string[]): boolean {
  const own = Object.keys(o);
  return own.length === keys.length && keys.every((k) => Object.prototype.hasOwnProperty.call(o, k));
}

/** The event, if it is exactly one the whitelist allows; otherwise null. */
export function parseEvent(x: unknown): AnalyticsEvent | null {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  const o = x as Record<string, unknown>;
  switch (o.e) {
    case 'start_view':
      return hasExactly(o, ['e', 'ref']) && isRef(o.ref) ? { e: 'start_view', ref: o.ref } : null;
    case 'replay_done':
    case 'card_shown':
    case 'calendar_add':
      return hasExactly(o, ['e']) ? { e: o.e as 'replay_done' | 'card_shown' | 'calendar_add' } : null;
    case 'let_go':
      if (o.source === 'featured') return hasExactly(o, ['e', 'source', 'city']) && oneOf(CITIES, o.city) ? { e: 'let_go', source: 'featured', city: o.city } : null;
      return hasExactly(o, ['e', 'source']) && (o.source === 'search' || o.source === 'location') ? { e: 'let_go', source: o.source } : null;
    case 'link_open':
      return hasExactly(o, ['e', 'landed', 'ref']) && typeof o.landed === 'boolean' && isRef(o.ref) ? { e: 'link_open', landed: o.landed, ref: o.ref } : null;
    case 'card_share':
      return hasExactly(o, ['e', 'method']) && oneOf(SHARE_METHODS, o.method) ? { e: 'card_share', method: o.method } : null;
    case 'view_change':
      return hasExactly(o, ['e', 'view']) && oneOf(VIEWS, o.view) ? { e: 'view_change', view: o.view } : null;
    case 'session_end':
      return hasExactly(o, ['e', 'secs']) && oneOf(SECS_BUCKETS, o.secs) ? { e: 'session_end', secs: o.secs } : null;
    default:
      return null;
  }
}

/** A request body: small JSON holding one allowed event, or null. */
export function parseBody(text: string): AnalyticsEvent | null {
  if (!text || text.length > MAX_BODY) return null;
  try {
    return parseEvent(JSON.parse(text));
  } catch {
    return null;
  }
}

/** A visit's length in seconds, as its bucket. */
export function secsBucket(s: number): SecsBucket {
  if (!(s >= 10)) return '<10s';
  if (s < 30) return '10-30s';
  if (s < 60) return '30-60s';
  if (s < 180) return '1-3m';
  if (s < 600) return '3-10m';
  return '10m+';
}

/** Cloudflare's two-character country code (ISO 3166-1, or T1 for Tor), or XX when there is none. */
export function cleanCountry(c: unknown): string {
  return typeof c === 'string' && /^[A-Z][A-Z0-9]$/.test(c) ? c : 'XX';
}

/** The event's one detail, as stored. */
function detail(ev: AnalyticsEvent): string {
  switch (ev.e) {
    case 'let_go':
      return ev.source;
    case 'link_open':
      return ev.landed ? 'landed' : 'flying';
    case 'card_share':
      return ev.method;
    case 'view_change':
      return ev.view;
    case 'session_end':
      return ev.secs;
    default:
      return '';
  }
}

export type DataPoint = { blobs: string[]; doubles: number[]; indexes: string[] };

/**
 * The Analytics Engine row: blob1 event, blob2 detail, blob3 featured city (or ''), blob4 country,
 * and for a visit (start_view, link_open) blob5 device class and blob6 referrer; double1 is 1 (a
 * count); the event name is the sampling index.
 */
export function toDataPoint(ev: AnalyticsEvent, country: unknown, ua: string | null | undefined): DataPoint {
  const city = ev.e === 'let_go' && ev.source === 'featured' ? ev.city : '';
  const visit = ev.e === 'start_view' || ev.e === 'link_open';
  return { blobs: [ev.e, detail(ev), city, cleanCountry(country), visit ? deviceClass(ua) : '', visit ? ev.ref : ''], doubles: [1], indexes: [ev.e] };
}
