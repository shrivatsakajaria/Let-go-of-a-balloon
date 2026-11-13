import { describe, expect, test } from 'vitest';
import * as THREE from 'three';
import { Person, HOLD_S, MAX_HOLD_S, PERSON_HEIGHT_M } from '../../src/balloon/person';

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
    const box = new THREE.Box3().setFromObject(p.root);
    expect(box.max.y - box.min.y).toBeGreaterThan(1.62);
    expect(box.max.y - box.min.y).toBeLessThan(1.82);
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
    // idle: the hand is at about hip height and moves a little, never a lot
    const span = Math.max(...handYs) - Math.min(...handYs);
    expect(span).toBeGreaterThan(1e-4);
    expect(span).toBeLessThan(0.05);
    expect(hand.y).toBeGreaterThan(0.8);
    expect(hand.y).toBeLessThan(1.3);
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

  test('head, hands and hair are a neutral non-skin tone: no identifying detail', () => {
    const { p } = mk();
    const hsl = { h: 0, s: 0, l: 0 };
    let n = 0;
    p.root.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const m = o.material as THREE.MeshStandardMaterial;
      m.color.getHSL(hsl, THREE.SRGBColorSpace);
      expect(hsl.s).toBeLessThan(0.15); // greys and slates only, nothing that reads as a skin or hair colour
      n++;
    });
    expect(n).toBeGreaterThan(8);
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
