import { describe, expect, test } from 'vitest';
import { HAND_OPEN_S, poseAt, releaseTAt, SLIP_FROM_S, SLIP_S, type Phase, type Pose } from '../../src/balloon/gesture';

const DT = 1 / 60;

/** Every scalar of a pose, by name (body.rise, r.fingers, ...). */
function flat(p: Pose): Record<string, number> {
  const o: Record<string, number> = {};
  for (const part of ['body', 'r', 'l'] as const) for (const [k, v] of Object.entries(p[part])) o[`${part}.${k}`] = v;
  return o;
}

/** The whole launch at 60 Hz: idle, the tap at 2 s, the hand opening `wait` s after the tap, then 10 s. */
function launch(wait = 1.2, reduced = false): { t: number; phase: Phase; pose: Record<string, number> }[] {
  const out: { t: number; phase: Phase; pose: Record<string, number> }[] = [];
  const tap = 2, open = tap + wait, end = open + 10;
  for (let i = 0; i * DT <= end + 1e-9; i++) {
    const t = i * DT;
    const phase: Phase = t < tap ? { kind: 'idle' } : t < open ? { kind: 'anticipate', s: t - tap } : { kind: 'released', s: t - open };
    out.push({ t, phase, pose: flat(poseAt(phase, t, reduced)) });
  }
  return out;
}

