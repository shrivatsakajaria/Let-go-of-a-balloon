import { describe, expect, it } from 'vitest';
import { LOD_LEVELS, levelFor } from '../../src/world/lod';

describe('levelFor: the landing card’s region levels', () => {
  it('has the coarse levels the card sees from very high up (z5, z6), drawn under z7', () => {
    for (const z of [5, 6]) {
      const l = levelFor(z);
      expect(l.z).toBe(z);
      expect(l.detail.buildings).toBe('none');
      expect(l.detail.boats).toBe(false);
      expect(l.castShadow).toBe(false);
      // under z7, deeper the coarser, with skirts deep enough to meet it
      expect(l.dropM).toBeGreaterThan(levelFor(7).dropM);
      expect(l.skirtM).toBeGreaterThan(levelFor(7).skirtM);
    }
    expect(levelFor(5).dropM).toBeGreaterThan(levelFor(6).dropM);
  });

  it('has no level the worlds never ask for', () => {
    expect(() => levelFor(9)).toThrow();
    expect(() => levelFor(3)).toThrow();
  });

  it('leaves the live levels as they are (tilesFor never asks for the card levels)', () => {
    expect(LOD_LEVELS.map((l) => l.z)).toEqual([14, 13, 12, 10, 7]);
  });
});
