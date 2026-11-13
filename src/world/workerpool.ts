/**
 * A small pool of Web Workers that answer requests by id: each request gets a fresh `id`, the
 * worker's reply carries it back. Every request settles: with the reply, or with an error when
 * the worker fails to load or throws (onerror), a reply cannot be decoded (onmessageerror), the
 * message cannot be posted, no reply comes within the timeout, or the caller aborts it. A failed
 * worker leaves the rotation; with none left, requests reject at once. A worker that times out
 * `maxTimeouts` times in a row is taken to be hung: it is stopped, whatever else it holds is
 * rejected, and a fresh worker takes its place. No DOM types beyond the Worker shape, so tests can
 * pass a fake.
 *
 * Requests go to the least busy worker (ties in turn). An aborted request frees its place at once,
 * the worker is told (`{ type: 'cancel', id }`, so it can skip the work), and its reply, if one
 * still comes, is ignored.
 */

/** The parts of a Worker the pool uses. */
export type WorkerLike = {
  postMessage(message: unknown, transfer: Transferable[]): void;
  terminate(): void;
  onmessage: ((e: MessageEvent) => void) | null;
  onerror: ((e: ErrorEvent) => void) | null;
  onmessageerror: ((e: MessageEvent) => void) | null;
};

type Pending<Rep> = {
  resolve: (r: Rep) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  slot: number;
  signal?: AbortSignal;
  onAbort?: () => void;
};

export type PoolOptions = {
  timeoutMs?: number;
  /** Timeouts in a row after which a worker is replaced (default 2). */
  maxTimeouts?: number;
  /** Fresh workers the pool may start in place of hung ones, in all (default 4). */
  maxRespawns?: number;
};

export type RequestOptions = { signal?: AbortSignal };

const abortError = () => Object.assign(new Error('request cancelled'), { name: 'AbortError' });

export class WorkerPool<Req extends { id?: number }, Rep extends { id?: number }> {
  private readonly workers: (WorkerLike | null)[];
  private readonly load: number[];
  private readonly timeouts: number[];
  private readonly pending = new Map<number, Pending<Rep>>();
  private nextId = 1;
  private turn = 0;
  private respawns = 0;
  private readonly timeoutMs: number;
  private readonly maxTimeouts: number;
  private readonly maxRespawns: number;
  private readonly make: () => WorkerLike;

  constructor(make: () => WorkerLike, size: number, opts: PoolOptions = {}) {
    this.make = make;
    this.timeoutMs = opts.timeoutMs ?? 20000;
    this.maxTimeouts = opts.maxTimeouts ?? 2;
    this.maxRespawns = opts.maxRespawns ?? 4;
    const n = Math.max(1, size);
    this.load = new Array(n).fill(0);
    this.timeouts = new Array(n).fill(0);
    this.workers = Array.from({ length: n }, (_, slot) => this.start(slot));
  }

  /** Live workers. */
  get size(): number {
    return this.workers.filter(Boolean).length;
  }

  /** Requests waiting for a reply. */
  get inFlight(): number {
    return this.pending.size;
  }

  /** Send `msg` (an id is added) to the least busy live worker; resolves with the reply that carries its id. */
  request(msg: Omit<Req, 'id'>, transfer: Transferable[] = [], opts: RequestOptions = {}): Promise<Rep> {
    return new Promise<Rep>((resolve, reject) => {
      const { signal } = opts;
      if (signal?.aborted) {
        reject(abortError());
        return;
      }
      const slot = this.pickSlot();
      if (slot < 0) {
        reject(new Error('no worker available'));
        return;
      }
      const id = this.nextId++;
      const timer = setTimeout(() => this.timedOut(id), this.timeoutMs);
      const p: Pending<Rep> = { resolve, reject, timer, slot, signal };
      if (signal) {
        p.onAbort = () => this.cancel(id);
        signal.addEventListener('abort', p.onAbort, { once: true });
      }
      this.pending.set(id, p);
      this.load[slot]++;
      try {
        this.workers[slot]!.postMessage({ ...msg, id }, transfer);
      } catch (e) {
        this.settle(id);
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
  }

  /** Stop every worker and reject whatever is still waiting. */
  terminate(): void {
    for (let s = 0; s < this.workers.length; s++) this.fail(s, 'worker pool terminated');
  }

  private start(slot: number): WorkerLike {
    const w = this.make();
    w.onmessage = (e: MessageEvent<Rep>) => {
      const id = e.data?.id;
      if (id === undefined) return; // not a reply to a request; its request will time out
      const p = this.pending.get(id);
      if (!p) return; // already timed out, cancelled or failed
      this.timeouts[slot] = 0;
      this.settle(id);
      p.resolve(e.data);
    };
    w.onerror = (e: ErrorEvent) => {
      e.preventDefault?.();
      this.fail(slot, `worker error: ${e.message || 'failed to load'}`);
    };
    w.onmessageerror = () => this.fail(slot, 'worker reply could not be read');
    return w;
  }

  private pickSlot(): number {
    let best = -1;
    for (let k = 0; k < this.workers.length; k++) {
      const s = (this.turn + k) % this.workers.length;
      if (this.workers[s] && (best < 0 || this.load[s] < this.load[best])) best = s;
    }
    if (best >= 0) this.turn = best + 1;
    return best;
  }

  private settle(id: number): Pending<Rep> | undefined {
    const p = this.pending.get(id);
    if (!p) return undefined;
    clearTimeout(p.timer);
    if (p.onAbort) p.signal?.removeEventListener('abort', p.onAbort);
    this.pending.delete(id);
    this.load[p.slot] = Math.max(0, this.load[p.slot] - 1);
    return p;
  }

  private cancel(id: number): void {
    const p = this.settle(id);
    if (!p) return;
    try {
      this.workers[p.slot]?.postMessage({ type: 'cancel', id }, []);
    } catch {
      /* the worker skips nothing; its reply is ignored all the same */
    }
    p.reject(abortError());
  }

  private timedOut(id: number): void {
    const p = this.settle(id);
    if (!p) return;
    p.reject(new Error(`worker timed out after ${this.timeoutMs} ms`));
    if (!this.workers[p.slot]) return;
    if (++this.timeouts[p.slot] < this.maxTimeouts) return;
    // hung: stop it and start a fresh one, if the pool still may
    this.fail(p.slot, 'worker hung and was replaced');
    if (this.respawns < this.maxRespawns) {
      this.respawns++;
      this.timeouts[p.slot] = 0;
      this.workers[p.slot] = this.start(p.slot);
    }
  }

  /** Take worker `slot` out of the rotation and reject its waiting requests. */
  private fail(slot: number, message: string): void {
    const w = this.workers[slot];
    if (!w) return;
    this.workers[slot] = null;
    w.onmessage = w.onerror = w.onmessageerror = null;
    w.terminate();
    for (const [id, p] of [...this.pending]) {
      if (p.slot !== slot) continue;
      this.settle(id);
      p.reject(new Error(message));
    }
  }
}
