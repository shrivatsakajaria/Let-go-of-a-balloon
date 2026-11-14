import { describe, expect, test } from 'vitest';
import * as THREE from 'three';
import { Balloon } from '../../src/balloon/balloon';
import type { RoutePoint } from '../../src/flight/route';
import { lightFor } from '../../src/world/palette';

/**
 * The balloon's string as drawn (Task 26c): an art-directed string, not a simulation. It hangs in a
 * gentle curve under the knot, leaning slowly with the air going past and swaying a little, and the
 * let-go is one eased move from the hand to hanging. Measured on the drawn tip (its direction from the
 * knot) through scripted flights: the release, a scale change, a stall, cuts, a gust and jittered frames.
 */
const DAY = lightFor(30);
const RAD = Math.PI / 180;

/** The limits the drawn tip keeps: how fast it turns (deg/s) and how fast that turning changes (deg/s/s). */
const MAX_TURN_DEG_S = 30;
const MAX_TURN_ACCEL_DEG_S2 = 90;

type Frame = { t: number; e: number; dir: THREE.Vector3; aboveM: number; scale: number; tipRel: THREE.Vector3; held: boolean };

/** The direction from the drawn knot to the drawn tip, the highest point above the knot, and the tip in real metres from the knot. */
function sample(b: Balloon, t: number, e: number, held: boolean): Frame {
  const knot = b.stringPoint(0, new THREE.Vector3()), p = new THREE.Vector3();
  let above = -Infinity;
  for (let i = 1; i <= b.stringSegments; i++) above = Math.max(above, b.stringPoint(i, p).y - knot.y);
  const tip = b.stringPoint(b.stringSegments, new THREE.Vector3()).sub(knot);
  return { t, e, dir: tip.clone().normalize(), aboveM: above, scale: b.scale, tipRel: tip.divideScalar(b.scale), held };
}

/**
 * How fast the tip turns each frame (deg/s, over the time that really went by) and how fast that changes
 * (deg/s/s, the turning as a vector, so a change of direction counts too). From frame `from` on.
 */
function turning(run: Frame[], fromT = -Infinity) {
  let w = 0, a = 0, wAt = 0, aAt = 0;
  let prevW: THREE.Vector3 | null = null, prevE = 0;
  for (let i = 1; i < run.length; i++) {
    const r = run[i], q = run[i - 1];
    if (!(r.e > 0)) continue;
    const ang = Math.acos(Math.min(1, Math.max(-1, r.dir.dot(q.dir))));
    const axis = new THREE.Vector3().crossVectors(q.dir, r.dir);
    const wv = axis.lengthSq() > 1e-18 ? axis.normalize().multiplyScalar(ang / RAD / r.e) : new THREE.Vector3();
    if (r.t >= fromT) {
      if (wv.length() > w) [w, wAt] = [wv.length(), r.t];
      if (prevW) {
        const acc = wv.distanceTo(prevW) / ((r.e + prevE) / 2);
        if (acc > a) [a, aAt] = [acc, r.t];
      }
    }
    prevW = wv;
    prevE = r.e;
  }
  return { w, a, wAt, aAt };
}

type Script = { hz: number; untilS: number; quiet?: boolean; jitterMs?: number; stallAt?: number; stallS?: number; wind?: number };

/**
 * Held for 2 s in a wind, let go at t = 0, climbing and drifting. Unless quiet: the camera pulls out to 400 m
 * (the display scale ramps) and cuts in and out, a crosswind gust, a paused tab's long frame (the scene's
 * frame capped at 0.25 s while the route runs on by the clock) and a floating-origin shift.
 */
