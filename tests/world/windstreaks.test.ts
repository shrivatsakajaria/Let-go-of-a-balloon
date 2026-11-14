import { describe, expect, it } from 'vitest';
import {
  boxShift,
  easeToward,
  edgeFade,
  heightFade,
  layerDistance,
  STREAK_COUNT,
  STREAK_LAYERS,
  STREAK_REL_GAIN,
  STREAK_REL_MIN_MS,
  streakPos,
  streakTarget,
  streakVelocity,
  turnToward,
  WindStreaks,
  type StreakState,
} from '../../src/world/windstreaks';
import * as THREE from 'three';
import { createHaze } from '../../src/world/haze';
import { lightFor } from '../../src/world/palette';
import { sunDirection } from '../../src/world/sunlight';

const cruise: StreakState = { released: true, landed: false, replay: false, reduced: false, shot: 'ride', aglM: 1500, toLandS: 40 * 3600 };

describe('wind streaks: when they show', () => {
  it('fade in with height: none up to 300 m above the ground, all by 600 m, rising smoothly between', () => {
    expect(heightFade(0)).toBe(0);
    expect(heightFade(300)).toBe(0);
    expect(heightFade(600)).toBe(1);
    expect(heightFade(1500)).toBe(1);
    expect(heightFade(Number.NaN)).toBe(0);
    let last = 0;
    for (let h = 300; h <= 600; h += 10) {
      const f = heightFade(h);
      expect(f).toBeGreaterThanOrEqual(last);
      last = f;
    }
    expect(heightFade(450)).toBeCloseTo(0.5, 5);
  });

  it('show at cruise in every live view, never before release, in the launch, landed, in the replay or with reduced motion', () => {
    for (const shot of ['ride', 'circling', 'side', 'down']) expect(streakTarget({ ...cruise, shot })).toBe(1);
    expect(streakTarget({ ...cruise, released: false })).toBe(0);
    expect(streakTarget({ ...cruise, shot: 'launch' })).toBe(0);
    expect(streakTarget({ ...cruise, landed: true })).toBe(0);
    expect(streakTarget({ ...cruise, replay: true })).toBe(0);
    expect(streakTarget({ ...cruise, reduced: true })).toBe(0);
    expect(streakTarget({ ...cruise, aglM: 200 })).toBe(0);
    expect(streakTarget({ ...cruise, aglM: 450 })).toBeCloseTo(0.5, 5);
  });

  it('fade out over the last minutes before the landing', () => {
    expect(streakTarget({ ...cruise, toLandS: 0 })).toBe(0);
    expect(streakTarget({ ...cruise, toLandS: -5 })).toBe(0);
    expect(streakTarget({ ...cruise, toLandS: 600 })).toBe(1);
    const mid = streakTarget({ ...cruise, toLandS: 150 });
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    // no landing known (a balloon still in the hand): only the height counts
    expect(streakTarget({ ...cruise, toLandS: Number.NaN })).toBe(1);
  });

  it('ease toward the target over a few seconds, never past it', () => {
    let v = 0;
    for (let i = 0; i < 60; i++) v = easeToward(v, 1, 1 / 60, 1.5);
    expect(v).toBeGreaterThan(0.4); // about half way after a second
    expect(v).toBeLessThan(0.6);
    for (let i = 0; i < 240; i++) v = easeToward(v, 1, 1 / 60, 1.5);
    expect(v).toBeGreaterThan(0.95);
    expect(v).toBeLessThanOrEqual(1);
    expect(easeToward(0.3, 1, 0, 1.5)).toBe(0.3);
    expect(easeToward(0.3, 0, 100, 1.5)).toBeCloseTo(0, 9);
    // a long pause (a background tab) lands on the target, not past it
    expect(easeToward(0.3, 1, 1e6, 1.5)).toBe(1);
  });
});

