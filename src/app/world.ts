/**
 * What the page asks of whatever draws the flight: the 3D world (app/live.ts) or, on a phone without
 * WebGL or one that keeps losing it, the 2D map (fallback/fallback2d.ts).
 */
import { FLIGHT_HOURS } from '../config';
import type { SavedBalloon } from '../flight/codec';
import type { Route } from '../flight/route';
import type { StartChoice } from '../ui/start';

export type Home = { name: string; lat: number; lon: number };
/** A balloon being shown: its route, where it was let go, and whether it is the visitor's own. */
export type Flight = { route: Route; home: Home; own: boolean; launched?: boolean };

export type World = {
  letGo(c: StartChoice): void;
  /** Rejects when the balloon's route could not be fetched. */
  open(b: SavedBalloon): Promise<void>;
  setStart(c: StartChoice): void;
  backToStart(): void;
  /** Let go of everything it drew and listens to, before another world takes its place. */
  dispose?(): void;
};

/** What the 3D world hands over when it is rebuilt or gives up: the start place, the state and any flight. */
export type Handover = { choice: StartChoice; state: 'start' | 'launch' | 'flight' | 'error'; flight: Flight | null };

/** What the world that takes over does with a handover. */
export type ResumeAction = { kind: 'fly'; mode: 'film' | 'side' } | { kind: 'launch' } | { kind: 'start' } | { kind: 'stay' };

/**
 * A flight carries on as a link opens (a landed balloon from the side); a launch that had not let go
 * yet starts again; the winds error goes back to the start screen; the start screen, with any notice
 * over it (a broken link), stays as it is.
 */
export function resumeAction(h: Handover, nowMs: number): ResumeAction {
  if (h.flight) return { kind: 'fly', mode: nowMs >= h.flight.route.release + FLIGHT_HOURS * 3600e3 ? 'side' : 'film' };
  if (h.state === 'launch') return { kind: 'launch' };
  if (h.state === 'error') return { kind: 'start' };
  return { kind: 'stay' };
}
