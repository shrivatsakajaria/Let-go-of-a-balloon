import { afterEach, describe, expect, test, vi } from 'vitest';
import { onRequestPost, type Env } from '../../functions/api/e';
import type { DataPoint } from '../../src/analytics/events';

const LIVE = 'https://let-go-of-a-balloon.pages.dev/api/e';

function req(body: BodyInit | null, o: { url?: string; country?: string; headers?: Record<string, string> } = {}) {
  const r = new Request(o.url ?? LIVE, { method: 'POST', body, headers: { 'content-type': 'text/plain;charset=UTF-8', ...o.headers } });
  return Object.assign(r, { cf: o.country ? { country: o.country } : undefined });
}

function dataset() {
  const points: DataPoint[] = [];
  return { points, env: { LGOAB_EVENTS: { writeDataPoint: (p: DataPoint) => void points.push(p) } } satisfies Env };
}

afterEach(() => vi.restoreAllMocks());

describe('the counter (POST /api/e)', () => {
  test('an allowed event is stored with the country from the edge, and answered 204 with no cookie', async () => {
    const { points, env } = dataset();
    const res = await onRequestPost({ request: req('{"e":"let_go","source":"featured","city":"paris"}', { country: 'FR' }), env });
    expect(res.status).toBe(204);
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(points).toEqual([{ blobs: ['let_go', 'featured', 'paris', 'FR', '', ''], doubles: [1], indexes: ['let_go'] }]);
  });

  test('a visit is stored with the device class read from the User-Agent, never the User-Agent itself', async () => {
    const { points, env } = dataset();
    const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
    await onRequestPost({ request: req('{"e":"start_view","ref":"www.linkedin.com"}', { country: 'GB', headers: { 'user-agent': ua } }), env });
    expect(points).toEqual([{ blobs: ['start_view', '', '', 'GB', 'mobile', 'www.linkedin.com'], doubles: [1], indexes: ['start_view'] }]);
    expect(JSON.stringify(points)).not.toContain('iPhone');
  });

  test('the country comes only from the edge: a country in the body is refused', async () => {
    const { points, env } = dataset();
    await onRequestPost({ request: req('{"e":"card_shown","country":"US"}', { country: 'FR' }), env });
    await onRequestPost({ request: req('{"e":"card_shown"}'), env });
    expect(points.map((p) => p.blobs[3])).toEqual(['XX']);
  });

  test('no dataset bound (a preview, or before it is set up): 204, nothing stored, nothing breaks', async () => {
    const res = await onRequestPost({ request: req('{"e":"card_shown"}', { country: 'GB' }), env: {} });
    expect(res.status).toBe(204);
  });

  test('events arriving at a preview or any other host are dropped', async () => {
    const { points, env } = dataset();
    for (const url of ['https://3f2a9c1b.let-go-of-a-balloon.pages.dev/api/e', 'http://localhost:8788/api/e']) {
      const res = await onRequestPost({ request: req('{"e":"card_shown"}', { url }), env });
      expect(res.status).toBe(204);
    }
    expect(points).toEqual([]);
  });

  test('sent from another site (its Origin): dropped', async () => {
    const { points, env } = dataset();
    await onRequestPost({ request: req('{"e":"card_shown"}', { headers: { origin: 'https://example.com' } }), env });
    expect(points).toEqual([]);
    await onRequestPost({ request: req('{"e":"card_shown"}', { headers: { origin: 'https://let-go-of-a-balloon.pages.dev' } }), env });
    expect(points).toHaveLength(1);
  });

  test('anything not on the whitelist is dropped, with the same 204', async () => {
    const { points, env } = dataset();
    for (const body of ['', 'hello', '{"e":"pageview"}', '{"e":"let_go","source":"search","name":"Windermere"}', '{"e":"let_go","source":"location","lat":51.5,"lon":-0.1}', '[{"e":"card_shown"}]', null]) {
      const res = await onRequestPost({ request: req(body), env });
      expect(res.status, String(body)).toBe(204);
    }
    expect(points).toEqual([]);
  });

  test('a large body is not read: dropped', async () => {
    const { points, env } = dataset();
    await onRequestPost({ request: req(`{"e":"card_shown"}${' '.repeat(10_000)}`), env });
    // streamed, with no length given up front
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        for (let i = 0; i < 100; i++) c.enqueue(new TextEncoder().encode(' '.repeat(1000)));
        c.enqueue(new TextEncoder().encode('{"e":"card_shown"}'));
        c.close();
      },
    });
    await onRequestPost({ request: Object.assign(new Request(LIVE, { method: 'POST', body: stream, duplex: 'half' } as RequestInit), { cf: undefined }), env });
    expect(points).toEqual([]);
  });

  test('a failing write still answers 204; nothing is logged (no IP, no body)', async () => {
    const logs = (['log', 'info', 'warn', 'error', 'debug'] as const).map((k) => vi.spyOn(console, k).mockImplementation(() => {}));
    const env: Env = { LGOAB_EVENTS: { writeDataPoint: () => { throw new Error('down'); } } };
    const res = await onRequestPost({ request: req('{"e":"card_shown"}', { headers: { 'cf-connecting-ip': '203.0.113.9' } }), env });
    expect(res.status).toBe(204);
    for (const l of logs) expect(l).not.toHaveBeenCalled();
  });
});
