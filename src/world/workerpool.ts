/**
 * A small pool of Web Workers that answer requests by id: each request gets a fresh `id`, the
 * worker's reply carries it back. Every request settles: with the reply, or with an error when
 * the worker fails to load or throws (onerror), a reply cannot be decoded (onmessageerror), the
 * message cannot be posted, or no reply comes within the timeout. A failed worker leaves the
 * rotation; with none left, requests reject at once. No DOM types beyond the Worker shape, so
 * tests can pass a fake.
 */

/** The parts of a Worker the pool uses. */
export type WorkerLike = {
  postMessage(message: unknown, transfer: Transferable[]): void;
  terminate(): void;
  onmessage: ((e: MessageEvent) => void) | null;
  onerror: ((e: ErrorEvent) => void) | null;
  onmessageerror: ((e: MessageEvent) => void) | null;
};

type Pending<Rep> = { resolve: (r: Rep) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout>; slot: number };

export class WorkerPool<Req extends { id?: number }, Rep extends { id?: number }> {
  private readonly workers: (WorkerLike | null)[];
  private readonly pending = new Map<number, Pending<Rep>>();
  private nextId = 1;
  private turn = 0;
  private readonly timeoutMs: number;

  constructor(make: () => WorkerLike, size: number, opts: { timeoutMs?: number } = {}) {
    this.timeoutMs = opts.timeoutMs ?? 20000;
    this.workers = Array.from({ length: Math.max(1, size) }, (_, slot) => {
      const w = make();
      w.onmessage = (e: MessageEvent<Rep>) => {
        const id = e.data?.id;
        if (id === undefined) return; // not a reply to a request; its request will time out
        const p = this.pending.get(id);
        if (!p) return; // already timed out or failed
        this.settle(id);
        p.resolve(e.data);
      };
      w.onerror = (e: ErrorEvent) => {
        e.preventDefault?.();
        this.fail(slot, `worker error: ${e.message || 'failed to load'}`);
      };
      w.onmessageerror = () => this.fail(slot, 'worker reply could not be read');
      return w;
    });
  }

  /** Live workers. */
  get size(): number {
    return this.workers.filter(Boolean).length;
  }

  /** Send `msg` (an id is added) to the next live worker; resolves with the reply that carries its id. */
  request(msg: Omit<Req, 'id'>, transfer: Transferable[] = []): Promise<Rep> {
    return new Promise<Rep>((resolve, reject) => {
      const slot = this.pickSlot();
      if (slot < 0) {
        reject(new Error('no worker available'));
        return;
      }
      const id = this.nextId++;
      const timer = setTimeout(() => {
        if (!this.pending.has(id)) return;
        this.settle(id);
        reject(new Error(`worker timed out after ${this.timeoutMs} ms`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer, slot });
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

  private pickSlot(): number {
    for (let k = 0; k < this.workers.length; k++) {
      const s = (this.turn + k) % this.workers.length;
      if (this.workers[s]) {
        this.turn = s + 1;
        return s;
      }
    }
    return -1;
  }

  private settle(id: number): void {
    const p = this.pending.get(id);
    if (p) clearTimeout(p.timer);
    this.pending.delete(id);
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
