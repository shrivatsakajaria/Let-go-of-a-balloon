/**
 * The Burj Khalifa, 828 m: the Y-shaped plan of three wings round a hexagonal core, each wing
 * stepping back in turn as it climbs (the spiral of setbacks), the core rising out of the last of
 * them into the spire, a beacon at the tip that lights from dusk. Glass in the region's tower
 * colours, the terraces of the setbacks pale. And the Dubai Fountain in the lake to the south (the
 * CSV's animated touch): its jets dance in the shows on the half hours of the evening (and the two
 * early-afternoon ones), lit from dusk, and are still between shows. No façade light show.
 *
 * Model frame (types.ts): origin on the ground at the core (under the spire); the front (local -z)
 * is the south wing, toward the lake and Burj Park (186.7 deg); the other wings point to 306 and
 * 66 deg. Setback heights and wing lengths from the OpenStreetMap building parts (2026-11).
 */
import * as THREE from 'three';
import { Kit, LANDMARK_COLOURS as C } from '../kit';
import type { LandmarkModel } from '../types';
import type { Color } from '../../world/palette';

const B = -4;
const D2R = Math.PI / 180;

/** Each wing's reach from the core (m) up to each height: [top of section, front wing, wing at +120, wing at 240]. */
const SECTIONS: [number, number, number, number][] = [
  [35, 63, 63, 63], [70, 52, 51, 52], [105, 52, 42, 52], [130, 52, 42, 43], [160, 43, 42, 43], [200, 43, 32, 43],
  [235, 43, 32, 35], [270, 35, 32, 35], [315, 35, 23, 35], [360, 35, 23, 25], [405, 25, 23, 25], [460, 25, 17, 25],
  [520, 25, 17, 16], [560, 15, 17, 16], [580, 15, 17, 13], [625, 15, 13, 13],
];

/** The Y outline: wings of half-width hw reaching lengths ls at turns 0, 120, 240 (clockwise from -z). */
function yOutline(ls: number[], hw: number): [number, number][] {
  const out: [number, number][] = [];
  const notch = hw / Math.sin(60 * D2R);
  for (let i = 0; i < 3; i++) {
    const a = i * 120 * D2R;
    const u = [Math.sin(a), -Math.cos(a)], r = [Math.cos(a), Math.sin(a)];
    const at = (along: number, across: number): [number, number] => [u[0] * along + r[0] * across, u[1] * along + r[1] * across];
    const b = (i * 120 - 60) * D2R;
    out.push([Math.sin(b) * notch, -Math.cos(b) * notch]);
    const L = ls[i], start = Math.max(L - hw * 0.9, notch * 0.75);
    out.push(at(start, -hw), at(L - hw * 0.25, -hw * 0.6), at(L, 0), at(L - hw * 0.25, hw * 0.6), at(start, hw));
  }
  return out;
}

/** A prism on a star-shaped outline (about the origin): walls from y0 to y1 and a flat top. */
function extrude(k: Kit, wall: Color, top: Color, pts: [number, number][], y0: number, y1: number): void {
  for (let i = 0; i < pts.length; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[(i + 1) % pts.length];
    let nx = bz - az, nz = -(bx - ax);
    if (nx * (ax + bx) + nz * (az + bz) < 0) (nx = -nx), (nz = -nz);
    k.quad('walls', wall, [ax, y0, az], [bx, y0, bz], [bx, y1, bz], [ax, y1, az], [nx, 0, nz]);
    k.tri('plain', top, 0, y1, 0, ax, y1, az, bx, y1, bz, 0, 1, 0);
  }
}

/** The Dubai Fountain (model frame, OSM): the long curve along the lake and its three rings. */
const ARC: [number, number][] = [
  [-84, -298], [-80, -276], [-81, -256], [-85, -240], [-92, -222], [-103, -206], [-115, -193], [-130, -182], [-150, -172],
  [-175, -162], [-200, -154], [-225, -151], [-250, -149], [-275, -150], [-302, -154],
];
const RINGS: [number, number, number][] = [[-58, -253, 17], [-128, -219, 21], [-193, -140, 12]];
/** Jet groups that dance together: three stretches of the curve and the rings. */
const GROUPS = 5;
/** The tallest jets (m); the real ones reach 150 m, most of a show is lower. */
const JET_M = 90;

type Fountain = { jets: THREE.Mesh[]; phase: number[] };

/** Dubai time: UTC+4 all year. */
const DUBAI_MS = 4 * 3600e3;