function fly({ hz, untilS, quiet, jitterMs = 0, stallAt = 15, stallS = 1.5, wind = 6 }: Script): Frame[] {
  const b = new Balloon(new THREE.Scene());
  const hand = new THREE.Vector3(0.25, 1.0, 0);
  const pos = new THREE.Vector3(0, 1.5, 0);
  const cam = new THREE.Vector3(3, 1.6, 4);
  const out: Frame[] = [];
  let t = -2;
  let released = false;
  let sp = wind, hd = 70;
  let seed = 3;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const shift = new THREE.Vector3();
  b.hold(hand);
  for (let f = 0; t < untilS; f++) {
    let dt = 1 / hz + (jitterMs ? ((rnd() - 0.5) * jitterMs) / 1000 : 0);
    let e = dt;
    if (!quiet && t < stallAt && t + dt >= stallAt) {
      dt = 0.25;
      e = stallS;
    }
    t += e;
    if (!released && t >= 0) {
      b.release();
      released = true;
    }
    const tr = Math.max(0, t);
    if (!quiet) {
      const g = t > 9 && t < 11 ? Math.sin(((t - 9) / 2) * Math.PI) : 0;
      hd = 70 + 40 * g;
      sp = wind + 3 * g;
      if (t >= 16 && shift.x === 0) {
        shift.set(-5000, 0, 3000);
        pos.add(shift);
      }
    }
    if (released) {
      pos.x += Math.sin(hd * RAD) * sp * e;
      pos.z -= Math.cos(hd * RAD) * sp * e;
      pos.y = 1.5 + 1.5 * tr;
    }
    let d = 3;
    if (!quiet) {
      if (t > 4) d = 3 + 397 * Math.min(1, (t - 4) / 2);
      if (t > 7) d = 5;
      if (t > 12) d = 800;
      if (t > 14) d = 5;
    }
    if (released) cam.set(pos.x - d * 0.6, pos.y - d * 0.2, pos.z + d * 0.77);
    const pt: RoutePoint = { tSec: tr, lat: 51.5, lon: -0.12, altM: 1.5 + 1.5 * tr, groundM: 0, speedMs: sp, headingDeg: hd };
    b.setState(pt, dt, DAY, { pos, camera: cam, elapsedS: e });
    out.push(sample(b, t, e, !released));
  }
  return out;
}