describe('wind streaks: the wind to their velocity', () => {
  const rel = (s: number) => STREAK_REL_MIN_MS + STREAK_REL_GAIN * s;

  it('travel along the wind (u east is +x, v north is -z), flowing past the balloon at 5 m/s plus twice the wind', () => {
    const out = { x: 0, z: 0 };
    streakVelocity(10, 0, { x: 1, z: 0 }, out);
    expect(out.z).toBeCloseTo(0, 9);
    expect(out.x).toBeCloseTo(10 + rel(10), 6);
    streakVelocity(0, 8, { x: 0, z: -1 }, out);
    expect(out.x).toBeCloseTo(0, 9);
    expect(out.z).toBeCloseTo(-(8 + rel(8)), 6);
    // the direction is the wind's once they have turned to it
    const dir = { x: 0, z: 1 };
    for (let i = 0; i < 600; i++) turnToward(dir, 3, -4, 1 / 30);
    streakVelocity(3, -4, dir, out);
    expect(Math.atan2(-out.z, out.x)).toBeCloseTo(Math.atan2(-4, 3), 3);
  });

  it('flow faster past the balloon as the wind rises, all through the light winds', () => {
    const out = { x: 0, z: 0 };
    let last = -1;
    for (let s = 0; s <= 12; s += 0.5) {
      streakVelocity(s, 0, { x: 1, z: 0 }, out);
      const past = out.x - s; // past the balloon, which moves with the wind
      expect(past).toBeCloseTo(rel(s), 9);
      expect(past).toBeGreaterThan(last);
      last = past;
    }
  });

  it('in a calm they drift slowly the way the wind last blew; no jump as the wind dies away', () => {
    const out = { x: 0, z: 0 };
    const dir = { x: 0.6, z: -0.8 };
    streakVelocity(0, 0, dir, out);
    expect(Math.hypot(out.x, out.z)).toBeCloseTo(STREAK_REL_MIN_MS, 9);
    expect(out.x / out.z).toBeCloseTo(0.6 / -0.8, 9);
    streakVelocity(Number.NaN, 2, dir, out);
    expect(Math.hypot(out.x, out.z)).toBeCloseTo(STREAK_REL_MIN_MS, 9);
    // the wind falling from 1 m/s to nothing: the velocity changes smoothly, never stops
    const a = { x: 0, z: 0 }, b = { x: 0, z: 0 };
    const d = { x: 0.6, z: -0.8 };
    for (let s = 1; s >= 0; s -= 0.01) {
      streakVelocity(0.6 * s, 0.8 * s, d, a);
      streakVelocity(0.6 * Math.max(0, s - 0.01), 0.8 * Math.max(0, s - 0.01), d, b);
      expect(Math.hypot(b.x - a.x, b.z - a.z)).toBeLessThan(0.05);
      expect(Math.hypot(b.x, b.z)).toBeGreaterThanOrEqual(STREAK_REL_MIN_MS - 1e-9);
    }
  });

  it('turn toward a new wind over a few seconds, staying a unit direction; a calm leaves them as they are', () => {
    const dir = { x: 1, z: 0 };
    turnToward(dir, 0, 5, 1); // north: scene -z
    expect(Math.hypot(dir.x, dir.z)).toBeCloseTo(1, 9);
    expect(dir.z).toBeLessThan(0);
    expect(dir.x).toBeGreaterThan(0.5); // only part of the way after a second
    turnToward(dir, 0, 0, 1);
    const kept = { ...dir };
    turnToward(dir, 0, 0, 10);
    expect(dir).toEqual(kept);
    for (let i = 0; i < 30; i++) turnToward(dir, 0, 5, 1);
    expect(dir.z).toBeCloseTo(-1, 3);
  });
});

