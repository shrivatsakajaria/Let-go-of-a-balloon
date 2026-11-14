import { FLIGHT_HOURS, WINDS_BASE } from '../config';
import { decodeTile, type WindTile } from './format';
import type { LatLon } from '../geo/coords';
import { wrapLon } from '../geo/coords';
import { cruiseLevel, interpolateAltitude, sampleTileLevels, tileKey, tileOrigin, type LevelSample } from './sampler';

export class WindUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WindUnavailableError';
  }
}

export class TileNotReadyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TileNotReadyError';
  }
}

export interface ManifestRun {
  id: string;
  issued: string;
  hours: number[];
  climb: { tileDeg: number; res: number; hours: number[]; scale: number };
  cruise: { tileDeg: number; res: number; windowHours: number; scale: number };
}
export interface Manifest {
  runs: ManifestRun[];
}

export type FetchFn = (url: string) => Promise<Response>;

/** The page's fetch, called without a borrowed `this` (a stored `fetch` throws "Illegal invocation" in browsers). */
const pageFetch: FetchFn = (url) => fetch(url);

const HOUR_MS = 3.6e6;
/** A run older than this is never used, however far ahead it reaches (R59: runs go to f120, 120 - 72 = 48). */
const MAX_RUN_AGE_MS = 48 * HOUR_MS;
/**
 * How much later than the manifest's `nowMs` a release may come and still be covered: app/data.ts
 * keeps a loaded manifest for 20 minutes before reading it again.
 */
const RELEASE_SLACK_MS = 30 * 60e3;
const CRUISE_LAT_MAX = 70;
const CLIMB_LAT_MAX = 85;

/**
 * Whether `run` can carry a whole flight released at `releaseMs` (or up to RELEASE_SLACK_MS later):
 * issued less than 48 h before, and its last forecast hour at or after the landing, 72 h on.
 */
export function runCoversFlight(run: ManifestRun, releaseMs: number): boolean {
  const issued = Date.parse(run.issued);
  const last = Array.isArray(run.hours) && run.hours.length > 0 ? run.hours[run.hours.length - 1] : NaN;
  if (!Number.isFinite(issued) || !Number.isFinite(last)) return false;
  if (issued <= releaseMs - MAX_RUN_AGE_MS) return false;
  return issued + last * HOUR_MS >= releaseMs + FLIGHT_HOURS * HOUR_MS + RELEASE_SLACK_MS;
}

/**
 * Load the manifest and keep only the runs that cover a whole flight released now (runCoversFlight),
 * newest first. WindField starts on the first and falls back down the list only while a tile is
 * missing, so a newer usable run is always preferred. Every forecast hour a flight from these runs
 * reads is then inside the run, so the clamping in WindField (to 0 .. last hour) only ever trims the
 * release slack.
 */
