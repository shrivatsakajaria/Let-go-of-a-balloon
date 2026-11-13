import { describe, expect, test, vi } from 'vitest';
import * as THREE from 'three';
import { ReplayTrail, TRAIL_PX, MARKER_PX } from '../../src/world/trail';
import type { Route, RoutePoint } from '../../src/flight/route';
import type { LatLon } from '../../src/geo/coords';

const K = 111_000;
const toScene = (p: LatLon, out = { x: 0, z: 0 }) => {
  out.x = p.lon * K;
  out.z = -(p.lat - 50) * K;
  return out;
};
/** East along 50 N at 0.1 deg per 10 minutes, at 1,500 m. */
function route(): Route {
  const points: RoutePoint[] = Array.from({ length: 433 }, (_, i) => ({ tSec: i * 600, lat: 50, lon: 0.1 * i, altM: 1500, groundM: 0, speedMs: 18, headingDeg: 90 }));
  return { points, hourly: [], release: 0, runId: 'x' };
}
function camAt(x: number, y: number, z: number, look: THREE.Vector3) {
  const c = new THREE.PerspectiveCamera(50, 390 / 844, 1, 1e6);
  c.position.set(x, y, z);
  c.lookAt(look);
  c.updateMatrixWorld(true);
  return c;
}

describe('ReplayTrail', () => {
  test('draws the route flown so far, ending at the balloon as drawn', () => {
    const scene = new THREE.Scene();
    const trail = new ReplayTrail(scene);
    const r = route();
    const head = new THREE.Vector3(toScene({ lat: 50, lon: 1.05 }).x, 1500, 0);
    const cam = camAt(head.x - 30000, 40000, 0, head);
    trail.update({ route: r, tSec: 10.5 * 600, toScene, head, camera: cam, viewportH: 844, balloonRadiusM: 6 });
    // points 0..10 plus the head
    expect(trail.points).toBe(12);
    const pos = trail.ribbon.geometry.getAttribute('position');
    const mid = (i: number) => new THREE.Vector3((pos.getX(2 * i) + pos.getX(2 * i + 1)) / 2, (pos.getY(2 * i) + pos.getY(2 * i + 1)) / 2, (pos.getZ(2 * i) + pos.getZ(2 * i + 1)) / 2);
    expect(mid(0).x).toBeCloseTo(0, 3);
    expect(mid(0).y).toBeCloseTo(1500, 3);
    expect(mid(11).distanceTo(head)).toBeLessThan(1e-3);
    expect(trail.ribbon.geometry.drawRange.count).toBe(11 * 6);
    expect(scene.getObjectByName('replay-trail')).toBeTruthy();
  });

  test('at the landing the trail settles onto the ground with the balloon', () => {
    const trail = new ReplayTrail(new THREE.Scene());
    const r = route();
    r.points.forEach((p) => (p.groundM = 200));
    const head = new THREE.Vector3(toScene({ lat: 50, lon: 1.05 }).x, 201, 0);
    const cam = camAt(head.x - 300, 400, 0, head);
    trail.update({ route: r, tSec: 10.5 * 600, toScene, head, camera: cam, viewportH: 844, balloonRadiusM: 2, lower: 1 });
    const pos = trail.ribbon.geometry.getAttribute('position');
    expect((pos.getY(0) + pos.getY(1)) / 2).toBeCloseTo(200 + 2, 0); // just over the ground
    trail.update({ route: r, tSec: 10.5 * 600, toScene, head, camera: cam, viewportH: 844, balloonRadiusM: 2, lower: 0.5 });
    expect((pos.getY(0) + pos.getY(1)) / 2).toBeCloseTo((1500 + 202) / 2, 0);
  });

  test('nothing to draw before the balloon has moved', () => {
    const trail = new ReplayTrail(new THREE.Scene());
    const head = new THREE.Vector3(0, 1500, 0);
    trail.update({ route: route(), tSec: 0, toScene, head, camera: camAt(-300, 1700, 0, head), viewportH: 844, balloonRadiusM: 2 });
    expect(trail.ribbon.geometry.drawRange.count).toBe(0);
  });

  test('the ribbon is about the same width on screen near and far, facing the camera', () => {
    const trail = new ReplayTrail(new THREE.Scene());
    const r = route();
    const head = new THREE.Vector3(toScene({ lat: 50, lon: 20 }).x, 1500, 0);
    const cam = camAt(0, 1500, 30_000, new THREE.Vector3(0, 1500, 0)); // looking north at the trail's side
    trail.update({ route: r, tSec: 200 * 600, toScene, head, camera: cam, viewportH: 844, balloonRadiusM: 6 });
    const pos = trail.ribbon.geometry.getAttribute('position');
    const px = (i: number) => {
      const a = new THREE.Vector3(pos.getX(2 * i), pos.getY(2 * i), pos.getZ(2 * i)).project(cam);
      const b = new THREE.Vector3(pos.getX(2 * i + 1), pos.getY(2 * i + 1), pos.getZ(2 * i + 1)).project(cam);
      return (Math.hypot(a.x - b.x, (a.y - b.y)) / 2) * 844; // NDC y spans 844 px (x is scaled by aspect, but the ribbon is near vertical here)
    };
    expect(px(0)).toBeGreaterThan(TRAIL_PX * 0.8);
    expect(px(0)).toBeLessThan(TRAIL_PX * 1.25);
    expect(px(30)).toBeGreaterThan(TRAIL_PX * 0.5); // further off to the side, still a few pixels
  });

  test('the balloon marker keeps the balloon a few pixels wide from far up, and steps aside when the balloon is bigger', () => {
    const trail = new ReplayTrail(new THREE.Scene());
    const head = new THREE.Vector3(0, 1500, 0);
    const far = camAt(-37_000, 42_000, 0, head);
    trail.update({ route: route(), tSec: 0, toScene, head, camera: far, viewportH: 844, balloonRadiusM: 6 });
    expect(trail.marker.visible).toBe(true);
    const r = trail.marker.scale.x;
    const d = far.position.distanceTo(head);
    expect((r / (d * Math.tan((25 * Math.PI) / 180))) * 422).toBeCloseTo(MARKER_PX, 1);
    expect(trail.marker.position.distanceTo(head)).toBeLessThan(1e-6);
    const near = camAt(-300, 1600, 0, head);
    trail.update({ route: route(), tSec: 0, toScene, head, camera: near, viewportH: 844, balloonRadiusM: 2 });
    expect(trail.marker.visible).toBe(false);
  });

  test('dispose takes the trail and the marker out of the scene and frees their buffers', () => {
    const scene = new THREE.Scene();
    const trail = new ReplayTrail(scene);
    const g1 = vi.spyOn(trail.ribbon.geometry, 'dispose');
    const g2 = vi.spyOn(trail.marker.geometry, 'dispose');
    const m1 = vi.spyOn(trail.ribbon.material as THREE.Material, 'dispose');
    const m2 = vi.spyOn(trail.marker.material as THREE.Material, 'dispose');
    trail.dispose();
    expect(scene.getObjectByName('replay-trail')).toBeUndefined();
    expect(scene.children.length).toBe(0);
    for (const s of [g1, g2, m1, m2]) expect(s).toHaveBeenCalled();
  });
});
