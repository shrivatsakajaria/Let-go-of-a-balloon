import { expect, test } from 'vitest';
import { LAUNCH, TERRACE_Y, model } from '../../src/landmarks/models/rio-de-janeiro-christ-the-redeemer';
import { model as sugarloaf } from '../../src/landmarks/models/rio-de-janeiro-sugarloaf';
import { groundGrid } from '../../src/landmarks/layer';
import { siteById } from '../../src/landmarks/registry';
import { regionStyle } from '../../src/world/palette';

const site = siteById('rio-de-janeiro-christ-the-redeemer')!;

test("Corcovado's summit rock and terrace are the landmark's own ground: the launch platform stands at the terrace, the statue is not ground", () => {
  const t = groundGrid(model.build(regionStyle(site.at)))!;
  expect(t).not.toBeNull();
  const at = (x: number, z: number) => t.h[Math.floor((z - t.minZ) / 6) * t.nx + Math.floor((x - t.minX) / 6)];
  // the launch platform, all over
  for (const [dx, dz] of [[0, 0], [-5, -12], [5, 12]]) expect(at(LAUNCH.x + dx, LAUNCH.z + dz)).toBeCloseTo(TERRACE_Y, 3);
  // under the statue: the upper terrace, not the figure's head
  expect(at(0, 0)).toBeCloseTo(TERRACE_Y, 3);
  // down the rock in front, lower
  expect(at(0, -150)).toBeLessThan(TERRACE_Y - 30);
});

test("Sugarloaf marks no ground (its Praia Vermelha station stands on the map's ground as before)", () => {
  expect(groundGrid(sugarloaf.build(regionStyle({ lat: -22.95, lon: -43.16 })))).toBeNull();
});