describe('the release performance (gesture)', () => {
  test('before the tap the hand stays closed round the string, with a gentle breath and weight shift', () => {
    const chest: number[] = [], shift: number[] = [];
    for (let t = 0; t < 8; t += 0.1) {
      const p = poseAt({ kind: 'idle' }, t);
      expect(p.r.fingers).toBe(1);
      expect(p.r.thumb).toBe(1);
      chest.push(p.body.chest);
      shift.push(p.body.shift);
    }
    const span = (a: number[]) => Math.max(...a) - Math.min(...a);
    expect(span(chest)).toBeGreaterThan(0.2); // breathing
    expect(span(shift)).toBeGreaterThan(0.005); // a small weight shift (rad)
    expect(span(shift)).toBeLessThan(0.06);
    expect(poseAt({ kind: 'idle' }, 1).body.look).toBeGreaterThan(0.3); // the head tilted up toward the balloon
  });

  test('pose to pose with no snapping: the tap and the hand opening start exactly where the last pose was', () => {
    for (const clock of [0.3, 2, 7.77]) {
      expect(flat(poseAt({ kind: 'anticipate', s: 0 }, clock))).toEqual(flat(poseAt({ kind: 'idle' }, clock)));
      for (const held of [1.2, 3.4]) {
        const a = flat(poseAt({ kind: 'anticipate', s: held }, clock));
        const b = flat(poseAt({ kind: 'released', s: 0 }, clock));
        for (const k of Object.keys(a)) expect(b[k]).toBeCloseTo(a[k], 9);
      }
    }
  });

  for (const wait of [1.2, 3.1]) {
    for (const reduced of [false, true]) {
      test(`no joint moves faster than a person can (hand opening ${wait} s after the tap${reduced ? ', reduced motion' : ''})`, () => {
        const run = launch(wait, reduced);
        let worst = '';
        let worstD = 0;
        for (let i = 1; i < run.length; i++) {
          for (const k of Object.keys(run[i].pose)) {
            // the fingers and thumb open over about a quarter of a second; everything else is slower
            const lim = /fingers|thumb/.test(k) ? 0.12 : k === 'body.rise' ? 0.004 : 0.05;
            const d = Math.abs(run[i].pose[k] - run[i - 1].pose[k]) / lim;
            if (d > worstD) {
              worstD = d;
              worst = `${k} at ${run[i].t.toFixed(2)} s`;
            }
          }
        }
        expect(worstD, worst).toBeLessThan(1);
      });
    }
  }

  test('anticipation: the arm lifts a little higher, up onto the toes, a breath in', () => {
    const idle = poseAt({ kind: 'idle' }, 2);
    const a = poseAt({ kind: 'anticipate', s: 1.1 }, 3.1);
    expect(a.r.pitch).toBeGreaterThan(idle.r.pitch + 0.15);
    expect(a.body.rise).toBeGreaterThan(0.02);
    expect(a.body.heel).toBeGreaterThan(0.1);
    expect(a.body.chest).toBeGreaterThan(0.6);
    expect(a.r.fingers).toBe(1); // still holding
  });

  test('the hand opens at the release over about 0.25 s: thumb and fingers rotate open, steadily', () => {
    let prevF = 2, prevT = 2;
    for (let s = 0; s <= HAND_OPEN_S + 1e-9; s += 0.01) {
      const p = poseAt({ kind: 'released', s }, 5);
      expect(p.r.fingers).toBeLessThanOrEqual(prevF);
      expect(p.r.thumb).toBeLessThanOrEqual(prevT);
      prevF = p.r.fingers;
      prevT = p.r.thumb;
    }
    expect(poseAt({ kind: 'released', s: 0 }, 5).r.fingers).toBe(1);
    expect(poseAt({ kind: 'released', s: 0.1 }, 5).r.fingers).toBeLessThan(0.9);
    expect(poseAt({ kind: 'released', s: HAND_OPEN_S }, 5).r.fingers).toBeLessThan(0.05);
    expect(poseAt({ kind: 'released', s: HAND_OPEN_S }, 5).r.thumb).toBeLessThan(0.05);
    expect(HAND_OPEN_S).toBeGreaterThanOrEqual(0.2);
    expect(HAND_OPEN_S).toBeLessThanOrEqual(0.3);
  });

  test('releaseT: 0 while the fist holds, 0 to 1 as the string slips out over 0.2 to 0.3 s, then 1', () => {
    expect(releaseTAt(-1)).toBe(0);
    expect(releaseTAt(0)).toBe(0);
    expect(releaseTAt(SLIP_FROM_S)).toBe(0);
    expect(releaseTAt(SLIP_FROM_S + SLIP_S)).toBe(1);
    expect(releaseTAt(5)).toBe(1);
    expect(SLIP_S).toBeGreaterThanOrEqual(0.2);
    expect(SLIP_S).toBeLessThanOrEqual(0.3);
    let prev = 0;
    for (let s = 0; s < 0.5; s += 0.005) {
      const r = releaseTAt(s);
      expect(r).toBeGreaterThanOrEqual(prev);
      prev = r;
    }
    // the fingers are already loosening when the string starts to slide
    expect(poseAt({ kind: 'released', s: SLIP_FROM_S }, 5).r.fingers).toBeLessThan(1);
  });

  test('after the release: the open hand follows the balloon up, the body tilts up to watch', () => {
    const a = poseAt({ kind: 'anticipate', s: 1.2 }, 5);
    const p = poseAt({ kind: 'released', s: 1.2 }, 6.2);
    expect(p.r.pitch).toBeGreaterThan(a.r.pitch + 0.8); // the arm well up
    expect(p.r.fingers).toBeLessThan(0.15); // open palm
    expect(p.r.twist).toBeLessThan(-0.8); // turned up toward the balloon
    expect(p.body.look).toBeGreaterThan(0.9); // watching it
    expect(p.body.lean).toBeGreaterThan(0.08);
  });

  test('a small, quiet reaction around 3 to 6 s (a hand to the chest, the arm lowered), then a calm rest', () => {
    const r = poseAt({ kind: 'released', s: 4.6 }, 9);
    expect(r.l.elbow).toBeGreaterThan(1.6); // the other hand comes to the chest
    const rest = poseAt({ kind: 'released', s: 9.5 }, 14);
    expect(rest.l.elbow).toBeLessThan(0.5);
    expect(rest.r.pitch).toBeLessThan(0.4);
    expect(rest.r.fingers).toBeGreaterThan(0.2); // a relaxed hand
    expect(rest.body.look).toBeGreaterThan(0.6); // still watching it go
    // and it stays at rest
    expect(flat(poseAt({ kind: 'released', s: 30 }, 14))).toEqual(flat(poseAt({ kind: 'released', s: 60 }, 14)));
  });

  test('reduced motion: the same hand opening, less body motion', () => {
    for (let s = 0; s < 1; s += 0.02) {
      const full = poseAt({ kind: 'released', s }, 5);
      const calm = poseAt({ kind: 'released', s }, 5, true);
      expect(calm.r.fingers).toBe(full.r.fingers);
      expect(calm.r.thumb).toBe(full.r.thumb);
    }
    const travel = (reduced: boolean, k: string) => {
      const run = launch(1.2, reduced);
      let d = 0;
      for (let i = 1; i < run.length; i++) d += Math.abs(run[i].pose[k] - run[i - 1].pose[k]);
      return d;
    };
    for (const k of ['body.rise', 'body.lean', 'body.shift', 'r.pitch', 'l.elbow']) {
      expect(travel(true, k), k).toBeLessThan(travel(false, k) * 0.6);
    }
  });
});
