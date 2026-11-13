/**
 * A phone can take the WebGL context away (memory pressure, the GPU process restarting, too many tabs).
 * The first time, the page asks for it back and redraws the scene (three.js uploads everything again
 * on its own; we only ask for the shadows to be redrawn). A second loss, or a context that does not
 * come back in time, means this phone cannot keep the 3D world: the 2D map takes over (spec 6.7).
 */
export type ContextHandlers = {
  onLost?(): void;
  /** The context is back: everything GPU-side is being uploaded again. */
  onRestored(): void;
  /** Called at most once: stop using WebGL. */
  onGiveUp(): void;
};

export type ContextWatch = { readonly losses: number; dispose(): void };

/** How long to wait for a lost context to come back before giving up. */
export const RESTORE_WAIT_MS = 4000;

export function watchContextLoss(target: EventTarget, h: ContextHandlers, opts: { restoreWaitMs?: number } = {}): ContextWatch {
  const wait = opts.restoreWaitMs ?? RESTORE_WAIT_MS;
  let losses = 0;
  let gaveUp = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const giveUp = () => {
    clearTimeout(timer);
    if (gaveUp) return;
    gaveUp = true;
    h.onGiveUp();
  };
  const lost = (e: Event) => {
    e.preventDefault(); // without this the browser never offers the context back
    if (gaveUp) return;
    losses++;
    h.onLost?.();
    if (losses >= 2) return giveUp();
    clearTimeout(timer);
    timer = setTimeout(giveUp, wait);
  };
  const restored = () => {
    if (gaveUp) return;
    clearTimeout(timer);
    h.onRestored();
  };
  target.addEventListener('webglcontextlost', lost);
  target.addEventListener('webglcontextrestored', restored);
  return {
    get losses() {
      return losses;
    },
    dispose() {
      clearTimeout(timer);
      target.removeEventListener('webglcontextlost', lost);
      target.removeEventListener('webglcontextrestored', restored);
    },
  };
}
