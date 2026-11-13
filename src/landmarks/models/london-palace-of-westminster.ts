/**
 * The Palace of Westminster, without the Elizabeth Tower (its own landmark, at the north end): the
 * long Gothic river front with its buttresses, pinnacles and pavilions, the Victoria Tower (98 m)
 * at the south end, the octagonal Central Tower and its spire, Westminster Hall's great roof and
 * twin north towers, St Stephen's porch, and the ranges round the courtyards, under slate roofs.
 * Faceted chalk stone, Contour colours.
 *
 * Model frame (types.ts): origin midway between the Victoria Tower and the Elizabeth Tower, -z
 * along the axis toward the Elizabeth Tower (north), +x toward the river. Plan positions follow
 * the OpenStreetMap building parts (2026-11 tile).
 */
import { Kit, LANDMARK_COLOURS as C } from '../kit';
import type { LandmarkModel } from '../types';
import type { Color, RegionStyle } from '../../world/palette';

/** Everything stands on this (below the street, so slopes never show under it). */
const B = -4;

/** A range of building: walls from B to h, a pitched roof (ridge `ridge` above) along its length. */
function range(k: Kit, x0: number, x1: number, z0: number, z1: number, h: number, ridge: number, roof: Color, walls: Color = C.stone): void {
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, w = x1 - x0, d = z1 - z0;
  k.box('walls', walls, cx, B, cz, w, h - B, d, { top: false });
  if (d >= w) k.gable('plain', roof, cx, h, cz, w, d, ridge, { hip: Math.min(w / 2, 3), ends: roof });
  else {
    k.push(cx, h, cz, 90);
    k.gable('plain', roof, 0, 0, 0, d, w, ridge, { hip: Math.min(d / 2, 3), ends: roof });
    k.pop();
  }
}

/** A square pinnacle: a shaft and a spirelet, on (x, y, z). */
function pinnacle(k: Kit, x: number, y: number, z: number, r: number, shaft: number, tip: number, top: Color = C.chalkShade): void {
  k.prism('plain', C.chalk, x, y, z, r, shaft, 4, { rot: 45, top: false });
  k.spire('plain', top, x, y + shaft, z, r, tip, 4, 45);
}

/** A pavilion on the river front: a taller block, an iron pyramid roof, a pinnacle at each corner. */
function pavilion(k: Kit, cz: number, d: number, h: number, roof: Color): void {
  k.box('walls', C.stone, -8, B, cz, 20, h - B, d, { top: false });
  k.box('plain', C.chalk, -8, h - 0.6, cz, 20.8, 1.2, d + 0.8, { top: false });
  k.pyramid('plain', roof, -8, h, cz, 20, d, 7);
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) pinnacle(k, -8 + sx * 10.4, h - 1, cz + sz * (d / 2 + 0.4), 0.9, 4.5, 3.4);
}

/** The river front: the long range, its buttresses and pinnacles, its pavilions and the Lords' end. */
function riverFront(k: Kit, roof: Color): void {
  // the facade runs at 2.8 deg to the axis (x 64 at the north end, 75 by the south pavilions)
  k.push(70.1, 0, 0, -2.8);
  const z0 = -128, z1 = 106;
  k.box('walls', C.stone, -8.5, B, (z0 + z1) / 2, 17, 22 - B, z1 - z0, { top: false });
  k.box('plain', C.chalk, -8.5, 21.4, (z0 + z1) / 2, 17.8, 1.2, z1 - z0 + 0.8, { top: false });
  k.gable('plain', roof, -8.5, 22.6, (z0 + z1) / 2, 17, z1 - z0, 4.6, { ends: roof });
  // string courses between the storeys
  for (const y of [7, 14.5]) k.box('plain', C.chalkShade, 0.15, y, (z0 + z1) / 2, 0.5, 0.5, z1 - z0, { top: false });
  // buttresses with pinnacles, every 6.5 m
  for (let z = z0 + 3; z < z1 - 2; z += 6.5) {
    k.box('plain', C.chalkShade, 0.45, B, z, 0.9, 27 - B, 0.9, { top: false });
    k.spire('plain', C.chalk, 0.45, 23, z, 0.65, 3.2, 4, 45);
  }
  for (const [cz, d, h] of [[-120, 14, 30], [-100, 12, 32], [-28, 14, 33], [43, 14, 33]]) pavilion(k, cz, d, h, roof);
  // the Lords' end: a wider block that steps out toward the river, with its own pavilion pair
  range(k, -18, 14, z1, 142, 25, 6, roof);
  for (const cz of [112, 136]) {
    k.box('walls', C.stone, 10, B, cz, 10, 32 - B, 10, { top: false });
    k.pyramid('plain', roof, 10, 32, cz, 10, 10, 6);
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) pinnacle(k, 10 + sx * 5.3, 31, cz + sz * 5.3, 0.8, 4.5, 3.2);
  }
  for (let z = z1 + 4; z < 140; z += 6.5) {
    k.box('plain', C.chalkShade, 14.45, B, z, 0.9, 27 - B, 0.9, { top: false });
    k.spire('plain', C.chalk, 14.45, 27, z, 0.65, 3.2, 4, 45);
  }
  k.pop();
}

