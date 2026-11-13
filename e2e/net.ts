import { readFileSync } from 'node:fs';
import type { Page, Request } from '@playwright/test';

const fixture = (name: string) => readFileSync(new URL(`../tests/fixtures/geocoding/${name}.json`, import.meta.url), 'utf8');

/** Answers for the place search, by the name searched for. Anything else: no results. */
const PLACES: Record<string, string> = { windermere: 'windermere', manchester: 'manchester' };

/**
 * Keep a page off the network: the local server is allowed, Open-Meteo geocoding is answered from
 * fixtures, everything else is aborted and recorded.
 */
export async function offline(page: Page, opts: { searchDelayMs?: number; searchFails?: boolean } = {}) {
  const external: string[] = [];
  const searches: string[] = [];
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') return route.continue();
    if (url.hostname === 'geocoding-api.open-meteo.com') {
      searches.push(url.search);
      if (opts.searchDelayMs) await new Promise((r) => setTimeout(r, opts.searchDelayMs));
      if (opts.searchFails) return route.fulfill({ status: 503, body: '' });
      const name = (url.searchParams.get('name') ?? '').toLowerCase();
      const hit = Object.keys(PLACES).find((k) => k.startsWith(name) || name.startsWith(k));
      return route.fulfill({ status: 200, contentType: 'application/json', body: hit ? fixture(PLACES[hit]) : fixture('none') });
    }
    external.push(url.href);
    return route.abort('blockedbyclient');
  });
  return { external, searches };
}

export const isFontsGoogle = (r: Request) => /fonts\.(googleapis|gstatic)\.com/.test(r.url());
