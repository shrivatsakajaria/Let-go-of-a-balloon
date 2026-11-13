import { describe, expect, test } from 'vitest';
import * as THREE from 'three';
import { Director, type DirectorDeps } from '../../src/camera/director';
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
      if ([1, 8, 20].includes(k)) {
        snap[k] = { y: cam.position.y, fov: cam.fov, dist: Math.hypot(cam.position.x - p0.x, cam.position.z - p0.z) };
      }
    });
    expect(snap[1].y).toBeGreaterThanOrEqual(ground + 1.2 - 1e-6);
    expect(snap[1].y).toBeLessThan(ground + 3);
    expect(snap[1].dist).toBeGreaterThan(2);
    expect(snap[1].dist).toBeLessThan(10);
    expect(snap[8].y).toBeGreaterThan(snap[1].y + 5);
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
});
