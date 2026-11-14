import { describe, expect, test } from 'vitest';
import * as THREE from 'three';
import { Person, HOLD_S, MAX_HOLD_S, PERSON_HEIGHT_M } from '../../src/balloon/person';
import { OUTFITS, outfitFor } from '../../src/balloon/figure';
import { SLIP_FROM_S, SLIP_S } from '../../src/balloon/gesture';

const AT = { lat: 51.5007, lon: -0.1246 };
const DT = 1 / 60;
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

function mk() {
  const scene = new THREE.Scene();
  const p = new Person(scene, AT, 0, new THREE.Vector3(0, 0, 0));
  return { scene, p };
}

/** Advance in frames; returns the times at which onRelease fired. */
async function runFor(p: Person, seconds: number, calls: number[], clock: { t: number }) {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    p.update(DT);
    clock.t += DT;
    if (i % 6 === 0) await flush(); // let promise callbacks land between frames
  }
  void calls;
}

describe('person', () => {
  test('is about 1.7 m tall, anonymous and stands at its feet', () => {
    const { p } = mk();
    p.update(0);
    const box = new THREE.Box3().setFromObject(p.root, true);
    expect(box.max.y - box.min.y).toBeGreaterThan(1.62);
    expect(box.max.y - box.min.y).toBeLessThan(1.85); // to the top of a hat
    expect(Math.abs(box.min.y)).toBeLessThan(0.03);
    expect(PERSON_HEIGHT_M).toBeCloseTo(1.7, 1);
    expect(p.at).toEqual(AT);
  });

  test('faces its compass heading (90 deg = east = +x)', () => {
    const scene = new THREE.Scene();
    const p = new Person(scene, AT, 90, new THREE.Vector3(0, 0, 0));
    p.update(0);
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(p.root.quaternion);
    expect(fwd.x).toBeCloseTo(1, 6);
  });

  test('fires onRelease exactly once at 1.2 s', async () => {
    const { p } = mk();
    const fired: number[] = [];
    const clock = { t: 0 };
    p.play(() => fired.push(clock.t + DT));
    await runFor(p, 5, fired, clock);
    expect(fired.length).toBe(1);
    expect(fired[0]).toBeGreaterThanOrEqual(HOLD_S - 1e-9);
    expect(fired[0]).toBeLessThan(HOLD_S + DT + 1e-9);
    expect(p.state).toBe('released');
    expect(p.timedOut).toBe(false);
  });

  test('waits for the route when it is late, then releases once', async () => {
    const { p } = mk();
    const fired: number[] = [];
    const clock = { t: 0 };
    let ready!: () => void;
    const readyAt = new Promise<void>((r) => (ready = r));
    p.play(() => fired.push(clock.t), { readyAt });
    await runFor(p, 3, fired, clock);
    expect(fired.length).toBe(0);
    expect(p.state).toBe('holding');
    ready();
    await flush();
    await runFor(p, 2, fired, clock);
    expect(fired.length).toBe(1);
    expect(fired[0]).toBeGreaterThan(2.9);
    expect(fired[0]).toBeLessThan(3.2);
  });

  test('never releases after 6 s: times out instead', async () => {
    const { p } = mk();
    const fired: number[] = [];
    let timeouts = 0;
    const clock = { t: 0 };
    let ready!: () => void;
    const readyAt = new Promise<void>((r) => (ready = r));
    p.play(() => fired.push(clock.t), { readyAt, onTimeout: () => timeouts++ });
    await runFor(p, MAX_HOLD_S + 0.1, fired, clock);
    expect(p.timedOut).toBe(true);
    expect(p.state).toBe('timedOut');
    expect(timeouts).toBe(1);
    ready();
    await flush();
    await runFor(p, 2, fired, clock);
    expect(fired.length).toBe(0);
    expect(timeouts).toBe(1);
  });

  test('with the wait left to the caller (holdS), keeps holding past 6 s and lets go when the route comes', async () => {
    const { p } = mk();
    const fired: number[] = [];
    let timeouts = 0;
    const clock = { t: 0 };
    let ready!: () => void;
    const readyAt = new Promise<void>((r) => (ready = r));
    p.play(() => fired.push(clock.t), { readyAt, onTimeout: () => timeouts++, holdS: Infinity });
    await runFor(p, MAX_HOLD_S + 4, fired, clock);
    expect(p.state).toBe('holding');
    expect(timeouts).toBe(0);
    ready();
    await flush();
    await runFor(p, 0.2, fired, clock);
    expect(p.state).toBe('released');
    expect(fired.length).toBe(1);
  });

  test('on a real clock (now), the hand opens at 1.2 s of real time: at 1 fps with the route ready it lets go on the second frame', async () => {
    const { p } = mk();
    let ms = 0;
    const fired: number[] = [];
    let timeouts = 0;
    p.play(() => fired.push(ms), { readyAt: Promise.resolve(), onTimeout: () => timeouts++, holdS: Infinity, now: () => ms });
    await flush();
    // one frame a second (the person's frame time is capped at 0.1 s a frame)
    for (let f = 0; f < 3 && p.state === 'holding'; f++) {
      ms += 1000;
      p.update(1);
      await flush();
    }
    expect(p.state).toBe('released');
    expect(fired).toEqual([2000]);
    expect(timeouts).toBe(0);
  });

  test('on a real clock, a route that never comes times out at holdS of real time, not of frame time', async () => {
    const { p } = mk();
    let ms = 0;
    let timeouts = 0;
    p.play(() => {}, { readyAt: new Promise<void>(() => {}), onTimeout: () => timeouts++, now: () => ms });
    for (let f = 0; f < 7; f++) {
      ms += 1000;
      p.update(1);
      await flush();
    }
    expect(timeouts).toBe(1);
    expect(p.timedOut).toBe(true);
  });

  test('a failed route times out at once', async () => {
    const { p } = mk();
    const fired: number[] = [];
    const clock = { t: 0 };
    p.play(() => fired.push(clock.t), { readyAt: Promise.reject(new Error('no wind')) });
    await flush();
    await runFor(p, 1, fired, clock);
    expect(p.timedOut).toBe(true);
    expect(fired.length).toBe(0);
  });

  test('keeps holding with an idle sway, then looks up and half-raises an arm after release', async () => {
    const { p } = mk();
    const clock = { t: 0 };
    const hand = new THREE.Vector3();
    const handYs: number[] = [];
    for (let i = 0; i < 120; i++) {
      p.update(DT);
      handYs.push(p.handPosition(hand).y);
    }
    // idle: the string held at about chest height, in front; the hand moves a little, never a lot
    const span = Math.max(...handYs) - Math.min(...handYs);
    expect(span).toBeGreaterThan(1e-4);
    expect(span).toBeLessThan(0.05);
    expect(hand.y).toBeGreaterThan(1.15);
    expect(hand.y).toBeLessThan(1.45);
    expect(hand.z).toBeLessThan(-0.2); // in front of the body (it faces -z)
    const head0 = p.headPitch;
    p.play(() => {});
    await runFor(p, 4, [], clock);
    expect(p.headPitch).toBeGreaterThan(head0 + 0.4); // looking up (radians, chin up)
    expect(p.handPosition(hand).y).toBeGreaterThan(1.35); // arm raised toward the balloon
  });

  test('holdIdle returns to holding; dispose removes it', () => {
    const { scene, p } = mk();
    p.play(() => {});
    for (let i = 0; i < 200; i++) p.update(DT);
    p.holdIdle();
    expect(p.state).toBe('idle');
    p.dispose();
    expect(scene.children.length).toBe(0);
  });

  test('one of four warm outfits, chosen from the place: the same place always gets the same person', () => {
    expect(OUTFITS.length).toBe(4);
    const places = [AT, { lat: 48.8584, lon: 2.2945 }, { lat: 40.7128, lon: -74.006 }, { lat: 53.4794, lon: -2.2453 }, { lat: -22.9519, lon: -43.2105 }, { lat: 41.4036, lon: 2.1744 }, { lat: 25.1972, lon: 55.2744 }, { lat: 51.4545, lon: -2.5879 }];
    const seen = new Set<number>();
    for (const at of places) {
      const i = outfitFor(at);
      expect(outfitFor({ ...at })).toBe(i);
      expect(new Person(new THREE.Scene(), at, 0).outfit).toBe(i);
      seen.add(i);
    }
    expect(seen.size).toBeGreaterThanOrEqual(3);
    expect(new Person(new THREE.Scene(), AT, 0, undefined, { outfit: 2 }).outfit).toBe(2);
  });

  test('the balloon stays the one bright thing: every colour on the person is far below its chroma, and the coats are warm', () => {
    const hsl = { h: 0, s: 0, l: 0 };
    const chroma = (hex: string) => {
      new THREE.Color(hex).getHSL(hsl, THREE.SRGBColorSpace);
      return (1 - Math.abs(2 * hsl.l - 1)) * hsl.s;
    };
    const balloon = chroma('#ff5a12');
    expect(balloon).toBeGreaterThan(0.9);
    for (const o of OUTFITS) {
      for (const k of ['coat', 'trim', 'scarf', 'trousers', 'shoes', 'skin', 'hair', 'hat'] as const) {
        expect(chroma(o[k]), `${o.name} ${k}`).toBeLessThan(0.36);
      }
      new THREE.Color(o.coat).getHSL(hsl, THREE.SRGBColorSpace);
      const warm = hsl.h < 50 / 360 || hsl.h > 320 / 360;
      expect(warm, `${o.name} coat`).toBe(true);
      // the scarf contrasts with the coat (in hue or in lightness)
      const c = new THREE.Color(o.coat).getHSL({ h: 0, s: 0, l: 0 }, THREE.SRGBColorSpace);
      const f = new THREE.Color(o.scarf).getHSL({ h: 0, s: 0, l: 0 }, THREE.SRGBColorSpace);
      const dh = Math.min(Math.abs(c.h - f.h), 1 - Math.abs(c.h - f.h));
      expect(dh > 0.2 || Math.abs(c.l - f.l) > 0.25, `${o.name} scarf`).toBe(true);
    }
  });

  test('cheap: one draw call and under about 3,000 triangles', () => {
    for (let i = 0; i < OUTFITS.length; i++) {
      const p = new Person(new THREE.Scene(), AT, 0, undefined, { outfit: i });
      let meshes = 0;
      p.root.traverse((o) => {
        if (o instanceof THREE.Mesh) meshes++;
      });
      expect(meshes).toBe(1);
      expect(p.triangles).toBeLessThan(3200);
    }
  });

  test('the grip: releaseT is 0 while held, runs 0 to 1 as the string slips out of the opening hand, then stays 1', async () => {
    const { p } = mk();
    for (let i = 0; i < 30; i++) p.update(DT);
    expect(p.releaseT).toBe(0);
    let releasedAt = -1;
    let t = 0;
    p.play(() => (releasedAt = t + DT));
    const samples: { t: number; r: number; hand: THREE.Vector3 }[] = [];
    for (let i = 0; i < Math.round(3 / DT); i++) {
      p.update(DT);
      t += DT;
      samples.push({ t, r: p.releaseT, hand: p.hand.clone() });
      if (releasedAt < 0) expect(p.releaseT).toBe(0);
    }
    expect(releasedAt).toBeGreaterThan(0);
    const after = (s: number) => samples.find((x) => x.t >= releasedAt + s - 1e-9)!;
    expect(after(SLIP_FROM_S * 0.5).r).toBe(0);
    expect(after(SLIP_FROM_S + SLIP_S * 0.5).r).toBeGreaterThan(0.2);
    expect(after(SLIP_FROM_S + SLIP_S * 0.5).r).toBeLessThan(0.8);
    expect(after(SLIP_FROM_S + SLIP_S + 0.02).r).toBe(1);
    expect(samples[samples.length - 1].r).toBe(1);
    // the end travels out of the fist, not a jump: a few centimetres over the slip, smoothly
    let worst = 0;
    for (let i = 1; i < samples.length; i++) worst = Math.max(worst, samples[i].hand.distanceTo(samples[i - 1].hand));
    expect(worst).toBeLessThan(0.03); // m per 60 Hz frame
    const slipStart = after(SLIP_FROM_S).hand, slipEnd = after(SLIP_FROM_S + SLIP_S).hand;
    expect(slipStart.distanceTo(slipEnd)).toBeGreaterThan(0.04);
  });

  test('the grip point is in the closed fist on the start screen and moves with the hand, every frame', () => {
    const { p } = mk();
    p.update(DT);
    const a = p.hand.clone();
    p.place({ x: 10, y: 2, z: -5 });
    expect(p.hand.x - a.x).toBeCloseTo(10, 6);
    expect(p.hand.y - a.y).toBeCloseTo(2, 6);
    const r = p.handPosition(new THREE.Vector3());
    expect(r.equals(p.hand)).toBe(true);
  });

  test('a launch called off eases back to holding: no snap from the anticipation', async () => {
    const { p } = mk();
    p.play(() => {}, { readyAt: new Promise<void>(() => {}), holdS: Infinity });
    for (let i = 0; i < 70; i++) p.update(DT);
    const before = p.hand.clone();
    p.holdIdle();
    p.update(DT);
    expect(p.hand.distanceTo(before)).toBeLessThan(0.01);
    for (let i = 0; i < 60; i++) p.update(DT);
    expect(p.state).toBe('idle');
  });

  test('dispose cancels the launch: a late route never releases', async () => {
    const { p } = mk();
    let fired = 0, timeouts = 0;
    let ready!: () => void;
    const readyAt = new Promise<void>((r) => (ready = r));
    p.play(() => fired++, { readyAt, onTimeout: () => timeouts++ });
    for (let i = 0; i < 60; i++) p.update(DT);
    p.dispose();
    expect(p.state).toBe('idle');
    ready();
    await flush();
    for (let i = 0; i < 600; i++) p.update(DT);
    await flush();
    expect(fired).toBe(0);
    expect(timeouts).toBe(0);
    expect(p.state).toBe('idle');
  });
});
