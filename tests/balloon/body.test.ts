import { describe, expect, test } from 'vitest';
import * as THREE from 'three';
import { Balloon, BALLOON_RADIUS_M, displayScale, squashScale } from '../../src/balloon/balloon';
import type { RoutePoint } from '../../src/flight/route';
import { lightFor } from '../../src/world/palette';

const DAY = lightFor(30);

function point(tSec: number, over: Partial<RoutePoint> = {}): RoutePoint {
  return { tSec, lat: 51.5, lon: -0.12, altM: 1.5 + 1.5 * Math.max(0, tSec), groundM: 0, speedMs: 3, headingDeg: 90, ...over };
}
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
  test('the string end is at the hand during the hold and free after release', () => {
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
      expect(b.stringPoint(b.stringSegments, end).distanceTo(hand)).toBeLessThan(1e-9);
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
    b.stringPoint(b.stringSegments, end);
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
