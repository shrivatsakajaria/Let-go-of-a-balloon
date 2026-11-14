import { describe, expect, test } from 'vitest';
import * as THREE from 'three';
import { Rope, ROPE_SEGMENTS, ROPE_SEG_M } from '../../src/balloon/rope';
import { Balloon, BALLOON_RADIUS_M, displayScale, squashScale } from '../../src/balloon/balloon';
import type { RoutePoint } from '../../src/flight/route';
import { lightFor } from '../../src/world/palette';

const DAY = lightFor(30);

function point(tSec: number, over: Partial<RoutePoint> = {}): RoutePoint {
  return { tSec, lat: 51.5, lon: -0.12, altM: 1.5 + 1.5 * Math.max(0, tSec), groundM: 0, speedMs: 3, headingDeg: 90, ...over };
}

/** Direction from the knot to the free end. */
function endDir(rope: Rope, out = new THREE.Vector3()): THREE.Vector3 {
  const k = rope.point(0, new THREE.Vector3());
  return rope.point(rope.segments, out).sub(k).normalize();
}

/** Highest point of the string (below the knot) above the knot, m. */
function aboveKnot(rope: Rope): number {
  const k = rope.point(0, new THREE.Vector3()), p = new THREE.Vector3();
  let m = -Infinity;
  for (let i = 1; i <= rope.segments; i++) m = Math.max(m, rope.point(i, p).y - k.y);
  return m;
}

/**
 * Held in the hand in a crosswind, then let go while the knot starts to climb (eased from rest,
 * as the balloon does): the end direction each frame, with the turn since the last frame.
 */
function letGo(hz: number, untilS = 5) {
  const rope = new Rope();
  const top = new THREE.Vector3(0, 2.4, 0);
  const hand = new THREE.Vector3(0.3, 2.4 - 1.12, 0);
  rope.reset(top);
  const air = new THREE.Vector3(1, 0, 0);
  for (let i = 0; i < 2 * hz; i++) rope.step(1 / hz, top, { end: hand, air });
  const out: { t: number; turnDeg: number; above: number }[] = [];
  const prev = endDir(rope);
  const d = new THREE.Vector3();
  let vy = 0;
  for (let t = 0, f = 0; t < untilS; f++) {
    const dt = 1 / hz;
    t += dt;
    // the knot eases up to the climb (critically damped, about 0.7 s), the air going past it down
    const e = Math.exp(-3 * t);
    vy = 1.5 * (1 - e * (1 + 3 * t));
    top.y += vy * dt;
    air.set(0.6, -vy, 0);
    rope.step(dt, top, { air });
    endDir(rope, d);
    out.push({ t, turnDeg: (Math.acos(Math.min(1, Math.max(-1, d.dot(prev)))) * 180) / Math.PI, above: aboveKnot(rope) });
    prev.copy(d);
  }
  return out;
}

