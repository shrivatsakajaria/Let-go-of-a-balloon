import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { HorizontalTiltShiftShader } from 'three/addons/shaders/HorizontalTiltShiftShader.js';
import { VerticalTiltShiftShader } from 'three/addons/shaders/VerticalTiltShiftShader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/* ---------------- noise ---------------- */
const perm = new Uint8Array(512);
{ let s = 1337; const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) { s = (s * 16807) % 2147483647; const j = s % (i + 1); [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255]; }
const G = [[1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]];
function simplex(x, y) {
  const F2 = 0.5 * (Math.sqrt(3) - 1), G2 = (3 - Math.sqrt(3)) / 6;
  const s = (x + y) * F2, i = Math.floor(x + s), j = Math.floor(y + s);
  const t = (i + j) * G2, x0 = x - (i - t), y0 = y - (j - t);
  const i1 = x0 > y0 ? 1 : 0, j1 = 1 - i1;
  const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2, x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
  const ii = i & 255, jj = j & 255;
  const c = (gx, gy, xx, yy) => { let t0 = 0.5 - xx * xx - yy * yy; if (t0 < 0) return 0; t0 *= t0; const g = G[perm[gx + perm[gy]] & 7]; return t0 * t0 * (g[0] * xx + g[1] * yy); };
  return 70 * (c(ii, jj, x0, y0) + c(ii + i1, jj + j1, x1, y1) + c(ii + 1, jj + 1, x2, y2));
}
const fbm = (x, y, o = 4) => { let a = 0.5, f = 1, v = 0; for (let i = 0; i < o; i++) { v += a * simplex(x * f, y * f); f *= 2.03; a *= 0.5; } return v; };
const hash = (a, b = 0) => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); };
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* ---------------- the made-up place ---------------- */
// 1 unit = 10 m. Balloon drifts west to east: city, moors, farmland, coast, sea.
const R = 210;
const CITY = new THREE.Vector2(-120, 12);
const riverZ = x => 14 * Math.sin(x * 0.021 + 0.6) + 6 * Math.sin(x * 0.05);
function baseHeight(x, z) {
  let h = 6 + fbm(x * 0.0065, z * 0.0065) * 16;
  h += 26 * sstep(-90, -40, x) * (1 - sstep(10, 70, x)) * (0.65 + 0.5 * fbm(x * 0.012 + 3, z * 0.012));   // the moors
  h += Math.abs(fbm(x * 0.02 + 9, z * 0.02)) * 9 * sstep(-80, -40, x) * (1 - sstep(20, 60, x));
  const coast = sstep(95, 150, x + fbm(z * 0.012, 4) * 30);
  h = h * (1 - coast) - coast * 9;
  const rd = Math.abs(z - riverZ(x));
  if (x < 105) h -= 7 * sstep(9, 0, rd) * (1 - sstep(60, 105, x));                                           // river valley
  const cd = Math.hypot(x - CITY.x, z - CITY.y);
  h = THREE.MathUtils.lerp(h, 3.2 + (rd < 4 ? -2.5 : 0), sstep(58, 30, cd));                                // flat city
  return h;
}
function cityMask(x, z) { return sstep(58, 34, Math.hypot(x - CITY.x, z - CITY.y)); }

/* ---------------- styles ---------------- */
const STYLES = {
  sculpt: {
    name: 'Sculpted', segs: 240, terrace: 3.2, tilt: 0.0022,
    ramp: ['#f1e2b0', '#cfe39a', '#b4d98a', '#9acb7d', '#86bb73', '#9fb07a', '#c3b08f', '#e0d6c4', '#f6f1e8'],
    shallow: '#bfe9dc', deep: '#4db4c6', water: '#62cbd6', waterOpacity: 0.78,
    fields: ['#cfe39a', '#e6dc95', '#b9d98c', '#d8e7a4'], buildings: ['#fff4e4', '#ffe1cc', '#f2dfef', '#e7ecf7', '#fdeac0'],
    roofs: null, tree: 'blob', treeCols: ['#79b86a', '#6aa95f', '#8cc472', '#5d9a58'], strata: ['#d9a77c', '#c08a63', '#a6735a', '#8c6553'],
    balloon: 'smooth', flat: false, waves: false, cars: false, skyLift: 0.18
  },
  lowpoly: {
    name: 'Low-poly', segs: 96, terrace: 0, tilt: 0.0016,
    ramp: ['#f2d184', '#86c95a', '#6cbb4f', '#55a845', '#3f9442', '#5f8a4a', '#8d8174', '#a49a90', '#f4f4ee'],
    shallow: '#7fd6d0', deep: '#2b8fbf', water: '#36aee0', waterOpacity: 0.88,
    fields: ['#9fd45f', '#e4cf5a', '#7cc354', '#c9d860'], buildings: ['#f4f1e8', '#e9d8bd', '#d9e2ea', '#f1c9a5', '#cfd8c4'],
    roofs: ['#d9553f', '#3d6fb2', '#e08a32', '#4a9a7c'], tree: 'cone', treeCols: ['#2f8a49', '#3f9c4f', '#277a42', '#4fae55'], strata: ['#b9784a', '#9a5f3b', '#7d4b31', '#6b4a3c'],
    balloon: 'faceted', flat: true, waves: true, cars: false, skyLift: 0.0
  },
  toy: {
    name: 'Toy town', segs: 160, terrace: 0, tilt: 0.0032,
    ramp: ['#f4e1a6', '#a8d672', '#98cc66', '#88c05e', '#7ab55a', '#8fae66', '#b8a88c', '#d4cbbd', '#f6f3ec'],
    shallow: '#9fe3e0', deep: '#3aa6cf', water: '#4cc0e4', waterOpacity: 0.82,
    fields: ['#b8de7a', '#f0d877', '#9fd06a', '#e9c46c'], buildings: ['#fff7ea', '#ffd9b8', '#c9e6f0', '#ffe7a3', '#f7c8c8', '#d6f0cf'],
    roofs: ['#e2574c', '#3f7fc4', '#f29b38', '#5bb0a0', '#8f6bc9'], tree: 'lolly', treeCols: ['#6cc05a', '#58b04f', '#82cd62', '#4aa04a'], strata: ['#d39a6a', '#b77f54', '#9a6646', '#7f553e'],
    balloon: 'smooth', flat: false, waves: false, cars: true, skyLift: 0.08
  }
};
STYLES.contour = {
  name: 'Contour', segs: 0, terrace: 0, contour: 1.8, tilt: 0,
  ramp: ['#e6d6a2', '#b9cd86', '#a0c078', '#88b06c', '#76a063', '#90996b', '#b0a083', '#cdc1ae', '#f1ece2'],
  shallow: '#8fd3cf', deep: '#2b7fb0', water: '#3d9ec6', waterOpacity: 0.9,
  fields: ['#d9d59a', '#e6d9a6', '#c3d39a', '#d2c48f', '#b8cc8f'], buildings: ['#f4efe5', '#ebe3d4', '#f0e8dc', '#e4dccd'],
  roofs: ['#d9bfa4', '#c9ad92', '#b59c86', '#9fa6aa'], tree: 'cone', treeCols: ['#5f8f5a', '#527f50', '#6c9a62', '#4a7449'], strata: ['#d9a77c', '#c08a63', '#a6735a', '#8c6553'],
  balloon: 'smooth', flat: true, waves: true, cars: false, skyLift: 0.06, cliff: '#d4a982'
};
const col = h => new THREE.Color(h);

