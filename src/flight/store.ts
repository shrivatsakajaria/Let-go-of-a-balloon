import { FLIGHT_HOURS } from '../config';
import type { SavedBalloon } from './codec';

const KEY = 'lgoab.balloons.v1';
const CAP = 20;
const HOUR_MS = 3600_000;

/** Deterministic id: release minute, run id and the rounded start. */
export function balloonId(b: SavedBalloon): string {
  return `${Math.round(b.release / 60000)}-${b.runId}-${b.start.lat.toFixed(3)},${b.start.lon.toFixed(3)}`;
}

function valid(x: unknown): x is SavedBalloon {
  const b = x as SavedBalloon | null;
  return (
    !!b && typeof b === 'object' && b.v === 1 && typeof b.name === 'string' && typeof b.runId === 'string' &&
    typeof b.release === 'number' && !!b.start && Array.isArray(b.hourly) && b.hourly.length > 1
  );
}

function read(): SavedBalloon[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(valid).map((b) => ({ ...b, id: b.id ?? balloonId(b) }));
  } catch {
    return [];
  }
}

function write(list: SavedBalloon[]): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

export const store = {
  /** The visitor's balloons, newest first. Empty when storage is unavailable or holds junk. */
  list(): SavedBalloon[] {
    return read();
  },
  /** Save a balloon at the front (replacing a duplicate), keep at most 20. Returns the new list. */
  add(b: SavedBalloon): SavedBalloon[] {
    try {
      const entry = { ...b, id: b.id ?? balloonId(b) };
      const list = [entry, ...read().filter((x) => x.id !== entry.id)].slice(0, CAP);
      return write(list) ? list : [];
    } catch {
      return [];
    }
  },
  remove(id: string): SavedBalloon[] {
    try {
      const list = read().filter((x) => x.id !== id);
      return write(list) ? list : [];
    } catch {
      return [];
    }
  },
};

/** Landed once 72 h have passed since release; hoursAloft is clamped to [0, 72]. */
export function balloonStatus(b: SavedBalloon, nowMs: number): { landed: boolean; hoursAloft: number } {
  const hours = (nowMs - b.release) / HOUR_MS;
  return {
    landed: hours >= FLIGHT_HOURS,
    hoursAloft: Math.min(FLIGHT_HOURS, Math.max(0, Math.floor(hours * 1e6) / 1e6)),
  };
}
