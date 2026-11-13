/**
 * A small numbers panel for `?fps=1`: frame rate, draw calls and triangles (with and without the
 * shadow pass), and whatever else the page reports. Monospace, top left, off-white on ink.
 */
import type { WebGLRenderer } from 'three';

export class StatsOverlay {
  private readonly el: HTMLElement;
  private frames = 0;
  private since = performance.now();
  private fps = 0;
  private worstMs = 0;
  private lastFrame = performance.now();
  /** Last frame that drew the shadow map, and the last that did not. */
  shadow = { calls: 0, triangles: 0 };
  plain = { calls: 0, triangles: 0 };

  constructor(parent: HTMLElement = document.body) {
    this.el = document.createElement('pre');
    this.el.setAttribute('aria-hidden', 'true');
    Object.assign(this.el.style, {
      position: 'fixed', top: 'max(8px, env(safe-area-inset-top))', left: '8px', margin: '0', padding: '6px 8px',
      font: '11px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace', color: '#f2efe6',
      background: 'rgba(10, 14, 28, 0.62)', borderRadius: '4px', pointerEvents: 'none', zIndex: '10', whiteSpace: 'pre',
    } satisfies Partial<CSSStyleDeclaration>);
    parent.appendChild(this.el);
  }

  /** Call right after renderer.render; `shadowDrawn` when the shadow map was redrawn this frame. */
  frame(renderer: WebGLRenderer, shadowDrawn: boolean, extra: Record<string, string | number> = {}): void {
    const now = performance.now();
    this.worstMs = Math.max(this.worstMs, now - this.lastFrame);
    this.lastFrame = now;
    const { calls, triangles } = renderer.info.render;
    if (shadowDrawn) this.shadow = { calls, triangles };
    else this.plain = { calls, triangles };
    this.frames++;
    if (now - this.since < 500) return;
    this.fps = (this.frames * 1000) / (now - this.since);
    const worst = this.worstMs;
    this.frames = 0;
    this.worstMs = 0;
    this.since = now;
    const k = (n: number) => `${(n / 1000).toFixed(0)}k`;
    const lines = [
      `${this.fps.toFixed(0)} fps  worst ${worst.toFixed(0)} ms`,
      `calls ${this.plain.calls}  tris ${k(this.plain.triangles)}`,
      `+shadow ${this.shadow.calls}  ${k(this.shadow.triangles)}`,
      ...Object.entries(extra).map(([a, b]) => `${a} ${b}`),
    ];
    this.el.textContent = lines.join('\n');
  }
}
