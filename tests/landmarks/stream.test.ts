import { expect, test } from 'vitest';
import * as THREE from 'three';
import { tileBounds } from '../../src/geo/coords';
import { hiddenFootprints } from '../../src/landmarks/registry';
import { DEFAULT_REGION } from '../../src/world/palette';
import { WorldStream, type BuildPool } from '../../src/world/stream';
import type { BuildRequest } from '../../src/world/worker';

test('the stream sends each tile build only the landmark footprints that reach into it', async () => {
  const sent: Omit<BuildRequest, 'id'>[] = [];
  const pool: BuildPool = { request: (msg) => (sent.push(msg), new Promise(() => {})) };
  const square = { lat: 51.5007, lon: -0.1263 };
  // a far-off footprint too, which no tile here should carry
  const hidden = [...hiddenFootprints(), { lat: 40.7, lon: -74, radiusM: 50 }];
  const stream = new WorldStream(new THREE.Scene(), pool, () => DEFAULT_REGION, { vectorUrl: 'x/{z}/{x}/{y}', origin: square, hidden, maxInFlight: 64 });
  stream.update({ ...square, altM: 30, headingDeg: 90 }, 0);
  await new Promise((r) => setTimeout(r, 0));
  stream.update({ ...square, altM: 30, headingDeg: 90 }, 16);
  expect(sent.length).toBeGreaterThan(4);
  let withSome = 0;
  for (const m of sent) {
    const b = tileBounds(m.z, m.x, m.y);
    for (const h of m.hiddenFootprints ?? []) {
      const pad = h.radiusM / 111320;
      expect(h.lat + pad).toBeGreaterThan(b.south);
      expect(h.lat - pad).toBeLessThan(b.north);
      expect(h.lon).toBeGreaterThan(b.west - 2 * pad);
      expect(h.lon).toBeLessThan(b.east + 2 * pad);
    }
    if ((m.hiddenFootprints ?? []).length > 0) withSome++;
  }
  // the tile under the square carries Westminster's circles
  expect(withSome).toBeGreaterThan(0);
  stream.dispose();
});
