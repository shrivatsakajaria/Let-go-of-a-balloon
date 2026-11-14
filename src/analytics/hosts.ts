/**
 * The live site's own hosts: the pages.dev address and the address in src/config.ts (a custom
 * domain, once there is one). Events are sent only from these (analytics/track.ts) and stored only
 * when they arrive at one of them (functions/api/e.ts): previews, localhost and tests count nothing.
 */
import { SITE_URL } from '../config';

export const PRODUCTION_HOSTS: ReadonlySet<string> = new Set(['let-go-of-a-balloon.pages.dev', new URL(SITE_URL).hostname]);
export const isProductionHost = (host: string) => PRODUCTION_HOSTS.has(host);
