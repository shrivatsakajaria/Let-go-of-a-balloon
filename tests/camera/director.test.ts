import { describe, expect, test } from 'vitest';
import * as THREE from 'three';
import { Director, type DirectorDeps } from '../../src/camera/director';
import { displayScale } from '../../src/balloon/balloon';
import type { RoutePoint } from '../../src/flight/route';
import type { LatLon } from '../../src/geo/coords';

// Flat local frame: 1 deg = 111 km, x east, z = -north, origin at (50, 0).
const K = 111_000;
const toScene = (p: LatLon) => ({ x: p.lon * K, z: -(p.lat - 50) * K });
const fromScene = (x: number, z: number): LatLon => ({ lat: 50 - z / K, lon: x / K });
const R = (d: number) => 1.2 + 0.002 * d;

function deps(over: Partial<DirectorDeps> = {}): DirectorDeps {
  return { toScene, groundAt: () => 0, balloonRadius: R, ...over };
}
function mkCam() {
  return new THREE.PerspectiveCamera(50, 16 / 9, 1, 100000);
}
/** Balloon drifting east at 8 m/s, heading 90 deg, at altitude alt. */
function balloon(tSec: number, alt = 1500, heading = 90): RoutePoint {
  return { tSec, lat: 50, lon: (8 * tSec) / K, altM: alt, groundM: 0, speedMs: 8, headingDeg: heading };
}
function run(d: Director, from: number, seconds: number, dt = 0.1, mk = balloon, each?: (t: number) => void) {
  const n = Math.round(seconds / dt);
  for (let i = 1; i <= n; i++) {
    const t = from + i * dt;
    d.update(mk(t), dt);
    each?.(t);
  }
  return from + n * dt;
}
function ballPos(b: RoutePoint) {
  const s = toScene(b);
  return new THREE.Vector3(s.x, b.altM, s.z);
}
/** The real balloon: 0.15 m radius, real size within 20 m (spec 6.2). */
const REAL = (d: number) => 0.15 * displayScale(d);
/** A phone held upright. */
function mkPhone(fov = 50) {
  return new THREE.PerspectiveCamera(fov, 390 / 844, 0.05, 100000);
}
/** Projected size of a sphere of radius r at c: height fraction of the viewport, and its furthest NDC extent. */
function framing(cam: THREE.PerspectiveCamera, c: THREE.Vector3, r: number) {
  cam.updateMatrixWorld(true);
  const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0);
  const up = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1);
  const top = c.clone().addScaledVector(up, r).project(cam);
  const bot = c.clone().addScaledVector(up, -r).project(cam);
  const l = c.clone().addScaledVector(right, -r).project(cam);
  const rr = c.clone().addScaledVector(right, r).project(cam);
  const ctr = c.clone().project(cam);
  return {
    h: Math.abs(top.y - bot.y) / 2,
    extent: Math.max(Math.abs(top.y), Math.abs(bot.y), Math.abs(l.x), Math.abs(rr.x)),
    centre: ctr,
    inFront: c.clone().applyMatrix4(cam.matrixWorldInverse).z < 0,
  };
}
/** Is the point inside the frame (in front of the camera, NDC within +-1)? */
function inFrame(cam: THREE.PerspectiveCamera, p: THREE.Vector3) {
  cam.updateMatrixWorld(true);
  const v = p.clone().project(cam);
  return p.clone().applyMatrix4(cam.matrixWorldInverse).z < 0 && Math.abs(v.x) < 1 && Math.abs(v.y) < 1;
}
describe('Director', () => {
  test('camera never below ground + 8 m over a 300 m hill', () => {
    const hill = (p: LatLon) => {
      const x = (p.lon * K - 4000) / 1500;
      const z = ((p.lat - 50) * K) / 1500;
      return 300 * Math.exp(-(x * x + z * z));
    };
    for (const mode of ['ride', 'above', 'side', 'film'] as const) {
      const cam = mkCam();
      const d = new Director(cam, deps({ groundAt: hill }));
      d.set(mode);
      // balloon skims the hill 30 m above it
      const mk = (t: number): RoutePoint => {
        const b = balloon(t);
        return { ...b, altM: hill(b) + 30, groundM: hill(b) };
      };
      run(d, 0, 900, 0.5, mk, () => {
        const g = hill(fromScene(cam.position.x, cam.position.z));
        expect(cam.position.y).toBeGreaterThanOrEqual(g + 8 - 1e-6);
      });
    }
  });

  test('camera stays above building tops within 30 m', () => {
    const cam = mkCam();
    const d = new Director(cam, deps({ buildingTopAt: () => 120 }));
    d.set('side');
    run(d, 0, 60, 0.1, (t) => balloon(t, 100), () => {
      expect(cam.position.y).toBeGreaterThanOrEqual(123 - 1e-6);
    });
  });

  test('film schedule order and durations', () => {
    const d = new Director(mkCam(), deps());
    d.set('film');
    const seen: [number, string][] = [];
    run(d, 0, 250, 0.5, balloon, (t) => seen.push([t, d.shot]));
    const at = (t: number) => seen.find(([s]) => s === t)![1];
    expect([at(10), at(39.5)]).toEqual(['ride', 'ride']);
    expect([at(40.5), at(69.5)]).toEqual(['circling', 'circling']);
    expect([at(70.5), at(99.5)]).toEqual(['side', 'side']);
    expect([at(100.5), at(119.5)]).toEqual(['down', 'down']);
    expect(at(120.5)).toBe('ride');
    expect(at(160.5)).toBe('circling');
  });

  test('switching to side-on converges within 4 s', () => {
    const a = mkCam();
    const A = new Director(a, deps());
    A.set('ride');
    const t = run(A, 0, 8);
    A.set('side');
    run(A, t, 4);
    const b = mkCam();
    const B = new Director(b, deps());
    B.set('side');
    run(B, 0, 12);
    expect(a.position.distanceTo(b.position)).toBeLessThan(1);
    expect(Math.abs(a.fov - b.fov)).toBeLessThan(0.5);
  });

  test('reduced motion excludes side-on and straight-down', () => {
    const d = new Director(mkCam(), deps({ reducedMotion: true }));
    d.set('film');
    const shots = new Set<string>();
    run(d, 0, 600, 0.5, balloon, (t) => {
      shots.add(d.shot);
      if (t % 100 === 0) d.event('coast');
    });
    expect([...shots].sort()).toEqual(['circling', 'ride']);
  });

  test('film mode switches shot within 3 s of a coast-crossing event', () => {
    const d = new Director(mkCam(), deps());
    d.set('film');
    let t = run(d, 0, 20);
    expect(d.shot).toBe('ride');
    d.event('coast');
    t = run(d, t, 3);
    expect(d.shot).toBe('side');
  });

  test('events are rate limited to about every 15 s', () => {
    const d = new Director(mkCam(), deps());
    d.set('film');
    let t = run(d, 0, 20);
    d.event('coast'); // -> side
    t = run(d, t, 3);
    expect(d.shot).toBe('side');
    d.event('city'); // too soon -> waits
    t = run(d, t, 5);
    expect(d.shot).toBe('side');
    t = run(d, t, 12);
    expect(d.shot).toBe('circling');
  });

  test('in ride the projected balloon height stays between 18% and 35% of the viewport', () => {
    for (const radius of [R, (m: number) => 0.8 + 0.01 * m, () => 3]) {
      const cam = mkCam();
      const d = new Director(cam, deps({ balloonRadius: radius }));
      d.set('ride');
      const mk = (t: number) => balloon(t, 1500, 90 + 40 * Math.sin(t / 20));
      run(d, 0, 120, 0.1, mk, (t) => {
        const h = (() => {
          cam.updateMatrixWorld(true);
          const c = ballPos(mk(t));
          const r = radius(cam.position.distanceTo(c));
          const top = c.clone().add(new THREE.Vector3(0, r, 0)).project(cam);
          const bot = c.clone().add(new THREE.Vector3(0, -r, 0)).project(cam);
          return Math.abs(top.y - bot.y) / 2;
        })();
        expect(h).toBeGreaterThan(0.18);
        expect(h).toBeLessThan(0.35);
        // balloon fully inside the frame
        const top = ballPos(mk(t)).add(new THREE.Vector3(0, radius(cam.position.distanceTo(ballPos(mk(t)))), 0)).project(cam);
        expect(Math.abs(top.y)).toBeLessThan(1);
      });
    }
  });

  test('launch timeline: street level, tilts up, pulls back wider, hands over to ride', () => {
    const person: LatLon = { lat: 50, lon: 0 };
    const ground = 40;
    const cam = mkCam();
    const d = new Director(cam, deps({ groundAt: () => ground }));
    d.setLaunch({ personAt: person, landmarkHeadingDeg: 45, startUtcMs: 0 });
    expect(d.mode).toBe('launch');
    const mk = (t: number): RoutePoint => {
      const rise = Math.max(0, t - 1.2) * 3;
      return { tSec: t, lat: 50, lon: (Math.max(0, t - 1.2) * 6) / K, altM: ground + 1.7 + rise, groundM: ground, speedMs: 6, headingDeg: 90 };
    };
    const snap: Record<number, { y: number; fov: number; dist: number }> = {};
    const p0 = toScene(person);
    run(d, 0, 21, 0.05, mk, (t) => {
      const k = Math.round(t * 100) / 100;
      if ([1, 8, 14, 20].includes(k)) {
        snap[k] = { y: cam.position.y, fov: cam.fov, dist: Math.hypot(cam.position.x - p0.x, cam.position.z - p0.z) };
      }
    });
    expect(snap[1].y).toBeGreaterThanOrEqual(ground + 1.2 - 1e-6);
    expect(snap[1].y).toBeLessThan(ground + 3);
    expect(snap[1].dist).toBeGreaterThan(2);
    expect(snap[1].dist).toBeLessThan(10);
    // 0-8 s at street level, tilting up; the climb is part of the 8-20 s pull-back
    expect(snap[8].y).toBeLessThan(ground + 4);
    expect(snap[14].y).toBeGreaterThan(snap[8].y + 5);
    expect(snap[20].dist).toBeGreaterThan(snap[8].dist + 20);
    expect(snap[20].fov).toBeGreaterThan(snap[1].fov + 5);
    expect(d.mode).toBe('film');
    expect(d.shot).toBe('ride');
  });

  test('launch honours a view chosen during the launch once it ends', () => {
    const d = new Director(mkCam(), deps());
    d.setLaunch({ personAt: { lat: 50, lon: 0 }, landmarkHeadingDeg: 0, startUtcMs: 0 });
    d.set('side');
    expect(d.mode).toBe('launch');
    run(d, 0, 21);
    expect(d.mode).toBe('side');
  });

  test('reduced-motion ride has fixed framing (no bob)', () => {
    const run1 = (reduced: boolean) => {
      const cam = mkCam();
      const d = new Director(cam, deps({ reducedMotion: reduced }));
      d.set('ride');
      const offs: THREE.Vector3[] = [];
      run(d, 0, 60, 0.1, balloon, (t) => {
        if (t > 15) offs.push(cam.position.clone().sub(ballPos(balloon(t))));
      });
      let spread = 0;
      for (const o of offs) spread = Math.max(spread, o.distanceTo(offs[0]));
      return spread;
    };
    expect(run1(true)).toBeLessThan(1e-3);
    expect(run1(false)).toBeGreaterThan(0.2);
  });

  test('circling angular speed varies and never stays constant', () => {
    const cam = mkCam();
    const d = new Director(cam, deps());
    d.set('above');
    run(d, 0, 20);
    const az: number[] = [];
    run(d, 20, 120, 1, balloon, (t) => {
      const o = cam.position.clone().sub(ballPos(balloon(t)));
      az.push(Math.atan2(o.x, -o.z));
    });
    const w = az.slice(1).map((a, i) => {
      let dlt = a - az[i];
      while (dlt < -Math.PI) dlt += 2 * Math.PI;
      while (dlt > Math.PI) dlt -= 2 * Math.PI;
      return dlt;
    });
    expect(Math.max(...w) - Math.min(...w)).toBeGreaterThan(0.005);
    expect(Math.min(...w)).toBeGreaterThan(0); // always turning one way, slowly
    expect(Math.max(...w)).toBeLessThan(0.1);
  });

  test('a huge dt (backgrounded tab) changes the shot at most once', () => {
    const d = new Director(mkCam(), deps());
    d.set('film');
    run(d, 0, 10);
    const seen: string[] = [d.shot];
    d.update(balloon(310), 300);
    seen.push(d.shot);
    for (let i = 1; i <= 40; i++) {
      d.update(balloon(310 + i * 0.1), 0.1);
      seen.push(d.shot);
    }
    let changes = 0;
    for (let i = 1; i < seen.length; i++) if (seen[i] !== seen[i - 1]) changes++;
    expect(changes).toBeLessThanOrEqual(1);
  });

  test('non-finite dt or balloon values do not poison the camera', () => {
    const cam = mkCam();
    const d = new Director(cam, deps());
    d.set('ride');
    let t = run(d, 0, 10);
    d.update(balloon(t), NaN);
    d.update({ ...balloon(t), lat: NaN }, 0.1);
    d.update({ ...balloon(t), altM: NaN }, 0.1);
    t = run(d, t, 10);
    expect(cam.position.toArray().every(Number.isFinite)).toBe(true);
    expect(cam.position.distanceTo(ballPos(balloon(t)))).toBeLessThan(60);
  });

  test('paused freezes choreography but follows the balloon rigidly', () => {
    const cam = mkCam();
    const d = new Director(cam, deps());
    d.set('film');
    let t = run(d, 0, 35);
    const shot = d.shot;
    d.paused = true;
    const off0 = cam.position.clone().sub(ballPos(balloon(t)));
    t = run(d, t, 120);
    expect(d.shot).toBe(shot);
    expect(cam.position.clone().sub(ballPos(balloon(t))).distanceTo(off0)).toBeLessThan(1e-6);
    d.paused = false;
    run(d, t, 10);
    expect(d.shot).toBe('circling'); // 5 s of the 40 s ride were left
  });

  test('ride frames the real-size balloon at 18-35% of the height at 30 m, 450 m and 1,500 m, never cropped', () => {
    for (const alt of [30, 450, 1500]) {
      for (const cam of [mkPhone(), mkCam()]) {
        const d = new Director(cam, deps({ balloonRadius: REAL }));
        d.set('ride');
        const mk = (t: number) => balloon(t, alt, 90 + 40 * Math.sin(t / 20));
        run(d, 0, 120, 0.1, mk, (t) => {
          const c = ballPos(mk(t));
          const dist = cam.position.distanceTo(c);
          const f = framing(cam, c, REAL(dist));
          expect(f.inFront).toBe(true);
          expect(f.h).toBeGreaterThan(0.18);
          expect(f.h).toBeLessThan(0.35);
          expect(f.extent).toBeLessThan(0.98); // never cropped, also on a narrow phone
          expect(f.centre.y).toBeGreaterThan(0.2); // large at the top of the frame
          // roughly a string's length away, outside the balloon and its string
          expect(dist).toBeGreaterThan(0.8);
          expect(dist).toBeLessThan(2.5);
        });
      }
    }
  });

  test('an optional scene-space target (the drawn balloon) replaces the route position', () => {
    const lift = new THREE.Vector3(0.2, 0.9, -0.1);
    const camA = mkCam(), camB = mkCam(), camC = mkCam(), camD = mkCam();
    const A = new Director(camA, deps({ balloonRadius: REAL }));
    const Bd = new Director(camB, deps({ balloonRadius: REAL }));
    const C = new Director(camC, deps({ balloonRadius: REAL }));
    const D = new Director(camD, deps({ balloonRadius: REAL }));
    for (const x of [A, Bd, C, D]) x.set('film');
    const moved = (t: number): RoutePoint => {
      const b = balloon(t, 300);
      const p = ballPos(b).add(lift);
      const ll = fromScene(p.x, p.z);
      return { ...b, lat: ll.lat, lon: ll.lon, altM: p.y };
    };
    for (let i = 1; i <= 900; i++) {
      const t = i * 0.1;
      A.update(moved(t), 0.1); // the route itself at the drawn position
      Bd.update(balloon(t, 300), 0.1, ballPos(balloon(t, 300)).add(lift));
      C.update(balloon(t, 300), 0.1); // no target: unchanged behaviour
      D.update(balloon(t, 300), 0.1, { x: NaN, y: 0, z: 0 }); // bad target: ignored
      expect(camB.position.distanceTo(camA.position)).toBeLessThan(1e-6);
      expect(camB.quaternion.angleTo(camA.quaternion)).toBeLessThan(1e-6);
      expect(camD.position.distanceTo(camC.position)).toBeLessThan(1e-9);
    }
    expect(camC.position.distanceTo(camA.position)).toBeGreaterThan(0.5);
  });

  test('launch with the real balloon: eye level and tilting up to 8 s, climbs and shows the landmark, ride at 20 s', () => {
    const person: LatLon = { lat: 50, lon: 0 };
    const ground = 40;
    // a terrace of 15 m buildings 2.5 m west of the person; the wind blows from the west-south-west
    const inBlock = (x: number, r: number) => x - r < -2.5 && x + r > -20;
    const buildingTopAt = (p: LatLon, r: number) => (inBlock(toScene(p).x, r) ? ground + 15 : ground);
    const cam = mkPhone(50);
    const d = new Director(cam, deps({ balloonRadius: REAL, groundAt: () => ground, buildingTopAt }));
    const landmarkHeadingDeg = 30;
    d.setLaunch({ personAt: person, landmarkHeadingDeg, startUtcMs: 0 });
    const heading = 70;
    const h = (heading * Math.PI) / 180;
    // drawn balloon: 2.4 m up while held, then climbing at 1.5 m/s and drifting at 2.5 m/s
    const mk = (t: number): RoutePoint => {
      const fl = Math.max(0, t - 1.2);
      const ll = fromScene(Math.sin(h) * 2.5 * fl, -Math.cos(h) * 2.5 * fl);
      return { tSec: t, lat: ll.lat, lon: ll.lon, altM: ground + 2.4 + 1.5 * fl, groundM: ground, speedMs: 2.5, headingDeg: heading };
    };
    const lh = (landmarkHeadingDeg * Math.PI) / 180;
    const landmark = new THREE.Vector3(Math.sin(lh) * 2500, ground + 60, -Math.cos(lh) * 2500);
    const p0 = toScene(person);
    const personHead = new THREE.Vector3(p0.x, ground + 1.6, p0.z);
    let landmarkSeen = false;
    run(d, 0, 21, 0.05, mk, (t) => {
      const k = Math.round(t * 100) / 100;
      const B = ballPos(mk(t));
      // never inside a building or the ground
      if (inBlock(cam.position.x, 0)) expect(cam.position.y).toBeGreaterThan(ground + 15);
      expect(cam.position.y).toBeGreaterThan(ground + 1);
      if (k <= 20) expect(inFrame(cam, B)).toBe(true); // the balloon is always in the frame
      if (k === 0.5) expect(inFrame(cam, personHead)).toBe(true); // the person holding it is in the shot
      if (k === 4 || k === 8) {
        expect(cam.position.y).toBeLessThan(ground + 4); // low at street level
        expect(cam.position.y).toBeLessThan(B.y); // looking up at it, not down
      }
      if (k === 4) expect(new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion).y).toBeGreaterThan(0.15); // tilted up
      if (k >= 11 && k <= 16 && cam.position.y > ground + 10 && inFrame(cam, landmark)) landmarkSeen = true;
      if (k === 20) {
        const f = framing(cam, B, REAL(cam.position.distanceTo(B)));
        expect(f.h).toBeGreaterThan(0.18);
        expect(f.h).toBeLessThan(0.35);
        expect(f.extent).toBeLessThan(0.98);
      }
    });
    expect(landmarkSeen).toBe(true);
    expect(d.mode).toBe('film');
    expect(d.shot).toBe('ride');
  });

  test('waiting at the start screen: the person and the held balloon sit in the free band, nothing blocks them; go() starts the launch', () => {
    const person: LatLon = { lat: 50, lon: 0 };
    const ground = 20;
    // a 12 m building 8-14 m upwind of the person (west, the wind blows east): the wide spot must come in front of it
    const inBlock = (x: number, z: number, r: number) => x + r > -14 && x - r < -8 && Math.abs(z) - r < 30;
    const buildingTopAt = (p: LatLon, r: number) => {
      const s = toScene(p);
      return inBlock(s.x, s.z, r) ? ground + 12 : ground;
    };
    for (const aspect of [390 / 660, 390 / 844, 16 / 9]) {
      const cam = new THREE.PerspectiveCamera(50, aspect, 0.05, 100000);
      const d = new Director(cam, deps({ balloonRadius: REAL, groundAt: () => ground, buildingTopAt }));
      const band = { centerY: 0.2, spanY: 0.8 };
      d.setLaunch({ personAt: person, startUtcMs: 0, waiting: band });
      const held = (t: number): RoutePoint => ({ tSec: t, lat: 50, lon: 0, altM: ground + 2.4, groundM: ground, speedMs: 3, headingDeg: 90 });
      run(d, 0, 30, 0.1, held);
      expect(d.shot).toBe('launch'); // waiting never hands over
      expect(d.waiting).toBe(true);
      const p0 = toScene(person);
      const feet = new THREE.Vector3(p0.x, ground, p0.z);
      const top = new THREE.Vector3(p0.x, ground + 2.6, p0.z);
      cam.updateMatrixWorld(true);
      const f = feet.clone().project(cam), tp = top.clone().project(cam);
      expect(inFrame(cam, feet) && inFrame(cam, top)).toBe(true);
      expect(f.y).toBeGreaterThan(band.centerY - band.spanY / 2 - 0.02);
      expect(tp.y).toBeLessThan(band.centerY + band.spanY / 2 + 0.02);
      expect(tp.y - f.y).toBeGreaterThan(0.25); // big enough to read
      expect(Math.abs((f.y + tp.y) / 2 - band.centerY)).toBeLessThan(0.08);
      // never in the building, and the building is not between the camera and the person
      expect(inBlock(cam.position.x, cam.position.z, 0)).toBe(false);
      expect(cam.position.x).toBeGreaterThan(-8);
      expect(cam.position.y).toBeLessThan(ground + 2);
      // Let go: the launch runs from 0 and hands over to ride 20 s later
      d.go();
      expect(d.waiting).toBe(false);
      run(d, 30, 19.5, 0.1, held);
      expect(d.shot).toBe('launch');
      run(d, 49.5, 1, 0.1, held);
      expect(d.shot).toBe('ride');
    }
    // a failed launch rewinds to the waiting shot smoothly (no snap), and stays there
    const cam = new THREE.PerspectiveCamera(50, 390 / 660, 0.05, 100000);
    const d = new Director(cam, deps({ balloonRadius: REAL, groundAt: () => ground, buildingTopAt }));
    const held = (t: number): RoutePoint => ({ tSec: t, lat: 50, lon: 0, altM: ground + 2.4, groundM: ground, speedMs: 3, headingDeg: 90 });
    d.setLaunch({ personAt: person, startUtcMs: 0, waiting: { centerY: 0.2, spanY: 0.8 } });
    run(d, 0, 5, 0.1, held);
    const wide = cam.position.clone();
    d.go();
    run(d, 5, 6, 0.1, held);
    const street = cam.position.clone();
    expect(street.distanceTo(wide)).toBeGreaterThan(0.8);
    d.rewind({ centerY: 0.2, spanY: 0.8 });
    d.update(held(11.1), 0.1);
    expect(cam.position.distanceTo(street)).toBeLessThan(0.5); // eases, no cut
    run(d, 11.1, 30, 0.1, held);
    expect(d.waiting).toBe(true);
    expect(cam.position.distanceTo(wide)).toBeLessThan(0.05);
  });

  test('featured landmark: in view from 0.5 to 4 s, camera beyond the person from it, the person not blocking it', () => {
    const person: LatLon = { lat: 50, lon: 0 };
    const H = 30;
    const lh = (H * Math.PI) / 180;
    const Ld = new THREE.Vector3(Math.sin(lh), 0, -Math.cos(lh));
    const tower = (y: number) => Ld.clone().multiplyScalar(400).setY(y); // 100 m tall, 400 m away
    const cam = mkPhone(50);
    const d = new Director(cam, deps({ balloonRadius: REAL }));
    d.setLaunch({ personAt: person, landmarkHeadingDeg: H, startUtcMs: 0 });
    const w = (50 * Math.PI) / 180; // wind 20 deg off the landmark line
    const mk = (t: number): RoutePoint => {
      const fl = Math.max(0, t - 1.2);
      const ll = fromScene(Math.sin(w) * 2.5 * fl, -Math.cos(w) * 2.5 * fl);
      return { tSec: t, lat: ll.lat, lon: ll.lon, altM: 2.4 + 1.5 * fl, groundM: 0, speedMs: 2.5, headingDeg: 50 };
    };
    run(d, 0, 4.05, 0.05, mk, (t) => {
      const k = Math.round(t * 100) / 100;
      if (k < 0.5 || k > 4) return;
      expect(inFrame(cam, ballPos(mk(t)))).toBe(true);
      expect(inFrame(cam, tower(50))).toBe(true);
      if (k === 0.5) {
        // camera -> person -> landmark roughly in line
        const toPerson = new THREE.Vector3(-cam.position.x, 0, -cam.position.z).normalize();
        expect(toPerson.angleTo(Ld)).toBeLessThan((20 * Math.PI) / 180);
        // the person (a 0.6 x 1.75 m box) does not cover the landmark
        const box = new THREE.Box2(new THREE.Vector2(Infinity, Infinity), new THREE.Vector2(-Infinity, -Infinity));
        for (const x of [-0.3, 0.3]) for (const y of [0, 1.75]) for (const z of [-0.3, 0.3]) {
          const v = new THREE.Vector3(x, y, z).project(cam);
          box.expandByPoint(new THREE.Vector2(v.x, v.y));
        }
        for (const y of [10, 50, 90]) {
          const v = tower(y).project(cam);
          expect(box.containsPoint(new THREE.Vector2(v.x, v.y))).toBe(false);
        }
      }
    });
  });

  test('a non-finite heading (first launch frame, or mid-ride) never poisons the camera', () => {
    const cam = mkPhone(50);
    const d = new Director(cam, deps({ balloonRadius: REAL }));
    d.setLaunch({ personAt: { lat: 50, lon: 0 }, landmarkHeadingDeg: 30, startUtcMs: 0 });
    const mk = (t: number, heading = 50): RoutePoint => ({ ...balloon(0, 2.4 + 1.5 * Math.max(0, t - 1.2), heading), tSec: t, speedMs: 0 });
    d.update(mk(0, NaN), 0);
    d.update(mk(0.05, NaN), 0.05);
    expect(cam.position.toArray().every(Number.isFinite)).toBe(true);
    run(d, 0.05, 30, 0.05, (t) => mk(t), () => expect(cam.position.toArray().every(Number.isFinite)).toBe(true));
    expect(inFrame(cam, ballPos(mk(30)))).toBe(true);
    d.update(mk(30.05, NaN), 0.05);
    run(d, 30.05, 5, 0.05, (t) => mk(t), () => expect(cam.position.toArray().every(Number.isFinite)).toBe(true));
  });
});