/* ---------------- renderer ---------------- */
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(30, 1, 1, 3000);
const rt = new THREE.WebGLRenderTarget(1, 1, { samples: 4, type: THREE.HalfFloatType });
const composer = new EffectComposer(renderer, rt);
composer.addPass(new RenderPass(scene, camera));
const hts = new ShaderPass(HorizontalTiltShiftShader), vts = new ShaderPass(VerticalTiltShiftShader);
composer.addPass(hts); composer.addPass(vts); composer.addPass(new OutputPass());
function resize() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  renderer.setSize(w, h, false); composer.setSize(w, h);
  camera.aspect = w / h; camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);

/* lights + sky */
const sun = new THREE.DirectionalLight(0xffffff, 2.4);
sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -240, right: 240, top: 240, bottom: -240, near: 10, far: 900 });
sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.6;
scene.add(sun, sun.target);
const hemi = new THREE.HemisphereLight(0xcfe8ff, 0x7d8a5a, 1.0); scene.add(hemi);
const skyU = { top: { value: col('#5aa8f0') }, hor: { value: col('#cfeaf7') } };
const sky = new THREE.Mesh(new THREE.SphereGeometry(1400, 32, 16), new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, uniforms: skyU, fog: false,
  vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: 'uniform vec3 top; uniform vec3 hor; varying vec3 vP; void main(){ float t = smoothstep(-0.25, 0.6, vP.y); gl_FragColor = vec4(mix(hor, top, t), 1.0); }'
}));
scene.add(sky);
const starGeo = new THREE.BufferGeometry();
{ const p = []; for (let i = 0; i < 900; i++) { const u = hash(i, 1) * 2 - 1, a = hash(i, 2) * Math.PI * 2, y = Math.abs(u) * 0.95 + 0.05, r = Math.sqrt(1 - y * y);
  p.push(Math.cos(a) * r * 1300, y * 1300, Math.sin(a) * r * 1300); } starGeo.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); }
const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
scene.add(stars);
scene.fog = new THREE.Fog(0xcfeaf7, 260, 1250);

