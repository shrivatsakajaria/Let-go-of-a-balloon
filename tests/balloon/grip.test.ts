import { describe, expect, test } from 'vitest';
import * as THREE from 'three';
import { Balloon, BALLOON_RADIUS_M, KNOT_DROP, SLIP_MAX_S } from '../../src/balloon/balloon';
import { Person } from '../../src/balloon/person';
import { CLIMB_RATE_MS } from '../../src/config';
import type { RoutePoint } from '../../src/flight/route';
import { lightFor } from '../../src/world/palette';

/**
 * The hand/string contract (Task 26d): the string's end stays in the person's hand while it opens and
 * slides out past the fingertips (StringGrip.releaseT), the balloon leaves the hand without a jump,
 * and the string is tied at the bottom of the knot.
 */
const DAY = lightFor(30);
const DT = 1 / 60;
const AT = { lat: 48.8584, lon: 2.2945 };

/** The person lets go of the balloon (as the scene does), with a stand-in route that climbs from where it was let go. */
function launch(withGrip: boolean) {
  const scene = new THREE.Scene();
  const person = new Person(scene, AT, 0, { x: 0, y: 0, z: 0 });
  const b = new Balloon(scene);
  if (withGrip) b.hold(person.hand, person);
  else b.hold(person.hand);
  const cam = new THREE.Vector3(2, 1.6, -3);
  const pos = new THREE.Vector3(0, 1.5, 0);
  const pt: RoutePoint = { tSec: 0, lat: AT.lat, lon: AT.lon, altM: 1.5, groundM: 0, speedMs: 2, headingDeg: 90 };
  let t = 0;
  let releasedAt = -1;
  let fromY = 0;
  const frames: { t: number; s: number; releaseT: number; end: THREE.Vector3; hand: THREE.Vector3; centre: THREE.Vector3 }[] = [];
  const end = new THREE.Vector3();
  const step = () => {
    person.update(DT);
    t += DT;
    if (releasedAt >= 0) {
      const s = t - releasedAt;
      pos.set(2 * s, fromY + CLIMB_RATE_MS * s, 0);
      pt.altM = pos.y;
    }
    b.setState(pt, DT, DAY, { pos, camera: cam });
    person.lookAt(b.mesh.position);
    b.stringPoint(b.rope.segments, end);
    frames.push({ t, s: releasedAt >= 0 ? t - releasedAt : -1, releaseT: person.releaseT, end: end.clone(), hand: person.hand.clone(), centre: b.mesh.position.clone() });
  };
  for (let i = 0; i < 60; i++) step();
  person.play(() => {
    releasedAt = t + DT; // called inside the next update, which ends at t + DT
    fromY = b.mesh.position.y;
    b.release();
  });
  while (t < 5) step();
  return { frames, b };
}

