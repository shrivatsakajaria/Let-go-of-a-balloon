/**
 * `?fps=1`: a small frame counter at the top of the screen, so SK can check smoothness on his own
 * phone (the test machines draw in software, where frame times mean nothing). It counts the
 * browser's animation frames over the last second, which is the rate the page is really drawn at,
 * in the 3D world and on the 2D map alike, and shows the slowest frame of that second.
 */
import './fps.css';

const WINDOW_MS = 1000;
const SHOW_EVERY_MS = 500;

export class FpsMeter {
  private readonly times: number[] = [];

  tick(t: number): void {
    this.times.push(t);
    while (this.times.length > 2 && t - this.times[0] > WINDOW_MS) this.times.shift();
  }

  /** Frames per second over the last second (0 before two frames). */
  get fps(): number {
    const n = this.times.length;
    return n < 2 ? 0 : ((n - 1) * 1000) / (this.times[n - 1] - this.times[0]);
  }

  /** The longest gap between two frames in the last second, ms. */
  get worstMs(): number {
    let w = 0;
    for (let i = 1; i < this.times.length; i++) w = Math.max(w, this.times[i] - this.times[i - 1]);
    return w;
  }
}

export function fpsText(m: FpsMeter): string {
  return m.fps > 0 ? `${Math.round(m.fps)} fps · slowest ${Math.round(m.worstMs)} ms` : '– fps';
}

/** Show the counter; returns a function that removes it. */
export function mountFps(host: HTMLElement = document.body): () => void {
  const el = document.createElement('p');
  el.className = 'fps';
  el.setAttribute('aria-hidden', 'true');
  host.append(el);
  const m = new FpsMeter();
  let shown = 0;
  let raf = 0;
  const loop = (t: number) => {
    raf = requestAnimationFrame(loop);
    m.tick(t);
    if (t - shown >= SHOW_EVERY_MS) {
      shown = t;
      el.textContent = fpsText(m);
    }
  };
  raf = requestAnimationFrame(loop);
  return () => {
    cancelAnimationFrame(raf);
    el.remove();
  };
}