const nightU = { value: 0 };
function withWindows(mat) {
  mat.onBeforeCompile = sh => {
    sh.uniforms.uNight = nightU;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWP; varying vec3 vWN;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        mat4 wm = modelMatrix;
        #ifdef USE_INSTANCING
          wm = modelMatrix * instanceMatrix;
        #endif
        vWP = (wm * vec4(transformed, 1.0)).xyz; vWN = normalize(mat3(wm) * objectNormal);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWP; varying vec3 vWN; uniform float uNight;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float side = step(abs(vWN.y), 0.5);
        vec2 g = vec2((abs(vWN.x) > 0.5 ? vWP.z : vWP.x) / 0.9, (vWP.y - 0.4) / 1.05);
        vec2 cl = floor(g); vec2 f = fract(g);
        float win = step(0.28, f.x) * step(f.x, 0.72) * step(0.3, f.y) * step(f.y, 0.78);
        float lit = step(0.38, fract(sin(dot(cl, vec2(12.9898, 78.233))) * 43758.5453));
        diffuseColor.rgb *= 1.0 - win * side * 0.22 * (1.0 - uNight);
        totalEmissiveRadiance += vec3(1.0, 0.7, 0.36) * win * lit * side * uNight * 3.2;`);
  };
  return mat;
}

/* ---------------- world build ---------------- */
let world = null, style = 'sculpt', waterMesh = null, carState = [], carMesh = null, cloudGroup = null, lampMat = null;
const terrainH = { fn: null };

function styledHeight(x, z, st) {
  const h = baseHeight(x, z);
  if (st.terrace && h > 0.6) {
    const hh = h * 1.05, s = st.terrace, k = Math.floor(hh / s), f = hh / s - k;
    return (k + sstep(0.9, 1.0, f)) * s;
  }
  if (st.contour && h > 0.8) {
    const e = 1.5, gx = baseHeight(x + e, z) - baseHeight(x - e, z), gz = baseHeight(x, z + e) - baseHeight(x, z - e);
    const slope = Math.hypot(gx, gz) / (2 * e);
    const s = st.contour, k = Math.floor(h / s), f = h / s - k, t = (k + sstep(0.8, 1.0, f)) * s;
    return THREE.MathUtils.lerp(h, t, sstep(0.12, 0.3, slope));
  }
  if (st === STYLES.toy) return h > 0 ? h * 0.72 : h;
  return h;
}
function groundColour(x, z, h, st, slope) {
  if (h < 0.4) {
    const d = clamp(-h / 9, 0, 1);
    return col(st.shallow).lerp(col(st.deep), d).lerp(col(st.ramp[0]), clamp(0.4 - h, 0, 1) < 0.1 ? 0.6 : 0);
  }
  if (h < 1.6) return col(st.ramp[0]);
  const idx = clamp((h - 1.6) / 40 * (st.ramp.length - 2), 0, st.ramp.length - 2.001) + 1;
  let c = col(st.ramp[Math.floor(idx)]).lerp(col(st.ramp[Math.ceil(idx)]), st.terrace ? 0 : idx % 1);
  if (cityMask(x, z) > 0.5) c = col(st.ramp[2]).lerp(col('#d8d2c4'), 0.35);
  // patchwork fields on gentle low ground east of the moors
  const fieldZone = sstep(0, 30, x) * (1 - sstep(80, 105, x)) + sstep(-60, -85, x) * (1 - cityMask(x, z)) * 0.0;
  if (fieldZone > 0.3 && h < 22 && slope < 0.5) {
    const fx = Math.floor((x * 0.96 + z * 0.28) / 13), fz = Math.floor((z * 0.96 - x * 0.28) / 9);
    const pick = st.fields[Math.floor(hash(fx, fz) * st.fields.length)];
    c = c.clone().lerp(col(pick), 0.85);
  }
  if (slope > 0.9 && !st.terrace) c.lerp(col(st.ramp[6]), 0.5);
  if (st.contour && slope > 0.72 && h > 1.6) c = col(st.cliff).lerp(c, 0.35);
  if (st.terrace) {
    const k = Math.floor(h / st.terrace);
    if (slope > 0.7) c = c.clone().lerp(col('#f0dcae'), 0.32);
    else c.offsetHSL(0.005 * (k % 3), 0.04, (k % 2) * 0.035 - 0.012);
  }
  if (st.flat) { const j = (hash(x * 3.1, z * 1.7) - 0.5) * 0.08; c.offsetHSL(0, 0, j); }
  return c;
}

const IN = { x0: -260, x1: 300, z0: -180, z1: 180 };
function colourise(g, st) {
  const p = g.attributes.position, nrm = g.attributes.normal, cols = new Float32Array(p.count * 3);
  if (st.flat) {
    for (let i = 0; i < p.count; i += 3) {
      const cx = (p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3, cz = (p.getZ(i) + p.getZ(i + 1) + p.getZ(i + 2)) / 3, cy = (p.getY(i) + p.getY(i + 1) + p.getY(i + 2)) / 3;
      const c = groundColour(cx, cz, cy, st, 1 - nrm.getY(i));
      for (let k = 0; k < 3; k++) { cols[(i + k) * 3] = c.r; cols[(i + k) * 3 + 1] = c.g; cols[(i + k) * 3 + 2] = c.b; }
    }
  } else {
    for (let i = 0; i < p.count; i++) { const c = groundColour(p.getX(i), p.getZ(i), p.getY(i), st, 1 - nrm.getY(i)); cols.set([c.r, c.g, c.b], i * 3); }
  }
  g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
}
function buildTerrain(st) {
  const cell = st.contour ? 2.0 : st.flat ? 4.4 : st.terrace ? 1.75 : 2.6;
  const w = IN.x1 - IN.x0, d = IN.z1 - IN.z0;
  const geo = new THREE.PlaneGeometry(w, d, Math.round(w / cell), Math.round(d / cell)); geo.rotateX(-Math.PI / 2);
  geo.translate((IN.x0 + IN.x1) / 2, 0, (IN.z0 + IN.z1) / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i), z = pos.getZ(i);
    const edge = x <= IN.x0 + 0.1 || x >= IN.x1 - 0.1 || z <= IN.z0 + 0.1 || z >= IN.z1 - 0.1;
    if (st.flat && !edge) { x += (hash(i, 7) - 0.5) * cell * 0.5; z += (hash(i, 8) - 0.5) * cell * 0.5; }
    pos.setXYZ(i, x, styledHeight(x, z, st), z);
  }
  const g = st.flat ? geo.toNonIndexed() : geo; g.computeVertexNormals(); colourise(g, st);
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, flatShading: st.flat });
  const inner = new THREE.Mesh(g, mat); inner.receiveShadow = true; inner.castShadow = true;
  // far land to the horizon: coarse, with a sunk hole under the detailed patch
  const FAR = 3200, fc = 20;
  const og = new THREE.PlaneGeometry(FAR, FAR, FAR / fc, FAR / fc); og.rotateX(-Math.PI / 2); og.translate(20, 0, 0);
  const op = og.attributes.position;
  for (let i = 0; i < op.count; i++) {
    const x = op.getX(i), z = op.getZ(i);
    const insideHole = x > IN.x0 + 0.5 && x < IN.x1 - 0.5 && z > IN.z0 + 0.5 && z < IN.z1 - 0.5;
    op.setY(i, insideHole ? -40 : styledHeight(x, z, st));
  }
  const og2 = st.flat ? og.toNonIndexed() : og; og2.computeVertexNormals(); colourise(og2, st);
  const outer = new THREE.Mesh(og2, mat); outer.receiveShadow = true;
  const grp = new THREE.Group(); grp.add(inner, outer); return grp;
}
function buildSkirt(st) {
  const N = 220, depth = 34, pos = [], cols = [], idx = [];
  const bands = st.strata.map(col);
  for (let i = 0; i <= N; i++) {
    const a = i / N * Math.PI * 2, x = Math.cos(a) * R, z = Math.sin(a) * R;
    const top = Math.max(styledHeight(x, z, st), 0);
    const rows = 8;
    for (let r = 0; r <= rows; r++) {
      const y = top - (top + depth) * r / rows + (r ? (hash(i, r) - 0.5) * 1.2 : 0);
      const rr = R - r * 0.9 - (r === rows ? 6 : 0);
      pos.push(Math.cos(a) * rr, y, Math.sin(a) * rr);
      let c = bands[Math.min(bands.length - 1, Math.floor((top - y) / 7))].clone();
      if (styledHeight(x, z, st) < 0 && y > -2) c = col(st.water);
      if (r === 0 && top > 0.5) c = col(st.ramp[2]);
      cols.push(c.r, c.g, c.b);
    }
  }
  const rows = 9;
  for (let i = 0; i < N; i++) for (let r = 0; r < 8; r++) {
    const a = i * rows + r, b = (i + 1) * rows + r;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  let g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3)); g.setIndex(idx);
  if (st.flat) g = g.toNonIndexed();
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: st.flat, side: THREE.DoubleSide }));
  m.receiveShadow = true; return m;
}
function buildWater(st) {
  let geo = new THREE.PlaneGeometry(3200, 3200, 1, 1); geo.rotateX(-Math.PI / 2); geo.translate(20, 0, 0);
  if (st.waves) {
    const pg = new THREE.PlaneGeometry(700, 520, 90, 66); pg.rotateX(-Math.PI / 2); pg.translate(160, 0, 0);
    geo = pg.toNonIndexed();
    geo.userData.base = geo.attributes.position.array.slice();
  }
  const mat = new THREE.MeshStandardMaterial({ color: st.water, transparent: true, opacity: st.waterOpacity, roughness: st.contour ? 0.22 : st.waves ? 0.45 : 0.15, metalness: 0.0, flatShading: st.waves });
  const m = new THREE.Mesh(geo, mat); m.position.y = 0.05; m.receiveShadow = true;
  if (st.waves) { const far = new THREE.Mesh(new THREE.PlaneGeometry(3200, 3200).rotateX(-Math.PI / 2).translate(20, -0.25, 0), mat); const g2 = new THREE.Group(); g2.add(m, far); g2.userData.waves = m; return g2; }
  return m;
}

function buildBuildings(st) {
  const group = new THREE.Group();
  const items = [];
  // city grid
  const ang = 0.18, ca = Math.cos(ang), sa = Math.sin(ang);
  for (let gx = -6; gx <= 6; gx++) for (let gz = -6; gz <= 6; gz++) {
    const lx = gx * 8.5, lz = gz * 8.5;
    for (let k = 0; k < 4; k++) {
      const ox = (k % 2 ? 1.9 : -1.9) + (hash(gx, gz + k) - 0.5), oz = (k > 1 ? 1.9 : -1.9) + (hash(gz, gx - k) - 0.5);
      const x = CITY.x + (lx + ox) * ca - (lz + oz) * sa, z = CITY.y + (lx + ox) * sa + (lz + oz) * ca;
      const m = cityMask(x, z); if (m < 0.35 || hash(gx * 7 + k, gz) > 0.25 + m * 0.75) continue;
      if (Math.abs(z - riverZ(x)) < 4.5) continue;
      const d = Math.hypot(x - CITY.x, z - CITY.y);
      let h = 1.6 + hash(gx, gz * 3 + k) * 3 + Math.max(0, 1 - d / 34) * (4 + hash(k, gx + gz) * 8);
      items.push({ x, z, w: 2.6 + hash(gx + k, 3) * 1.4, d: 2.6 + hash(gz + k, 5) * 1.4, h, rot: ang, town: true });
    }
  }
  items.push({ x: CITY.x + 4, z: CITY.y - 6, w: 3.4, d: 3.4, h: 17, rot: ang, town: true, tower: true });
  items.push({ x: CITY.x - 7, z: CITY.y + 5, w: 3, d: 4, h: 11, rot: ang, town: true });
  // villages and farms
  const villages = [[-30, -60, 9], [35, 40, 14], [62, -30, 12], [88, 22, 16], [-70, 70, 8], [10, -110, 8]];
  villages.forEach(([vx, vz, n], vi) => {
    for (let i = 0; i < n; i++) {
      const a = hash(vi, i) * Math.PI * 2, r = 3 + hash(i, vi) * 11;
      const x = vx + Math.cos(a) * r, z = vz + Math.sin(a) * r;
      if (baseHeight(x, z) < 1) continue;
      items.push({ x, z, w: 1.6 + hash(i, 2) * 0.8, d: 1.3 + hash(i, 3) * 0.6, h: 1.1 + hash(i, 4) * 0.7, rot: a, town: false });
    }
  });
  const box = new THREE.BoxGeometry(1, 1, 1); box.translate(0, 0.5, 0);
  const bMat = withWindows(new THREE.MeshStandardMaterial({ roughness: 0.8, flatShading: st.flat }));
  const im = new THREE.InstancedMesh(box, bMat, items.length);
  const roofItems = [];
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  items.forEach((b, i) => {
    const gy = styledHeight(b.x, b.z, st) - 0.3;
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), b.rot);
    m4.compose(p.set(b.x, gy, b.z), q, s.set(b.w, b.h + 0.3, b.d)); im.setMatrixAt(i, m4);
    im.setColorAt(i, col(st.buildings[Math.floor(hash(i, 11) * st.buildings.length)]));
    if (st.roofs && b.h < (st.contour ? 7 : 6) && !b.tower) roofItems.push({ ...b, gy: gy + b.h + 0.3, i });
  });
  im.castShadow = true; im.receiveShadow = true; group.add(im);
  if (roofItems.length) {
    let rg;
    if (st === STYLES.toy) { rg = new THREE.CylinderGeometry(0.6, 0.6, 1, 3); rg.rotateZ(Math.PI / 2); rg.rotateX(Math.PI / 2 * 0); rg.translate(0, 0.32, 0); rg.scale(1, 1, 1); }
    else { rg = new THREE.ConeGeometry(0.75, 0.6, 4); rg.rotateY(Math.PI / 4); rg.translate(0, 0.3, 0); }
    const rm = new THREE.InstancedMesh(rg, new THREE.MeshStandardMaterial({ roughness: 0.7, flatShading: true }), roofItems.length);
    roofItems.forEach((b, i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), b.rot);
      const sc = st === STYLES.toy ? s.set(b.w * 1.05, b.d * 0.9, b.d * 1.1) : s.set(b.w * 1.1, Math.min(b.w, b.d) * 1.2, b.d * 1.1);
      if (st === STYLES.toy) { m4.compose(p.set(b.x, b.gy - 0.02, b.z), q, s.set(b.w * 1.06, Math.min(b.w, b.d) * 0.9, b.d * 1.08)); }
      else m4.compose(p.set(b.x, b.gy, b.z), q, sc);
      rm.setMatrixAt(i, m4); rm.setColorAt(i, col(st.roofs[Math.floor(hash(i, 21) * st.roofs.length)]));
    });
    rm.castShadow = true; rm.receiveShadow = true; group.add(rm);
  }
  // streets + lamps in the city
  const roadMat = new THREE.MeshStandardMaterial({ color: st === STYLES.sculpt ? '#e9e3d6' : '#6b6f78', roughness: 1 });
  const roadGeo = new THREE.BoxGeometry(1, 0.12, 1);
  const roads = []; const lamps = [];
  for (let k = -6; k <= 6; k++) for (const axis of [0, 1]) {
    for (let t = -6; t < 6; t++) {
      const a = (t + 0.5) * 8.5, b = k * 8.5 + 4.25;
      const lx = axis ? b : a, lz = axis ? a : b;
      const x = CITY.x + lx * ca - lz * sa, z = CITY.y + lx * sa + lz * ca;
      if (cityMask(x, z) < 0.5 || Math.abs(z - riverZ(x)) < 3) continue;
      roads.push({ x, z, axis }); if (hash(k * 13 + t, axis) > 0.45) lamps.push({ x: x + 0.9, z: z + 0.9 });
    }
  }
  const rmesh = new THREE.InstancedMesh(roadGeo, roadMat, roads.length);
  roads.forEach((r, i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), ang + (r.axis ? Math.PI / 2 : 0));
    m4.compose(p.set(r.x, styledHeight(r.x, r.z, st) + 0.02, r.z), q, s.set(8.6, 1, 1.25)); rmesh.setMatrixAt(i, m4);
  });
  rmesh.receiveShadow = true; group.add(rmesh);
  lampMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.75, 0.42), toneMapped: false, transparent: true, opacity: 0 });
  const lmesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.4, 6, 4), lampMat, lamps.length);
  lamps.forEach((l, i) => { m4.compose(p.set(l.x, styledHeight(l.x, l.z, st) + 1.1, l.z), q.identity(), s.set(1, 1, 1)); lmesh.setMatrixAt(i, m4); });
  group.add(lmesh);
  // river (city stretch) is covered by the water plane only where below zero; add a painted river ribbon
  // cars (toy only)
  carState = []; carMesh = null;
  if (st.cars) {
    const carGeo = new THREE.BoxGeometry(1.1, 0.55, 0.6); carGeo.translate(0, 0.38, 0);
    const n = 46; carMesh = new THREE.InstancedMesh(carGeo, new THREE.MeshStandardMaterial({ roughness: 0.5 }), n);
    const cc = ['#e2574c', '#3f7fc4', '#f2c14e', '#ffffff', '#5bb0a0', '#2d2f36'];
    for (let i = 0; i < n; i++) {
      carState.push({ axis: hash(i, 1) > 0.5 ? 1 : 0, lane: Math.floor(hash(i, 2) * 13) - 6, t: hash(i, 3) * 100, v: 2.5 + hash(i, 4) * 2.5, dir: hash(i, 5) > 0.5 ? 1 : -1 });
      carMesh.setColorAt(i, col(cc[i % cc.length]));
    }
    carMesh.castShadow = true; group.add(carMesh);
  }
  return group;
}
function treeGeometry(kind) {
  if (kind === 'cone') { const c = new THREE.ConeGeometry(0.9, 2.6, 5); c.translate(0, 2.0, 0); const t = new THREE.CylinderGeometry(0.18, 0.22, 0.9, 5); t.translate(0, 0.45, 0); return { crown: c, trunk: t }; }
  if (kind === 'lolly') { const c = new THREE.SphereGeometry(1.0, 14, 10); c.translate(0, 2.0, 0); const t = new THREE.CylinderGeometry(0.16, 0.2, 1.3, 8); t.translate(0, 0.65, 0); return { crown: c, trunk: t }; }
  const c = mergeGeometries([new THREE.IcosahedronGeometry(1.0, 2).translate(0, 1.6, 0), new THREE.IcosahedronGeometry(0.75, 2).translate(0.55, 1.2, 0.2), new THREE.IcosahedronGeometry(0.7, 2).translate(-0.5, 1.15, -0.25)]);
  const t = new THREE.CylinderGeometry(0.15, 0.2, 0.8, 6); t.translate(0, 0.4, 0); return { crown: c, trunk: t };
}
function buildTrees(st) {
  const spots = [];
  for (let i = 0; i < 16000 && spots.length < 3200; i++) {
    const x = IN.x0 + 4 + hash(i, 31) * (IN.x1 - IN.x0 - 8), z = IN.z0 + 4 + hash(i, 32) * (IN.z1 - IN.z0 - 8);
    const h = baseHeight(x, z); if (h < 1.6 || cityMask(x, z) > 0.2) continue;
    const dens = sstep(0.0, 0.45, fbm(x * 0.02 + 40, z * 0.02 - 7)) + 0.25 * sstep(-0.1, 0.05, Math.abs(z - riverZ(x)) < 10 ? 1 : 0);
    if (hash(i, 33) > dens) continue;
    if (h > 34) continue;
    spots.push([x, styledHeight(x, z, st), z, 0.7 + hash(i, 34) * 0.7]);
  }
  const { crown, trunk } = treeGeometry(st.tree);
  const cm = new THREE.InstancedMesh(crown, new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: st.flat }), spots.length);
  const tm = new THREE.InstancedMesh(trunk, new THREE.MeshStandardMaterial({ color: '#7a5a43', roughness: 1, flatShading: st.flat }), spots.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  spots.forEach((t, i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), hash(i, 35) * 6.28);
    m4.compose(p.set(t[0], t[1] - 0.1, t[2]), q, s.setScalar(t[3])); cm.setMatrixAt(i, m4); tm.setMatrixAt(i, m4);
    cm.setColorAt(i, col(st.treeCols[Math.floor(hash(i, 36) * st.treeCols.length)]));
  });
  cm.castShadow = tm.castShadow = true; cm.receiveShadow = true;
  const g = new THREE.Group(); g.add(cm, tm); return g;
}
function buildClouds(st) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1, flatShading: st.flat, transparent: true, opacity: 0.94 });
  for (let i = 0; i < 14; i++) {
    const parts = [];
    const n = 4 + Math.floor(hash(i, 41) * 4);
    for (let k = 0; k < n; k++) parts.push(new THREE.IcosahedronGeometry(1.8 + hash(i, k) * 2.4, st.flat ? 0 : 3).translate((k - n / 2) * 2.6, hash(k, i) * 1.5, (hash(i + k, 2) - 0.5) * 3));
    const m = new THREE.Mesh(mergeGeometries(parts), mat); m.scale.set(1, 0.62, 1);
    m.position.set(-300 + hash(i, 42) * 700, 0, (hash(i, 44) - 0.5) * 320); m.userData.y = 8 + hash(i, 43) * 8;
    m.castShadow = true; g.add(m);
  }
  return g;
}

/* ---------------- balloon ---------------- */
const balloon = new THREE.Group(); scene.add(balloon);
let balloonBody = null, balloonMat = null;
const BS = 2.6;
function buildBalloon(st) {
  if (balloonBody) { balloon.remove(balloonBody); balloonBody.traverse(o => o.geometry && o.geometry.dispose()); }
  const g = st.balloon === 'faceted' ? new THREE.IcosahedronGeometry(1, 2) : new THREE.SphereGeometry(1, 48, 32);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { let x = p.getX(i), y = p.getY(i), z = p.getZ(i); const k = y < 0 ? 1 + y * 0.32 : 1 + y * 0.04; p.setXYZ(i, x * k, y * 1.16, z * k); }
  g.computeVertexNormals();
  const mat = new THREE.MeshPhysicalMaterial({ color: '#ff5a12', roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.18, flatShading: st.balloon === 'faceted', sheen: 0.3, sheenColor: new THREE.Color('#ffb48a') });
  mat.emissive = new THREE.Color('#ff5a12'); mat.emissiveIntensity = 0.06; balloonMat = mat;
  const body = new THREE.Mesh(g, mat); body.castShadow = true;
  const knot = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.22, 10), mat); knot.position.y = -1.22; knot.rotation.x = Math.PI;
  balloonBody = new THREE.Group(); balloonBody.add(body, knot); balloonBody.scale.setScalar(BS);
  balloon.add(balloonBody);
}
// string: verlet chain
const SEG = 22, segLen = 0.5;
const strPts = Array.from({ length: SEG }, () => ({ p: new THREE.Vector3(), o: new THREE.Vector3() }));
const strGeo = new THREE.BufferGeometry(); strGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(SEG * 3), 3));
const strLine = new THREE.Line(strGeo, new THREE.LineBasicMaterial({ color: '#fff7ee' })); scene.add(strLine);
function resetString(anchor) { strPts.forEach((s, i) => { s.p.copy(anchor).y -= i * segLen; s.o.copy(s.p); }); }
function stepString(anchor, vel, dt) {
  const drag = new THREE.Vector3(-vel.x, 0, -vel.z).multiplyScalar(0.0009);
  strPts.forEach((s, i) => {
    if (i === 0) { s.p.copy(anchor); s.o.copy(anchor); return; }
    const v = s.p.clone().sub(s.o).multiplyScalar(0.96);
    s.o.copy(s.p); s.p.add(v).add(new THREE.Vector3(0, -9.8 * dt * dt * 3, 0)).add(drag.clone().multiplyScalar(i / SEG));
  });
  for (let it = 0; it < 6; it++) for (let i = 1; i < SEG; i++) {
    const a = strPts[i - 1].p, b = strPts[i].p, d = b.clone().sub(a), L = d.length() || 1e-6;
    const diff = (L - segLen) / L; if (i === 1) b.sub(d.multiplyScalar(diff)); else { const h = d.multiplyScalar(diff * 0.5); a.add(h); b.sub(h); }
    strPts[0].p.copy(anchor);
  }
  const arr = strGeo.attributes.position.array; strPts.forEach((s, i) => arr.set([s.p.x, s.p.y, s.p.z], i * 3)); strGeo.attributes.position.needsUpdate = true;
}

/* ---------------- flight ---------------- */
const START = new THREE.Vector3(CITY.x + 10, 0, CITY.y + 16);
const CRUISE = 56, SPEED = 5.2;
let flightT = 0;
function flightPos(t, out) {
  const L = 6.5; // seconds of launch
  const u = clamp(t / L, 0, 1);
  const travel = SPEED * (t < L ? (t * t) / (2 * L) : (L / 2 + (t - L)));
  const x = START.x + travel, z = START.z + 16 * Math.sin(travel * 0.012) - travel * 0.08;
  const g = styledHeight(START.x, START.z, STYLES[style]);
  const climb = t < L ? Math.pow(sstep(0, 1, u), 1.15) : 1;
  const bob = Math.sin(t * 1.25) * 0.7 * climb + Math.sin(t * 0.47) * 0.9 * climb;
  let ceil = 0; for (let k = -2; k <= 6; k++) ceil = Math.max(ceil, styledHeight(x + k * 8, z, STYLES[style]));
  const cruise = Math.max(CRUISE, ceil + 34);
  out.set(x, g + 2.2 + (cruise - g - 2.2) * climb + bob, z);
  return out;
}

/* ---------------- time of day ---------------- */
const KEYS = [
  { t: 0.0, el: 9, az: 105, sun: '#ffb27c', si: 1.7, top: '#7088cc', hor: '#ffc8a0', hs: '#b0b8e6', hg: '#6d5a4c', hi: 0.75, night: 0.15 },
  { t: 0.25, el: 52, az: 160, sun: '#fff3df', si: 2.6, top: '#5ea9ef', hor: '#d4edf8', hs: '#d2e9ff', hg: '#7f8b5c', hi: 1.05, night: 0 },
  { t: 0.5, el: 7, az: 250, sun: '#ff8d50', si: 1.8, top: '#4d5296', hor: '#ff9f70', hs: '#9e92cc', hg: '#5a4a48', hi: 0.65, night: 0.4 },
  { t: 0.75, el: 38, az: 300, sun: '#a9bcff', si: 0.95, top: '#0e1538', hor: '#33407a', hs: '#5a6aa8', hg: '#262636', hi: 0.7, night: 1 },
  { t: 1.0, el: 9, az: 105, sun: '#ffb27c', si: 1.7, top: '#7088cc', hor: '#ffc8a0', hs: '#b0b8e6', hg: '#6d5a4c', hi: 0.75, night: 0.15 }
];
function applyTime(ph) {
  let i = 0; while (i < KEYS.length - 2 && ph > KEYS[i + 1].t) i++;
  const a = KEYS[i], b = KEYS[i + 1], f = sstep(0, 1, (ph - a.t) / (b.t - a.t));
  const L = (k) => THREE.MathUtils.lerp(a[k], b[k], f), C = k => col(a[k]).lerp(col(b[k]), f);
  let az = THREE.MathUtils.lerp(a.az, b.az > a.az ? b.az : b.az + 360, f) * Math.PI / 180, el = L('el') * Math.PI / 180;
  const dir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
  sun.target.position.set(balloon.position.x, 0, balloon.position.z * 0.3);
  sun.position.copy(sun.target.position).add(dir.multiplyScalar(420));
  sun.color.copy(C('sun')); sun.intensity = L('si');
  const lift = STYLES[style].skyLift;
  skyU.top.value.copy(C('top')).lerp(col('#ffffff'), lift * (1 - L('night'))); skyU.hor.value.copy(C('hor')).lerp(col('#ffffff'), lift * 0.6 * (1 - L('night')));
  scene.fog.color.copy(skyU.hor.value);
  hemi.color.copy(C('hs')); hemi.groundColor.copy(C('hg')); hemi.intensity = L('hi');
  const n = L('night'); nightU.value = n; stars.material.opacity = n * 0.9;
  if (lampMat) lampMat.opacity = sstep(0.2, 0.8, n);
  if (balloonMat) balloonMat.emissiveIntensity = 0.06 + n * 0.32;
  return n;
}

/* ---------------- camera director ---------------- */
const cam = { pos: new THREE.Vector3(-150, 20, 80), look: new THREE.Vector3(), fov: 30 };
let viewMode = 'auto', shotT = 0, shotIdx = 0;
const AUTO = [['ride', 10], ['orbit', 11], ['side', 9], ['top', 7]];
function shot(name, b, t) {
  if (name === 'launch') {
    const u = sstep(0, 1, flightT / 6.5);
    return { pos: new THREE.Vector3(START.x - 12 - 40 * u, styledHeight(START.x, START.z, STYLES[style]) + 3 + (b.y - START.y) * 0.55 + 30 * u, START.z + 24 + 70 * u), look: b.clone().add(new THREE.Vector3(0, -4 * u, 0)), fov: 38 - 6 * u };
  }
  if (name === 'ride') {
    const p = b.clone().add(new THREE.Vector3(-21 + Math.sin(t * 0.3) * 0.8, -1 + Math.sin(t * 0.5) * 0.4, 5));
    return { pos: p, look: b.clone().add(new THREE.Vector3(50, -24, -3)), fov: 54 };
  }
  if (name === 'orbit') { const az = 2.55 + Math.sin(t * 0.09) * 0.45, el = 0.6 + Math.sin(t * 0.05) * 0.08, d = 128;
    return { pos: b.clone().add(new THREE.Vector3(Math.cos(az) * Math.cos(el) * d, Math.sin(el) * d, Math.sin(az) * Math.cos(el) * d)), look: b.clone().add(new THREE.Vector3(2, -20, 0)), fov: 30 }; }
  if (name === 'side') { const p = b.clone().add(new THREE.Vector3(-6 + Math.sin(t * 0.2) * 3, 12, 64)); p.y = Math.max(p.y, styledHeight(p.x, p.z, STYLES[style]) + 18);
    return { pos: p, look: b.clone().add(new THREE.Vector3(1, -9, 0)), fov: 36 }; }
  return { pos: b.clone().add(new THREE.Vector3(6, 168, 40)), look: b.clone().add(new THREE.Vector3(3, -40, 0)), fov: 30 };
}

/* ---------------- assemble ---------------- */
function build(name) {
  style = name; const st = STYLES[name];
  if (world) { scene.remove(world); world.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); }
  world = new THREE.Group();
  world.add(buildTerrain(st));
  waterMesh = buildWater(st); world.add(waterMesh);
  world.add(buildBuildings(st), buildTrees(st));
  cloudGroup = buildClouds(st); world.add(cloudGroup);
  scene.add(world);
  buildBalloon(st);
  hts.uniforms.h.value = st.tilt; vts.uniforms.v.value = st.tilt * 0.7; hts.enabled = vts.enabled = st.tilt > 0;
  hts.uniforms.r.value = vts.uniforms.r.value = 0.48;
}
function relaunch() { flightT = 0; shotT = 0; shotIdx = 0; const p = flightPos(0, new THREE.Vector3()); balloon.position.copy(p); resetString(p.clone().add(new THREE.Vector3(0, -1.3 * BS, 0))); }

/* ---------------- UI ---------------- */
let timeMode = 'auto', timePh = 0.62, lastSpeed = 0;
const $ = id => document.getElementById(id);
function pressed(sel, attr, val) { document.querySelectorAll(sel).forEach(b => b.setAttribute('aria-pressed', b.dataset[attr] === val)); }
document.querySelectorAll('[data-style]').forEach(b => b.addEventListener('click', () => { pressed('[data-style]', 'style', b.dataset.style); build(b.dataset.style); }));
document.querySelectorAll('[data-time]').forEach(b => b.addEventListener('click', () => { timeMode = b.dataset.time; pressed('[data-time]', 'time', timeMode); if (timeMode !== 'auto') timePh = +b.dataset.ph; }));
document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => { viewMode = b.dataset.view; pressed('[data-view]', 'view', viewMode); shotT = 0; }));
$('letgo').addEventListener('click', relaunch);
const PHASE_NAME = ph => ph < 0.12 || ph > 0.9 ? 'Dawn' : ph < 0.4 ? 'Day' : ph < 0.6 ? 'Dusk' : 'Night';
const CLOCK = ph => { const mins = ((ph * 24 + 6) % 24) * 60; return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(Math.floor(mins % 60)).padStart(2, '0')}`; };

/* ---------------- loop ---------------- */
const tmp = new THREE.Vector3(), prevPos = new THREE.Vector3(), vel = new THREE.Vector3();
let last = performance.now(), sim = 0, squash = 0, squashV = 0, snapNext = false;
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now; sim += dt; flightT += dt; shotT += dt;
  if (timeMode === 'auto') timePh = (timePh + dt / 48) % 1;
  flightPos(flightT, tmp);
  if (tmp.x > 270) { relaunch(); flightPos(flightT, tmp); }
  prevPos.copy(balloon.position); balloon.position.copy(tmp);
  vel.copy(balloon.position).sub(prevPos).divideScalar(Math.max(dt, 1e-4));
  // squash and stretch from vertical acceleration, plus a slight lean into the wind
  const target = clamp(vel.y * 0.035, -0.12, 0.2);
  squashV += (target - squash) * 60 * dt; squashV *= Math.exp(-7 * dt); squash += squashV * dt;
  if (balloonBody) {
    balloonBody.scale.set(BS * (1 - squash * 0.5), BS * (1 + squash), BS * (1 - squash * 0.5));
    balloon.rotation.z = -clamp(vel.x * 0.012, -0.25, 0.25) + Math.sin(sim * 0.9) * 0.05;
    balloon.rotation.x = Math.sin(sim * 0.7) * 0.05; balloon.rotation.y += dt * 0.15;
  }
  const anchor = balloon.position.clone().add(new THREE.Vector3(Math.sin(balloon.rotation.z) * 1.3 * BS, -1.3 * BS * (1 + squash), 0));
  stepString(anchor, vel, dt);
  const n = applyTime(timePh);
  // clouds drift, cars move, waves
  if (cloudGroup) cloudGroup.children.forEach((c, i) => { c.position.x += dt * (1.8 + (i % 3) * 0.4); if (c.position.x > 420) c.position.x = -300; c.position.y = Math.max(0, styledHeight(c.position.x, c.position.z, STYLES[style])) + 22 + c.userData.y; });
  if (carMesh) {
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3(); const ang = 0.18;
    carState.forEach((c, i) => {
      c.t += c.v * dt * c.dir; const span = 102; const a = ((c.t % span) + span) % span - span / 2, b = c.lane * 8.5 + 4.25 + (c.dir > 0 ? 0.35 : -0.35);
      const lx = c.axis ? b : a, lz = c.axis ? a : b;
      const x = CITY.x + lx * Math.cos(ang) - lz * Math.sin(ang), z = CITY.y + lx * Math.sin(ang) + lz * Math.cos(ang);
      const vis = cityMask(x, z) > 0.5 && Math.abs(z - riverZ(x)) > 3 ? 1 : 0.0001;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), ang + (c.axis ? Math.PI / 2 : 0) + (c.dir < 0 ? Math.PI : 0));
      m4.compose(p.set(x, styledHeight(x, z, STYLES[style]) + 0.05, z), q, s.setScalar(vis)); carMesh.setMatrixAt(i, m4);
    });
    carMesh.instanceMatrix.needsUpdate = true;
  }
  const wm = waterMesh && (waterMesh.userData.waves || waterMesh);
  if (wm && wm.geometry && wm.geometry.userData.base) {
    const b = wm.geometry.userData.base, arr = wm.geometry.attributes.position.array;
    for (let i = 0; i < arr.length; i += 3) arr[i + 1] = Math.sin(b[i] * 0.09 + sim * 1.1) * 0.35 + Math.cos(b[i + 2] * 0.11 + sim * 0.8) * 0.3;
    wm.geometry.attributes.position.needsUpdate = true; wm.geometry.computeVertexNormals();
  }
  // director
  let name;
  if (flightT < 7.5) name = 'launch';
  else if (viewMode === 'side') name = 'side';
  else if (viewMode === 'above') name = Math.floor(shotT / 10) % 2 ? 'top' : 'orbit';
  else if (viewMode === 'ride') name = 'ride';
  else { if (shotT > AUTO[shotIdx][1]) { shotIdx = (shotIdx + 1) % AUTO.length; shotT = 0; } name = AUTO[shotIdx][0]; }
  const sh = shot(name, balloon.position, sim);
  const k = 1 - Math.exp(-dt * (name === 'launch' ? 3.5 : 1.15));
  if (snapNext) { cam.pos.copy(sh.pos); cam.look.copy(sh.look); cam.fov = sh.fov; snapNext = false; }
  cam.pos.lerp(sh.pos, k); cam.look.lerp(sh.look, k); cam.fov += (sh.fov - cam.fov) * k;
  camera.position.copy(cam.pos); camera.lookAt(cam.look); camera.fov = cam.fov; camera.updateProjectionMatrix();
  sky.position.copy(camera.position); stars.position.copy(camera.position);
  composer.render(dt);
  // HUD
  const sp = Math.round(Math.hypot(vel.x, vel.z) * 7.2); lastSpeed += (sp - lastSpeed) * 0.05;
  $('clock').textContent = CLOCK(timePh); $('phase').textContent = PHASE_NAME(timePh);
  const altM = Math.round((balloon.position.y - styledHeight(balloon.position.x, balloon.position.z, STYLES[style])) * 10 / 10) * 10;
  $('alt').textContent = `${Math.max(0, altM).toLocaleString('en-GB')} m`;
  $('spd').textContent = `${Math.round(lastSpeed)} km/h`;
  const x = balloon.position.x; $('over').textContent = x < -78 ? 'the city' : x < 40 ? 'the moors' : x < 100 ? 'farmland' : x < 128 ? 'the coast' : 'open sea';
  requestAnimationFrame(frame);
}
build('contour'); relaunch(); resize();
cam.pos.copy(shot('launch', balloon.position, 0).pos); cam.look.copy(balloon.position);
requestAnimationFrame(t => { last = t; frame(t); });
window.__setTime = ph => { timeMode = 'fixed'; timePh = ph; };
window.__setStyle = s => build(s);
window.__setFlight = t => { flightT = t; };
window.__setView = v => { viewMode = v; shotT = 0; };
window.__snap = () => { snapNext = true; };