describe('wind streaks: recycled round the view', () => {
  const seeds = Array.from({ length: 200 }, (_, i) => ({ x: (i * 0.618034) % 1, y: (i * 0.414214) % 1, z: (i * 0.732051) % 1 }));

  it('the shift is a fraction of the box, whatever the anchor (a flight of thousands of kilometres)', () => {
    const out = { x: 0, y: 0, z: 0 };
    for (const size of STREAK_LAYERS)
      for (const a of [0, 1, -1, 1234.5, -987654.3, 4.2e6]) {
        boxShift({ x: a, y: -a, z: a / 3 }, { x: 17, y: 1500, z: -40 }, size, out);
        for (const k of ['x', 'y', 'z'] as const) {
          expect(out[k]).toBeGreaterThanOrEqual(0);
          expect(out[k]).toBeLessThan(1);
        }
      }
  });

  it('the anchor may wrap at the largest box: every box repeats there', () => {
    const big = STREAK_LAYERS[STREAK_LAYERS.length - 1];
    const a = { x: 0, y: 0, z: 0 }, b = { x: 0, y: 0, z: 0 };
    for (const size of STREAK_LAYERS) {
      expect(big % size).toBe(0);
      boxShift({ x: 123.4, y: 0, z: -56.7 }, { x: 10, y: 1400, z: 20 }, size, a);
      boxShift({ x: 123.4 + 3 * big, y: 0, z: -56.7 - 7 * big }, { x: 10, y: 1400, z: 20 }, size, b);
      expect(b.x).toBeCloseTo(a.x, 9);
      expect(b.z).toBeCloseTo(a.z, 9);
    }
  });

  it('every streak stays in its box, wherever the wind has carried them and wherever the box is', () => {
    const shift = { x: 0, y: 0, z: 0 };
    const p = { x: 0, y: 0, z: 0 };
    for (const size of STREAK_LAYERS)
      for (const center of [{ x: 300, y: 1350, z: -800 }, { x: -5e4, y: 900, z: 3e4 }])
        for (const a of [0, 55.5, -3210, 7.7e5]) {
          boxShift({ x: a, y: 0, z: -a }, center, size, shift);
          for (const s of seeds) {
            streakPos(s, shift, center, size, p);
            expect(Math.abs(p.x - center.x)).toBeLessThanOrEqual(size / 2 + 1e-6);
            expect(Math.abs(p.y - center.y)).toBeLessThanOrEqual(size / 2 + 1e-6);
            expect(Math.abs(p.z - center.z)).toBeLessThanOrEqual(size / 2 + 1e-6);
          }
        }
  });

  it('move with the wind by exactly its step, and with the box not at all, and are invisible wherever they wrap round (no pop-in)', () => {
    const size = STREAK_LAYERS[0];
    const center = { x: 0, y: 1400, z: 0 };
    const a = { x: 0, y: 0, z: 0 };
    const sh = { x: 0, y: 0, z: 0 };
    const before = { x: 0, y: 0, z: 0 };
    const after = { x: 0, y: 0, z: 0 };
    const q = (p: { x: number; y: number; z: number }) => ({ x: (p.x - center.x) / size, y: (p.y - center.y) / size, z: (p.z - center.z) / size });
    const wind = { x: 0.6, z: -0.3 }; // metres a frame: 40 m/s at 60 frames a second
    const box = { x: -0.2, y: 0.15, z: 0.3 }; // the camera turning and the balloon flying
    for (let f = 0; f < 600; f++) {
      boxShift(a, center, size, sh);
      const pos0 = seeds.map((s) => ({ ...streakPos(s, sh, center, size, before) }));
      a.x += wind.x;
      a.z += wind.z;
      center.x += box.x;
      center.y += box.y;
      center.z += box.z;
      boxShift(a, center, size, sh);
      seeds.forEach((s, i) => {
        streakPos(s, sh, center, size, after);
        const moved = Math.hypot(after.x - pos0[i].x - wind.x, after.y - pos0[i].y, after.z - pos0[i].z - wind.z);
        if (moved > 1e-6) {
          // wrapped: it left at one face and came back at the other, both where it cannot be seen
          expect(edgeFade(q(pos0[i]))).toBeLessThan(0.02);
          expect(edgeFade(q(after))).toBeLessThan(0.02);
        }
      });
    }
  });

  it('are fully visible in the middle of the box and gone at its faces', () => {
    expect(edgeFade({ x: 0, y: 0, z: 0 })).toBe(1);
    expect(edgeFade({ x: 0.5, y: 0, z: 0 })).toBe(0);
    expect(edgeFade({ x: 0, y: -0.5, z: 0 })).toBe(0);
    expect(edgeFade({ x: 0, y: 0, z: 0.5 })).toBe(0);
    expect(edgeFade({ x: 0.2, y: 0.1, z: -0.2 })).toBeGreaterThan(0.5);
  });

  it('the boxes sit one behind another along the look, with no gap between them, for every view', () => {
    for (const fov of [34, 40, 50]) {
      for (let k = 1; k < STREAK_LAYERS.length; k++) {
        const near = layerDistance(STREAK_LAYERS[k - 1], fov), far = layerDistance(STREAK_LAYERS[k], fov);
        expect(far).toBeGreaterThan(near);
        // the far box starts before the near box ends: their fades overlap
        expect(far - 0.5 * STREAK_LAYERS[k]).toBeLessThan(near + 0.5 * STREAK_LAYERS[k - 1] - 10);
      }
      // each is about as tall as the view at its distance
      for (const size of STREAK_LAYERS) {
        const viewH = 2 * layerDistance(size, fov) * Math.tan((fov * Math.PI) / 360);
        expect(size / viewH).toBeGreaterThan(1);
        expect(size / viewH).toBeLessThan(1.4);
      }
    }
  });

  it('a landscape screen is covered side to side: on 16:9 each box is as wide as the view', () => {
    const aspect = 16 / 9;
    for (const fov of [34, 40, 50])
      for (const size of STREAK_LAYERS) {
        const d = layerDistance(size, fov, aspect);
        const tanV = Math.tan((fov * Math.PI) / 360);
        const viewW = 2 * d * tanV * aspect, viewH = 2 * d * tanV;
        expect(size / viewW).toBeGreaterThan(1);
        expect(size / viewW).toBeLessThan(1.4);
        expect(size).toBeGreaterThan(viewH);
        // portrait is as before: sized to the height
        expect(layerDistance(size, fov, 390 / 844)).toBeCloseTo(layerDistance(size, fov), 9);
      }
  });

  it('a few thousand vertices in one draw', () => {
    expect(STREAK_COUNT * 4).toBeLessThanOrEqual(4000);
  });
});