export async function loadManifest(
  base = WINDS_BASE,
  fetchFn: FetchFn = pageFetch,
  nowMs: number = Date.now(),
): Promise<Manifest> {
  let m: Manifest;
  try {
    const res = await fetchFn(`${base}/manifest.json`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    m = (await res.json()) as Manifest;
  } catch (e) {
    throw new WindUnavailableError(`wind manifest unavailable: ${(e as Error).message}`);
  }
  const runs = (Array.isArray(m.runs) ? m.runs : [])
    .filter((r) => runCoversFlight(r, nowMs))
    .sort((a, b) => Date.parse(b.issued) - Date.parse(a.issued));
  if (runs.length === 0) throw new WindUnavailableError('no wind run under 48 h old that covers the whole 72 h flight');
  return { runs };
}

async function gunzip(res: Response): Promise<ArrayBuffer> {
  return new Response(res.body!.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
}

export class WindField {
  private runIdx = 0;
  private prepared = false;
  private readonly tiles = new Map<string, WindTile | null>();
  private readonly inflight = new Map<string, Promise<WindTile | null>>();
  private readonly climbLists = new Map<string, Set<string>>();

  constructor(
    private readonly manifest: Manifest,
    private readonly fetchFn: FetchFn = pageFetch,
    private readonly base = WINDS_BASE,
  ) {
    if (manifest.runs.length === 0) throw new WindUnavailableError('no wind runs');
  }

  private get run(): ManifestRun {
    return this.manifest.runs[this.runIdx];
  }
  get runId(): string {
    return this.run.id;
  }
  get runIssuedMs(): number {
    return Date.parse(this.run.issued);
  }

  /** Returns the tile, null for a definitive miss, or undefined for a transient failure (retry later). */
  private async fetchTile(url: string): Promise<WindTile | null | undefined> {
    let res: Response;
    try {
      res = await this.fetchFn(url);
    } catch {
      return undefined; // network error
    }
    if (res.status >= 500) return undefined;
    if (!res.ok || !res.body) return null; // 404 and friends: definitive
    try {
      return decodeTile(await gunzip(res));
    } catch {
      return null; // R17: a fallback HTML page or corrupt file counts as missing
    }
  }

  private load(key: string, url: string): Promise<WindTile | null> {
    if (this.tiles.has(key)) return Promise.resolve(this.tiles.get(key)!);
    let p = this.inflight.get(key);
    if (!p) {
      p = this.fetchTile(url).then((t) => {
        if (t !== undefined) this.tiles.set(key, t); // transient failures are not cached
        this.inflight.delete(key);
        return t ?? null;
      });
      this.inflight.set(key, p);
    }
    return p;
  }

  private cruiseKey(run: string, lat0: number, lon0: number, w: number): string {
    return `cruise/${run}/${tileKey(lat0, lon0)}_${w}`;
  }
  private climbKey(run: string, lat0: number, lon0: number): string {
    return `climb/${run}/${tileKey(lat0, lon0)}`;
  }

  private async climbList(run: string): Promise<Set<string>> {
    let s = this.climbLists.get(run);
    if (s) return s;
    try {
      const res = await this.fetchFn(`${this.base}/climb/${run}/tiles.json`);
      if (!res.ok) throw new Error('missing');
      const names = (await res.json()) as unknown;
      if (!Array.isArray(names)) throw new Error('bad shape');
      s = new Set(names.filter((n): n is string => typeof n === 'string'));
    } catch {
      s = new Set(); // no usable list: no climb tiles, cruise tiles are used instead
    }
    this.climbLists.set(run, s);
    return s;
  }

  /** Tile origins of the tile containing `around` plus its 8 neighbours. */
  private neighbourhood(around: LatLon, deg: number, latMax: number, radius: 0 | 1 = 1): { lat0: number; lon0: number }[] {
    const c = tileOrigin(around, deg, latMax);
    const seen = new Set<string>();
    const out: { lat0: number; lon0: number }[] = [];
    for (let di = -radius; di <= radius; di++) {
      for (let dj = -radius; dj <= radius; dj++) {
        const lat0 = c.lat0 + di * deg;
        if (lat0 < -90 || lat0 > latMax) continue;
        const lon0 = wrapLon(c.lon0 + dj * deg);
        const k = tileKey(lat0, lon0);
        if (seen.has(k)) continue;
        seen.add(k);
        out.push({ lat0, lon0 });
      }
    }
    return out;
  }

  /**
   * Load every tile a route step near `around` could need within [fromUtcMs, toUtcMs]. Before the
   * first successful prepare, a missing cruise tile moves the field to the next usable run.
   */
  async prepare(around: LatLon, hours: [number, number], opts?: { radius?: 0 | 1 }): Promise<void> {
    const radius = opts?.radius ?? 1;
    for (;;) {
      try {
        await this.prepareRun(around, hours, radius);
        this.prepared = true;
        return;
      } catch (e) {
        if (!(e instanceof WindUnavailableError)) throw e;
        if (this.prepared || this.runIdx + 1 >= this.manifest.runs.length) throw e;
        this.runIdx++;
      }
    }
  }

  private async prepareRun(around: LatLon, span: [number, number], radius: 0 | 1): Promise<void> {
    const run = this.run;
    const issued = this.runIssuedMs;
    const maxH = run.hours[run.hours.length - 1];
    const fromH = Math.max(0, Math.min(maxH, (span[0] - issued) / HOUR_MS));
    const toH = Math.max(fromH, Math.min(maxH, (span[1] - issued) / HOUR_MS));
    const win = run.cruise.windowHours;
    const nWin = Math.max(1, Math.round(maxH / win));
    const w0 = Math.min(nWin - 1, Math.floor(fromH / win));
    const w1 = Math.max(w0, Math.min(nWin - 1, Math.ceil(toH / win) - 1));

    const jobs: Promise<void>[] = [];
    for (const { lat0, lon0 } of this.neighbourhood(around, run.cruise.tileDeg, CRUISE_LAT_MAX, radius)) {
      for (let w = w0; w <= w1; w++) {
        const key = this.cruiseKey(run.id, lat0, lon0, w);
        const url = `${this.base}/cruise/${run.id}/${lat0}_${lon0}_${w}.bin.gz`;
        jobs.push(
          this.load(key, url).then((t) => {
            if (!t) throw new WindUnavailableError(`cruise tile missing: ${key}`);
          }),
        );
      }
    }
    const climbMax = run.climb.hours[run.climb.hours.length - 1];
    if (fromH <= climbMax) {
      const list = await this.climbList(run.id);
      for (const { lat0, lon0 } of this.neighbourhood(around, run.climb.tileDeg, CLIMB_LAT_MAX, radius)) {
        if (!list.has(tileKey(lat0, lon0))) continue;
        // A failed climb tile is not fatal: sampling falls back to the cruise tiles.
        jobs.push(this.load(this.climbKey(run.id, lat0, lon0), `${this.base}/climb/${run.id}/${lat0}_${lon0}.bin.gz`).then(() => {}));
      }
    }
    const results = await Promise.allSettled(jobs);
    const failed = results.find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined;
    if (failed) throw failed.reason;
  }

  private cruiseTile(p: LatLon, forecastHour: number): WindTile {
    const run = this.run;
    const maxH = run.hours[run.hours.length - 1];
    const win = run.cruise.windowHours;
    const nWin = Math.max(1, Math.round(maxH / win));
    const h = Math.max(0, Math.min(maxH, forecastHour));
    const { lat0, lon0 } = tileOrigin(p, run.cruise.tileDeg, CRUISE_LAT_MAX);
    const w = Math.min(nWin - 1, Math.floor(h / win));
    const candidates = [w];
    if (h === w * win && w > 0) candidates.push(w - 1); // boundary hour: either window works
    for (const c of candidates) {
      const t = this.tiles.get(this.cruiseKey(run.id, lat0, lon0, c));
      if (t) return t;
    }
    throw new TileNotReadyError(`cruise tile not prepared: ${lat0}_${lon0} window ${w}`);
  }

  /** Climb levels at the point, or null if there is no climb data there (use cruise instead). */
  private climbLevels(p: LatLon, forecastHour: number): LevelSample[] | null {
    const run = this.run;
    if (forecastHour > run.climb.hours[run.climb.hours.length - 1]) return null;
    const list = this.climbLists.get(run.id);
    if (!list) throw new TileNotReadyError('climb tile list not loaded');
    const { lat0, lon0 } = tileOrigin(p, run.climb.tileDeg, CLIMB_LAT_MAX);
    if (!list.has(tileKey(lat0, lon0))) return null;
    const key = this.climbKey(run.id, lat0, lon0);
    if (!this.tiles.has(key)) throw new TileNotReadyError(`climb tile not prepared: ${lat0}_${lon0}`);
    const t = this.tiles.get(key);
    return t ? sampleTileLevels(t, forecastHour, p) : null;
  }

  /**
   * Whether the cruise winds at p for utcMs are in already (loaded, not missing). Only reads: it never
   * loads a tile nor moves to another run.
   */
  has(p: LatLon, utcMs: number): boolean {
    try {
      this.cruiseTile(p, (utcMs - this.runIssuedMs) / HOUR_MS);
      return true;
    } catch {
      return false;
    }
  }

  /** Synchronous wind sample from prepared tiles. Throws TileNotReadyError if one is missing. */
  sample(p: LatLon, altAslM: number, utcMs: number): { u: number; v: number } {
    const h = (utcMs - this.runIssuedMs) / HOUR_MS;
    const climb = this.climbLevels(p, h);
    if (climb) {
      const l850 = climb.find((l) => l.hpa === 850);
      if (l850 && l850.gh > 0 && altAslM < l850.gh) {
        const r = interpolateAltitude(climb, altAslM);
        if (r) return r;
      }
    }
    const r = interpolateAltitude(sampleTileLevels(this.cruiseTile(p, h), h, p), altAslM);
    return r ?? { u: 0, v: 0 };
  }

  /** Cruise level (and its height) the route should hold over ground at groundM. */
  cruiseLevelHeight(p: LatLon, utcMs: number, groundM: number): { levelHpa: number; heightM: number } {
    const h = (utcMs - this.runIssuedMs) / HOUR_MS;
    const heights: Record<number, number> = {};
    for (const l of sampleTileLevels(this.cruiseTile(p, h), h, p)) heights[l.hpa] = l.gh;
    const levelHpa = cruiseLevel(groundM, heights);
    return { levelHpa, heightM: heights[levelHpa] };
  }
}
