import { describe, expect, test } from 'vitest';
import {
  MAX_NAMES,
  NAME_ON_S,
  landingLines,
  nameOpacity,
  pickNames,
  reducedFrame,
  REDUCED_TOTAL_S,
  replayFrame,
  travelFrac,
  wallAtFrac,
  type NameCandidate,
} from '../../src/ui/replaymath';

const H = 3600;

describe('replay timeline (spec 8: 2 s climb, 15 s travel, 2 s descent, 1 s hold)', () => {
  test('the climb holds the start and rises to the wide view by 2 s', () => {
    expect(replayFrame(0)).toMatchObject({ phase: 'climb', routeFrac: 0, wide: 0, landing: 0, done: false });
    const mid = replayFrame(1);
    expect(mid.routeFrac).toBe(0);
    expect(mid.wide).toBeGreaterThan(0.2);
    expect(mid.wide).toBeLessThan(0.8);
    expect(replayFrame(2)).toMatchObject({ phase: 'travel', wide: 1 });
  });

  test('travel covers the 72 hours in 15 s, slow at both ends, never backwards', () => {
    let prev = -1;
    const speeds: number[] = [];
    for (let t = 2; t <= 17.0001; t += 0.05) {
      const f = replayFrame(t).routeFrac;
      expect(f).toBeGreaterThanOrEqual(prev - 1e-12);
      speeds.push(f - prev);
      prev = f;
    }
    expect(replayFrame(17).routeFrac).toBeCloseTo(1, 9);
    expect(replayFrame(2.05).routeFrac).toBeLessThan(0.002); // eased in
    // the middle runs steadily, at most about 1.2 times the average speed
    expect(travelFrac(0.55) - travelFrac(0.45)).toBeLessThan(0.1 * 1.2);
    expect(travelFrac(0.55) - travelFrac(0.45)).toBeGreaterThan(0.1);
    expect(travelFrac(1) - travelFrac(0.98)).toBeLessThan(0.002); // eased out
  });

  test('the descent brings the camera and the balloon down by 19 s, then a 1 s hold, done at 20 s', () => {
    const d = replayFrame(18);
    expect(d.phase).toBe('descent');
    expect(d.routeFrac).toBe(1);
    expect(d.wide).toBeGreaterThan(0.2);
    expect(d.wide).toBeLessThan(0.8);
    expect(replayFrame(19)).toMatchObject({ phase: 'hold', wide: 0, landing: 1, done: false });
    expect(replayFrame(19.99).done).toBe(false);
    expect(replayFrame(20)).toMatchObject({ phase: 'done', done: true, routeFrac: 1 });
  });

  test('another length scales every phase', () => {
    expect(replayFrame(1, 10).wide).toBe(1); // climb is 1 s of 10
    expect(replayFrame(10, 10).done).toBe(true);
  });

  test('wallAtFrac inverts the travel: the moment the route reaches a share of the trip', () => {
    for (const f of [0, 0.1, 0.5, 0.93, 1]) {
      const t = wallAtFrac(f);
      expect(t).toBeGreaterThanOrEqual(2);
      expect(t).toBeLessThanOrEqual(17);
      expect(replayFrame(t).routeFrac).toBeCloseTo(f, 4);
    }
  });

  test('reduced motion: the route draws in place over 2 s, then holds still', () => {
    expect(reducedFrame(0).routeFrac).toBe(0);
    expect(reducedFrame(1).routeFrac).toBeGreaterThan(0.3);
    expect(reducedFrame(2).routeFrac).toBe(1);
    expect(reducedFrame(3).done).toBe(false);
    expect(reducedFrame(REDUCED_TOTAL_S).done).toBe(true);
  });
});

