import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { destination, lonLatToTile, tileBounds, type LatLon } from '../../src/geo/coords';
import { tileFrame } from '../../src/world/frame';
import { DEFAULT_REGION } from '../../src/world/palette';
import { levelFor, type LodCamera } from '../../src/world/lod';
import { WorldStream, type BuildPool, type RecentreEvent } from '../../src/world/stream';
import type { BuildReply, BuildRequest } from '../../src/world/worker';

const MANCHESTER = { lat: 53.4794, lon: -2.2453 };
const cam = (p: LatLon, headingDeg = 90, altM = 1500): LodCamera => ({ ...p, altM, headingDeg });
const tileAt = (p: LatLon, z: number) => {
  const t = lonLatToTile(p.lat, p.lon, z);
  return `${z}/${Math.floor(t.x)}/${Math.floor(t.y)}`;
};

type Job = { msg: Omit<BuildRequest, 'id'>; signal?: AbortSignal; resolve: (r: BuildReply) => void; reject: (e: Error) => void };

/** A pool that answers only when the test says so. */
class FakePool implements BuildPool {
  jobs: Job[] = [];
  request(msg: Omit<BuildRequest, 'id'>, _t?: Transferable[], opts: { signal?: AbortSignal } = {}): Promise<BuildReply> {
    return new Promise((resolve, reject) => {
      const job = { msg, signal: opts.signal, resolve, reject };
      this.jobs.push(job);
      opts.signal?.addEventListener('abort', () => reject(Object.assign(new Error('cancelled'), { name: 'AbortError' })));
    });
  }
  open(): Job[] {
    return this.jobs.filter((j) => !j.signal?.aborted && !(j as { done?: boolean }).done);
  }
  /** Reply to a job with a flat tile at `height` and one 30 m building at its centre. */
  answer(job: Job, height = (z: number) => 10 + z) {
    (job as { done?: boolean }).done = true;
    const { z, x, y } = job.msg;
    const n = job.msg.lcSize!;
    const f = tileFrame(z, x, y);
    const h = height(z);
    const quad = (yy: number) => ({
      position: new Float32Array([0, yy, 0, f.widthM, yy, 0, 0, yy, -f.heightM]),
      normal: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]),
      color: new Float32Array(9).fill(0.6),
    });
    const empty = () => ({ position: new Float32Array(0), normal: new Float32Array(0), color: new Float32Array(0) });
    job.resolve({
      type: 'built', z, x, y,
      meshes: {
        ground: quad(h), water: empty(), buildings: empty(), roofs: empty(), roads: empty(), waterways: empty(),
        trees: new Float32Array(0), lamps: new Float32Array(0), labels: [],
        grid: new Float32Array((n + 1) * (n + 1)).fill(h),
        tops: new Float32Array([f.widthM / 2, -f.heightM / 2, 10, h + 30]),
        stats: { buildings: 1, gapHouses: 0, trees: 0, lamps: 0 },
      },
    });
  }
}

const tick = () => new Promise((r) => setTimeout(r, 0));

function setup(opts: { origin?: LatLon; fallback?: number } = {}) {
  const scene = new THREE.Scene();
  const pool = new FakePool();
  const stream = new WorldStream(scene, pool, () => DEFAULT_REGION, {
    vectorUrl: 'https://tiles.example/{z}/{x}/{y}.pbf',
    origin: opts.origin ?? MANCHESTER,
    fallbackGround: () => opts.fallback,
  });
  return { scene, pool, stream };
}

/** Run frames until the template has resolved and builds are out. */
async function start(stream: WorldStream, c: LodCamera, t = 0) {
  stream.update(c, t);
  await tick();
  stream.update(c, t + 16);
}

describe('WorldStream scene frame', () => {
  it('toScene and fromScene round-trip, metres east and north', () => {
    const { stream } = setup();
    const o = stream.toScene(MANCHESTER);
    expect(Math.abs(o.x) + Math.abs(o.z)).toBe(0);
    const p = destination(MANCHESTER, 45, 3);
    const s = stream.toScene(p);
    expect(Math.hypot(s.x, s.z)).toBeCloseTo(3000, -1); // within ~10 m over 3 km
    expect(s.x).toBeGreaterThan(0); // east
    expect(s.z).toBeLessThan(0); // north is -z
    const q = stream.fromScene(s.x, s.z);
    expect(q.lat).toBeCloseTo(p.lat, 10);
    expect(q.lon).toBeCloseTo(p.lon, 10);
  });

  it('is continuous across the date line', () => {
    const { stream } = setup({ origin: { lat: 64.2, lon: 179.999 } });
    const a = stream.toScene({ lat: 64.2, lon: 179.9995 });
    const b = stream.toScene({ lat: 64.2, lon: -179.9995 });
    const m = 0.001 * 111320 * Math.cos((64.2 * Math.PI) / 180); // 0.001 degrees east
    expect(b.x - a.x).toBeCloseTo(m, 6);
    const back = stream.fromScene(b.x, b.z);
    expect(back.lon).toBeCloseTo(-179.9995, 9);
    expect(stream.fromScene(a.x + 2 * m, 0).lon).toBeCloseTo(-179.9985, 9);
  });
});

