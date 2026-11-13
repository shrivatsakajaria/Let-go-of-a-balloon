import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { keyLight, Sky, SUN_MIN_EL, MOON_MIN_EL } from '../../src/world/sky';
import { lightFor, parseHex, stageLight } from '../../src/world/palette';
import { SunLight, sunDirection } from '../../src/world/sunlight';
import { sunPosition } from '../../src/geo/sun';

const MANCHESTER = { lat: 53.4794, lon: -2.2453 };
const at = (h: number, m: number) => Date.UTC(2026, 10, 13, h, m);
const elOf = (v: THREE.Vector3) => (Math.asin(v.y) * 180) / Math.PI;

describe('keyLight', () => {
  it('by day is the real sun, at the tile proof strengths', () => {
    const L = lightFor(30);
    const k = keyLight({ elevationDeg: 30, azimuthDeg: 180 }, null, L);
    expect(k.dir.distanceTo(sunDirection(30, 180))).toBeLessThan(1e-9);
    expect(k.intensity).toBeCloseTo(stageLight(L).sunIntensity, 9);
    expect(k.color).toBe(stageLight(L).sunColor);
    expect(k.night).toBe(0);
  });

  it('at the tile proof golden hour is exactly what the tile proof lit with', () => {
    const L = lightFor(8);
    const k = keyLight({ elevationDeg: 8, azimuthDeg: 250 }, { elevationDeg: 20, azimuthDeg: 100, illumination: 1 }, L);
    const s = new SunLight(L, sunDirection(8, 250));
    expect(k.dir.distanceTo(sunDirection(8, 250))).toBeLessThan(1e-12);
    expect(k.intensity).toBe(s.sun.intensity);
    expect(new THREE.Color(k.color).getHex()).toBe(s.sun.color.getHex());
  });

  it('never comes from below the horizon at twilight', () => {
    for (const el of [-6, -3, -1, 0, 1]) {
      const k = keyLight({ elevationDeg: el, azimuthDeg: 240 }, null, lightFor(el));
      expect(elOf(k.dir)).toBeGreaterThanOrEqual(SUN_MIN_EL - 1e-9);
    }
  });

  it('at night turns to a cool moonlight from the moon, scaled by how much of it is lit, never black', () => {
    const L = lightFor(-40);
    const full = keyLight({ elevationDeg: -40, azimuthDeg: 0 }, { elevationDeg: 35, azimuthDeg: 160, illumination: 1 }, L);
    const thin = keyLight({ elevationDeg: -40, azimuthDeg: 0 }, { elevationDeg: 35, azimuthDeg: 160, illumination: 0.1 }, L);
    const none = keyLight({ elevationDeg: -40, azimuthDeg: 0 }, { elevationDeg: -20, azimuthDeg: 160, illumination: 1 }, L);
    expect(full.dir.distanceTo(sunDirection(35, 160))).toBeLessThan(1e-9);
    expect(full.night).toBe(1);
    expect(full.intensity).toBeGreaterThan(thin.intensity);
    expect(thin.intensity).toBeGreaterThan(none.intensity * 0.999);
    expect(none.intensity).toBeGreaterThan(0.1);
    expect(none.dir.y).toBeGreaterThan(0.5); // from high in the sky
    const [r, , b] = parseHex(full.color);
    expect(b).toBeGreaterThan(r); // cool
    // a low moon still lights from at least MOON_MIN_EL
    const low = keyLight({ elevationDeg: -40, azimuthDeg: 0 }, { elevationDeg: 7, azimuthDeg: 160, illumination: 1 }, L);
    expect(elOf(low.dir)).toBeGreaterThanOrEqual(MOON_MIN_EL - 1e-6);
  });

  it('turns smoothly from sun to night key as the sun sets', () => {
    let prev = keyLight({ elevationDeg: 2, azimuthDeg: 240 }, null, lightFor(2));
    for (let el = 1.5; el >= -20; el -= 0.5) {
      const k = keyLight({ elevationDeg: el, azimuthDeg: 240 }, null, lightFor(el));
      expect(k.dir.angleTo(prev.dir)).toBeLessThan((8 * Math.PI) / 180); // per half degree of sun (a few minutes)
      expect(k.intensity).toBeGreaterThan(0);
      prev = k;
    }
  });
});