describe('place names on the way', () => {
  const town = (name: string, population: number, hour: number): NameCandidate => ({ name, kind: 'town', population, tSec: hour * H });

  test('at most five, the biggest crossed, in route order, never overlapping, none at the start or the landing', () => {
    const c: NameCandidate[] = [
      town('Manchester', 550000, 0),
      town('Huddersfield', 160000, 2),
      town('Leeds', 790000, 3),
      town('York', 150000, 5),
      town('Hull', 260000, 8),
      { name: 'North Sea', kind: 'sea', tSec: 20 * H },
      town('Stavanger', 140000, 40),
      town('Sandnes', 80000, 44),
      town('Haugesund', 37000, 52),
      town('Bergen', 285000, 72),
      town('Tiny', 6000, 60),
    ];
    const names = pickNames(c, { exclude: ['Manchester', 'Bergen'], flightSec: 72 * H });
    expect(names.length).toBeLessThanOrEqual(MAX_NAMES);
    expect(names.map((n) => n.name)).not.toContain('Manchester');
    expect(names.map((n) => n.name)).not.toContain('Bergen');
    expect(names.map((n) => n.name)).toContain('the North Sea');
    expect(names.map((n) => n.name)).toContain('Stavanger');
    expect(names.map((n) => n.name)).not.toContain('Tiny');
    for (let i = 1; i < names.length; i++) expect(names[i].atS - names[i - 1].atS).toBeGreaterThanOrEqual(NAME_ON_S + 0.3);
    for (const n of names) {
      expect(n.atS).toBeGreaterThanOrEqual(2);
      expect(n.atS + NAME_ON_S).toBeLessThanOrEqual(17);
    }
  });

  test('the same name crossed twice is shown once; generic names never', () => {
    const names = pickNames(
      [town('Leeds', 790000, 3), town('Leeds', 790000, 30), { name: 'open sea', kind: 'sea', generic: true, tSec: 50 * H }],
      { exclude: [], flightSec: 72 * H },
    );
    expect(names.map((n) => n.name)).toEqual(['Leeds']);
  });

  test('not in the first or last moments (the start and the landing are said already); towns outrank vague regions', () => {
    const names = pickNames(
      [town('Salford', 270000, 0.2), town('Nesttun', 30000, 71), { name: 'Great Britain', kind: 'region', tSec: 6 * H }, town('Leeds', 790000, 6.2)],
      { exclude: [], flightSec: 72 * H },
    );
    expect(names.map((n) => n.name)).toEqual(['Leeds']);
  });

  test('a name is on screen for 1.6 s, fading in and out on the interface curve', () => {
    expect(nameOpacity(4.9, 5)).toBe(0);
    expect(nameOpacity(5.1, 5)).toBeGreaterThan(0.3);
    expect(nameOpacity(5.8, 5)).toBe(1);
    expect(nameOpacity(5 + NAME_ON_S - 0.05, 5)).toBeLessThan(0.5);
    expect(nameOpacity(5 + NAME_ON_S, 5)).toBe(0);
  });
});

describe('the landing, as the replay ends', () => {
  const at = { lat: 60.39, lon: 5.32 }; // Bergen
  const ms = Date.UTC(2026, 10, 15, 13, 20);
  test('a town: "Expected to land near", "Bergen", and the local day and time', () => {
    expect(landingLines({ name: 'Bergen', kind: 'town' }, at, ms, false)).toEqual({ kicker: 'Expected to land near', name: 'Bergen', when: 'Sun 15 Nov, 14:20' });
  });
  test('the sea: "Expected to come down in", "the North Sea"', () => {
    expect(landingLines({ name: 'North Sea', kind: 'sea' }, { lat: 57, lon: 3 }, ms, false)).toMatchObject({ kicker: 'Expected to come down in', name: 'the North Sea' });
  });
  test('after 72 hours: "Landed near"', () => {
    expect(landingLines({ name: 'Bergen', kind: 'town' }, at, ms, true).kicker).toBe('Landed near');
    expect(landingLines({ name: 'North Sea', kind: 'sea' }, at, ms, true).kicker).toBe('Came down in');
  });
});