/** The Victoria Tower, 98 m, over the Sovereign's Entrance. */
function victoriaTower(k: Kit): void {
  k.push(0, 0, 135);
  const s = 11.5;
  k.box('walls', C.stone, 0, B, 0, 2 * s, 75 - B, 2 * s, { topColour: C.slate });
  for (const y of [22, 48]) k.box('plain', C.chalk, 0, y, 0, 2 * s + 0.8, 0.8, 2 * s + 0.8);
  k.box('plain', C.chalk, 0, 73.5, 0, 2 * s + 1.0, 1.5, 2 * s + 1.0);
  for (let i = 0; i < 4; i++) {
    k.push(0, 0, 0, i * 90);
    // panelling ribs, the great entrance arch on the south face, parapet pinnacles
    for (const x of [-4.5, 0, 4.5]) k.box('plain', C.chalkShade, x, 22.8, -s - 0.2, 0.7, 50.6, 0.5, { top: false });
    for (const x of [-5.5, 5.5]) pinnacle(k, x, 75, -s - 0.1, 0.7, 4, 3.5);
    if (i === 2) {
      k.box('plain', C.iron, 0, B, -s - 0.15, 8, 18 - B, 0.4, { top: false });
      k.quad('plain', C.iron, [-4, 18, -s - 0.36], [4, 18, -s - 0.36], [1, 21.5, -s - 0.36], [-1, 21.5, -s - 0.36], [0, 0, -1]);
    }
    k.pop();
  }
  // octagonal corner turrets with spirelets, and the flagstaff
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    k.prism('plain', C.stone, sx * (s - 0.6), B, sz * (s - 0.6), 2.4, 85 - B, 8, { top: false });
    k.prism('plain', C.chalk, sx * (s - 0.6), 85, sz * (s - 0.6), 2.6, 1, 8, { top: false });
    k.spire('plain', C.iron, sx * (s - 0.6), 86, sz * (s - 0.6), 2.6, 7.5, 8);
  }
  k.box('plain', C.iron, 0, 75, 0, 0.35, 23, 0.35);
  k.pop();
}

/** The Central Tower over the Central Lobby: an octagon, a lantern ringed with pinnacles, and its spire. */
function centralTower(k: Kit, roof: Color): void {
  k.push(19, 0, 11);
  k.prism('walls', C.stone, 0, B, 0, 10.5, 44 - B, 8, { top: false });
  k.prism('plain', C.chalk, 0, 44, 0, 11.2, 1.2, 8, { top: false });
  k.prism('walls', C.stone, 0, 45.2, 0, 9, 15, 8, { top: false });
  k.prism('plain', C.chalk, 0, 60, 0, 9.6, 1, 8, { top: false });
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    pinnacle(k, Math.sin(a) * 9.6, 60.5, -Math.cos(a) * 9.6, 0.7, 3.5, 3.5);
  }
  k.spire('plain', roof, 0, 61, 0, 8.6, 27, 8);
  k.prism('plain', C.gilt, 0, 87.8, 0, 0.2, 3, 4);
  k.pop();
}

