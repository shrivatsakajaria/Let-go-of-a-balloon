import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Clouds, CLOUD_BAND } from '../../src/world/clouds';
import { createHaze } from '../../src/world/haze';
import { lightFor } from '../../src/world/palette';
import { sunDirection } from '../../src/world/sunlight';

function make(opts: { count?: number; ground?: number; sunEl?: number } = {}) {
  const scene = new THREE.Scene();
  const haze = createHaze(lightFor(opts.sunEl ?? 30), sunDirection(opts.sunEl ?? 30, 180));
  const clouds = new Clouds(scene, { haze, count: opts.count, seed: 7, groundAt: () => opts.ground ?? 0 });
  return { scene, haze, clouds };
}

/** Is p inside cloud c grown by r? */
const inside = (c: { x: number; cy: number; z: number; rx: number; ry: number; rz: number; scale: number; rot: number }, p: THREE.Vector3, r: number) => {
  const dx = p.x - c.x, dz = p.z - c.z;
  const cs = Math.cos(c.rot), sn = Math.sin(c.rot);
  const lx = dx * cs - dz * sn, lz = dx * sn + dz * cs; // into the cloud's own axes
  const ly = p.y - c.cy;
  const s = Math.max(1e-6, c.scale);
  return (lx / (c.rx * s + r)) ** 2 + (ly / (c.ry * s + r)) ** 2 + (lz / (c.rz * s + r)) ** 2 < 1;
};

describe('Clouds', () => {
  it('8 to 14 soft faceted clouds in one instanced draw, below cruise height', () => {
    for (const n of [3, 11, 40]) {
      const { scene, clouds } = make({ count: n });
      expect(clouds.list().length).toBe(Math.min(14, Math.max(8, n)));
      const meshes = scene.children.filter((o) => (o as THREE.InstancedMesh).isInstancedMesh) as THREE.InstancedMesh[];
      expect(meshes).toHaveLength(1);
      expect(meshes[0].castShadow).toBe(false);
    }
    const { clouds } = make({ ground: 300 });
    for (const c of clouds.list()) {
      expect(c.cy - c.ry - 300).toBeGreaterThanOrEqual(CLOUD_BAND.base - 1e-6);
      expect(c.cy + c.ry - 300).toBeLessThanOrEqual(CLOUD_BAND.top + 1e-6);
    }
  });

  it('drift with the wind (u east, v north)', () => {
    const { clouds } = make();
    const before = clouds.list().map((c) => ({ ...c }));
    clouds.update(10, { u: 4, v: 3 });
    clouds.list().forEach((c, i) => {
      expect(c.x - before[i].x).toBeCloseTo(40, 6);
      expect(c.z - before[i].z).toBeCloseTo(-30, 6);
    });
  });

  it('are recycled around the focus as it moves on', () => {
    const { clouds } = make();
    const focus = new THREE.Vector3();
    for (let k = 0; k < 300; k++) {
      focus.x += 150; // 45 km east in 300 s
      clouds.setFocus(focus);
      clouds.update(1, { u: 5, v: 0 });
    }
    for (const c of clouds.list()) expect(Math.hypot(c.x - focus.x, c.z - focus.z)).toBeLessThan(clouds.radiusM * 1.25);
    // the ones that fell well behind shrink away and come back ahead, where the camera looks
    for (const c of clouds.list()) if (c.x < focus.x - clouds.radiusM * 0.45) expect(c.leaving).toBe(true);
    expect(clouds.list().filter((c) => c.x > focus.x).length).toBeGreaterThanOrEqual(3);
  });

  it('never hold the balloon or the camera: clearOf keeps a corridor free', () => {
    const { clouds } = make({ count: 14 });
    const target = clouds.list()[0];
    // the camera right in the middle of a cloud
    const cam = new THREE.Vector3(target.x, target.cy, target.z);
    clouds.clearOf(cam, 200);
    clouds.update(0.016, { u: 0, v: 0 });
    for (const c of clouds.list()) expect(inside(c, cam, 0)).toBe(false);
    // keep asking for a few seconds: nothing comes within 200 m, and nothing new spawns there
    for (let k = 0; k < 300; k++) {
      clouds.clearOf(cam, 200);
      clouds.update(0.05, { u: 3, v: 1 });
      for (const c of clouds.list()) if (c.scale > 0) expect(inside(c, cam, 0)).toBe(false);
    }
    for (const c of clouds.list()) expect(inside(c, cam, 150)).toBe(false);
  });

  it('cast soft shadows by day through the shared haze uniforms, none at night', () => {
    const day = make({ sunEl: 30 });
    day.clouds.update(0.016, { u: 0, v: 0 });
    const u = day.haze.uClouds.value;
    const n = day.clouds.list().length;
    for (let i = 0; i < n; i++) {
      const c = day.clouds.list()[i];
      expect(u[i].x).toBeCloseTo(c.x, 6);
      expect(u[i].y).toBeCloseTo(c.cy, 6);
      expect(u[i].w).toBeGreaterThan(100);
    }
    for (let i = n; i < u.length; i++) expect(u[i].w).toBe(0);
    expect(day.haze.uCloudSun.value.w).toBeGreaterThan(0.15);
    expect(day.haze.uCloudSun.value.y).toBeCloseTo(day.haze.uSunDir.value.y, 9);

    const night = make({ sunEl: -30 });
    night.haze.uNight.value = 1;
    night.clouds.update(0.016, { u: 0, v: 0 });
    expect(night.haze.uCloudSun.value.w).toBe(0);
  });

  it('move with the floating origin', () => {
    const { clouds } = make();
    const before = clouds.list().map((c) => ({ ...c }));
    clouds.shift(1000, -500);
    clouds.list().forEach((c, i) => {
      expect(c.x).toBeCloseTo(before[i].x - 1000, 6);
      expect(c.z).toBeCloseTo(before[i].z + 500, 6);
    });
  });
});
