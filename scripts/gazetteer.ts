/**
 * Place-name data for the live facts. Run with `npm run gazetteer` (needs network and `unzip`).
 *
 *   GeoNames cities5000        (CC BY 4.0)         towns of 5,000+ people
 *   Natural Earth marine polys (public domain)     seas, gulfs, oceans
 *   Natural Earth region polys (public domain)     ranges, plateaus, deserts, islands
 *   Natural Earth land         (public domain)     coast mask (marine polygons overlap land)
 *
 * Output: public/gazetteer/<z>_<x>_<y>.json for every Web Mercator tile at GAZETTEER_ZOOM that
 * holds a town, a sea or a named region. Tile format:
 *   c: country names (index in t)          t: towns [name, countryIdx, lat, lon, population]
 *   n: names [name, 's' sea | 'r' region]  g: run-length coded GRID x GRID cell grid, row-major
 *                                          from the north-west, as [value, runLength, ...];
 *                                          0 land, 1 open sea (unnamed), 2 + k = n[k].
 * Sea takes precedence over region; a cell is sea when its centre is outside the land mask.
 * Source files are cached in .cache/gazetteer/.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { GAZETTEER_GRID as G, GAZETTEER_ZOOM as Z } from '../src/config';
import { lonLatToTile } from '../src/geo/coords';

const CACHE = '.cache/gazetteer';
const OUT = 'public/gazetteer';
const NE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson';
const SOURCES = {
  cities: 'https://download.geonames.org/export/dump/cities5000.zip',
  marine: `${NE}/ne_10m_geography_marine_polys.geojson`,
  regions: `${NE}/ne_10m_geography_regions_polys.geojson`,
  land: `${NE}/ne_10m_land.geojson`,
};

const N = (2 ** Z) * G; // global grid is N x N cells

async function download(url: string): Promise<string> {
  mkdirSync(CACHE, { recursive: true });
  const file = `${CACHE}/${url.split('/').pop()}`;
  if (!existsSync(file)) {
    console.log('downloading', url);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: ${res.status}`);
    writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }
  return file;
}

// ---- polygons ------------------------------------------------------------------------------

type Ring = number[][]; // [lon, lat]
type Poly = Ring[]; // outer ring then holes (even-odd fill makes holes work)
type Named = { name: string; cls: string; polys: Poly[] };

function polysOf(g: { type: string; coordinates: unknown }): Poly[] {
  return (g.type === 'Polygon' ? [g.coordinates] : g.coordinates) as Poly[];
}

const MAX_LAT = 85.0511;
/** Continuous grid row for a latitude: cell centres sit on integers. */
function rowOf(lat: number): number {
  const φ = (Math.max(-MAX_LAT, Math.min(MAX_LAT, lat)) * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(φ) + 1 / Math.cos(φ)) / Math.PI) / 2) * N - 0.5;
}
const colOf = (lon: number): number => ((lon + 180) / 360) * N - 0.5;

/** Even-odd scanline fill of polygons over cell centres; calls fill(row, firstCol, lastColExclusive). */
function paint(polys: Poly[], fill: (row: number, c0: number, c1: number) => void): void {
  const rows = new Map<number, number[]>();
  for (const poly of polys) {
    for (const ring of poly) {
      for (let k = 0; k < ring.length; k++) {
        const a = ring[k];
        const b = ring[(k + 1) % ring.length];
        const ya = rowOf(a[1]);
        const yb = rowOf(b[1]);
        if (ya === yb) continue;
        const lo = Math.min(ya, yb);
        const hi = Math.max(ya, yb);
        const xa = colOf(a[0]);
        const xb = colOf(b[0]);
        for (let j = Math.max(0, Math.ceil(lo)); j < hi && j < N; j++) {
          if (j < lo) continue;
          const x = xa + ((j - ya) / (yb - ya)) * (xb - xa);
          let list = rows.get(j);
          if (!list) rows.set(j, (list = []));
          list.push(x);
        }
      }
    }
  }
  for (const [j, xs] of rows) {
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const c0 = Math.max(0, Math.ceil(xs[k]));
      const c1 = Math.min(N, Math.ceil(xs[k + 1]));
      if (c1 > c0) fill(j, c0, c1);
    }
  }
}

