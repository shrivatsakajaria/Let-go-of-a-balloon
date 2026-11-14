// One-off check: do the map and data hosts allow requests from the preview domain?
// Prints a markdown table. Never fails the build (exit code is always 0).
// SITE_URL is set once, in src/config.ts; the Deploy workflow passes it on (scripts/site-url.sh).
const ORIGIN = process.env.SITE_URL;
if (!ORIGIN) throw new Error('SITE_URL is not set');
const rows = [];

async function check(name, url, headers = {}) {
  try {
    const res = await fetch(url, { headers: { Origin: ORIGIN, ...headers } });
    const acao = res.headers.get('access-control-allow-origin');
    const ok = res.status < 400 && (acao === '*' || acao === ORIGIN);
    rows.push({ name, url, status: res.status, acao: acao ?? '(none)', ok });
    return res;
  } catch (err) {
    rows.push({ name, url, status: 'error', acao: String(err.cause?.code ?? err.message), ok: false });
    return null;
  }
}

// (a) OpenFreeMap: TileJSON, then one tile from its URL template.
const tj = await check('OpenFreeMap TileJSON', 'https://tiles.openfreemap.org/planet');
if (tj && tj.ok) {
  try {
    const json = await tj.json();
    const template = json.tiles?.[0];
    if (template) {
      const tileUrl = template.replace('{z}', '14').replace('{x}', '8089').replace('{y}', '5300');
      await check('OpenFreeMap tile z14/8089/5300', tileUrl);
    }
  } catch { /* already recorded */ }
}

// (b) Open-Meteo geocoding.
await check('Open-Meteo geocoding', 'https://geocoding-api.open-meteo.com/v1/search?name=Windermere&count=1');

// (c) Mapterhorn PMTiles archive (range request) and its single-tile endpoint.
await check('Mapterhorn planet.pmtiles (Range)', 'https://download.mapterhorn.com/planet.pmtiles', { Range: 'bytes=0-16383' });
await check('Mapterhorn tile endpoint', 'https://tiles.mapterhorn.com/0/0/0.webp');

const failed = rows.filter((r) => !r.ok);
const lines = [
  '## Cross-origin check',
  '',
  `Origin used: \`${ORIGIN}\``,
  '',
  '| Check | Status | access-control-allow-origin | Result |',
  '| --- | --- | --- | --- |',
  ...rows.map((r) => `| ${r.name} | ${r.status} | ${r.acao} | ${r.ok ? 'OK' : 'FAIL'} |`),
  '',
  failed.length ? `${failed.length} check(s) failed.` : 'All checks passed.',
];
console.log(lines.join('\n'));