describe('Sky', () => {
  const make = () => {
    const scene = new THREE.Scene();
    const sky = new Sky(scene, { shadow: { radius: 600, mapSize: 1024, snap: 100 } });
    const camera = new THREE.PerspectiveCamera(50, 0.5, 1, 40000);
    camera.position.set(0, 1500, 0);
    camera.lookAt(1000, 1300, 0);
    camera.updateMatrixWorld();
    return { scene, sky, camera };
  };

  it('follows the real sun: noon in Manchester is day, with the sun disc up and no stars', () => {
    const { sky, camera } = make();
    const L = sky.update(at(12, 10), MANCHESTER);
    sky.setView(camera, 40000, 600);
    expect(L.night).toBe(0);
    expect(sky.haze.uNight.value).toBe(0);
    const s = sunPosition(at(12, 10), MANCHESTER);
    expect(sky.sunDir.distanceTo(sunDirection(s.elevationDeg, s.azimuthDeg))).toBeLessThan(1e-9);
    expect(sky.light.dir.distanceTo(sky.sunDir)).toBeGreaterThan(-1); // placed below
    expect(sky.sunDisc.visible).toBe(true);
    expect(sky.stars.visible).toBe(false);
    expect(sky.fog.near).toBeCloseTo(0.2 * sky.fog.far, 9); // haze starts at 20% of the far distance
    expect(sky.fog.far).toBe(40000);
    // the disc sits where the sun is, inside the far plane
    const d = sky.sunDisc.position.clone().sub(camera.position);
    expect(d.normalize().distanceTo(sky.sunDir)).toBeLessThan(1e-6);
    expect(sky.sunDisc.position.distanceTo(camera.position)).toBeLessThan(camera.far);
  });

  it('midnight is ink-blue with stars, no sun disc, and a night key light that still lights', () => {
    const { sky, camera } = make();
    const L = sky.update(at(0, 0), MANCHESTER);
    sky.setView(camera, 40000, 600);
    expect(L.night).toBe(1);
    expect(sky.haze.uNight.value).toBe(1);
    expect(sky.stars.visible).toBe(true);
    expect(sky.sunDisc.visible).toBe(false);
    const top = sky.haze.uTop.value;
    expect(top.z).toBeGreaterThan(top.x); // ink blue
    expect(Math.max(top.x, top.y, top.z)).toBeLessThan(0.25);
    expect(sky.light.sun.intensity).toBeGreaterThan(0.1);
    expect(sky.light.hemi.intensity).toBeGreaterThan(1);
    // no warm glow toward a sun far below the horizon
    expect(sky.haze.uSunCol.value.distanceTo(sky.haze.uHor.value)).toBeLessThan(1e-9);
  });

  it('the shadows follow the key light and redraw when it turns', () => {
    const { sky } = make();
    sky.update(at(12, 10), MANCHESTER);
    const focus = new THREE.Vector3(0, 0, 0);
    expect(sky.place(focus)).toBe(true);
    expect(sky.place(focus)).toBe(false);
    expect(sky.light.dir.distanceTo(sky.key.dir)).toBeLessThan(1e-9);
    sky.update(at(15, 40), MANCHESTER);
    expect(sky.place(focus)).toBe(true);
  });

  it('the moon shows with its phase toward the sun', () => {
    const { sky, camera } = make();
    sky.apply({ elevationDeg: -30, azimuthDeg: 0 }, { elevationDeg: 30, azimuthDeg: 90, illumination: 0.5 });
    camera.lookAt(new THREE.Vector3(3000, 1500 + 1700, 0));
    camera.updateMatrixWorld();
    sky.setView(camera, 40000, 600);
    expect(sky.moonDisc.visible).toBe(true);
    const u = sky.moonDisc.material.uniforms.uSun.value as THREE.Vector3;
    expect(u.length()).toBeCloseTo(1, 6);
  });
});
