import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import { computeRoute, type Route } from '../flight/route';
import { haversineKm, type LatLon } from '../geo/coords';
import { localTime } from '../geo/time';
import { CONTOUR } from '../world/palette';
import { routeGround } from '../world/terrainsrc';
import { loadManifest, WindField, WindUnavailableError } from '../wind/loader';
import { ageText, fitView, mercator, nearestPlace, project, summarise, tilesFor, unwrapLons, type Place, type TileRef, type View } from './proofmath';

/** Albert Square, Manchester; `?from=lat,lon` overrides it for live checks from other places. */
const START: LatLon = ((): LatLon => {
  const m = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/.exec(new URLSearchParams(location.search).get('from') ?? '');
  return m ? { lat: Number(m[1]), lon: Number(m[2]) } : { lat: 53.4794, lon: -2.2453 };
})();
const ORANGE = '#ff5a12';
const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

let windBytes = 0;
const countingFetch = async (url: string): Promise<Response> => {
  const res = await fetch(url);
  if (url.includes('/winds/')) {
    const len = Number(res.headers.get('content-length'));
    if (len > 0 && !res.headers.get('content-encoding')) windBytes += len;
    else windBytes += (await res.clone().arrayBuffer()).byteLength;
  }
  return res;
};

type Decoded = { tile: TileRef; vt: VectorTile };

async function loadTiles(refs: TileRef[]): Promise<Decoded[]> {
  try {
    const tj = (await (await fetch('https://tiles.openfreemap.org/planet')).json()) as { tiles: string[] };
    const tpl = tj.tiles[0];
    const out = await Promise.all(
      refs.map(async (t): Promise<Decoded | null> => {
        try {
          const r = await fetch(tpl.replace('{z}', String(t.z)).replace('{x}', String(t.x)).replace('{y}', String(t.y)));
          if (!r.ok) return null;
          return { tile: t, vt: new VectorTile(new PbfReader(new Uint8Array(await r.arrayBuffer()))) };
        } catch {
          return null;
        }
      }),
    );
    return out.filter((d): d is Decoded => d !== null);
  } catch {
    return [];
  }
}

function drawMap(canvas: HTMLCanvasElement, route: Route, tiles: Decoded[], view: View, w: number, h: number): void {
  const ctx = canvas.getContext('2d')!;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = CONTOUR.land[1];
  ctx.fillRect(0, 0, w, h);

  const pathFor = (d: Decoded, feat: ReturnType<VectorTile['layers'][string]['feature']>, extent: number, close: boolean): void => {
    const n = 2 ** d.tile.z;
    for (const ring of feat.loadGeometry()) {
      ring.forEach((pt, i) => {
        const m = { x: (d.tile.x + pt.x / extent) / n + d.tile.shift, y: (d.tile.y + pt.y / extent) / n };
        const s = project(view, m);
        if (i === 0) ctx.moveTo(s.x, s.y);
        else ctx.lineTo(s.x, s.y);
      });
      if (close) ctx.closePath();
    }
  };
  const each = (name: string, fn: (d: Decoded, f: ReturnType<VectorTile['layers'][string]['feature']>, extent: number) => void): void => {
    for (const d of tiles) {
      const layer = d.vt.layers[name];
      if (!layer) continue;
      for (let i = 0; i < layer.length; i++) fn(d, layer.feature(i), layer.extent);
    }
  };

  ctx.globalAlpha = 0.35;
  ctx.fillStyle = CONTOUR.land[3];
  each('landcover', (d, f, e) => {
    if (f.type !== 3 || !['wood', 'grass', 'farmland'].includes(String(f.properties.class))) return;
    ctx.beginPath(); pathFor(d, f, e, true); ctx.fill('evenodd');
  });
  ctx.globalAlpha = 1;
  ctx.fillStyle = CONTOUR.waterShallow;
  each('water', (d, f, e) => {
    if (f.type !== 3) return;
    ctx.beginPath(); pathFor(d, f, e, true); ctx.fill('evenodd');
  });
  ctx.strokeStyle = 'rgba(10,14,28,0.35)';
  ctx.lineWidth = 0.75;
  each('boundary', (d, f, e) => {
    if (f.properties.admin_level !== 2 || f.properties.maritime === 1) return;
    ctx.beginPath(); pathFor(d, f, e, false); ctx.stroke();
  });

  // Route line and points.
  const un = unwrapLons(route.points.map((p) => p.lon));
  const scr = route.points.map((p, i) => project(view, mercator(p.lat, un[i])));
  ctx.strokeStyle = ORANGE;
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  scr.forEach((s, i) => (i === 0 ? ctx.moveTo(s.x, s.y) : ctx.lineTo(s.x, s.y)));
  ctx.stroke();
  ctx.fillStyle = ORANGE;
  for (let k = 0; k < route.hourly.length; k++) {
    const s = scr[k * 6];
    ctx.beginPath();
    ctx.arc(s.x, s.y, k % 24 === 0 ? 5 : 2.5, 0, Math.PI * 2);
    ctx.fill();
    if (k % 24 === 0 && k > 0) {
      ctx.strokeStyle = '#0a0e1c'; ctx.lineWidth = 1.5; ctx.stroke();
    }
  }
  // Start and landing markers with labels.
  const label = (s: { x: number; y: number }, text: string): void => {
    ctx.font = '600 13px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    const tw = ctx.measureText(text).width;
    const right = s.x + 12 + tw < w - 4;
    const x = right ? s.x + 10 : s.x - 10 - tw;
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(10,14,28,0.8)'; ctx.strokeText(text, x, s.y - 12);
    ctx.fillStyle = '#fff'; ctx.fillText(text, x, s.y - 12);
  };
  const ring = (s: { x: number; y: number }): void => {
    ctx.beginPath(); ctx.arc(s.x, s.y, 8, 0, Math.PI * 2);
    ctx.lineWidth = 3; ctx.strokeStyle = '#0a0e1c'; ctx.stroke();
    ctx.lineWidth = 2; ctx.strokeStyle = ORANGE; ctx.stroke();
  };
  ring(scr[0]); label(scr[0], 'Start');
  ring(scr[scr.length - 1]); label(scr[scr.length - 1], 'Landing');
}