describe('the hand and the string (StringGrip)', () => {
  test('held: the string ends in the closed fist, every frame', () => {
    const { frames } = launch(true);
    for (const f of frames.filter((x) => x.s < 0)) expect(f.end.distanceTo(f.hand)).toBeLessThan(1e-3);
  });

  test('the string slides out of the opening hand: its end stays with the fingers until releaseT is 1, then it is free', () => {
    const { frames } = launch(true);
    const slipping = frames.filter((f) => f.s >= 0 && f.releaseT < 1);
    expect(slipping.length).toBeGreaterThan(8); // a quarter of a second or so at 60 Hz
    // at the fingers (or, as the rising balloon draws it out, just past them along the string)
    for (const f of slipping) expect(f.end.distanceTo(f.hand), `s=${f.s.toFixed(3)}`).toBeLessThan(0.05);
    expect(slipping[0].end.distanceTo(slipping[0].hand)).toBeLessThan(0.005);
    const later = frames.find((f) => f.s > 1.5)!;
    expect(later.end.distanceTo(later.hand)).toBeGreaterThan(0.2); // gone with the balloon
    // the end never jumps, from the fist to the fingertips to free
    let worst = 0;
    for (let i = 1; i < frames.length; i++) worst = Math.max(worst, frames[i].end.distanceTo(frames[i - 1].end));
    const wi = frames.findIndex((f, i) => i > 0 && f.end.distanceTo(frames[i - 1].end) === worst);
    expect(worst, `at s=${frames[wi].s.toFixed(3)} releaseT ${frames[wi].releaseT} prev ${frames[wi - 1].releaseT} knot-to-end ${frames[wi].centre.distanceTo(frames[wi].end).toFixed(3)} before ${frames[wi - 1].centre.distanceTo(frames[wi - 1].end).toFixed(3)}`).toBeLessThan(0.06);
  });

  test('without a grip the string comes free at once (the old contract still holds)', () => {
    const { frames } = launch(false);
    const f = frames.find((x) => x.s > 0.15)!;
    expect(f.end.distanceTo(f.hand)).toBeGreaterThan(0.002);
  });

  test('a grip that never finishes the slip lets go of the string after half a second all the same', () => {
    const b = new Balloon(new THREE.Scene());
    const hand = new THREE.Vector3(0, 1.3, 0);
    const stuck = { releaseT: 0.5 };
    b.hold(hand, stuck);
    const pos = new THREE.Vector3(0, 1.5, 0);
    const cam = new THREE.Vector3(2, 1.6, -3);
    const pt: RoutePoint = { tSec: 0, lat: AT.lat, lon: AT.lon, altM: 1.5, groundM: 0, speedMs: 2, headingDeg: 90 };
    const end = new THREE.Vector3();
    for (let i = 0; i < 30; i++) b.setState(pt, DT, DAY, { pos, camera: cam });
    b.release();
    let t = 0;
    const pinnedAt: number[] = [];
    while (t < 1.5) {
      t += DT;
      pos.y = 1.5 + CLIMB_RATE_MS * t;
      b.setState(pt, DT, DAY, { pos, camera: cam });
      b.stringPoint(b.rope.segments, end);
      if (end.distanceTo(hand) < 1e-3) pinnedAt.push(t);
    }
    expect(pinnedAt.length).toBeGreaterThan(5); // it did follow the grip at first
    expect(Math.max(...pinnedAt)).toBeLessThan(SLIP_MAX_S + 2 * DT);
    expect(end.distanceTo(hand)).toBeGreaterThan(0.2); // and then went with the balloon
  });

  test('the balloon leaves the hand smoothly: no pop at the release, a gentle rise from rest in the first half second', () => {
    const { frames } = launch(true);
    const i0 = frames.findIndex((f) => f.s >= 0);
    // before and across the release, frame to frame, it moves only as far as a slow drift
    for (let i = i0 - 10; i < i0 + 40; i++) {
      const d = frames[i].centre.distanceTo(frames[i - 1].centre);
      expect(d, `frame ${i - i0}`).toBeLessThan(0.05);
    }
    // it starts at rest and speeds up, never dipping
    const vy = (i: number) => (frames[i].centre.y - frames[i - 1].centre.y) / DT;
    expect(Math.abs(vy(i0 + 1))).toBeLessThan(0.4);
    for (let i = i0 + 1; i < i0 + 30; i++) expect(vy(i), `frame ${i - i0}`).toBeGreaterThan(-0.05);
    const rise = frames[i0 + 30].centre.y - frames[i0].centre.y;
    expect(rise).toBeGreaterThan(0.05);
    expect(rise).toBeLessThan(0.75);
  });

  test('the string is tied at the bottom of the knot', () => {
    const { b } = launch(true);
    b.mesh.updateMatrixWorld(true);
    // the lowest point of the balloon, along its own axis, is where the string starts
    const axis = new THREE.Vector3(0, -1, 0).applyQuaternion(b.mesh.quaternion);
    let lowest = -Infinity;
    const v = new THREE.Vector3();
    b.body.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const p = o.geometry.getAttribute('position');
      for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld).sub(b.mesh.position);
        lowest = Math.max(lowest, v.dot(axis));
      }
    });
    const knot = b.stringPoint(0, new THREE.Vector3()).sub(b.mesh.position).dot(axis);
    const r = BALLOON_RADIUS_M * b.scale;
    expect(Math.abs(lowest - knot) / r).toBeLessThan(0.04);
    expect(KNOT_DROP).toBeGreaterThan(1.3); // below the neck's rolled lip
  });
});
