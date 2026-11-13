/**
 * Clock hands for landmark models (the Elizabeth Tower, Shandon, the Royal Liver Building, Cardiff
 * Castle's Clock Tower): local time in the UK and Ireland, and the angles of the hands.
 *
 * Both keep the EU rule: clocks go forward an hour at 01:00 UTC on the last Sunday of March and back
 * at 01:00 UTC on the last Sunday of October. The offset is worked out once per UTC hour into a small
 * state the model keeps (animate must not allocate).
 *
 * Hands are drawn pointing up (+y) from their pivot on a dial facing local -z; turning one by an
 * angle about z (rotation.z) turns it clockwise as seen from in front of the dial.
 */

/** Last Sunday of a month (0-based), 01:00 UTC. */
function changeUtc(year: number, month: number): number {
  const last = new Date(Date.UTC(year, month + 1, 0));
  return last.getTime() - last.getUTCDay() * 864e5 + 3600e3;
}

/** The UK and Ireland's offset from UTC at utcMs (ms): an hour in summer time, else none. */
export function ukOffsetMs(utcMs: number): number {
  const y = new Date(utcMs).getUTCFullYear();
  return utcMs >= changeUtc(y, 2) && utcMs < changeUtc(y, 9) ? 3600e3 : 0;
}

/** The cached offset: the UTC hour it was worked out for, and the offset (ms). */
export type ClockState = { hourKey: number; offsetMs: number };

export const clockState = (): ClockState => ({ hourKey: Number.NaN, offsetMs: 0 });

/** UK and Irish local time at utcMs (ms since the epoch, as if local were UTC). Does not allocate within an hour. */
export function localMs(c: ClockState, utcMs: number): number {
  const key = Math.floor(utcMs / 3600e3);
  if (key !== c.hourKey) {
    c.hourKey = key;
    c.offsetMs = ukOffsetMs(utcMs);
  }
  return utcMs + c.offsetMs;
}

const TAU = 2 * Math.PI;
const turn = (t: number, period: number) => ((((t % period) + period) % period) / period) * TAU;

/** The minute hand's angle at local time t (ms), radians clockwise from twelve. */
export const minuteAngle = (t: number): number => turn(t, 3600e3);

/** The hour hand's angle at local time t (ms), radians clockwise from twelve. */
export const hourAngle = (t: number): number => turn(t, 43200e3);