describe('the string, through a scripted flight', () => {
  for (const [name, s] of [
    ['30 Hz', { hz: 30 }],
    ['120 Hz', { hz: 120 }],
    ['60 Hz with 4 ms of jitter', { hz: 60, jitterMs: 4 }],
    ['144 Hz with 1 ms of jitter', { hz: 144, jitterMs: 1 }],
  ] as [string, Partial<Script>][]) {
    test(`${name}: no point of the string ever rises above the knot`, () => {
      const run = fly({ hz: 60, untilS: 18, ...s });
      const worst = run.reduce((a, r) => (r.aboveM > a.aboveM ? r : a));
      expect(worst.aboveM, `at t=${worst.t.toFixed(2)} s`).toBeLessThan(0);
    });

    test(`${name}: the tip turns at most ${MAX_TURN_DEG_S} deg/s and its turning changes at most ${MAX_TURN_ACCEL_DEG_S2} deg/s/s, through the release, the zoom and cuts, the gust, the stall and the origin shift`, () => {
      const run = fly({ hz: 60, untilS: 18, ...s });
      const r = turning(run, -1.9);
      expect(r.w, `at t=${r.wAt.toFixed(2)} s`).toBeLessThanOrEqual(MAX_TURN_DEG_S);
      expect(r.a, `at t=${r.aAt.toFixed(2)} s`).toBeLessThanOrEqual(MAX_TURN_ACCEL_DEG_S2);
    });
  }

  test('a 4 s stall (a hidden tab) and a 10 s one: the string is not flung, it turns no faster than the limit', () => {
    for (const stallS of [4, 10]) {
      const run = fly({ hz: 60, untilS: 25, stallS });
      const r = turning(run, -1.9);
      expect(r.w, `${stallS} s`).toBeLessThanOrEqual(MAX_TURN_DEG_S);
      expect(r.a, `${stallS} s`).toBeLessThanOrEqual(MAX_TURN_ACCEL_DEG_S2);
      expect(Math.max(...run.map((f) => f.aboveM))).toBeLessThan(0);
    }
  });

  test('the let-go is one eased move: the end leaves the hand and hangs within 1.6 s, never swinging back more than 2 deg', () => {
    for (const hz of [30, 60, 120]) {
      for (const wind of [0.5, 3, 9]) {
        const run = fly({ hz, untilS: 4, quiet: true, wind });
        const at = (t: number) => run.find((r) => r.t >= t - 1e-9)!;
        const end = at(1.6);
        // from 1.6 s on it hangs: a gentle drift at most (under 10 deg/s), its length that of a hanging string
        expect(turning(run, 1.6).w, `${hz} Hz ${wind} m/s`).toBeLessThan(10);
        const len = run.filter((r) => r.t >= 1.6).map((r) => r.tipRel.length());
        expect(Math.max(...len) - Math.min(...len), `${hz} Hz ${wind} m/s length`).toBeLessThan(0.01);
        // on the way, the angle to where it ends up only closes: any swing back is under 2 deg
        let best = Infinity, back = 0;
        for (const r of run) {
          if (r.t < 0 || r.t > 1.6) continue;
          const off = Math.acos(Math.min(1, r.dir.dot(end.dir))) / RAD;
          best = Math.min(best, off);
          back = Math.max(back, off - best);
        }
        expect(back, `${hz} Hz ${wind} m/s`).toBeLessThan(2);
      }
    }
  });

  test('the string hangs the same at 4, 30 and 120 Hz (within 2 deg, and a frame of turning more through the let-go: the hand opens between frames), the let-go included', () => {
    const a = fly({ hz: 120, untilS: 18 });
    for (const hz of [4, 30]) {
      const b = fly({ hz, untilS: 18 });
      for (const t of [0.5, 1, 1.5, 3, 8, 10, 13, 17.5]) {
        const ra = a.find((r) => r.t >= t - 1e-9)!, rb = b.find((r) => r.t >= t - 1e-9)!;
        // compared at the same moment (the frames fall at different times): the nearer sample of each
        const ta = ra.t, tb = rb.t;
        if (Math.abs(ta - tb) > 0.2) continue;
        const slack = t <= 3.5 ? MAX_TURN_DEG_S / hz : 0;
        expect(Math.acos(Math.min(1, ra.dir.dot(rb.dir))) / RAD, `${hz} Hz t=${t}`).toBeLessThan(2 + slack + MAX_TURN_DEG_S * Math.abs(ta - tb));
      }
    }
  });

  test('while held the string runs from the knot to the hand, wherever the hand goes', () => {
    const b = new Balloon(new THREE.Scene());
    const hand = new THREE.Vector3(0.25, 1.0, 0);
    const pos = new THREE.Vector3(0, 1.5, 0);
    const cam = new THREE.Vector3(3, 1.6, 4);
    const end = new THREE.Vector3();
    b.hold(hand);
    for (let i = 0; i < 120; i++) {
      hand.set(0.25 + 0.1 * Math.sin(i / 10), 1.0 + 0.2 * Math.sin(i / 17), 0.05 * Math.cos(i / 13)); // the arm moves
      b.setState({ tSec: 0, lat: 51.5, lon: -0.12, altM: 1.5, groundM: 0, speedMs: 4, headingDeg: 90 }, 1 / 60, DAY, { pos, camera: cam });
      expect(b.stringPoint(b.stringSegments, end).distanceTo(hand)).toBeLessThan(1e-6);
      const knot = b.stringPoint(0, new THREE.Vector3());
      expect(knot.y).toBeGreaterThan(hand.y + 0.8); // the balloon floats over the hand
    }
  });

  test('the let-go starts from the hand where it is as it opens: the tip does not jump', () => {
    const b = new Balloon(new THREE.Scene());
    const hand = new THREE.Vector3(0.3, 1.1, 0.1);
    const pos = new THREE.Vector3(0, 1.5, 0);
    const cam = new THREE.Vector3(3, 1.6, 4);
    b.hold(hand);
    const pt = (t: number): RoutePoint => ({ tSec: t, lat: 51.5, lon: -0.12, altM: 1.5 + 1.5 * t, groundM: 0, speedMs: 4, headingDeg: 90 });
    for (let i = 0; i < 60; i++) b.setState(pt(0), 1 / 60, DAY, { pos, camera: cam });
    const before = b.stringPoint(b.stringSegments, new THREE.Vector3());
    b.release();
    pos.y += 1.5 / 60;
    b.setState(pt(1 / 60), 1 / 60, DAY, { pos, camera: cam });
    const after = b.stringPoint(b.stringSegments, new THREE.Vector3());
    expect(after.distanceTo(before)).toBeLessThan(0.02); // at rest as the hand opens, a hand's width in a second at most
  });

  test('the display scale only magnifies the string about the knot: its shape is the same near and far', () => {
    const shape = (far: number) => {
      const b = new Balloon(new THREE.Scene());
      const pos = new THREE.Vector3(0, 100, 0);
      const cam = new THREE.Vector3();
      const knot = new THREE.Vector3(), p = new THREE.Vector3();
      for (let i = 0; i < 300; i++) {
        const t = i / 60;
        pos.set(6 * t, 100 + 1.5 * t, 0);
        cam.set(pos.x, pos.y, pos.z + far);
        b.setState({ tSec: 60 + t, lat: 51.5, lon: -0.12, altM: pos.y, groundM: 0, speedMs: 6, headingDeg: 90 }, 1 / 60, DAY, { pos, camera: cam });
      }
      b.stringPoint(0, knot);
      const pts = Array.from({ length: b.stringSegments + 1 }, (_, i) => b.stringPoint(i, p).clone().sub(knot).divideScalar(b.scale));
      return { pts, scale: b.scale };
    };
    const near = shape(5), far = shape(600);
    expect(far.scale).toBeGreaterThan(10 * near.scale);
    for (let i = 0; i < near.pts.length; i++) expect(near.pts[i].distanceTo(far.pts[i])).toBeLessThan(0.01);
  });

  test('a crosswind past the knot leans the string gently downwind (a few degrees to about 20), never more than 30 deg', () => {
    const lean = (cross: number) => {
      const b = new Balloon(new THREE.Scene());
      const pos = new THREE.Vector3(0, 100, 0), cam = new THREE.Vector3();
      for (let i = 0; i < 600; i++) {
        const t = i / 60;
        // the route says the wind blows north at `cross` m/s, but the drawn balloon stands still (held at a wall)
        cam.set(pos.x - 5, pos.y, pos.z);
        b.setState({ tSec: 60 + t, lat: 51.5, lon: 0, altM: 100, groundM: 0, speedMs: cross, headingDeg: 0 }, 1 / 60, DAY, { pos, camera: cam });
      }
      const k = b.stringPoint(0, new THREE.Vector3());
      const d = b.stringPoint(b.stringSegments, new THREE.Vector3()).sub(k).normalize();
      return { deg: Math.acos(-d.y) / RAD, north: -d.z };
    };
    const calm = lean(0), light = lean(0.4), strong = lean(20);
    expect(calm.deg).toBeLessThan(5); // the sway only
    expect(light.deg).toBeGreaterThan(calm.deg);
    expect(light.north).toBeGreaterThan(0); // downwind
    expect(strong.deg).toBeGreaterThan(8);
    expect(strong.deg).toBeLessThanOrEqual(30);
  });
});