function placesOf(tiles: Decoded[]): Place[] {
  const out: Place[] = [];
  for (const d of tiles) {
    const layer = d.vt.layers['place'];
    if (!layer) continue;
    for (let i = 0; i < layer.length; i++) {
      const f = layer.feature(i);
      if (!['city', 'town', 'village'].includes(String(f.properties.class))) continue;
      const name = String(f.properties['name:latin'] ?? f.properties.name ?? '');
      if (!name) continue;
      const g = f.toGeoJSON(d.tile.x, d.tile.y, d.tile.z).geometry;
      if (g.type !== 'Point') continue;
      out.push({ name, lon: g.coordinates[0], lat: g.coordinates[1], cls: String(f.properties.class) });
    }
  }
  return out;
}

function row(dl: HTMLElement, k: string, v: string): void {
  const dt = document.createElement('dt'); dt.textContent = k;
  const dd = document.createElement('dd'); dd.textContent = v;
  dl.append(dt, dd);
}

async function run(): Promise<void> {
  const status = $('status'), dl = $('summary'), retry = $('retry');
  dl.hidden = true; retry.hidden = true; dl.textContent = '';
  status.textContent = "Working out the route from today's winds…";
  windBytes = 0;
  try {
    const manifest = await loadManifest('/winds', countingFetch);
    const wind = new WindField(manifest, countingFetch, '/winds');
    const now = Date.now();
    performance.mark('route:start');
    const t0 = performance.now();
    const route = await computeRoute(START, now, wind, routeGround);
    const computeMs = Math.round(performance.now() - t0);
    performance.mark('route:end');
    // Exposed for the live measurement harness (timing, bytes, route deviation checks).
    (window as unknown as { __proof?: unknown }).__proof = { computeMs, windBytes, runId: wind.runId, release: now, hourly: route.hourly };

    const un = unwrapLons(route.points.map((p) => p.lon));
    const merc = route.points.map((p, i) => mercator(p.lat, un[i]));
    const box = {
      x0: Math.min(...merc.map((m) => m.x)), x1: Math.max(...merc.map((m) => m.x)),
      y0: Math.min(...merc.map((m) => m.y)), y1: Math.max(...merc.map((m) => m.y)),
    };
    // Use a margin so labels and nearby places are inside the tiles we load.
    const mx = Math.max(box.x1 - box.x0, 0.02) * 0.15, my = Math.max(box.y1 - box.y0, 0.02) * 0.15;
    const padded = { x0: box.x0 - mx, x1: box.x1 + mx, y0: box.y0 - my, y1: box.y1 + my };
    const refs = tilesFor(padded);

    const canvas = $<HTMLCanvasElement>('map');
    const w = Math.round(canvas.getBoundingClientRect().width) || 360;
    const aspect = (padded.y1 - padded.y0) / (padded.x1 - padded.x0);
    const h = Math.round(Math.min(Math.max(w * aspect, w * 0.7), w * 1.15));
    canvas.style.height = `${h}px`;
    const view = fitView(merc, w, h, 36);
    const tiles = await loadTiles(refs);
    drawMap(canvas, route, tiles, view, w, h);

    const s = summarise(route);
    const place = nearestPlace(placesOf(tiles), s.landing, 100);
    const where = tiles.length === 0
      ? 'Map tiles did not load, so the place name is unknown'
      : place ? `near ${place.name} (${Math.round(place.km)} km away)` : 'open sea';
    const f = (n: number): string => n.toFixed(2);
    const lt = localTime(route.points[route.points.length - 1].tSec * 1000 + now, s.landing);
    status.textContent = 'This is a real 72 hour route through the latest forecast winds.';
    row(dl, 'Distance', `${Math.round(s.distanceKm).toLocaleString('en-GB')} km along the path`);
    row(dl, 'Straight line', `${Math.round(haversineKm(START, s.landing)).toLocaleString('en-GB')} km`);
    row(dl, 'Top speed', `${Math.round(s.topSpeedKmh)} km/h`);
    row(dl, 'Landing point', `${f(s.landing.lat)}, ${f(s.landing.lon)}`);
    row(dl, 'Landing place', `${where}, ${lt.label} local time`);
    row(dl, 'Wind run', wind.runId);
    row(dl, 'Run age', ageText(now - wind.runIssuedMs));
    row(dl, 'Wind data downloaded', `${(windBytes / 1048576).toFixed(2)} MB (${windBytes.toLocaleString('en-GB')} bytes)`);
    row(dl, 'Route compute time', `${computeMs.toLocaleString('en-GB')} ms`);
    dl.hidden = false;
    document.body.dataset.ready = '1';
  } catch (e) {
    const unavailable = e instanceof WindUnavailableError;
    status.textContent = unavailable
      ? "We can't get today's winds right now. Try again in a few minutes."
      : "We can't draw the route right now. Try again in a few minutes.";
    console.error(e);
    retry.hidden = false;
    document.body.dataset.ready = 'error';
  }
}

$('retry-btn').addEventListener('click', () => void run());
void run();
