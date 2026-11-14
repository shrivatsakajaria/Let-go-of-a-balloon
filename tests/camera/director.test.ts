import { describe, expect, test } from 'vitest';
import * as THREE from 'three';
import { Director, type DirectorDeps } from '../../src/camera/director';
import { displayScale } from '../../src/balloon/balloon';
import { FacadeSlide } from '../../src/balloon/slide';
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
/** Where a point lands in the frame (NDC). */
function ndc(cam: THREE.PerspectiveCamera, p: THREE.Vector3) {
  cam.updateMatrixWorld(true);
  return p.clone().project(cam);
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

  test('launch honours a view chosen during the launch once it ends', () => {
    const d = new Director(mkCam(), deps());
    d.setLaunch({ personAt: { lat: 50, lon: 0 }, landmarkHeadingDeg: 0, startUtcMs: 0 });
    d.set('side');
    expect(d.mode).toBe('launch');
    run(d, 0, 41);
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
      // Let go: the launch runs from 0 and settles in ride no sooner than 12 s and no later than 40 s
      d.go();
      expect(d.waiting).toBe(false);
      run(d, 30, 11.9, 0.1, held);
      expect(d.shot).toBe('launch');
      run(d, 41.9, 28.2, 0.1, held);
      expect(d.mode).toBe('film');
      expect(d.shot).not.toBe('launch');
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

  test('waiting and the street shot: the camera never stands in a tree or behind one (a park of trees south of the person)', () => {
    const cam = mkPhone(50);
    // trees everywhere more than 3 m south of the person (z > 3), crowns 11 m tall
    const treeTopAt = (p: LatLon, r: number) => (toScene(p).z + r > 3 ? 11 : -Infinity);
    const d = new Director(cam, deps({ balloonRadius: REAL, treeTopAt }));
    d.setLaunch({ personAt: { lat: 50, lon: 0 }, landmarkHeadingDeg: 0, startUtcMs: 0, waiting: { centerY: 0.15, spanY: 0.7 } });
    const held = (t: number): RoutePoint => ({ tSec: t, lat: 50, lon: 0, altM: 2.4, groundM: 0, speedMs: 2.5, headingDeg: 0 });
    run(d, 0, 6, 0.05, held, () => expect(cam.position.z).toBeLessThan(3 - 1.5));
    d.go();
    run(d, 6, 1.1, 0.05, held, () => expect(cam.position.z).toBeLessThan(3 - 1.5));
  });

  test('waiting in a park of trees (a 14 m grid, crowns 3.5 m across the line): the camera finds an aisle with a clear sightline to the person', () => {
    const cam = mkPhone(50);
    const trees: [number, number][] = [];
    for (let i = -6; i <= 6; i++) for (let j = -6; j <= 6; j++) trees.push([i * 14 + 6, j * 14 + 5]);
    // and trees right on the landmark's line behind the person, and by the upwind street spots
    for (const k of [7, 12, 17]) trees.push([-0.5 * k, 0.866 * k]);
    trees.push([1.5, -5.5], [-4, -1], [7, 0], [9.5, 0], [12, 0], [14.5, 0], [17, 0]);
    const treeTopAt = (p: LatLon, r: number) => {
      const s = toScene(p);
      return trees.some(([x, z]) => Math.hypot(s.x - x, s.z - z) < r + 3.5) ? 11 : -Infinity;
    };
    const d = new Director(cam, deps({ balloonRadius: REAL, treeTopAt }));
    d.setLaunch({ personAt: { lat: 50, lon: 0 }, landmarkHeadingDeg: 30, startUtcMs: 0, waiting: { centerY: 0.15, spanY: 0.7 } });
    const held = (t: number): RoutePoint => ({ tSec: t, lat: 50, lon: 0, altM: 2.4, groundM: 0, speedMs: 2.5, headingDeg: 200 });
    run(d, 0, 8, 0.05, held);
    expect(Math.hypot(cam.position.x, cam.position.z)).toBeGreaterThan(5); // a wide shot, not a step behind them
    const c = cam.position;
    for (let f = 0.05; f < 1; f += 0.05) {
      const q = new THREE.Vector3(c.x * (1 - f), 0, c.z * (1 - f));
      for (const [x, z] of trees) expect(Math.hypot(q.x - x, q.z - z), `${f.toFixed(2)}`).toBeGreaterThan(3.5);
    }
  });

  // (the reviewer's reproduction: the real crane in a park, a 14 m grid of trees with crowns 3.4 m in radius, 11 m tall)
  test.each([[225, 0, 3], [225, 1.3, 5.3], [180, 0.4, 5], [270, -2.5, 4], [200, 3, 2]])('the launch in a park (wind %d deg, grid offset %d m, %d m/s): the camera is never inside a tree\'s crown', (heading, ox, speed) => {
    const trees: [number, number][] = [];
    for (let i = -8; i <= 8; i++) for (let j = -8; j <= 8; j++) trees.push([i * 14 + ox, j * 14 + 4.2]);
    const treeTopAt = (p: LatLon, r: number) => {
      const s = toScene(p);
      return trees.some(([x, z]) => Math.hypot(s.x - x, s.z - z) <= r + 3.4) ? 11 : -Infinity;
    };
    const crownNear = (p: LatLon, r: number, out: { lat: number; lon: number; radius: number; base: number; top: number }) => {
      const s = toScene(p);
      let best = -1, gap = Infinity;
      trees.forEach(([x, z], i) => {
        const g = Math.hypot(s.x - x, s.z - z) - 3.4;
        if (g <= r && g < gap) { gap = g; best = i; }
      });
      if (best < 0) return false;
      Object.assign(out, fromScene(trees[best][0], trees[best][1]), { radius: 3.4, base: 0, top: 11 });
      return true;
    };
    const cam = mkPhone(50);
    const d = new Director(cam, deps({ balloonRadius: REAL, buildingTopAt: () => 0, treeTopAt, crownNear }));
    d.setLaunch({ personAt: { lat: 50, lon: 0 }, landmarkHeadingDeg: 315, startUtcMs: 0, waiting: { centerY: 0.2, spanY: 1.2 }, cueRelease: true });
    const h = (heading * Math.PI) / 180;
    const mk = (t: number): RoutePoint => {
      const fl = Math.max(0, t - 1.2);
      const ll = fromScene(Math.sin(h) * speed * fl, -Math.cos(h) * speed * fl);
      return { tSec: t, lat: ll.lat, lon: ll.lon, altM: 2.4 + 1.5 * fl, groundM: 0, speedMs: speed, headingDeg: heading };
    };
    for (let i = 0; i < 30; i++) d.update(mk(0), 0.05);
    d.go();
    for (let i = 1; i <= 20 / 0.05; i++) {
      const t = i * 0.05;
      if (Math.abs(t - 1.2) < 1e-6) d.release();
      d.update(mk(t), 0.05);
      const c = cam.position;
      for (const [x, z] of trees) if (c.y < 11) expect(Math.hypot(c.x - x, c.z - z), `${t.toFixed(2)} ${d.shot}`).toBeGreaterThanOrEqual(3.4 * (1 - c.y / 11) - 1e-6);
    }
  });

  test('trees streaming in after the street spot was chosen: it is chosen again where it sees the person', () => {
    const cam = mkPhone(50);
    let trees: [number, number][] = [];
    const treeTopAt = (p: LatLon, r: number) => {
      const s = toScene(p);
      return trees.some(([x, z]) => Math.hypot(s.x - x, s.z - z) <= r + 3.4) ? 11 : -Infinity;
    };
    const d = new Director(cam, deps({ balloonRadius: REAL, treeTopAt }));
    d.setLaunch({ personAt: { lat: 50, lon: 0 }, landmarkHeadingDeg: 315, startUtcMs: 0, waiting: { centerY: 0.2, spanY: 1.2 }, cueRelease: true });
    const held = (t: number): RoutePoint => ({ tSec: t, lat: 50, lon: 0, altM: 2.4, groundM: 0, speedMs: 3, headingDeg: 225 });
    run(d, 0, 2, 0.05, held);
    const S = (d as unknown as { street: THREE.Vector3 }).street.clone();
    // a tree arrives right on the line from that spot to the person
    trees = [[S.x * 0.5, S.z * 0.5]];
    run(d, 2, 3, 0.05, held);
    const S2 = (d as unknown as { street: THREE.Vector3 }).street;
    for (const f of [0.2, 0.35, 0.5, 0.7, 0.85]) {
      const q = { x: S2.x * (1 - f), z: S2.z * (1 - f) };
      expect(Math.hypot(q.x - trees[0][0], q.z - trees[0][1])).toBeGreaterThan(3.4 + 0.6);
    }
  });

  test('waiting: the camera stands on the ground as drawn once finer tiles arrive, and moves off a building that arrives on its spot', () => {
    const person: LatLon = { lat: 50, lon: 0 };
    let ground = 60; // the coarse fallback before any tile is in
    let blocks = false;
    const buildingTopAt = (p: LatLon, r: number) => {
      const x = toScene(p).x;
      return blocks && x - r < -3 && x + r > -30 ? ground + 20 : ground;
    };
    const cam = new THREE.PerspectiveCamera(50, 390 / 844, 0.05, 100000);
    const d = new Director(cam, deps({ balloonRadius: REAL, groundAt: () => ground, buildingTopAt }));
    d.setLaunch({ personAt: person, startUtcMs: 0, waiting: { centerY: 0.15, spanY: 0.7 } });
    const held = (t: number): RoutePoint => ({ tSec: t, lat: 50, lon: 0, altM: ground + 2.4, groundM: ground, speedMs: 3, headingDeg: 90 });
    run(d, 0, 2, 0.1, held);
    expect(cam.position.y).toBeLessThan(60 + 2);
    ground = 5; // the street, as drawn
    run(d, 2, 10, 0.1, held);
    expect(cam.position.y).toBeGreaterThan(5 + 1);
    expect(cam.position.y).toBeLessThan(5 + 2);
    blocks = true; // a terrace arrives where the camera stands (upwind, west)
    run(d, 12, 12, 0.1, held);
    expect(cam.position.x).toBeGreaterThan(-3);
    expect(cam.position.y).toBeLessThan(5 + 2);
  });

  test('cut ends a launch at once (a balloon opened from a link) and frames the balloon in the chosen view', () => {
    const cam = mkPhone(50);
    const d = new Director(cam, deps({ balloonRadius: REAL }));
    d.setLaunch({ personAt: { lat: 50, lon: 0 }, startUtcMs: 0, waiting: { centerY: 0.2, spanY: 0.8 } });
    run(d, 0, 2);
    d.cut('film');
    expect(d.mode).toBe('film');
    expect(d.shot).toBe('ride');
    expect(d.waiting).toBe(false);
    d.update(balloon(2.1), 0.1);
    const B = ballPos(balloon(2.1));
    expect(cam.position.distanceTo(B)).toBeLessThan(3);
    expect(inFrame(cam, B)).toBe(true);
  });

  test('featured landmark, any wind (R36): behind the person in the start screen and in the first second of the launch', () => {
    const person: LatLon = { lat: 50, lon: 0 };
    const H = 100;
    const lh = (H * Math.PI) / 180;
    const Ld = new THREE.Vector3(Math.sin(lh), 0, -Math.cos(lh));
    const ground = 5;
    for (const heading of [0, 45, 90, 135, 180, 225, 270, 315]) {
      for (const dist of [40, 300]) {
        const tower = (y: number) => Ld.clone().multiplyScalar(dist).setY(ground + y);
        const cam = new THREE.PerspectiveCamera(50, 390 / 844, 0.05, 100000);
        const d = new Director(cam, deps({ balloonRadius: REAL, groundAt: () => ground }));
        const band = { centerY: 0.15, spanY: 0.7 };
        d.setLaunch({ personAt: person, landmarkHeadingDeg: H, startUtcMs: 0, waiting: band });
        const held = (t: number): RoutePoint => ({ tSec: t, lat: 50, lon: 0, altM: ground + 2.4, groundM: ground, speedMs: 3, headingDeg: heading });
        run(d, 0, 10, 0.1, held);
        const msg = `wind ${heading}, landmark ${dist} m`;
        // the start screen: the person in the band and the landmark right behind them
        const feet = new THREE.Vector3(0, ground, 0);
        expect(inFrame(cam, feet), msg).toBe(true);
        expect(inFrame(cam, tower(10)), msg).toBe(true);
        const f = ndc(cam, feet), l = ndc(cam, tower(10));
        expect(Math.abs(f.x - l.x), msg).toBeLessThan(0.35);
        // Let go: at 0.5 s (still held) and at 1 s the landmark is in the street shot too
        d.go();
        run(d, 10, 1, 0.05, held, (t) => {
          const k = Math.round((t - 10) * 100) / 100;
          if (k === 0.5 || k === 1) {
            expect(inFrame(cam, tower(10)), `${msg} at ${k} s`).toBe(true);
            expect(inFrame(cam, ballPos(held(t))), `${msg} at ${k} s`).toBe(true);
          }
        });
      }
    }
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
  // ---- the whole-trip replay (Task 18): a high, wide camera following the route at 72 hours in 15 s ----
  /** The replay's balloon: 170 km/s east (2,600 km in 15 s) at cruise. */
  const fast = (heading = 90) => (t: number): RoutePoint => ({ tSec: t, lat: 50, lon: (170_000 * t) / K, altM: 1500, groundM: 0, speedMs: 10, headingDeg: heading });
  const camRel = (cam: THREE.PerspectiveCamera, b: RoutePoint) => cam.position.clone().sub(ballPos(b));

  test('replay shot, wide: over 30 km above the balloon and behind it, looking down on it, the balloon in the frame', () => {
    const cam = mkPhone(50);
    const d = new Director(cam, deps({ balloonRadius: REAL }));
    d.cut('replay');
    d.replayWide = 1;
    expect(d.shot).toBe('replay');
    const mk = fast();
    run(d, 0, 3, 1 / 30, mk);
    const b = mk(3);
    const rel = camRel(cam, b);
    expect(rel.y).toBeGreaterThan(30_000);
    expect(rel.x).toBeLessThan(-10_000); // behind: the balloon flies east, away from the camera
    expect(Math.abs(rel.z)).toBeLessThan(2_000);
    expect(inFrame(cam, ballPos(b))).toBe(true);
    const look = cam.getWorldDirection(new THREE.Vector3());
    expect(look.y).toBeLessThan(-0.5); // well down
    // the land ahead of the balloon is in view too
    const ahead = ballPos(mk(3.2));
    ahead.y = 0;
    expect(inFrame(cam, ahead)).toBe(true);
  });

  test('replay shot, close: beside the balloon (under 1 km) at width 0; the 2 s climb is followed within about 0.3 s', () => {
    const cam = mkPhone(50);
    const d = new Director(cam, deps({ balloonRadius: REAL }));
    const still = (t: number): RoutePoint => ({ ...balloon(t, 300), lon: 0, speedMs: 0 });
    d.cut('replay');
    d.replayWide = 0;
    run(d, 0, 1, 1 / 30, still);
    const near = cam.position.distanceTo(ballPos(still(1)));
    expect(near).toBeLessThan(1000);
    expect(near).toBeGreaterThan(30);
    expect(inFrame(cam, ballPos(still(1)))).toBe(true);
    // climb: width eased 0 -> 1 over 2 s, then held
    const dist: number[] = [];
    run(d, 1, 2.5, 1 / 30, still, (t) => {
      const u = Math.min(1, (t - 1) / 2);
      d.replayWide = 0.5 - 0.5 * Math.cos(Math.PI * u);
      dist.push(cam.position.distanceTo(ballPos(still(t))));
      expect(inFrame(cam, ballPos(still(t)))).toBe(true);
    });
    // never backwards, and at 2.3 s into the climb within 10% of the wide distance
    for (let i = 1; i < dist.length; i++) expect(dist[i]).toBeGreaterThanOrEqual(dist[i - 1] - 1);
    expect(dist[Math.round(2.3 * 30) - 1]).toBeGreaterThan(0.9 * dist[dist.length - 1]);
  });

  test('replay shot: a heading that swings every 0.2 s (hours flicking past) barely turns the camera', () => {
    const cam = mkPhone(50);
    const d = new Director(cam, deps({ balloonRadius: REAL }));
    d.cut('replay');
    d.replayWide = 1;
    const wobble = (t: number): RoutePoint => ({ ...fast()(t), headingDeg: Math.floor(t / 0.2) % 2 ? 50 : 130 });
    d.update(fast()(0), 0); // the route's heading as the replay starts: east
    run(d, 0, 4, 1 / 30, wobble, (t) => {
      const rel = camRel(cam, wobble(t));
      const bearingFromBalloon = (Math.atan2(rel.x, -rel.z) * 180) / Math.PI; // camera sits at 270 (west) for a 90 heading
      expect(Math.abs(((bearingFromBalloon + 360) % 360) - 270)).toBeLessThan(12);
    });
    // a real turn is followed, slowly: heading south for 8 s puts the camera north of the balloon
    const south = (t: number): RoutePoint => ({ ...fast(180)(t) });
    run(d, 4, 8, 1 / 30, south);
    const rel = camRel(cam, south(12));
    expect(-rel.z).toBeGreaterThan(10_000);
  });

  test('replay shot: ground and buildings still clamp the camera when it is close', () => {
    const cam = mkPhone(50);
    const d = new Director(cam, deps({ balloonRadius: REAL, groundAt: () => 280 }));
    d.cut('replay');
    d.replayWide = 0;
    run(d, 0, 2, 1 / 30, (t) => ({ ...balloon(t, 300), speedMs: 0, lon: 0 }), () => expect(cam.position.y).toBeGreaterThanOrEqual(288 - 1e-6));
  });
});

// ---- the launch crane shot (Task 13c, ruling R51) ----
describe('launch crane', () => {
  type Box = { x0: number; x1: number; z0: number; z1: number; top: number };
  /** Buildings as boxes in the flat frame; tops are absolute (like groundAt). */
  const city = (boxes: Box[], ground: number) => (p: LatLon, r: number) => {
    const s = toScene(p);
    let best = ground;
    for (const b of boxes) if (s.x + r > b.x0 && s.x - r < b.x1 && s.z + r > b.z0 && s.z - r < b.z1) best = Math.max(best, b.top);
    return best;
  };
  const inside = (boxes: Box[], p: THREE.Vector3) => boxes.some((b) => p.x > b.x0 && p.x < b.x1 && p.z > b.z0 && p.z < b.z1 && p.y < b.top);
  /** Released at 1.2 s from the hand (2.4 m up), climbing at 1.5 m/s and drifting at `speed` along `heading`. */
  const rising = (ground: number, heading: number, speed = 2.5) => (t: number): RoutePoint => {
    const fl = Math.max(0, t - 1.2);
    const h = (heading * Math.PI) / 180;
    const ll = fromScene(Math.sin(h) * speed * fl, -Math.cos(h) * speed * fl);
    return { tSec: t, lat: ll.lat, lon: ll.lon, altM: ground + 2.4 + 1.5 * fl, groundM: ground, speedMs: speed, headingDeg: heading };
  };
  /** Runs a launch and records when it settled (the shot left 'launch'). */
  function launch(opts: { boxes?: Box[]; ground?: number; heading?: number; speed?: number; landmark?: number; reduced?: boolean; until?: number; each?: (t: number, cam: THREE.PerspectiveCamera, d: Director) => void }) {
    const ground = opts.ground ?? 10;
    const cam = mkPhone(50);
    const d = new Director(cam, deps({ balloonRadius: REAL, groundAt: () => ground, buildingTopAt: city(opts.boxes ?? [], ground), reducedMotion: opts.reduced }));
    d.setLaunch({ personAt: { lat: 50, lon: 0 }, landmarkHeadingDeg: opts.landmark, startUtcMs: 0 });
    const mk = rising(ground, opts.heading ?? 70, opts.speed);
    let settledAt = Number.NaN;
    run(d, 0, opts.until ?? 45, 0.05, mk, (t) => {
      if (Number.isNaN(settledAt) && d.shot !== 'launch') settledAt = t;
      opts.each?.(t, cam, d);
    });
    return { d, cam, mk, settledAt };
  }

  test('Ride settles only once the balloon has cleared the rooftops round it: later among taller buildings', () => {
    // a street running east with the wind, 16 m wide, between two long terraces
    const terraces = (top: number): Box[] => [
      { x0: -300, x1: 300, z0: 8, z1: 40, top },
      { x0: -300, x1: 300, z0: -40, z1: -8, top },
    ];
    const ground = 10;
    const settle = (h: number) => {
      const boxes = terraces(ground + h);
      const mk = rising(ground, 90);
      let lastCam: THREE.Vector3 | null = null;
      const r = launch({
        boxes, ground, heading: 90, until: 45,
        each: (t, cam, d) => {
          const B = ballPos(mk(t));
          expect(inside(boxes, cam.position)).toBe(false); // never inside a building
          if (t > 1.3) expect(inFrame(cam, B)).toBe(true);
          if (d.shot === 'launch' && B.y < ground + h + 4) expect(cam.position.y).toBeLessThan(B.y); // looking up at it in the canyon
          if (lastCam) expect(cam.position.distanceTo(lastCam)).toBeLessThan(0.75); // no cut, the hand-over included
          lastCam = cam.position.clone();
        },
      });
      // when it settled, the balloon was above the terraces with a margin, in the Ride framing
      const B = ballPos(mk(r.settledAt));
      expect(B.y).toBeGreaterThan(ground + h + 3);
      expect(r.d.shot).toBe('ride');
      const f = framing(r.cam, ballPos(mk(45)), REAL(r.cam.position.distanceTo(ballPos(mk(45)))));
      expect(f.h).toBeGreaterThan(0.18);
      expect(f.h).toBeLessThan(0.35);
      return r.settledAt;
    };
    const low = settle(12), high = settle(30);
    expect(low).toBeGreaterThanOrEqual(11.9);
    expect(high).toBeGreaterThan(low + 8);
    expect(high).toBeLessThan(40.1);
  });

  test('an open square with tall buildings downwind: it does not settle into Ride just before drifting in among them', () => {
    const ground = 10;
    const boxes: Box[] = [{ x0: 70, x1: 130, z0: -60, z1: 60, top: ground + 50 }];
    const shots: [number, string][] = [];
    const { settledAt } = launch({ boxes, ground, heading: 90, until: 60, each: (t, _c, d) => shots.push([t, d.shot]) });
    expect(settledAt).toBeLessThan(40.1);
    // once settled, Film rides on: the balloon is not walled in a few seconds later (it looks 8 s ahead)
    for (const [t, s] of shots) if (t >= settledAt && t < settledAt + 8) expect(s, `${t}`).toBe('ride');
  });

  test('a tower beside its path that it never clears in time: the launch still ends by 40 s, in Ride (R57: a landmark beside the balloon is no wall in Ride\'s view)', () => {
    const ground = 10;
    const boxes: Box[] = [{ x0: -60, x1: 60, z0: 20, z1: 70, top: ground + 200 }];
    const { settledAt, d } = launch({ boxes, ground, heading: 90, speed: 0.3, until: 60 });
    expect(settledAt).toBeGreaterThan(30);
    expect(settledAt).toBeLessThan(40.1);
    expect(d.mode).toBe('film');
    expect(d.shot).toBe('ride');
  });

  test('a link opened while the balloon is still down a narrow street: Film circles (Ride would film a wall), then rides once it is above the roofs', () => {
    const ground = 0;
    const boxes: Box[] = [{ x0: -400, x1: 400, z0: 5, z1: 60, top: 40 }, { x0: -400, x1: 400, z0: -60, z1: -5, top: 40 }];
    const cam = mkPhone(50);
    const d = new Director(cam, deps({ balloonRadius: REAL, buildingTopAt: city(boxes, ground) }));
    const mk = (t: number): RoutePoint => ({ ...balloon(t, 20 + 1.5 * t), speedMs: 1, lon: (1 * t) / K });
    d.cut('film');
    const shots: string[] = [];
    run(d, 0, 30, 0.05, mk, (t) => {
      shots.push(d.shot);
      const B = ballPos(mk(t));
      expect(inside(boxes, cam.position)).toBe(false);
      if (B.y < 43) expect(d.shot).not.toBe('ride');
    });
    expect(shots[0]).toBe('circling');
    expect(d.shot).toBe('ride'); // 65 m up by 30 s, still in Ride's 40 s slot
  });

  /** Is the straight line from p to q clear of the boxes (sampled every 0.25 m)? */
  const clearLine = (boxes: Box[], p: THREE.Vector3, q: THREE.Vector3) => {
    const n = Math.ceil(p.distanceTo(q) / 0.25);
    for (let i = 1; i < n; i++) if (inside(boxes, p.clone().lerp(q, i / n))) return false;
    return true;
  };
  test('the crane keeps the balloon in sight every frame: round or over the buildings, never in one, never facing a wall close by; the drawn balloon never inside one', () => {
    // a street east between terraces, a block across it 40 m on, and a tall tower beside the street further on
    const boxes: Box[] = [
      { x0: -200, x1: 200, z0: 8, z1: 40, top: 22 },
      { x0: -200, x1: 30, z0: -40, z1: -8, top: 18 },
      { x0: 40, x1: 70, z0: -8, z1: 8, top: 26 },
      { x0: 90, x1: 110, z0: -50, z1: -30, top: 90 },
    ];
    for (const heading of [80, 100, 70]) {
      const ground = 0;
      const cam = mkPhone(50);
      const top = city(boxes, ground);
      const d = new Director(cam, deps({ balloonRadius: REAL, groundAt: () => ground, buildingTopAt: top }));
      d.setLaunch({ personAt: { lat: 50, lon: 0 }, startUtcMs: 0 });
      const mk = rising(ground, heading, 3);
      const slide = new FacadeSlide();
      const h = (heading * Math.PI) / 180;
      const ux = Math.sin(h), uz = -Math.cos(h);
      const sTop = (x: number, z: number, r: number) => top(fromScene(x, z), r);
      let hidden = 0, walled = 0;
      let maxWalled = 0;
      for (let i = 1; i <= 45 / 0.05; i++) {
        const t = i * 0.05;
        const b = mk(t);
        const s0 = toScene(b);
        if (t > 1.2) slide.step(s0.x, b.altM, s0.z, ux, uz, 3, 0.05, sTop);
        const B = new THREE.Vector3(s0.x - ux * slide.back, b.altM + slide.lift, s0.z - uz * slide.back);
        d.update({ ...b, altM: B.y }, 0.05, B);
        expect(inside(boxes, B), `${heading} ${t.toFixed(2)} balloon`).toBe(false);
        expect(inside(boxes, cam.position), `${heading} ${t.toFixed(2)} camera`).toBe(false);
        if (d.shot !== 'launch' || t < 1.3) continue;
        // in sight: a frame or two of the camera catching up round a corner at most
        if (!clearLine(boxes, cam.position, B.clone().lerp(cam.position, 0.15))) hidden++;
        else hidden = 0;
        expect(hidden, `${heading} ${t.toFixed(2)} line of sight`).toBeLessThan(6);
        expect(inFrame(cam, B)).toBe(true);
        // never facing a wall close by: the line on past the balloon is clear to 10 m from the camera
        const far = B.clone().sub(cam.position).setLength(10).add(cam.position);
        if (cam.position.distanceTo(B) < 9 && !clearLine(boxes, B.clone().lerp(far, 0.1), far)) walled++;
        else walled = 0;
        maxWalled = Math.max(maxWalled, walled);
        expect(walled, `${heading} ${t.toFixed(2)} wall`).toBeLessThan(40); // gone round it within 2 s
      }
      expect(maxWalled).toBeLessThan(32); // round it within about 1.5 s
    }
  });

  test('the crane: the camera opens with the hand, then rises with the balloon close by, the balloon 5-10% of the frame high in its upper part', () => {
    const ground = 10;
    const mk = rising(ground, 70);
    let prevY = -Infinity;
    let personAt15 = false;
    const track: THREE.Vector3[] = [];
    const { settledAt } = launch({
      ground, until: 16,
      each: (t, cam, d) => {
        const k = Math.round(t * 100) / 100;
        const B = ballPos(mk(t));
        if (k === 1.5) personAt15 = inFrame(cam, new THREE.Vector3(0, ground + 0.9, 0));
        if (d.shot === 'launch') {
          expect(inFrame(cam, B)).toBe(true);
          track.push(cam.position.clone());
        }
        // from 4 s until the push begins (in the open, as soon as it may: 7 s before the 12 s floor)
        if (d.shot === 'launch' && k >= 4 && k <= 6.5) {
          const f = framing(cam, B, REAL(cam.position.distanceTo(B)));
          expect(f.h, `${k}`).toBeGreaterThan(0.05);
          expect(f.h, `${k}`).toBeLessThan(0.1);
          expect(f.centre.y, `${k}`).toBeGreaterThan(0.1);
          expect(f.centre.y, `${k}`).toBeLessThan(0.5);
          expect(cam.position.y, `${k}`).toBeGreaterThan(prevY - 1e-6); // rising with it
          prevY = cam.position.y;
        }
      },
    });
    expect(settledAt).toBeGreaterThan(11.9);
    expect(settledAt).toBeLessThan(15);
    expect(personAt15).toBe(true); // the hand opening, the person in the shot
    // smooth: no cut and no lurch
    for (let i = 2; i < track.length; i++) {
      const v1 = track[i].clone().sub(track[i - 1]).divideScalar(0.05);
      const v0 = track[i - 1].clone().sub(track[i - 2]).divideScalar(0.05);
      expect(v1.length()).toBeLessThan(15);
      expect(v1.distanceTo(v0) / 0.05).toBeLessThan(12);
    }
  });

  test('following the balloon away over the person (a landmark downwind, a strong wind), the camera goes over their head, never through them', () => {
    const ground = 10;
    let near = 0;
    launch({
      ground, heading: 100, speed: 6.4, landmark: 95, until: 8,
      each: (_t, cam) => {
        const dh = Math.hypot(cam.position.x, cam.position.z);
        if (dh < 1) { near++; expect(cam.position.y - ground).toBeGreaterThan(2.25); } // the person is 1.75 m tall: half a metre over their head
      },
    });
    expect(near).toBeGreaterThan(0); // it did pass over them
  });

  test('a late release (the route not ready at 1.2 s): the street shot holds until the hand opens, then the crane', () => {
    const ground = 10;
    const cam = mkPhone(50);
    const d = new Director(cam, deps({ balloonRadius: REAL, groundAt: () => ground }));
    d.setLaunch({ personAt: { lat: 50, lon: 0 }, startUtcMs: 0, cueRelease: true });
    const late = 4;
    const mk = (t: number): RoutePoint => {
      const fl = Math.max(0, t - late);
      return { tSec: t, lat: 50, lon: (2.5 * fl) / K, altM: ground + 2.4 + 1.5 * fl, groundM: ground, speedMs: 2.5, headingDeg: 90 };
    };
    let held: THREE.Vector3 | null = null;
    run(d, 0, 10, 0.05, mk, (t) => {
      const k = Math.round(t * 100) / 100;
      if (k === 2) held = cam.position.clone();
      if (k > 2 && k < late) expect(cam.position.distanceTo(held!)).toBeLessThan(1e-3);
      if (k === late) d.release();
    });
    expect(Math.hypot(cam.position.x, cam.position.z)).toBeGreaterThan(Math.hypot(held!.x, held!.z) + 5);
  });

  test('a featured landmark stays in frame through the crane', () => {
    const ground = 0;
    const H = 30;
    const lh = (H * Math.PI) / 180;
    const tower = (y: number) => new THREE.Vector3(Math.sin(lh) * 400, y, -Math.cos(lh) * 400);
    launch({
      ground, landmark: H, heading: 50, until: 12,
      each: (t, cam) => {
        const k = Math.round(t * 100) / 100;
        if ([2, 5, 9].includes(k)) expect(inFrame(cam, tower(60))).toBe(true);
      },
    });
  });

  test('reduced motion: no crane, a still frame of the person and the rising balloon (big enough to read), then a cut to the settled view as it leaves it', () => {
    const ground = 10;
    const mk = rising(ground, 70);
    let still: { pos: THREE.Vector3; q: THREE.Quaternion } | null = null;
    let personIn = false;
    let prev: THREE.Vector3 | null = null;
    let jump = 0;
    const { settledAt, d, cam } = launch({
      ground, reduced: true, until: 45,
      each: (t, cam, d) => {
        const k = Math.round(t * 100) / 100;
        if (d.shot === 'launch' && k >= 1.3) {
          if (!still) still = { pos: cam.position.clone(), q: cam.quaternion.clone() };
          expect(cam.position.distanceTo(still.pos)).toBeLessThan(1e-6); // still
          expect(cam.quaternion.angleTo(still.q)).toBeLessThan(1e-6);
          expect(inFrame(cam, ballPos(mk(t)))).toBe(true);
          if (k === 1.5) personIn = inFrame(cam, new THREE.Vector3(0, ground + 0.9, 0));
          if (k === 1.5) {
            const B = ballPos(mk(t));
            expect(framing(cam, B, REAL(cam.position.distanceTo(B))).h).toBeGreaterThan(0.04); // the balloon reads
          }
        }
        if (prev) jump = Math.max(jump, cam.position.distanceTo(prev));
        prev = cam.position.clone();
      },
    });
    expect(personIn).toBe(true);
    expect(settledAt).toBeGreaterThan(4); // once the balloon is about to leave the still (it is framed close, so it reads)
    expect(settledAt).toBeLessThan(40.1);
    expect(jump).toBeGreaterThan(5); // a cut, not a move
    expect(d.shot).toBe('ride');
    expect(cam.position.distanceTo(ballPos(mk(45)))).toBeLessThan(2.5);
  });
});