/** Westminster Hall (1097, Richard II's great roof), its north towers and the west annex. */
function westminsterHall(k: Kit, roof: Color): void {
  const x0 = -47, x1 = -25, z0 = -69, z1 = 6;
  k.box('walls', C.stone, (x0 + x1) / 2, B, (z0 + z1) / 2, x1 - x0, 15 - B, z1 - z0, { top: false });
  k.gable('plain', roof, (x0 + x1) / 2, 15, (z0 + z1) / 2, x1 - x0 + 1, z1 - z0, 13, { ends: C.stone, endsBucket: 'walls' });
  // buttresses down both sides
  for (let z = z0 + 6; z < z1 - 3; z += 9.5) for (const x of [x0 - 0.9, x1 + 0.9]) k.box('plain', C.stoneDeep, x, B, z, 1.8, 14 - B, 1.6, { taper: 0.7 });
  // the great north window and the twin towers either side of it
  k.push((x0 + x1) / 2, 0, z0 - 0.05);
  k.quad('plain', C.iron, [-5, 9, 0], [5, 9, 0], [5, 19, 0], [-5, 19, 0], [0, 0, -1]);
  k.tri('plain', C.iron, -5, 19, 0, 5, 19, 0, 0, 24, 0, 0, 0, -1);
  k.pop();
  for (const x of [x0 + 3, x1 - 3]) {
    k.box('walls', C.stone, x, B, z0 - 1, 6.5, 31 - B, 6.5, { top: false });
    k.box('plain', C.chalk, x, 30.4, z0 - 1, 7.1, 0.8, 7.1, { top: false });
    k.pyramid('plain', C.iron, x, 31.2, z0 - 1, 6.5, 6.5, 5);
  }
  range(k, -61, x0 - 1.8, -72, -20, 12, 4, roof, C.chalkShade);
  // St Stephen's Porch at the south end, St Stephen's Hall on to the Central Lobby
  k.box('walls', C.stone, -35, B, 12.5, 18, 26 - B, 13, { top: false });
  k.push(-35, 26, 12.5, 90);
  k.gable('plain', roof, 0, 0, 0, 13, 18, 7, { ends: C.stone });
  k.pop();
  for (const z of [6, 19]) pinnacle(k, -44.4, 25, z, 1, 7, 4);
  range(k, -26, 4, 5, 19, 24, 6, roof);
}

export const model: LandmarkModel = {
  build(style: RegionStyle) {
    const k = new Kit();
    const roof = style.roofs[0], roof2 = style.roofs[style.roofs.length > 1 ? 1 : 0];
    riverFront(k, roof);
    victoriaTower(k);
    westminsterHall(k, roof2);
    // the north range (Speaker's House) and the link to the Elizabeth Tower
    range(k, 4, 62, -128, -112, 24, 5, roof);
    range(k, -6, 6, -126, -110, 22, 5, roof2);
    // the west front on Old Palace Yard, its buttresses toward the street
    range(k, -18, -4, 19, 124, 24, 6, roof);
    for (let z = 22; z < 122; z += 7) {
      k.box('plain', C.chalkShade, -18.45, B, z, 0.9, 27 - B, 0.9, { top: false });
      k.spire('plain', C.chalk, -18.45, 27, z, 0.65, 3.2, 4, 45);
    }
    // ranges round the courtyards, north to south
    range(k, 0, 10, -112, -76, 24, 5, roof2);
    range(k, 4, 22, -76, -8, 25, 6, roof);
    range(k, 37, 56, -112, -28, 24, 5, roof2);
    range(k, 8, 56, -32, -22, 24, 5, roof);
    // the Central Lobby block under the Central Tower, and the corridors either side of it
    range(k, -4, 44, -8, 30, 26, 5, roof2);
    range(k, 44, 58, -22, 42, 24, 5, roof);
    range(k, -4, 60, 42, 52, 24, 5, roof2);
    // the Lords' side: chamber range, inner range, the south cross range by the Victoria Tower
    range(k, 2, 16, 52, 116, 25, 6, roof);
    range(k, 22, 34, 52, 116, 24, 5, roof2);
    range(k, 40, 56, 52, 106, 24, 5, roof);
    range(k, -18, 58, 112, 124, 24, 5, roof2);
    centralTower(k, C.iron);
    return k.group('london-palace-of-westminster');
  },
};
