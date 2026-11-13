import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { FrameBudget } from '../../src/world/framebudget';
import type { WorldStream } from '../../src/world/stream';
import { FRAME_BUDGET, VIEW_CAP, type SunLight } from '../../src/world/sunlight';

/** A stream whose view's tiles draw `tiles` (or the cap, if less), and a light whose smallest disc draws `pass`. */
function rig(tiles: number, pass: number) {
  const caps: number[] = [];
  const stream = {
    detailScale: 1,
    settled: true,
    fitView: (_c: THREE.Camera, cap: number) => {
      caps.push(cap);
      return Math.min(tiles, cap);
    },
    setShadowFocus: () => {},
  } as unknown as WorldStream;
  const light = {
    fit: () => ({ triangles: pass, calls: 20, radius: 200 }),
    casters: () => ({ triangles: pass, calls: 20 }),
  } as unknown as SunLight;
  return { budget: new FrameBudget(stream, light, { frameTimes: false }), caps, stream };
}

describe('FrameBudget', () => {
  const camera = new THREE.PerspectiveCamera();
  const scene = new THREE.Scene();

  it('the view gets the cap less the rest of the scene; a shadow pass over its share comes off the view on every frame after, not just the redraw', () => {
    const { budget, caps } = rig(600_000, 120_000);
    const other = 20_000;
    // a plain frame first: the view's tiles at their cap, the rest of the scene measured
    budget.fitView(camera);
    budget.afterRender({ triangles: VIEW_CAP + other, calls: 80 }, false, 0, 16);
    budget.fitView(camera);
    expect(caps.at(-1)).toBe(VIEW_CAP - other);
    // a redraw whose smallest disc is over its share: the view gives the difference up at once
    budget.fitShadows(scene, { x: 0, z: 0 });
    const over = VIEW_CAP + 120_000 - FRAME_BUDGET.triangles;
    expect(caps.at(-1)).toBe(VIEW_CAP - other - over);
    budget.afterRender({ triangles: VIEW_CAP - over + 120_000, calls: 100 }, true, 16, 16);
    // and keeps it given up on the plain frames that follow (no blink back to the full cap)
    for (let f = 0; f < 5; f++) {
      budget.fitView(camera);
      expect(caps.at(-1)).toBe(VIEW_CAP - other - over);
      budget.afterRender({ triangles: VIEW_CAP - over, calls: 80 }, false, 32 + f * 16, 16);
    }
    // the frame with the redraw stays inside the frame budget
    expect(VIEW_CAP - over + 120_000).toBeLessThanOrEqual(FRAME_BUDGET.triangles);
  });

  it('a shadow pass that fits gives the view its cap back', () => {
    const { budget, caps } = rig(600_000, 120_000);
    budget.fitView(camera);
    budget.fitShadows(scene, { x: 0, z: 0 });
    const cut = caps.at(-1)!;
    expect(cut).toBeLessThan(VIEW_CAP);
    // now the pass is small (the balloon has left the dense centre)
    const light = budget as unknown as { light: { fit: () => object } };
    light.light.fit = () => ({ triangles: 10_000, calls: 5, radius: 600 });
    budget.fitView(camera);
    budget.fitShadows(scene, { x: 0, z: 0 });
    budget.fitView(camera);
    expect(caps.at(-1)).toBe(VIEW_CAP);
  });
});