/** Seconds into a fountain show at utcMs, or -1 between shows (4-minute shows at 13:00, 13:30 and every half hour 18:00-23:00). */
export function showSeconds(utcMs: number): number {
  const day = (((utcMs + DUBAI_MS) % 864e5) + 864e5) % 864e5;
  const min = day / 60e3;
  const evening = min >= 18 * 60 && min < 23 * 60 + 4, lunch = min >= 13 * 60 && min < 13 * 60 + 34;
  const into = (day % 1800e3) / 1000;
  return (evening || lunch) && into < 240 ? into : -1;
}

function fountain(g: THREE.Group): Fountain {
  const kits = Array.from({ length: GROUPS }, () => new Kit());
  // jets along the curve, every 9 m or so, in three stretches; heights vary jet to jet
  let n = 0;
  for (let i = 0; i + 1 < ARC.length; i++) {
    const [ax, az] = ARC[i], [bx, bz] = ARC[i + 1];
    const steps = Math.max(1, Math.round(Math.hypot(bx - ax, bz - az) / 9));
    for (let s = 0; s < steps; s++, n++) {
      const t = s / steps;
      kits[Math.min(2, Math.floor((i / (ARC.length - 1)) * 3))].spire('glow', C.chalk, ax + (bx - ax) * t, 0, az + (bz - az) * t, 2, 0.55 + 0.45 * Math.abs(Math.sin(n * 1.7)), 4, 45);
    }
  }
  RINGS.forEach(([x, z, r], i) => {
    for (let j = 0; j < 10; j++) {
      const a = (j / 10) * 2 * Math.PI;
      kits[3 + (i % 2)].spire('glow', C.chalk, x + Math.sin(a) * r, 0, z + Math.cos(a) * r, 2, 0.7 + 0.3 * Math.abs(Math.cos(j * 2.3)), 4, 45);
    }
  });
  const jets = kits.map((k, i) => {
    const m = k.mesh('glow', `fountain-${i}`)!;
    m.castShadow = false;
    m.visible = false;
    m.scale.y = 0.01;
    m.position.y = -1;
    g.add(m);
    return m;
  });
  return { jets, phase: [0, 1.9, 3.7, 0.9, 2.8] };
}

export const model: LandmarkModel = {
  build(style) {
    const k = new Kit();
    const glass = style.tallWalls?.[0] ?? C.chalkShade;
    const glass2 = style.tallWalls?.[1] ?? glass;
    const terrace = C.chalk;
    // the setbacks: a Y section up to each height, the wings narrowing a little as they climb
    let y0 = B;
    SECTIONS.forEach(([y1, ...ls], i) => {
      extrude(k, i % 2 ? glass2 : glass, terrace, yOutline(ls, 11 - (y1 / 625) * 2.5), y0, y1);
      y0 = y1;
    });
    // the core rising out of the last wings, then the spire, its beacon lit from dusk
    k.prism('walls', glass, 0, 625, 0, 11, 20, 6, { r1: 9.5, rot: 30, topColour: terrace });
    k.prism('walls', glass2, 0, 645, 0, 9.5, 55, 6, { r1: 7, rot: 30, topColour: terrace });
    k.prism('plain', C.slate, 0, 700, 0, 6.5, 60, 6, { r1: 3.6, rot: 30 });
    k.prism('plain', C.slate, 0, 760, 0, 3.6, 56, 6, { r1: 1.2, rot: 30, top: false });
    k.box('glow', C.chalk, 0, 816, 0, 1.4, 4, 1.4);
    k.prism('plain', C.slate, 0, 820, 0, 0.7, 8, 4, { r1: 0.15 });
    // the fins up each wing's nose, the tower's sharpest lines
    SECTIONS.forEach(([y1, ...ls], i) => {
      const yb = i ? SECTIONS[i - 1][0] : B;
      for (let w = 0; w < 3; w++) {
        k.push(0, 0, 0, w * 120);
        k.box('plain', C.chalkShade, 0, yb, -ls[w] - 0.4, 1.2, y1 - yb, 1.2, { top: false });
        k.pop();
      }
    });
    // the podium round the base
    k.box('plain', C.stoneDeep, 0, B, 0, 70, 3 - B, 70, { topColour: C.paving });

    const g = k.group('dubai-burj-khalifa');
    g.userData.fountain = fountain(g);
    return g;
  },

  animate(group, utcMs) {
    const f = group.userData.fountain as Fountain | undefined;
    if (!f) return;
    const s = showSeconds(utcMs);
    for (let i = 0; i < f.jets.length; i++) {
      const m = f.jets[i];
      if (s < 0) {
        m.visible = false;
        continue;
      }
      // rise in the first seconds, fall away in the last; in between each group sways to its own beat
      const env = Math.min(1, s / 6, (240 - s) / 6);
      const beat = Math.sin(s * (0.9 + 0.23 * i) + f.phase[i]);
      m.visible = true;
      m.scale.y = Math.max(0.02, JET_M * env * (0.2 + 0.8 * beat * beat));
    }
  },
};
