import { describe, expect, test } from 'vitest';
import * as THREE from 'three';
import { Balloon } from '../../src/balloon/balloon';
import type { RoutePoint } from '../../src/flight/route';
import { lightFor } from '../../src/world/palette';

/**
 * The balloon's string as drawn (Task 26a): a heavier, calmer ribbon. Measured through a scripted
 * flight: held in a 6 m/s wind, let go, climbing, the camera zooming out and cutting between views
 * (the display scale ramps and jumps), a crosswind gust, a paused tab's long frame and a
 * floating-origin shift.
 */
const DAY = lightFor(30);
const RAD = Math.PI / 180;

type Frame = { t: number; dt: number; turnDeg: number; aboveM: number; dir: THREE.Vector3; scale: number };

type Script = { hz: number; untilS: number; quiet?: boolean };

/** Fly the script; one record a frame (t: seconds since the hand opened). */
function fly({ hz, untilS, quiet }: Script): Frame[] {
  const b = new Balloon(new THREE.Scene());
  const hand = new THREE.Vector3(0.25, 1.0, 0);
  const pos = new THREE.Vector3(0, 1.5, 0);
  const cam = new THREE.Vector3(3, 1.6, 4);
  const knot = new THREE.Vector3(), p = new THREE.Vector3();
  const prev = new THREE.Vector3();
  const out: Frame[] = [];
  const HOLD = 2;
  let t = -HOLD;
  let released = false;
  let sp = 6, hd = 70;
  const shift = new THREE.Vector3();
  b.hold(hand);
  for (let f = 0; t < untilS; f++) {
    let dt = 1 / hz;
    // a paused or hidden tab: one long frame (the scene caps a frame at 0.25 s)
    if (!quiet && t < 15 && t + dt >= 15) dt = 0.25;
    t += dt;
    if (!released && t >= 0) {
      b.release();
      released = true;
    }
    const tr = Math.max(0, t);
    if (!quiet) {
      // a crosswind gust: the wind veers 40 deg and freshens for 2 s
      const g = t > 9 && t < 11 ? Math.sin(((t - 9) / 2) * Math.PI) : 0;
      hd = 70 + 40 * g;
      sp = 6 + 3 * g;
      // the floating origin moves under everything
      if (t >= 16 && shift.x === 0) {
        shift.set(-5000, 0, 3000);
        pos.add(shift);
      }
    }
    if (released) {
      pos.x += Math.sin(hd * RAD) * sp * dt;
      pos.z -= Math.cos(hd * RAD) * sp * dt;
      pos.y = 1.5 + 1.5 * tr;
    }
    // the camera: close, then pulling out to 400 m over 2 s (the scale ramps), then cuts between views
    let d = 3;
    if (!quiet) {
      if (t > 4) d = 3 + 397 * Math.min(1, (t - 4) / 2);
      if (t > 7) d = 5; // cut back in (Film's next shot, or Ride)
      if (t > 12) d = 800; // cut out (Above)
      if (t > 14) d = 5;
    }
    if (released) cam.set(pos.x - d * 0.6, pos.y - d * 0.2, pos.z + d * 0.77);
    const pt: RoutePoint = { tSec: tr, lat: 51.5, lon: -0.12, altM: 1.5 + 1.5 * tr, groundM: 0, speedMs: sp, headingDeg: hd };
    b.setState(pt, dt, DAY, { pos, camera: cam });
    b.stringPoint(0, knot);
    let above = -Infinity;
    for (let i = 1; i <= b.rope.segments; i++) above = Math.max(above, b.stringPoint(i, p).y - knot.y);
    const dir = b.stringPoint(b.rope.segments, p).sub(knot).normalize();
    const turnDeg = f === 0 ? 0 : Math.acos(Math.min(1, Math.max(-1, dir.dot(prev)))) / RAD;
    prev.copy(dir);
    out.push({ t, dt, turnDeg, aboveM: above, dir: dir.clone(), scale: b.scale });
  }
  return out;
}

describe('the string, through a scripted flight', () => {
  for (const hz of [30, 120]) {
    test(`at ${hz} Hz no point of the string ever rises above the knot`, () => {
      const run = fly({ hz, untilS: 18 });
      const worst = run.reduce((a, r) => (r.aboveM > a.aboveM ? r : a));
      expect(worst.aboveM, `at t=${worst.t.toFixed(2)} s`).toBeLessThanOrEqual(0);
    });

    test(`at ${hz} Hz the end of the string never flicks: it turns at most 90 deg/s, frame by frame`, () => {
      const run = fly({ hz, untilS: 18 });
      // the same limit per second at either frame rate (3 deg a frame at 30 Hz, 0.75 at 120 Hz; a
      // paused tab's 0.25 s frame, 22 deg)
      const worst = run.reduce((a, r) => (r.turnDeg / r.dt > a.turnDeg / a.dt ? r : a));
      expect(worst.turnDeg / worst.dt, `at t=${worst.t.toFixed(2)} s`).toBeLessThanOrEqual(90);
    });
  }

  test('the let-go is soft: the end swings out and settles within 2 s, at 30 and 120 Hz alike', () => {
    for (const hz of [30, 120]) {
      const run = fly({ hz, untilS: 8, quiet: true });
      // settled: from here on the end turns slower than 10 deg/s
      let settled = 0;
      for (const r of run) if (r.t > 0 && r.turnDeg / r.dt > 10) settled = r.t;
      expect(settled, `${hz} Hz`).toBeLessThan(2);
      // and it does swing (it is a string, not a stick)
      const swing = Math.max(...run.filter((r) => r.t > 0 && r.t < 2).map((r) => r.turnDeg / r.dt));
      expect(swing, `${hz} Hz`).toBeGreaterThan(5);
    }
  });

  test('the string hangs the same at 30 Hz and 120 Hz', () => {
    const a = fly({ hz: 30, untilS: 18 }), b = fly({ hz: 120, untilS: 18 });
    for (const t of [1, 3, 8, 10, 13, 17.5]) {
      const ra = a.find((r) => r.t >= t)!, rb = b.find((r) => r.t >= t)!;
      expect(Math.acos(Math.min(1, ra.dir.dot(rb.dir))) / RAD, `t=${t}`).toBeLessThan(4);
    }
  });

  test('at a few frames a second (the software renderer) the let-go plays out in real time, as at 120 Hz', () => {
    const slow = fly({ hz: 4, untilS: 4, quiet: true }), fast = fly({ hz: 120, untilS: 4, quiet: true });
    for (const t of [0.5, 1, 1.5, 2, 3]) {
      const ra = slow.find((r) => r.t >= t - 1e-9)!, rb = fast.find((r) => r.t >= t - 1e-9)!;
      expect(Math.acos(Math.min(1, ra.dir.dot(rb.dir))) / RAD, `t=${t}`).toBeLessThan(6);
    }
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
      const pts = Array.from({ length: b.rope.segments + 1 }, (_, i) => b.stringPoint(i, p).clone().sub(knot).divideScalar(b.scale));
      return { pts, scale: b.scale };
    };
    const near = shape(5), far = shape(600);
    expect(far.scale).toBeGreaterThan(10 * near.scale);
    for (let i = 0; i < near.pts.length; i++) expect(near.pts[i].distanceTo(far.pts[i])).toBeLessThan(0.01);
  });
});
