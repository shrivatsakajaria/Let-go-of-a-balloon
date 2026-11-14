/**
 * The frame budget (spec 12: under 600,000 triangles and 250 draw calls a frame), wired the same way
 * for the live scene and the world check page. Each frame:
 *
 *   budget.fitView(camera);                  // before drawing: the view's tiles to the cap
 *   if (redraw) budget.fitShadows(scene, f);  // a frame that redraws the shadow map: the pass to its share
 *   renderer.render(scene, camera);
 *   budget.afterRender(renderer.info.render, redraw, now, frameMs);
 *
 * - The view's tiles are held to VIEW_CAP (stream.ts fitView leaves the farthest buildings out, with
 *   hysteresis), less what the rest of the scene drew last frame.
 * - The shadow pass gets what the view leaves of FRAME_BUDGET (SunLight.fit; trees cast within
 *   TREE_SHADOW_M only). When even the smallest disc is over its share, the overage comes off the
 *   view's cap on every frame until the next redraw, not just on the redraw frame, so nothing blinks.
 * - DetailBudget (lod.ts) pulls the buildings levels in while the view stays over its share, or the
 *   frames stay slow (frame times only where they mean something).
 */
import type * as THREE from 'three';
import { DetailBudget } from './lod';
import type { WorldStream } from './stream';
import { FRAME_BUDGET, shadowBudget, TREE_SHADOW_M, VIEW_CAP, type PassCount, type SunLight } from './sunlight';

export class FrameBudget {
  readonly detail = new DetailBudget();
  /** What the view alone drew last frame, and what the last shadow redraw's pass drew. */
  readonly view: PassCount = { triangles: 0, calls: 0 };
  readonly shadow: PassCount = { triangles: 0, calls: 0 };
  /** Off: no caps (the world page's budget=0); the counts are still kept. */
  readonly enabled: boolean;
  private readonly stream: WorldStream;
  private readonly light: SunLight;
  private readonly frameTimes: boolean;
  /** This frame's tiles in view (fitView), the rest of the scene as last frame, and the shadow overage. */
  private viewTiles = 0;
  private other = 0;
  private overage = 0;
  private camera: THREE.Camera | null = null;
  private cap = Infinity;
  private readonly est: PassCount = { triangles: 0, calls: 0 };

  constructor(stream: WorldStream, light: SunLight, opts: { frameTimes: boolean; enabled?: boolean }) {
    this.stream = stream;
    this.light = light;
    this.frameTimes = opts.frameTimes;
    this.enabled = opts.enabled ?? true;
  }

  /** Before drawing. `capped` false (the replay) shows everything the budget left out. */
  fitView(camera: THREE.Camera, capped = true): void {
    this.camera = camera;
    this.cap = this.enabled && capped ? VIEW_CAP - this.other - this.overage : Infinity;
    this.viewTiles = this.stream.fitView(camera, this.cap);
  }

  /** On a frame that redraws the shadow map, before drawing: trees near the focus, the disc to its share. */
  fitShadows(scene: THREE.Object3D, focus: { x: number; z: number }): void {
    this.stream.setShadowFocus(focus.x, focus.z, TREE_SHADOW_M);
    if (!this.enabled) {
      const c = this.light.casters(scene);
      this.shadow.triangles = c.triangles;
      this.shadow.calls = c.calls;
      return;
    }
    this.est.triangles = this.viewTiles + this.other;
    this.est.calls = this.view.calls;
    const budget = shadowBudget(this.est);
    const fit = this.light.fit(scene, budget);
    this.shadow.triangles = fit.triangles;
    this.shadow.calls = fit.calls;
    // even the smallest disc over its share: the view gives that up, on every frame from now on (what
    // it leaves out stays out a while, stream.ts fitView, so this frame's cut is held, not blinked)
    const over = this.est.triangles + fit.triangles - FRAME_BUDGET.triangles;
    this.overage = Math.max(0, this.overage + over);
    if (over > 0 && this.camera && this.cap !== Infinity) {
      this.cap -= over;
      this.viewTiles = this.stream.fitView(this.camera, this.cap, true);
    }
  }

  /**
   * After drawing: what the frame drew (renderer.info.render), whether it redrew the shadow map, the
   * clock and the frame's length (ms). `live` false (the replay) leaves the detail as it is.
   */
  afterRender(info: PassCount, shadowDrawn: boolean, nowMs: number, frameMs: number, live = true): void {
    this.view.triangles = info.triangles - (shadowDrawn ? this.shadow.triangles : 0);
    this.view.calls = info.calls - (shadowDrawn ? this.shadow.calls : 0);
    this.other = Math.max(0, this.view.triangles - this.viewTiles);
    if (this.enabled && live) this.stream.detailScale = this.detail.update(this.view.triangles, nowMs, this.frameTimes ? frameMs : undefined, this.stream.settled);
  }
}