describe('rope', () => {
  test('rope keeps segment lengths within 2% after 600 steps of wind', () => {
    const rope = new Rope();
    expect(rope.segments).toBe(20);
    expect(ROPE_SEGMENTS).toBe(20);
    expect(ROPE_SEG_M).toBeCloseTo(0.06, 10);
    const top = new THREE.Vector3(0, 10, 0);
    rope.reset(top);
    const air = new THREE.Vector3();
    const dt = 1 / 60;
    for (let i = 0; i < 600; i++) {
      const t = i * dt;
      // the knot drifts east with the wind and climbs; the air gusts round it (air relative to the knot)
      top.set(8 * t, 10 + 1.5 * t, Math.sin(t * 0.7) * 0.5);
      air.set(4 * Math.sin(t * 2.3), -1.5 + 0.8 * Math.sin(t * 3.1), 3 * Math.cos(t * 1.7));
      rope.step(dt, top, { air });
    }
    const a = new THREE.Vector3(), b = new THREE.Vector3();
    for (let s = 0; s < rope.segments; s++) {
      const L = rope.point(s, a).distanceTo(rope.point(s + 1, b));
      expect(Math.abs(L - ROPE_SEG_M) / ROPE_SEG_M).toBeLessThan(0.02);
    }
    expect(rope.point(0, a).distanceTo(top)).toBeLessThan(1e-9);
    // the free end really moved (it is not a rigid stick under the knot)
    const end = rope.point(rope.segments, a);
    expect(Number.isFinite(end.x + end.y + end.z)).toBe(true);
    expect(end.y).toBeLessThan(top.y);
  });

  test('a pinned end stays exactly on its pin', () => {
    const rope = new Rope();
    const top = new THREE.Vector3(0, 2.4, 0);
    const hand = new THREE.Vector3(0.2, 1.3, 0);
    rope.reset(top);
    for (let i = 0; i < 120; i++) rope.step(1 / 60, top, { end: hand, air: new THREE.Vector3(2, 0, 0) });
    expect(rope.point(rope.segments, new THREE.Vector3()).distanceTo(hand)).toBeLessThan(1e-9);
  });

  test('stays finite on a huge dt, a NaN dt and a teleporting knot', () => {
    const rope = new Rope();
    const top = new THREE.Vector3(0, 10, 0);
    rope.reset(top);
    rope.step(5, top, {});
    rope.step(Number.NaN, top, {});
    top.set(50_000, 1500, -20_000); // floating-origin shift or a jump along the route
    rope.step(1 / 60, top, {});
    const p = new THREE.Vector3();
    for (let i = 0; i <= rope.segments; i++) {
      rope.point(i, p);
      expect(Number.isFinite(p.x + p.y + p.z)).toBe(true);
      expect(p.distanceTo(top)).toBeLessThan(rope.segments * ROPE_SEG_M + 1e-6);
    }
  });

  for (const hz of [30, 120]) {
    test(`let go at ${hz} Hz: the end swings out at most 90 deg/s and settles within 2 s`, () => {
      const run = letGo(hz);
      const worst = Math.max(...run.map((r) => r.turnDeg));
      expect(worst).toBeLessThanOrEqual(90 / hz);
      let settled = 0;
      for (const r of run) if (r.turnDeg * hz > 10) settled = r.t;
      expect(settled).toBeLessThan(2);
      expect(Math.max(...run.map((r) => r.above))).toBeLessThanOrEqual(0);
    });
  }

  test('never above the knot, however the knot moves: stops dead, drops, jerks sideways', () => {
    for (const hz of [30, 120]) {
      const rope = new Rope();
      const top = new THREE.Vector3(0, 10, 0);
      rope.reset(top);
      const dt = 1 / hz;
      let worst = -Infinity;
      for (let t = 0; t < 8; t += dt) {
        // climbing at 3 m/s, then stopped dead at 2 s, dropping at 4 m/s from 4 s, jerked to and fro sideways from 6 s
        const vy = t < 2 ? 3 : t < 4 ? 0 : t < 6 ? -4 : 0;
        const vx = t < 6 ? 0 : 6 * Math.sign(Math.sin(t * 6));
        top.x += vx * dt;
        top.y += vy * dt;
        rope.step(dt, top, { air: new THREE.Vector3(-vx * 0.2, Math.min(0, -vy), 0) });
        worst = Math.max(worst, aboveKnot(rope));
      }
      expect(worst, `${hz} Hz`).toBeLessThanOrEqual(0);
    }
  });

  test('a long frame (a paused or hidden tab) carries the string with the knot instead of flinging it', () => {
    const rope = new Rope();
    const top = new THREE.Vector3(0, 10, 0);
    rope.reset(top);
    const air = new THREE.Vector3(0, -1.5, 0);
    for (let i = 0; i < 300; i++) {
      top.x += 6 / 60;
      top.y += 1.5 / 60;
      rope.step(1 / 60, top, { air });
    }
    const before = endDir(rope);
    for (const gap of [0.25, 1, 5]) {
      top.x += 6 * gap;
      top.y += 1.5 * gap;
      rope.step(gap, top, { air });
      const after = endDir(rope);
      expect((Math.acos(Math.min(1, after.dot(before))) * 180) / Math.PI, `${gap} s`).toBeLessThan(2);
    }
  });

  test('the knot jumping a long way (a floating-origin shift) carries the string as it hangs', () => {
    const rope = new Rope();
    const top = new THREE.Vector3(0, 10, 0);
    rope.reset(top);
    for (let i = 0; i < 300; i++) rope.step(1 / 60, top, { air: new THREE.Vector3(1, -1.5, 0) });
    const before = endDir(rope);
    top.x += 5000;
    rope.step(1 / 60, top, { air: new THREE.Vector3(1, -1.5, 0) });
    expect(endDir(rope).dot(before)).toBeGreaterThan(Math.cos(1 * (Math.PI / 180)));
  });
});