/** A seeded generator (a jittered run is the same every time). */
function rng(seed = 1) {
  return () => (seed = (seed * 16807) % 2147483647) / 2147483647;
}

/**
 * A balloon drifting east at 8 m/s and climbing, the camera alongside, for 12 s of frames: frame f
 * lasts dtAt(f) as the scene counts it, while the route (which follows the clock) moves on by
 * moveAt(f, dt) seconds. The worst and mean turn of the string's end (deg/s) after fromS, and how far
 * its end goes out to the side then (real metres of its 1.2).
 */
function drift(dtAt: (f: number) => number, moveAt: (f: number, dt: number) => number = (_f, dt) => dt, fromS = 5, tellElapsed = true) {
  const b = new Balloon(new THREE.Scene());
  const pos = new THREE.Vector3(0, 100, 0), cam = new THREE.Vector3();
  const k = new THREE.Vector3(), p = new THREE.Vector3(), d = new THREE.Vector3(), prev = new THREE.Vector3();
  let t = 0, worst = 0, sum = 0, n = 0, side = 0;
  for (let f = 0; t < 12; f++) {
    const dt = dtAt(f);
    const move = moveAt(f, dt);
    t += move;
    pos.x += 8 * move;
    pos.y += 1.5 * move;
    cam.set(pos.x - 5, pos.y, pos.z + 1.5);
    b.setState({ tSec: 60 + t, lat: 51.5, lon: 0, altM: pos.y, groundM: 0, speedMs: 8, headingDeg: 90 }, dt, DAY, { pos, camera: cam, elapsedS: tellElapsed ? move : undefined });
    b.stringPoint(0, k);
    b.stringPoint(b.stringSegments, p);
    d.copy(p).sub(k).divideScalar(b.scale).normalize();
    if (t > fromS) {
      const turn = Math.acos(Math.min(1, d.dot(prev))) / RAD / move;
      worst = Math.max(worst, turn);
      sum += turn;
      n++;
      side = Math.max(side, Math.abs(p.x - k.x) / b.scale);
    }
    prev.copy(d);
  }
  return { worst, mean: sum / n, side };
}