function area(polys: Poly[]): number {
  let s = 0;
  for (const poly of polys) {
    for (const [ri, ring] of poly.entries()) {
      let a = 0;
      for (let k = 0; k < ring.length; k++) {
        const p = ring[k];
        const q = ring[(k + 1) % ring.length];
        a += p[0] * q[1] - q[0] * p[1];
      }
      s += (ri === 0 ? 1 : -1) * Math.abs(a / 2);
    }
  }
  return s;
}

const LATIN = /^[\p{Script=Latin}\p{M}\s.'’\-()/]+$/u;
const prettyName = (s: string): string =>
  s === s.toUpperCase() && /[A-Z]/.test(s) ? s.toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (_m, a, b) => a + b.toUpperCase()) : s;

function loadNamed(file: string, nameKeys: string[], clsKey: string, keep: (cls: string) => boolean): Named[] {
  const json = JSON.parse(readFileSync(file, 'utf8')) as { features: { properties: Record<string, string>; geometry: { type: string; coordinates: unknown } }[] };
  const out: Named[] = [];
  for (const f of json.features) {
    const cls = f.properties[clsKey] ?? '';
    if (!keep(cls)) continue;
    const name = nameKeys.map((k) => f.properties[k]).find((v) => v && LATIN.test(v));
    if (!name) continue;
    out.push({ name: prettyName(name), cls, polys: polysOf(f.geometry) });
  }
  return out;
}

/**
 * Hand-drawn outlines for well-known areas Natural Earth lacks. Rough on purpose (the grid cells
 * are ~10 km); painted over Natural Earth's regions.
 */
const EXTRA_REGIONS: Named[] = [
  { name: 'Lake District', cls: 'extra', polys: [[[[-3.55, 54.25], [-2.75, 54.25], [-2.75, 54.7], [-3.3, 54.75], [-3.55, 54.55]]]] },
  { name: 'Peak District', cls: 'extra', polys: [[[[-2.1, 53.0], [-1.6, 53.0], [-1.6, 53.55], [-2.1, 53.55]]]] },
  { name: 'Snowdonia', cls: 'extra', polys: [[[[-4.2, 52.7], [-3.6, 52.7], [-3.6, 53.2], [-4.2, 53.2]]]] },
  {
    name: 'Scottish Highlands',
    cls: 'extra',
    polys: [[[[-5.7, 56.6], [-4.6, 56.2], [-3.4, 56.7], [-3.0, 57.0], [-3.4, 57.6], [-4.0, 57.6], [-3.9, 58.6], [-5.0, 58.5], [-5.8, 58.2], [-5.9, 57.3]]]],
  },
];

// ---- towns ---------------------------------------------------------------------------------

type Tile = { towns: [string, number, number, number, number][]; countries: string[]; grid?: Uint16Array };
const tiles = new Map<string, Tile>();
function tileAt(x: number, y: number): Tile {
  const key = `${Z}_${x}_${y}`;
  let t = tiles.get(key);
  if (!t) tiles.set(key, (t = { towns: [], countries: [] }));
  return t;
}