describe('displayScale', () => {
  test('displayScale is 1 at 5 m and <= 40 at 3000 m', () => {
    expect(displayScale(5)).toBe(1);
    expect(displayScale(3000)).toBeLessThanOrEqual(40);
    expect(displayScale(3000)).toBeGreaterThan(30);
  });

  test('1 up to 20 m, 40 from 2 km, monotonic and continuous in between', () => {
    expect(displayScale(0)).toBe(1);
    expect(displayScale(20)).toBe(1);
    expect(displayScale(2000)).toBeCloseTo(40, 9);
    expect(displayScale(1e7)).toBe(40);
    let prev = displayScale(0);
    for (let d = 0.5; d <= 4000; d += 0.5) {
      const s = displayScale(d);
      expect(s).toBeGreaterThanOrEqual(prev);
      expect(s - prev).toBeLessThan(0.05); // no jumps anywhere on the curve
      prev = s;
    }
    // continuous at the joins
    expect(displayScale(20.001) - 1).toBeLessThan(1e-6);
    expect(40 - displayScale(1999.99)).toBeLessThan(1e-4);
  });

  test('stays near real size at street level and never building-sized', () => {
    // the launch camera stays within ~30 m: the balloon is (almost) its real 30 cm
    expect(displayScale(30)).toBeLessThan(1.1);
    expect(displayScale(40)).toBeLessThan(1.3);
    // displayed diameter stays far below a storey (~3 m) up to 100 m away
    expect(2 * BALLOON_RADIUS_M * displayScale(100)).toBeLessThan(1);
  });

  test('handles bad input', () => {
    expect(displayScale(-10)).toBe(1);
    expect(displayScale(Number.NaN)).toBe(1);
    expect(displayScale(Infinity)).toBe(40);
  });
});

describe('squash and stretch', () => {
  test('squashScale preserves volume within 2%', () => {
    for (let s = -0.3; s <= 0.3; s += 0.01) {
      const k = squashScale(s);
      expect(Math.abs(k.xz * k.xz * k.y - 1)).toBeLessThan(0.02);
      expect(k.y).toBeCloseTo(1 + s, 9);
    }
  });

  test('the balloon squashes on release with its volume preserved, and the scale is the camera scale', () => {
    const scene = new THREE.Scene();
    const b = new Balloon(scene);
    const cam = new THREE.Vector3(3, 1.6, 4);
    const hand = new THREE.Vector3(0.25, 1.0, 0);
    const pos = new THREE.Vector3(0, 1.5, 0);
    b.hold(hand);
    for (let i = 0; i < 60; i++) b.setState(point(0), 1 / 60, DAY, { pos, camera: cam });
    b.release();
    let minY = Infinity;
    for (let i = 1; i <= 30; i++) {
      const t = i / 60;
      pos.set(0, 1.5 + 1.5 * t, 0);
      b.setState(point(t), 1 / 60, DAY, { pos, camera: cam });
      const sc = b.body.scale;
      const s = b.scale * BALLOON_RADIUS_M;
      expect(Math.abs((sc.x * sc.y * sc.z) / (s * s * s) - 1)).toBeLessThan(0.02);
      if (t <= 0.12) minY = Math.min(minY, sc.y / s);
    }
    expect(minY).toBeLessThan(0.95); // a visible squash within the first 120 ms
    expect(b.scale).toBe(displayScale(b.mesh.position.distanceTo(cam)));
  });
});

