/**
 * What the page asks of whatever draws the flight: the 3D world (app/live.ts) or, on a phone without
 * WebGL or one that keeps losing it, the 2D map (fallback/fallback2d.ts).
 */
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

/** What the 3D world hands to the 2D map when it gives up: the start place, the state and any flight. */
export type Handover = { choice: StartChoice; state: 'start' | 'launch' | 'flight' | 'error'; flight: Flight | null };
