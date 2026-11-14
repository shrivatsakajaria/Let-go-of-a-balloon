/**
 * POST /api/e: the anonymous event counter (spec 16), a Cloudflare Pages Function.
 *
 * One small JSON event from the page (src/analytics/track.ts) becomes one row in the Workers
 * Analytics Engine dataset bound as LGOAB_EVENTS (wrangler.toml): the event, its one detail, a
 * featured city if any, and the country Cloudflare's edge read from the connection (request.cf).
 *
 * - The answer is always 204 with no body, whatever arrives: nothing to learn from it.
 * - Stored only when the event is on the whitelist (src/analytics/events.ts), the body is small,
 *   and it arrived at the live site's own address from the live site's own pages.
 * - No dataset bound (a preview, or before it was set up): nothing is stored, nothing breaks.
 * - No cookies, no logging, no IP address: nothing is kept but the row.
 */
import { MAX_BODY, parseBody, toDataPoint, type DataPoint } from '../../src/analytics/events';
import { isProductionHost } from '../../src/analytics/hosts';

/** The binding's one method used here (Cloudflare's AnalyticsEngineDataset). */
type Dataset = { writeDataPoint(p: DataPoint): void };

export type Env = { LGOAB_EVENTS?: Dataset };

type Context = { request: Request & { cf?: { country?: unknown } }; env: Env };

const done = () => new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });

/** The body as text, or null once it is longer than `max` bytes (the rest is never read). */
async function readSmall(req: Request, max: number): Promise<string | null> {
  const declared = Number(req.headers.get('content-length') ?? '0');
  if (!(declared <= max)) return null;
  if (!req.body) return '';
  const reader = req.body.getReader();
  const parts: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done: end, value } = await reader.read();
    if (end) break;
    n += value.byteLength;
    if (n > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    parts.push(value);
  }
  const all = new Uint8Array(n);
  let at = 0;
  for (const p of parts) {
    all.set(p, at);
    at += p.byteLength;
  }
  return new TextDecoder().decode(all);
}

export async function onRequestPost({ request, env }: Context): Promise<Response> {
  try {
    const url = new URL(request.url);
    if (!isProductionHost(url.hostname)) return done();
    const origin = request.headers.get('origin');
    if (origin !== null && origin !== url.origin) return done();
    const ds = env.LGOAB_EVENTS;
    if (!ds) return done();
    const text = await readSmall(request, MAX_BODY);
    const ev = text === null ? null : parseBody(text);
    if (!ev) return done();
    ds.writeDataPoint(toDataPoint(ev, request.cf?.country));
  } catch {
    // counting never fails a request, and nothing is logged
  }
  return done();
}