describe('balloon on its string', () => {
  test('rope end is pinned to the hand during the hold and free after release', () => {
    const scene = new THREE.Scene();
    const b = new Balloon(scene);
    const hand = new THREE.Vector3(0.25, 1.0, 0);
    const pos = new THREE.Vector3(0, 1.5, 0);
    const cam = new THREE.Vector3(3, 1.6, 4);
    const end = new THREE.Vector3();
    b.hold(hand);
    for (let i = 0; i < 90; i++) {
      hand.x = 0.25 + 0.02 * Math.sin(i / 10); // the hand sways a little
      b.setState(point(0), 1 / 60, DAY, { pos, camera: cam });
      expect(b.stringPoint(b.rope.segments, end).distanceTo(hand)).toBeLessThan(1e-9);
    }
    // held above the hand, roughly a string's length up
    expect(b.mesh.position.y - hand.y).toBeGreaterThan(1.0);
    expect(b.mesh.position.y - hand.y).toBeLessThan(1.6);
    b.release();
    for (let i = 1; i <= 120; i++) {
      const t = i / 60;
      pos.set(0.5 * t, 1.5 + 1.5 * t, 0);
      b.setState(point(t), 1 / 60, DAY, { pos, camera: cam });
    }
    b.stringPoint(b.rope.segments, end);
    expect(end.distanceTo(hand)).toBeGreaterThan(1);
    expect(end.y).toBeGreaterThan(hand.y + 1); // it went up with the balloon
  });

  test('the held string stays at least about a pixel wide from the start camera, so the balloon never looks loose from the hand', () => {
    const scene = new THREE.Scene();
    const b = new Balloon(scene);
    const hand = new THREE.Vector3(0.25, 1.0, 0);
    const pos = new THREE.Vector3(0, 1.5, 0);
    for (const far of [3, 15, 25]) {
      const cam = new THREE.Vector3(0, 1.6, far);
      b.hold(hand);
      for (let i = 0; i < 30; i++) b.setState(point(0), 1 / 60, DAY, { pos, camera: cam });
      const ribbon = b.root.children.find((o) => o instanceof THREE.Mesh && (o.material as THREE.MeshBasicMaterial).side === THREE.DoubleSide) as THREE.Mesh;
      const p = ribbon.geometry.getAttribute('position');
      for (let j = 0; j < p.count; j += 2) {
        const a = new THREE.Vector3().fromBufferAttribute(p, j), c = new THREE.Vector3().fromBufferAttribute(p, j + 1);
        const mid = a.clone().add(c).multiplyScalar(0.5);
        // a phone 844 px tall with a 40-50 deg view: a pixel is about 1 mrad
        expect(a.distanceTo(c) / mid.distanceTo(cam), `${far} m`).toBeGreaterThan(0.0011);
      }
    }
  });

  test('after release the balloon rises without dipping and settles onto the given position', () => {
    const scene = new THREE.Scene();
    const b = new Balloon(scene);
    const hand = new THREE.Vector3(0.25, 1.0, 0);
    const pos = new THREE.Vector3(0, 1.5, 0);
    const cam = new THREE.Vector3(3, 1.6, 4);
    b.hold(hand);
    for (let i = 0; i < 30; i++) b.setState(point(0), 1 / 60, DAY, { pos, camera: cam });
    b.release();
    let prevY = b.mesh.position.y;
    for (let i = 1; i <= 300; i++) {
      const t = i / 60;
      pos.set(0, 1.5 + 1.5 * t, 0);
      b.setState(point(t), 1 / 60, DAY, { pos, camera: cam });
      expect(b.mesh.position.y).toBeGreaterThanOrEqual(prevY - 1e-9);
      prevY = b.mesh.position.y;
    }
    expect(b.mesh.position.distanceTo(pos)).toBeLessThan(0.02);
  });

  test('leans toward the heading, more with speed, capped', () => {
    const tilt = (speedMs: number) => {
      const b = new Balloon(new THREE.Scene(), { reducedMotion: true });
      const pos = new THREE.Vector3(0, 500, 0);
      for (let i = 0; i < 600; i++) b.setState(point(100, { altM: 500, speedMs, headingDeg: 90 }), 1 / 60, DAY, { pos, camera: new THREE.Vector3(0, 500, 10) });
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(b.mesh.quaternion);
      return up;
    };
    const slow = tilt(2), fast = tilt(15), gale = tilt(80);
    expect(fast.x).toBeGreaterThan(slow.x); // east = +x
    expect(fast.x).toBeGreaterThan(0.05);
    expect(Math.acos(gale.y)).toBeLessThan(0.3); // capped well short of lying flat
  });

  test('night adds a faint emissive lift; the shadow fades with height and at night', () => {
    const b = new Balloon(new THREE.Scene());
    const cam = new THREE.Vector3(0, 2, 10);
    const run = (alt: number, light = DAY) => {
      const pos = new THREE.Vector3(0, alt, 0);
      b.setState(point(100, { altM: alt }), 1 / 60, light, { pos, camera: cam });
      return b.shadowOpacity;
    };
    const low = run(3), high = run(800), night = run(3, lightFor(-30));
    expect(low).toBeGreaterThan(high);
    expect(high).toBeGreaterThan(0);
    expect(night).toBeLessThan(low * 0.1);
    expect(b.material.emissiveIntensity).toBeCloseTo(0.06 + 0.32, 6);
    run(3);
    expect(b.material.emissiveIntensity).toBeCloseTo(0.06, 6);
    expect(b.shadow.position.y).toBeCloseTo(0.0, 1); // straight down onto groundM
  });

  test('dispose removes everything from the scene', () => {
    const scene = new THREE.Scene();
    const b = new Balloon(scene);
    expect(scene.children.length).toBeGreaterThan(0);
    b.dispose();
    expect(scene.children.length).toBe(0);
  });
});
