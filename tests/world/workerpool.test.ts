import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkerPool, type WorkerLike } from '../../src/world/workerpool';

type Req = { id?: number; n: number };
type Rep = { id?: number; doubled: number };

class FakeWorker implements WorkerLike {
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  onmessageerror: ((e: MessageEvent) => void) | null = null;
  sent: Req[] = [];
  terminated = false;
  throwOnPost = false;
  postMessage(message: unknown): void {
    if (this.throwOnPost) throw new Error('DataCloneError');
    this.sent.push(message as Req);
  }
  terminate(): void {
    this.terminated = true;
  }
  reply(data: unknown) {
    this.onmessage?.({ data } as MessageEvent);
  }
  error(message = 'boom') {
    this.onerror?.({ message, preventDefault() {} } as unknown as ErrorEvent);
  }
}

function pool(size = 1, timeoutMs = 1000, maxTimeouts?: number) {
  const fakes: FakeWorker[] = [];
  const p = new WorkerPool<Req, Rep>(() => {
    const f = new FakeWorker();
    fakes.push(f);
    return f;
  }, size, { timeoutMs, maxTimeouts });
  return { p, fakes };
}

afterEach(() => vi.useRealTimers());

describe('WorkerPool', () => {
  it('resolves a request with the reply carrying its id', async () => {
    const { p, fakes } = pool();
    const r = p.request({ n: 2 });
    const sent = fakes[0].sent[0];
    expect(sent.n).toBe(2);
    expect(typeof sent.id).toBe('number');
    fakes[0].reply({ id: 999, doubled: 0 }); // someone else's id: ignored
    fakes[0].reply({ doubled: 0 }); // no id: ignored
    fakes[0].reply({ id: sent.id, doubled: 4 });
    await expect(r).resolves.toEqual({ id: sent.id, doubled: 4 });
  });

  it('spreads requests over the workers in turn', () => {
    const { p, fakes } = pool(3);
    for (let i = 0; i < 4; i++) void p.request({ n: i }).catch(() => {});
    expect(fakes.map((f) => f.sent.length)).toEqual([2, 1, 1]);
    p.terminate();
  });

  it('rejects every waiting request of a worker that errors, and stops using it', async () => {
    const { p, fakes } = pool(2);
    const a = p.request({ n: 1 }); // worker 0
    const b = p.request({ n: 2 }); // worker 1
    const c = p.request({ n: 3 }); // worker 0
    fakes[0].error('failed to load');
    await expect(a).rejects.toThrow(/failed to load/);
    await expect(c).rejects.toThrow(/failed to load/);
    expect(fakes[0].terminated).toBe(true);
    expect(p.size).toBe(1);
    void p.request({ n: 4 }).catch(() => {}); // goes to worker 1
    expect(fakes[1].sent.length).toBe(2);
    fakes[1].reply({ id: fakes[1].sent[0].id, doubled: 4 });
    await expect(b).resolves.toMatchObject({ doubled: 4 });
    p.terminate();
  });

  it('rejects on an unreadable reply', async () => {
    const { p, fakes } = pool();
    const a = p.request({ n: 1 });
    fakes[0].onmessageerror?.({} as MessageEvent);
    await expect(a).rejects.toThrow(/could not be read/);
  });

  it('rejects at once when no worker is left', async () => {
    const { p, fakes } = pool();
    fakes[0].error();
    await expect(p.request({ n: 1 })).rejects.toThrow(/no worker/);
  });

  it('rejects when a request times out, and ignores a late reply', async () => {
    vi.useFakeTimers();
    const { p, fakes } = pool(1, 500);
    const a = p.request({ n: 1 });
    const check = expect(a).rejects.toThrow(/timed out/);
    vi.advanceTimersByTime(501);
    await check;
    expect(() => fakes[0].reply({ id: fakes[0].sent[0].id, doubled: 2 })).not.toThrow();
    // the worker itself is still usable
    const b = p.request({ n: 2 });
    fakes[0].reply({ id: fakes[0].sent[1].id, doubled: 4 });
    await expect(b).resolves.toMatchObject({ doubled: 4 });
  });

  it('rejects when the message cannot be posted', async () => {
    const { p, fakes } = pool();
    fakes[0].throwOnPost = true;
    await expect(p.request({ n: 1 })).rejects.toThrow(/DataCloneError/);
  });

  it('terminate rejects what is waiting and stops the workers', async () => {
    const { p, fakes } = pool(2);
    const a = p.request({ n: 1 });
    p.terminate();
    await expect(a).rejects.toThrow(/terminated/);
    expect(fakes.every((f) => f.terminated)).toBe(true);
    expect(p.size).toBe(0);
  });

  it('sends a request to the least busy worker', async () => {
    const { p, fakes } = pool(2);
    const a = p.request({ n: 1 }); // worker 0
    void p.request({ n: 2 }).catch(() => {}); // worker 1
    const c = p.request({ n: 3 }); // worker 0
    fakes[0].reply({ id: fakes[0].sent[0].id, doubled: 2 });
    fakes[0].reply({ id: fakes[0].sent[1].id, doubled: 6 });
    await Promise.all([a, c]);
    void p.request({ n: 4 }).catch(() => {}); // worker 0 is idle, worker 1 still busy
    expect(fakes.map((f) => f.sent.length)).toEqual([3, 1]);
    p.terminate();
  });

  it('cancels a request: it rejects as aborted, frees its place, tells the worker, and its late reply is ignored', async () => {
    const { p, fakes } = pool(1);
    const ac = new AbortController();
    const a = p.request({ n: 1 }, [], { signal: ac.signal });
    expect(p.inFlight).toBe(1);
    const id = fakes[0].sent[0].id;
    ac.abort();
    await expect(a).rejects.toMatchObject({ name: 'AbortError' });
    expect(p.inFlight).toBe(0);
    expect(fakes[0].sent[1]).toEqual({ type: 'cancel', id });
    expect(() => fakes[0].reply({ id, doubled: 2 })).not.toThrow(); // late: ignored
    const b = p.request({ n: 2 });
    fakes[0].reply({ id: fakes[0].sent[2].id, doubled: 4 });
    await expect(b).resolves.toMatchObject({ doubled: 4 });
  });

  it('rejects at once, posting nothing, when the signal is already aborted', async () => {
    const { p, fakes } = pool(1);
    const ac = new AbortController();
    ac.abort();
    await expect(p.request({ n: 1 }, [], { signal: ac.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(fakes[0].sent).toHaveLength(0);
    expect(p.inFlight).toBe(0);
  });

  it('retires a worker that times out repeatedly and starts a fresh one in its place', async () => {
    vi.useFakeTimers();
    const { p, fakes } = pool(1, 500, 2);
    const a = p.request({ n: 1 });
    const b = p.request({ n: 2 });
    const checks = Promise.all([expect(a).rejects.toThrow(/timed out/), expect(b).rejects.toThrow(/timed out/)]);
    vi.advanceTimersByTime(501);
    await checks;
    expect(fakes[0].terminated).toBe(true);
    expect(fakes).toHaveLength(2);
    expect(p.size).toBe(1);
    const c = p.request({ n: 3 });
    expect(fakes[1].sent).toHaveLength(1);
    fakes[1].reply({ id: fakes[1].sent[0].id, doubled: 6 });
    await expect(c).resolves.toMatchObject({ doubled: 6 });
  });

  it('a reply in between resets the timeout count', async () => {
    vi.useFakeTimers();
    const { p, fakes } = pool(1, 500, 2);
    const a = p.request({ n: 1 });
    const check = expect(a).rejects.toThrow(/timed out/);
    vi.advanceTimersByTime(501);
    await check;
    const b = p.request({ n: 2 });
    fakes[0].reply({ id: fakes[0].sent[1].id, doubled: 4 });
    await b;
    const c = p.request({ n: 3 });
    const check2 = expect(c).rejects.toThrow(/timed out/);
    vi.advanceTimersByTime(501);
    await check2;
    expect(fakes[0].terminated).toBe(false);
    expect(fakes).toHaveLength(1);
  });
});