describe('the string at real frame timings', () => {
  const timings: [string, () => (f: number) => number][] = [
    ['50 Hz', () => () => 1 / 50],
    ['90 Hz', () => () => 1 / 90],
    ['144 Hz', () => () => 1 / 144],
    ['60 Hz with 0.5 ms of jitter', () => { const r = rng(); return () => 1 / 60 + (r() - 0.5) * 0.001; }],
    ['120 Hz with 0.5 ms of jitter', () => { const r = rng(); return () => 1 / 120 + (r() - 0.5) * 0.001; }],
    ['irregular frames of 12 to 22 ms', () => { const r = rng(); return () => 0.012 + r() * 0.01; }],
  ];
  for (const [name, make] of timings) {
    test(`${name}: a steady drift leaves the string still but for its slow sway (its end turns under 6 deg/s)`, () => {
      const r = drift(make());
      expect(r.worst).toBeLessThan(6);
      expect(r.mean).toBeLessThan(3);
    });
  }

  for (const stall of [0.5, 1, 1.5]) {
    test(`a ${stall} s stall (the scene's frame capped at 0.25 s, the route on by ${stall} s) does not fling the string`, () => {
      const at = 300; // 5 s of calm drift first
      const r = drift((f) => (f === at ? 0.25 : 1 / 60), (f, dt) => (f === at ? stall : dt), 4);
      expect(r.side).toBeLessThan(0.3);
      expect(r.worst).toBeLessThan(MAX_TURN_DEG_S);
    });

    test(`a ${stall} s stall, even untold (no elapsed time given), does not fling the string`, () => {
      const at = 300;
      const r = drift((f) => (f === at ? 0.25 : 1 / 60), (f, dt) => (f === at ? stall : dt), 4, false);
      expect(r.side).toBeLessThan(0.3);
      expect(r.worst).toBeLessThan(MAX_TURN_DEG_S);
    });
  }
});