describe('WindStreaks', () => {
  function make() {
    const scene = new THREE.Scene();
    const haze = createHaze(lightFor(30), sunDirection(30, 180));
    const streaks = new WindStreaks(scene, { haze });
    const camera = new THREE.PerspectiveCamera(34, 390 / 844, 0.1, 50000);
    const focus = new THREE.Vector3(0, 1500, 0);
    camera.position.set(-40, 1537, 30);
    camera.lookAt(focus);
    camera.updateMatrixWorld();
    const frame = { focus, focusRadius: 0.25, camera, groundM: 0, wind: { u: 8, v: 3 }, target: 1 };
    return { scene, streaks, camera, focus, frame };
  }
  const uniforms = (w: WindStreaks) => w.mesh.material.uniforms as Record<string, { value: unknown }>;
  /** Every streak's middle (scene metres), as the shader places it. */
  function positions(w: WindStreaks): THREE.Vector3[] {
    const seed = w.mesh.geometry.getAttribute('aSeed'), look = w.mesh.geometry.getAttribute('aLook');
    const centers = uniforms(w).uCenter.value as THREE.Vector3[], shifts = uniforms(w).uShift.value as THREE.Vector3[];
    return Array.from({ length: seed.count }, (_, i) => {
      const k = Math.round(look.getW(i));
      return streakPos({ x: seed.getX(i), y: seed.getY(i), z: seed.getZ(i) }, shifts[k], centers[k], STREAK_LAYERS[k], new THREE.Vector3()) as THREE.Vector3;
    });
  }

  it('one hidden mesh until asked for; then most of the view has streaks in it', () => {
    const { scene, streaks, camera, frame } = make();
    expect(scene.children.filter((o) => o.name === 'wind-streaks')).toHaveLength(1);
    expect(streaks.mesh.visible).toBe(false);
    expect(streaks.onScreen(camera)).toBe(0);
    for (let i = 0; i < 300; i++) streaks.update(1 / 30, frame);
    expect(streaks.opacity).toBeGreaterThan(0.99);
    expect(streaks.mesh.visible).toBe(true);
    expect(streaks.onScreen(camera)).toBeGreaterThan(200);
  });

  it('pause holds them where they are, still shown; they flow again on resume', () => {
    const { streaks, frame } = make();
    for (let i = 0; i < 100; i++) streaks.update(1 / 30, frame);
    streaks.paused = true;
    const before = positions(streaks);
    const t0 = uniforms(streaks).uTime.value;
    for (let i = 0; i < 60; i++) streaks.update(1 / 30, frame);
    expect(streaks.mesh.visible).toBe(true);
    expect(uniforms(streaks).uTime.value).toBe(t0);
    positions(streaks).forEach((p, i) => expect(p.distanceTo(before[i])).toBeLessThan(1e-6));
    streaks.paused = false;
    streaks.update(1 / 30, frame);
    expect(positions(streaks).some((p, i) => p.distanceTo(before[i]) > 0.1)).toBe(true);
  });

  it('a move of the floating origin keeps every streak where it was in the world', () => {
    const { streaks, camera, focus, frame } = make();
    for (let i = 0; i < 50; i++) streaks.update(1 / 30, frame);
    const before = positions(streaks);
    const dx = 1234.5, dz = -987.25;
    streaks.shift(dx, dz);
    focus.x -= dx;
    focus.z -= dz;
    camera.position.x -= dx;
    camera.position.z -= dz;
    camera.updateMatrixWorld();
    streaks.update(0, frame);
    positions(streaks).forEach((p, i) => {
      expect(p.x).toBeCloseTo(before[i].x - dx, 6);
      expect(p.y).toBeCloseTo(before[i].y, 6);
      expect(p.z).toBeCloseTo(before[i].z - dz, 6);
    });
  });

  it('cut hides them at once, and they fade in again from nothing', () => {
    const { streaks, frame } = make();
    for (let i = 0; i < 300; i++) streaks.update(1 / 30, frame);
    streaks.cut();
    expect(streaks.opacity).toBe(0);
    expect(streaks.mesh.visible).toBe(false);
    streaks.update(1 / 30, frame);
    expect(streaks.opacity).toBeLessThan(0.05);
  });

  it('never shown when disabled (reduced motion)', () => {
    const scene = new THREE.Scene();
    const haze = createHaze(lightFor(30), sunDirection(30, 180));
    const streaks = new WindStreaks(scene, { haze, enabled: false });
    const { frame } = make();
    for (let i = 0; i < 300; i++) streaks.update(1 / 30, frame);
    expect(streaks.opacity).toBe(0);
    expect(streaks.mesh.visible).toBe(false);
  });
});
