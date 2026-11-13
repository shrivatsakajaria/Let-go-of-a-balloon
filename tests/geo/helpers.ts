import { readFileSync } from 'node:fs';
import { vi } from 'vitest';

type Body = string | { status: number; body?: string };

/** Answer /gazetteer/<tile>.json from `bodies` (404 for anything else); `real` reads the committed tiles. */
export function stubGazetteer(bodies: Record<string, Body> = {}, real = false): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async (url: string) => {
    const key = String(url).replace(/^.*\/gazetteer\//, '');
    const hit = bodies[key];
    if (hit !== undefined) {
      if (typeof hit === 'string') return new Response(hit, { status: 200 });
      return new Response(hit.body ?? '', { status: hit.status });
    }
    if (real) {
      try {
        return new Response(readFileSync(`public/gazetteer/${key}`), { status: 200 });
      } catch {
        /* fall through */
      }
    }
    return new Response('Not found', { status: 404 });
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

/** A tile in the shipped format with a g x g grid given as rows of characters: . land, ~ open sea, digits name index + 2. */
export function tileJson(o: { towns?: [string, string, number, number, number][]; names?: [string, 's' | 'r'][]; rows?: string[] }): string {
  const countries: string[] = [];
  const t = (o.towns ?? []).map(([name, country, lat, lon, pop]) => {
    let ci = countries.indexOf(country);
    if (ci < 0) ci = countries.push(country) - 1;
    return [name, ci, lat, lon, pop];
  });
  let g: number[] | undefined;
  if (o.rows) {
    g = [];
    let prev = -1;
    for (const ch of o.rows.join('')) {
      const v = ch === '.' ? 0 : ch === '~' ? 1 : Number(ch) + 2;
      if (v === prev) g[g.length - 1]++;
      else { g.push(v, 1); prev = v; }
    }
  }
  return JSON.stringify({ c: countries, t, n: o.names ?? [], ...(g ? { g } : {}) });
}
