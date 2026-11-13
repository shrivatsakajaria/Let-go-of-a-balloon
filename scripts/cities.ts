/**
 * docs/reference/launch-cities.csv -> data/cities.json. Run with `npm run cities`.
 *
 * The CSV is a snapshot of SK's "Launch cities" sheet: quoted fields may hold commas and doubled
 * quotes. Launch batch first, then the weekly batches, then Tier 2, keeping the sheet's order
 * inside each batch. `launch.headingDeg` (from the launch spot to the main landmark, for the
 * launch camera) stays null until each launch spot is confirmed against OpenStreetMap.
 */
import { readFileSync, writeFileSync } from 'node:fs';

export type Batch = 'launch' | 'weekly' | 'later';

export type City = {
  id: string;
  group: string;
  country: string;
  city: string;
  tier: 1 | 2;
  batch: Batch;
  launch: { lat: number; lon: number; label: string; headingDeg: number | null };
  landmarks: string[];
  animated?: string;
  /** Rights flags to check before modelling. Not legal advice. */
  notes?: string;
};

/** RFC 4180 CSV: rows of fields. Quoted fields keep commas, newlines and "" as a quote. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const BATCHES: Record<string, Batch> = { 'Launch batch': 'launch', 'Weekly batches': 'weekly', 'After Tier 1': 'later' };
const ORDER: Batch[] = ['launch', 'weekly', 'later'];

export function slug(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function buildCities(csv: string): City[] {
  const [head, ...rows] = parseCsv(csv).filter((r) => r.some((f) => f.trim() !== ''));
  const col = (name: string): number => {
    const i = head.indexOf(name);
    if (i < 0) throw new Error(`launch-cities.csv has no "${name}" column`);
    return i;
  };
  const c = {
    group: col('Group'), country: col('Country'), city: col('City'), tier: col('Tier'), spot: col('Launch spot'),
    lat: col('Launch lat'), lon: col('Launch lon'), landmarks: col('Landmarks to model'), animated: col('Animated touch'),
    notes: col('Notes'), batch: col('Batch'),
  };
  const ids = new Set<string>();
  const out = rows.map((r, line): City => {
    const get = (i: number) => (r[i] ?? '').trim();
    const where = `row ${line + 2} (${get(c.city)})`;
    const lat = Number(get(c.lat));
    const lon = Number(get(c.lon));
    if (!get(c.lat) || !get(c.lon) || !(Math.abs(lat) <= 90) || !(Math.abs(lon) <= 180)) throw new Error(`${where}: bad launch coordinates`);
    const batch = BATCHES[get(c.batch)];
    if (!batch) throw new Error(`${where}: unknown batch "${get(c.batch)}"`);
    const tier = Number(get(c.tier));
    if (tier !== 1 && tier !== 2) throw new Error(`${where}: tier must be 1 or 2`);
    let id = slug(get(c.city));
    if (ids.has(id)) id = `${id}-${slug(get(c.country))}`;
    if (ids.has(id)) throw new Error(`${where}: duplicate id ${id}`);
    ids.add(id);
    const city: City = {
      id,
      group: get(c.group),
      country: get(c.country),
      city: get(c.city),
      tier,
      batch,
      launch: { lat, lon, label: get(c.spot), headingDeg: null },
      landmarks: get(c.landmarks).split(';').map((s) => s.trim()).filter(Boolean),
    };
    if (get(c.animated)) city.animated = get(c.animated);
    if (get(c.notes)) city.notes = get(c.notes);
    return city;
  });
  // stable: sheet order inside each batch
  return out.map((city, i) => ({ city, i }))
    .sort((a, b) => ORDER.indexOf(a.city.batch) - ORDER.indexOf(b.city.batch) || a.i - b.i)
    .map((x) => x.city);
}

// write only when run as `npm run cities`, not when a test imports this file
if (process.env.npm_lifecycle_event === 'cities') {
  const root = new URL('..', import.meta.url);
  const csv = readFileSync(new URL('docs/reference/launch-cities.csv', root), 'utf8');
  const cities = buildCities(csv);
  writeFileSync(new URL('data/cities.json', root), JSON.stringify(cities, null, 2) + '\n');
  console.log(`data/cities.json: ${cities.length} cities, ${cities.filter((x) => x.batch === 'launch').length} in the launch batch`);
}