async function main(): Promise<void> {
  const files = {
    cities: await download(SOURCES.cities),
    marine: await download(SOURCES.marine),
    regions: await download(SOURCES.regions),
    land: await download(SOURCES.land),
  };

  const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
  const txt = execFileSync('unzip', ['-p', files.cities, 'cities5000.txt'], { maxBuffer: 1 << 28 }).toString('utf8');
  let nTowns = 0;
  for (const line of txt.split('\n')) {
    if (!line) continue;
    const c = line.split('\t');
    if (c[7] === 'PPLX') continue; // a section of a town ("Manchester City Centre"): the town itself is in the data
    const [name, ascii, lat, lon, cc, pop] = [c[1], c[2], Number(c[4]), Number(c[5]), c[8], Number(c[14])];
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const t = lonLatToTile(lat, lon, Z);
    const tile = tileAt(Math.min(2 ** Z - 1, Math.floor(t.x)), Math.min(2 ** Z - 1, Math.floor(t.y)));
    let country = cc;
    try { country = regionNames.of(cc) ?? cc; } catch { /* keep the code */ }
    let ci = tile.countries.indexOf(country);
    if (ci < 0) ci = tile.countries.push(country) - 1;
    tile.towns.push([LATIN.test(name) ? name : ascii, ci, Math.round(lat * 1e3) / 1e3, Math.round(lon * 1e3) / 1e3, pop]);
    nTowns++;
  }
  console.log('towns', nTowns);

  // ---- rasters: land mask, sea names, region names
  const land = new Uint8Array(N * N);
  const landJson = JSON.parse(readFileSync(files.land, 'utf8')) as { features: { geometry: { type: string; coordinates: unknown } }[] };
  for (const f of landJson.features) paint(polysOf(f.geometry), (j, c0, c1) => land.fill(1, j * N + c0, j * N + c1));

  const names: [string, 's' | 'r'][] = [];
  const idOf = (name: string, kind: 's' | 'r'): number => {
    let i = names.findIndex((n) => n[0] === name && n[1] === kind);
    if (i < 0) i = names.push([name, kind]) - 1;
    return i + 2;
  };
  const sea = new Uint16Array(N * N);
  const reg = new Uint16Array(N * N);
  // largest first, so the smaller (more specific) feature is painted on top
  const biggestFirst = (list: Named[]): Named[] => list.map((n) => ({ n, a: area(n.polys) })).sort((p, q) => q.a - p.a).map((x) => x.n);
  for (const m of biggestFirst(loadNamed(files.marine, ['name_en', 'name'], 'featurecla', () => true))) {
    if (/reef|river/i.test(m.cls)) continue;
    const id = idOf(m.name, 's');
    paint(m.polys, (j, c0, c1) => sea.fill(id, j * N + c0, j * N + c1));
  }
  const regionClasses = /^(Range\/mtn|Desert|Plateau|Peninsula|Plain|Valley|Basin|Lowland|Foothills|Tundra|Wetlands|Delta|Gorge|Depression|Island|Island group)$/;
  const regions = loadNamed(files.regions, ['NAME_EN', 'NAME'], 'FEATURECLA', (c) => regionClasses.test(c));
  for (const m of [...biggestFirst(regions), ...EXTRA_REGIONS]) {
    const id = idOf(m.name, 'r');
    paint(m.polys, (j, c0, c1) => reg.fill(id, j * N + c0, j * N + c1));
  }

  // ---- cut into tiles
  const side = 2 ** Z;
  for (let ty = 0; ty < side; ty++) {
    for (let tx = 0; tx < side; tx++) {
      const grid = new Uint16Array(G * G);
      let any = false;
      for (let r = 0; r < G; r++) {
        for (let c = 0; c < G; c++) {
          const k = (ty * G + r) * N + tx * G + c;
          const v = !land[k] ? sea[k] || 1 : reg[k];
          grid[r * G + c] = v;
          if (v) any = true;
        }
      }
      if (any) tileAt(tx, ty).grid = grid;
    }
  }

  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  let total = 0;
  let max = 0;
  for (const [key, t] of tiles) {
    // only the names a tile uses, renumbered
    const used: number[] = [];
    let g: number[] | undefined;
    if (t.grid) {
      g = [];
      let prev = -1;
      for (const v of t.grid) {
        let w = v;
        if (v >= 2) {
          let u = used.indexOf(v);
          if (u < 0) u = used.push(v) - 1;
          w = u + 2;
        }
        if (w === prev) g[g.length - 1]++;
        else { g.push(w, 1); prev = w; }
      }
    }
    t.towns.sort((a, b) => b[4] - a[4]);
    const body = JSON.stringify({ c: t.countries, t: t.towns, n: used.map((v) => names[v - 2]), ...(g ? { g } : {}) });
    writeFileSync(`${OUT}/${key}.json`, body);
    total += body.length;
    max = Math.max(max, body.length);
  }
  console.log(`tiles ${tiles.size}, total ${(total / 1e6).toFixed(2)} MB, largest ${(max / 1e3).toFixed(0)} KB, files in ${OUT}: ${readdirSync(OUT).length}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