describe('WorldStream', () => {
  it('asks for the area ahead first and keeps to 6 builds in flight', async () => {
    const { pool, stream } = setup();
    await start(stream, cam(MANCHESTER, 90));
    expect(pool.open()).toHaveLength(6);
    const asked = pool.jobs.map((j) => `${j.msg.z}/${j.msg.x}/${j.msg.y}`);
    expect(asked[0]).toBe(tileAt(MANCHESTER, 14));
    // each build carries its level's detail, packing and the region of its centre
    const j0 = pool.jobs[0].msg;
    expect(j0).toMatchObject({ lcSize: levelFor(14).lcSize, skirtM: levelFor(14).skirtM, pack: true, region: DEFAULT_REGION });
    // finish everything, frame by frame
    for (let k = 0; k < 20; k++) {
      for (const j of pool.open()) pool.answer(j);
      await tick();
      stream.update(cam(MANCHESTER, 90), 100 + k * 50);
    }
    const keys = stream.tiles().map((t) => t.key);
    expect(keys).toContain(tileAt(destination(MANCHESTER, 90, 1.2), 14));
    expect(keys).not.toContain(tileAt(destination(MANCHESTER, 270, 1.2), 14));
    expect(keys.length).toBeLessThanOrEqual(40);
  });

  it('cancellation frees the slot and the late reply is ignored', async () => {
    const { pool, scene, stream } = setup();
    await start(stream, cam(MANCHESTER));
    const first = pool.open();
    expect(first).toHaveLength(6);
    // jump 400 km: nothing in flight is wanted any more
    const away = destination(MANCHESTER, 0, 400);
    stream.update(cam(away), 100);
    expect(first.every((j) => j.signal!.aborted)).toBe(true);
    expect(stream.stats().cancelled).toBe(6);
    expect(stream.stats().loading).toBe(6); // the freed places went to the new area
    expect(pool.open().every((j) => !first.includes(j))).toBe(true);
    // a reply arriving after the cancel builds nothing
    const before = scene.children.length;
    pool.answer(first[0]);
    await tick();
    stream.update(cam(away), 120);
    expect(scene.children.length).toBe(before);
    expect(stream.tiles().map((t) => t.key)).not.toContain(`${first[0].msg.z}/${first[0].msg.x}/${first[0].msg.y}`);
  });

  it('groundAt reads the finest loaded tile, and buildingTopAt its rooftops', async () => {
    const { pool, stream } = setup({ fallback: 7 });
    expect(stream.groundAt(MANCHESTER)).toBe(7); // nothing loaded: the coarse route ground
    await start(stream, cam(MANCHESTER));
    const z7 = pool.jobs.find((j) => j.msg.z === 7)!;
    pool.answer(z7);
    await tick();
    stream.update(cam(MANCHESTER), 50);
    expect(stream.groundAt(MANCHESTER)).toBe(17);
    const z14 = pool.jobs.find((j) => j.msg.z === 14)!;
    pool.answer(z14);
    await tick();
    stream.update(cam(MANCHESTER), 60);
    expect(stream.groundAt(MANCHESTER)).toBe(24);
    // the z14 tile's one building stands at its centre, 30 m tall
    const b = tileBounds(14, z14.msg.x, z14.msg.y);
    const centre = { lat: (b.south + b.north) / 2, lon: (b.west + b.east) / 2 };
    expect(stream.buildingTopAt(centre, 5)).toBe(54);
    expect(stream.buildingTopAt(destination(centre, 90, 0.5), 20)).toBe(24); // nothing near: the ground
    expect(stream.buildingTopAt(destination(centre, 90, 0.5), 600)).toBe(54);
  });

  it('places every tile so its frame and toScene agree, before and after a re-centre', async () => {
    const { pool, stream } = setup();
    await start(stream, cam(MANCHESTER));
    for (const j of pool.open()) pool.answer(j);
    await tick();
    stream.update(cam(MANCHESTER), 50);
    const key = tileAt(MANCHESTER, 14);
    const p = destination(MANCHESTER, 30, 0.3);
    const [, x, y] = key.split('/').map(Number);
    const f = tileFrame(14, x, y);
    const local = f.toLocal(p.lat, p.lon);
    const where = () => new THREE.Vector3(local.x, 0, local.z).applyMatrix4(stream.groupOf(key)!.matrixWorld);
    const s0 = stream.toScene(p);
    expect(where().x).toBeCloseTo(s0.x, 3);
    expect(where().z).toBeCloseTo(s0.z, 3);
    // fly 6 km north-east: the origin follows
    const events: RecentreEvent[] = [];
    stream.onRecentre = (e) => events.push(e);
    const on = destination(MANCHESTER, 45, 6);
    stream.update(cam(on, 45), 100);
    expect(events).toHaveLength(1);
    expect(stream.origin.lat).toBeCloseTo(on.lat, 9);
    const s1 = stream.toScene(p);
    expect(where().x).toBeCloseTo(s1.x, 3);
    expect(where().z).toBeCloseTo(s1.z, 3);
    // the event moves old positions to new ones: exactly by remap, to within a metre by the shift
    const r = events[0].remap(s0.x, s0.z);
    expect(r.x).toBeCloseTo(s1.x, 6);
    expect(r.z).toBeCloseTo(s1.z, 6);
    const near = destination(on, 200, 0.25); // near the new focus a plain shift is enough
    const n0 = { lat: near.lat, lon: near.lon };
    const before = { x: 0, z: 0 };
    // old frame position of `near`: invert the event's remap numerically via the origin it came from
    before.x = (near.lon - events[0].from.lon) * 111320 * Math.cos((events[0].from.lat * Math.PI) / 180);
    before.z = -(near.lat - events[0].from.lat) * 111320;
    const after = stream.toScene(n0);
    expect(Math.hypot(before.x - events[0].dx - after.x, before.z - events[0].dz - after.z)).toBeLessThan(0.5);
    expect(Math.hypot(stream.toScene(on).x, stream.toScene(on).z)).toBeLessThan(1e-6);
    // no re-centre while the camera stays near
    stream.update(cam(destination(on, 45, 3), 45), 150);
    expect(events).toHaveLength(1);
  });

  it('fades a tile in from the haze over 400 ms, or dissolves it in over coarser land', async () => {
    const { pool, stream } = setup();
    await start(stream, cam(MANCHESTER));
    const z7 = pool.jobs.find((j) => j.msg.z === 7)!;
    pool.answer(z7);
    await tick();
    stream.update(cam(MANCHESTER), 1000);
    const slotOf = (key: string) => {
      const mesh = stream.groupOf(key)!.children[0] as THREE.Mesh;
      return stream.materials.slots.get(mesh.geometry.getAttribute('aSlot').getX(0));
    };
    const k7 = `7/${z7.msg.x}/${z7.msg.y}`;
    expect(slotOf(k7).x).toBe(0);
    expect(slotOf(k7).z).toBe(0); // from the haze: nothing under it
    stream.update(cam(MANCHESTER), 1200);
    expect(slotOf(k7).x).toBeGreaterThan(0.9);
    expect(slotOf(k7).x).toBeLessThan(1);
    stream.update(cam(MANCHESTER), 1400);
    expect(slotOf(k7).x).toBe(1);
    expect(stream.tiles().find((t) => t.key === k7)!.settled).toBe(true);
    // a z14 tile arriving over settled land dissolves in, then is fully in
    const z14 = pool.jobs.find((j) => j.msg.z === 14)!;
    pool.answer(z14);
    await tick();
    stream.update(cam(MANCHESTER), 1500);
    const k14 = tileAt(MANCHESTER, 14);
    expect(slotOf(k14).z).toBe(1);
    stream.update(cam(MANCHESTER), 1950);
    expect(slotOf(k14).x).toBe(1);
    expect(slotOf(k14).z).toBe(0);
  });

  it('stays within 40 tiles and 6 builds over a long flight, and frees everything on dispose', async () => {
    const { pool, scene, stream } = setup();
    let p = MANCHESTER;
    let t = 0;
    let maxAlive = 0, maxLoading = 0;
    for (let k = 0; k < 120; k++) {
      p = destination(p, 80, 0.4);
      t += 100;
      stream.update(cam(p, 80, k % 30 < 15 ? 1500 : 450), t);
      // answer some, in no particular order
      for (const j of pool.open()) if ((j.msg.x + j.msg.y + k) % 3 === 0) pool.answer(j);
      await tick();
      const s = stream.stats();
      maxAlive = Math.max(maxAlive, s.alive);
      maxLoading = Math.max(maxLoading, s.loading);
    }
    expect(maxAlive).toBeLessThanOrEqual(40);
    expect(maxLoading).toBeLessThanOrEqual(6);
    expect(stream.stats().built).toBeGreaterThan(30);
    expect(stream.stats().recentres).toBeGreaterThanOrEqual(8);
    stream.dispose();
    expect(scene.children).toHaveLength(0);
    expect(stream.materials.slots.available).toBe(63);
  });
});
