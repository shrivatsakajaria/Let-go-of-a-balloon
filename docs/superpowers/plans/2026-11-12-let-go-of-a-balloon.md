# Let Go of a Balloon Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A static web page where anyone lets go of a balloon from any place on Earth and follows it, live for 72 hours, over the real world drawn in the Contour style, with a 20-second whole-trip replay and a shareable landing card.

**Architecture:** A static Vite + TypeScript site on Cloudflare Pages, with no backend. A scheduled GitHub Action turns NOAA GFS winds into small binary tiles that ship with the site. The browser computes the route at release, streams free map and terrain tiles around the balloon, builds Contour meshes in a Web Worker, and renders them with three.js under a directed camera.

**Tech Stack:** TypeScript 5, Vite 6, three.js (current release), Vitest, Playwright, `@mapbox/vector-tile` + `pbf`, `@photostructure/tz-lookup`, Python 3.12 with `eccodes`/`cfgrib`, `numpy` and `pytest` for the wind pipeline, GitHub Actions, Wrangler (Cloudflare Pages direct upload).

**Spec:** `docs/superpowers/specs/2026-11-12-let-go-of-a-balloon-design.md` (read it before Task 1, together with the files it lists under `docs/reference/`).

## Global Constraints

- The Wiz Digital `CLAUDE.md` standards (React/Node/Express/Azure SQL/MVC/Docker) do not apply to this project: SK approved a static site with no backend. Do not change the README to say so.
- Cost £0: free data and free hosting only; no service that bills or needs a card.
- Non-commercial: no ads, no sign-ups, no analytics that track people.
- No server stores anything. "Use my location" uses the exact GPS position with no rounding or moving (SK's decision); it only leaves the phone inside a link or card the visitor chooses to share.
- British spelling in all on-screen text. Short, plain words.
- Fonts: never Inter or Fraunces. No tilt-shift, no purple gradients, no glow or drop shadow behind text, no hard dark boxes behind text, no emoji in the interface.
- Balloon colour `#ff5a12`; the only saturated colour in the world.
- Contour palette values come from section 7 of the spec. Terrace step height is a fixed 10 m.
- Flight: climb rate 1.5 m/s from street level. Cruise on a pressure level: 850 hPa, or, where 850 hPa is less than 600 m above the ground, the lowest of 700, 600 and 500 hPa whose height is at least ground + 600 m. The balloon then follows that level's height. The flight lasts 72 hours. Route step: 10 minutes (RK2). The link stores 73 hourly points (hour 0 to hour 72). No latitude clamp on the route; only map tile maths clamps at 85.0511°.
- Wind levels: climb product `[1000, 975, 950, 925, 900, 850]` hPa at 0.25°, forecast hours `[3,6,9,12,15,18,21,24]`, u and v at 0.5 m/s per unit; cruise product `[850, 800, 750, 700, 600, 500]` hPa at 1°, hours 0 to 96 every 3 h, split into 24 h files, u and v at 1.0 m/s per unit (int8, clipped, never wrapped). Both store geopotential height (int16 m). The 180° column is duplicated in every grid. Files are stored as `.bin.gz` and unpacked with `DecompressionStream('gzip')`. A run is usable while it is under 24 h old; four runs are kept.
- Browser tests never call live services: Playwright serves fixture map, terrain and wind tiles from `tests/fixtures/` through route interception.
- Waiting on SK: any step that needs SK is a hard stop for that task only. Record what is blocked in `docs/for-sk/waiting.md` and carry on with the next task that does not depend on it.
- Performance: first frame (sky plus coarse ground) within 2 s on a mid-range phone over 4G. Route ready within 2 s. Device pixel ratio capped at 1.5. Live shadows only near the balloon. No full-screen blur passes.
- Replay length: 20 s. Landing card size: 1080 x 1350 px.
- Credits, exact text:
  - Map corner, linked, always visible over the 3D view: "OpenFreeMap © OpenMapTiles Data from OpenStreetMap © Mapterhorn"
  - Footer and credits page add: "Winds: NOAA GFS", "Place search: Open-Meteo.com (GeoNames, CC BY 4.0)", "Place names: GeoNames", and "© DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved." Then "A Still Signal build".
  - Card footer: "Winds: NOAA GFS · Map: © OpenMapTiles © OpenStreetMap contributors · Terrain: © Mapterhorn · A Still Signal build"
- Simulation notice on screen: "A simulation using forecast winds, not a real balloon. Real party balloons climb higher and pop; this one floats at about 1.5 km so you can see the ground."
- SK is not technical. Every step he must do himself is written for him click by click, in plain British English, in `docs/for-sk/`.
- Interface: every size, colour, layout rule, timing and string in spec sections 6.1, 6.5, 7.1 to 7.4 and 8 is fixed. Copy strings verbatim from 7.4. Self-host an Archivo subset (no Google Fonts request). One easing curve: `cubic-bezier(0.22,1,0.36,1)`. No spinners, skeletons, toasts, pills, glassy blur or confetti.
- Design skills: read impeccable's `reference/craft-floor.md` before any UI edit. Run unslop's checklist on every interface screen. Use `design-skills:interaction-design` for the launch, camera and replay motion. Use `design:ux-copy` for all on-screen text.

## Review Focus

1. **Crossing the date line** (a balloon released in Auckland or Fiji drifts east past 180°). The route, wind sampling, tile selection and drawn trail must continue smoothly, with no jump across the map. Tests are in Tasks 4, 5 and 10.
2. **Wind data late, missing or stale** (the newest GFS run has not been published, a tile returns 404, or the newest run is more than 24 hours old). The app uses the previous run. If it cannot, it says so plainly and offers to try again. Tests are in Tasks 4 and 16.
3. **Opening a link on another device, after landing, or a damaged link.** It shows the same route and the landed state, or a friendly "This balloon link is broken" message. It never shows a blank screen. Tests are in Task 14.
4. **High ground and high latitudes** (Mexico City, La Paz, the Alps, routes north of 80°). The balloon cruises on a level at least 600 m above the ground, a route rebuilt from a link is drawn no lower than that, and a route crossing 85° keeps flying with no fake wall. Tests are in Task 5 and Task 14.
5. **No storage, location refused or no WebGL** (private browsing, a refused permission, an old phone). Search still works, nothing nags, and the 2D fallback shows the route and the card. Tests are in Tasks 15, 14 and 22.

---

## File structure

```
index.html                     page shell, footer, fonts
package.json, tsconfig.json, vite.config.ts, playwright.config.ts
src/
  main.ts                      boot: reads link or shows start; wires modules
  config.ts                    every constant from Global Constraints
  geo/coords.ts                lat/lon maths, tile maths, wrapping
  geo/sun.ts                   sun and moon position
  geo/time.ts                  local time at a point (tz-lookup)
  wind/format.ts               binary tile layout shared with the pipeline
  wind/loader.ts               manifest + tile fetch, cache, run fallback
  wind/sampler.ts              space, time and vertical interpolation
  flight/ascent.ts             altitude over time
  flight/route.ts              route integration
  flight/codec.ts              link encode/decode
  flight/store.ts              "Your balloons" in local storage
  flight/startspot.ts          moves a searched start out of a building
  world/palette.ts             Contour colours, regional styles, time-of-day keys
  world/terrain.ts             Terrarium decode, terraces, faceted ground
  world/vector.ts              vector tile decode to typed features
  world/buildings.ts           extrusion, roofs, gap-fill houses
  world/landcover.ts           land use colours, tree placement, water
  world/meshjob.ts             one tile -> mesh buffers (pure, runs in worker)
  world/worker.ts              worker entry around meshjob
  world/lod.ts                 which tiles at which zoom around the camera
  world/stream.ts              loads, builds, swaps and disposes tiles
  world/places.ts              "Over ..." lookup: tile labels nearby, gazetteer far away
  world/gazetteer.ts           static place-name tiles (GeoNames towns + Natural Earth sea and region names)
  world/terrainsrc.ts          Mapterhorn PMTiles reader (pmtiles library), overzoom above z12
  world/sky.ts                 sky dome, haze, sun, moon, stars, lights
  balloon/balloon.ts           mesh, squash and stretch, rope, shadow
  balloon/person.ts            launch figure and animation
  camera/director.ts           shots, transitions, collision
  landmarks/types.ts           Landmark interface
  landmarks/registry.ts        nearby landmarks from cities.json
  landmarks/models/<id>.ts     one file per landmark
  ui/start.ts  ui/search.ts  ui/hud.ts  ui/facts.ts  ui/replay.ts  ui/card.ts  ui/notice.ts
  ui/styles.css
  fallback/fallback2d.ts       no-WebGL view
data/cities.json               generated from docs/reference/launch-cities.csv
data/gazetteer/<z5 tile>.json  generated by scripts/gazetteer.ts
scripts/cities.ts              CSV -> cities.json
pipeline/gfs_fetch.py          download GFS fields by byte range
pipeline/build_tiles.py        write climb and cruise tiles + manifest
pipeline/tests/                pytest
.github/workflows/deploy.yml   build site + winds, deploy to Cloudflare Pages
tests/                         Vitest unit tests, mirroring src/
e2e/                           Playwright phone-size checks
docs/for-sk/                   click-by-click notes for SK
```

---

### Task 0: Accounts, repository and preview links

**Files:**
- Create: `docs/for-sk/01-cloudflare-account.md`, `docs/for-sk/02-github-secrets.md`, `.github/workflows/deploy.yml`, `index.html`, `package.json`, `vite.config.ts`, `tsconfig.json`, `README.md`

**Interfaces:**
- Produces: `npm run build` writes `dist/`; every push to a branch deploys a preview with `wrangler pages deploy dist --project-name let-go-of-a-balloon --branch <branch>`; `main` deploys production.

- [ ] **Step 1: Write SK's Cloudflare walkthrough** in `docs/for-sk/01-cloudflare-account.md`. Cover:
  - signing up on the free plan with no card;
  - finding the Account ID;
  - creating an API token with the "Cloudflare Pages: Edit" permission only;
  - where to copy each value.
- [ ] **Step 1b: Write `docs/for-sk/03-keep-it-running.md`**: GitHub switches off schedules in public repositories after 60 days with no activity; explain the one-click "Enable workflow" fix and add a monthly keep-alive commit step to the workflow.
- [ ] **Step 2: Write SK's GitHub walkthrough** in `docs/for-sk/02-github-secrets.md`. Cover:
  - creating the public repository `let-go-of-a-balloon`;
  - adding the secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`, click by click.
- [ ] **Step 3: Scaffold Vite + TypeScript.** `index.html` shows "Let go of a balloon" and the footer line "A Still Signal build".
- [ ] **Step 4: Create the Pages project once** with `npx wrangler pages project create let-go-of-a-balloon --production-branch main` (run it in chat with SK's token, or add it as a guarded first step in the workflow).
- [ ] **Step 4b: Write `deploy.yml`.** Add `workflow_dispatch`, a `concurrency: deploy` group, and deploy scheduled runs with `--branch main`. Also check, with a one-off script run in the workflow, that OpenFreeMap tiles, the Mapterhorn PMTiles file and Open-Meteo geocoding answer cross-origin requests from the preview domain; write the result to `docs/for-sk/waiting.md` if any fail. It runs on push, on `workflow_dispatch`, and on the schedule `cron: '17 * * * *'`. A scheduled run exits early unless a GFS run newer than the deployed one has its f096 file. Otherwise it:
  - installs Node 22 and Python 3.12;
  - runs the pipeline (added in Task 3) into `dist/winds/`;
  - builds the site;
  - deploys with `cloudflare/wrangler-action`.
- [ ] **Step 5: Walk SK through 01 and 02 in chat, then push.** Expected: the Actions run is green and a `*.pages.dev` preview URL opens on SK's phone showing the shell.
- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "chore: scaffold site, Cloudflare Pages deploy and SK walkthroughs"
```

### Task 1: Config and coordinate maths

**Files:**
- Create: `src/config.ts`, `src/geo/coords.ts`
- Test: `tests/geo/coords.test.ts`

**Interfaces:**
- Produces:
  - `config.ts` exports `CLIMB_RATE_MS=1.5`, `CRUISE_ASL_M=1500`, `CRUISE_CLEARANCE_M=600`, `FLIGHT_HOURS=72`, `ROUTE_STEP_MIN=10`, `LINK_POINTS=73`, `CLIMB_LEVELS=[1000,975,950,925,900,850]`, `CRUISE_LEVELS=[850,800,750,700,600,500]`, `TERRACE_STEP_M=10`, `DPR_CAP=1.5`, `REPLAY_SECONDS=20`, `CARD_W=1080`, `CARD_H=1350`, `BALLOON_HEX='#ff5a12'`
  - `type LatLon = {lat:number; lon:number}`
  - `haversineKm(a,b): number`
  - `bearingDeg(a,b): number`
  - `destination(p: LatLon, bearingDeg:number, km:number): LatLon`
  - `wrapLon(lon): number` (range −180 to 180)
  - `lonDelta(a,b): number` (shortest signed difference)
  - `lonLatToTile(lat,lon,z): {x:number;y:number}` (fractional)
  - `tileBounds(z,x,y): {west,south,east,north}`
  - `clampLat(lat): number` (±85.0511, tile maths only)

- [ ] **Step 1: Write the failing tests**

```ts
test('haversine Parliament Square to Champ de Mars ~341 km', () => expect(haversineKm({lat:51.5007,lon:-0.1263},{lat:48.8556,lon:2.2986})).toBeCloseTo(341, -1));
test('destination then haversine round trip', () => { const p = destination({lat:53.48,lon:-2.24}, 45, 100); expect(haversineKm({lat:53.48,lon:-2.24}, p)).toBeCloseTo(100, 3); });
test('wrapLon across date line', () => { expect(wrapLon(181)).toBeCloseTo(-179); expect(lonDelta(179, -179)).toBeCloseTo(2); });
test('tile maths Manchester z14', () => { const t = lonLatToTile(53.4794,-2.2453,14); expect(Math.floor(t.x)).toBe(8089); expect(Math.floor(t.y)).toBe(5300); });
test('clampLat', () => expect(clampLat(89)).toBeCloseTo(85.0511, 4));
```

- [ ] **Step 2: Run** `npx vitest run tests/geo/coords.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement `config.ts` and `coords.ts`** with the signatures above. For the tile maths, use standard Web Mercator.
- [ ] **Step 4: Run.** Expected: PASS. If the tile index assertion is off by one, recheck it against `https://tiles.openfreemap.org`. Do not edit the expectation to fit the code.
- [ ] **Step 5: Commit** `feat: config and coordinate maths`

### Task 2: Sun, moon and local time

**Files:**
- Create: `src/geo/sun.ts`, `src/geo/time.ts`, `src/world/palette.ts` (time-of-day part only)
- Test: `tests/geo/sun.test.ts`, `tests/world/palette.test.ts`

**Interfaces:**
- Produces:
  - `sunPosition(utcMs:number, p:LatLon): {elevationDeg:number; azimuthDeg:number}`
  - `moonPosition(utcMs, p): {elevationDeg; azimuthDeg; illumination:number}`
  - `nextSunEvent(utcMs, p, route?: (t:number)=>LatLon): {kind:'sunrise'|'sunset'; utcMs:number} | null` (searches 24 h ahead, along the route if one is given)
  - `localTime(utcMs, p): {label:string; tz:string}`, where `label` is like `"Fri 07:42"` (uses `@photostructure/tz-lookup` and `Intl.DateTimeFormat('en-GB')`)
  - `lightFor(elevationDeg): Light` with `Light = {skyTop:Color; skyHorizon:Color; groundTint:Color; sun:Color; sunIntensity:number; hemiSky:Color; hemiGround:Color; night:number}` (`night` runs from 0 to 1)

- [ ] **Step 1: Write the failing tests**

```ts
test('noon sun high in London midsummer', () => expect(sunPosition(Date.UTC(2026,5,21,12,0), {lat:51.5,lon:-0.12}).elevationDeg).toBeCloseTo(61.9, 0));
test('midnight sun below horizon in Manchester November', () => expect(sunPosition(Date.UTC(2026,10,12,0,0), {lat:53.48,lon:-2.24}).elevationDeg).toBeLessThan(-30));
test('sunrise Manchester 13 Nov 2026 about 07:30 UTC', () => { const e = nextSunEvent(Date.UTC(2026,10,13,0,0), {lat:53.48,lon:-2.24})!; expect(e.kind).toBe('sunrise'); expect(Math.abs(e.utcMs - Date.UTC(2026,10,13,7,30))).toBeLessThan(10*60e3); });
test('local time in Bergen is CET', () => expect(localTime(Date.UTC(2026,10,15,20,0), {lat:60.39,lon:5.32}).label).toBe('Sun 21:00'));
test('night factor', () => { expect(lightFor(-18).night).toBe(1); expect(lightFor(30).night).toBe(0); });
```

- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Sun: NOAA solar position algorithm. Sunrise and sunset use an elevation of −0.833°.
  - Moon: a low-precision lunar position, accurate to within 1°.
  - `lightFor`: interpolate between keys at elevations −18, −10, −4, 0, 5, 15 and 40. The prototype `docs/reference/style-prototype/main.js` has a starting set of keys under `KEYS`; retune them to the Contour palette; the prototype's dusk sky (`#4d5296`) leans purple, so move it towards blue-grey.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: sun, moon, local time and light keys`

### Task 3: Wind pipeline (GFS to tiles)

**Files:**
- Create: `pipeline/gfs_fetch.py`, `pipeline/build_tiles.py`, `pipeline/requirements.txt`, `src/wind/format.ts`
- Test: `pipeline/tests/test_build_tiles.py`

**Interfaces:**
- Produces: the files below, inside `dist/winds/`.
  - `manifest.json`, written as `{"runs":[{"id":"2026111218","issued":"2026-11-12T18:00:00Z","hours":[0,3,...,96],"climb":{"tileDeg":5,"res":0.25,"hours":[3,6,9,12,15,18,21,24],"scale":0.5},"cruise":{"tileDeg":20,"res":1.0,"windowHours":24,"scale":1.0}}]}`. It lists the newest four runs, newest first.
  - Climb tiles: `climb/<run>/<tlat>_<tlon>.bin.gz`
  - Cruise tiles: `cruise/<run>/<tlat>_<tlon>_<window>.bin.gz`, one file per 24 h window (0, 1, 2, 3)
- Binary layout, shared by both products and mirrored in `src/wind/format.ts` as `TILE_HEADER` and `decodeTile(buf): WindTile`:
  - Header: magic `WIND`, `uint8 version=1`, `uint8 nLevels`, `uint8 nHours`, `uint16 nLat`, `uint16 nLon`, `float32 lat0, lon0, res, scale`, `int16 levels[nLevels]`, `int16 hours[nHours]`.
  - Then for each hour, then each level: `int8 u[nLat*nLon]` and `int8 v[...]` at `scale` m/s per unit (clipped to ±127), then `int16 gh[...]` in metres.
  - Files are gzipped on disk (`.bin.gz`); Cloudflare does not compress `.bin`.

- [ ] **Step 1: Write the failing tests.** Use synthetic numpy fields; no network needed.

```python
def test_round_trip_quantisation():
    u = np.full((21,21), 12.3); v = np.full((21,21), -7.6); gh = np.full((21,21), 1487.0)
    buf = encode_tile(lat0=40, lon0=-20, res=1.0, scale=0.5, levels=[850], hours=[0], u=u[None,None], v=v[None,None], gh=gh[None,None])
    t = decode_tile(buf)
    assert abs(t.u[0,0,5,5] - 12.5) < 0.26 and abs(t.v[0,0,5,5] + 7.5) < 0.26 and t.gh[0,0,5,5] == 1487

def test_values_beyond_range_clip_not_wrap():
    t = decode_tile(encode_tile(lat0=0, lon0=0, res=1.0, scale=1.0, levels=[500], hours=[0], u=np.full((1,1,2,2), 150.0), v=np.zeros((1,1,2,2)), gh=np.zeros((1,1,2,2))))
    assert t.u.max() == 127

def test_tiles_cover_globe_and_wrap():
    names = tile_names(tile_deg=20)
    assert len(names) == 9*18 and '80_160' in names and '-90_-180' in names

def test_tile_edges_overlap_one_cell():
    # neighbouring tiles share their edge row/column so the browser never samples a gap
    a, b = tile_slice(0, 0, 20, 1.0), tile_slice(0, 20, 20, 1.0)
    assert a.lon_stop == b.lon_start
```

- [ ] **Step 2: Run** `pytest pipeline/tests -q`. Expected: FAIL.
- [ ] **Step 3: Implement `build_tiles.py`** (`encode_tile`, `decode_tile`, `tile_names`, `tile_slice`, `main(run_id, out_dir)`) and `gfs_fetch.py` (`fetch_fields(run_id, hours, levels) -> xarray.Dataset`).
  - Data comes from `https://noaa-gfs-bdp-pds.s3.amazonaws.com/gfs.YYYYMMDD/HH/atmos/gfs.tHHz.pgrb2.0p25.fFFF`. Read the `.idx` file and use HTTP Range requests for `UGRD`, `VGRD` and `HGT` at the listed levels only.
  - Cruise tiles are downsampled to 1°, 0 to 96 h, split into 24 h windows.
  - Climb tiles stay at 0.25°, for forecast hours 3 to 24 every 3 h, and only for tiles that contain land.
  - The pipeline picks the newest run whose f096 file exists, and keeps the newest four.
- [ ] **Step 4: Run tests.** Expected: PASS. Then run `python pipeline/build_tiles.py --run latest --out /tmp/winds` and record the total size. Expected: about 70 to 80 MB per run gzipped, under 2,000 files.
- [ ] **Step 5: Wire into `deploy.yml`.** Cache the last run between workflow runs with `actions/cache` so a failed download still deploys the previous run.
- [ ] **Step 6: Commit** `feat: GFS wind pipeline to binary tiles`

### Task 4: Wind loader and sampler

**Files:**
- Create: `src/wind/loader.ts`, `src/wind/sampler.ts`
- Test: `tests/wind/sampler.test.ts`, `tests/wind/loader.test.ts`

**Interfaces:**
- Consumes: `decodeTile`, `WindTile` (Task 3); `wrapLon` and `clampLat` (Task 1)
- Produces:
  - `type Manifest`
  - `loadManifest(base='/winds'): Promise<Manifest>`, which throws `WindUnavailableError` if no run is under 24 h old
  - `class WindField { constructor(manifest, fetchFn=fetch); runIssuedMs: number; async prepare(around: LatLon, hours:[number,number]): Promise<void>; sample(p: LatLon, altAslM: number, utcMs: number): {u:number; v:number} }`
  - `sample` is synchronous and reads only prepared tiles. It throws `TileNotReadyError` if a tile is missing, and the integrator handles that.

- [ ] **Step 1: Write the failing tests** with an in-memory fetch that serves synthetic tiles.

```ts
test('uniform 10 m/s westerly samples as u=10 anywhere in tile', ...expect(w.sample({lat:53,lon:-2}, 1500, t0).u).toBeCloseTo(10, 1));
test('vertical interpolation between 850 (gh 1500, u 10) and 700 (gh 3000, u 20) at 2250 m gives 15', ...);
test('time interpolation halfway between 0 h (u 10) and 3 h (u 16) gives 13', ...);
test('sampling at lon 179.9 and -179.9 reads neighbouring tiles without a jump', ...);
test('below lowest level uses lowest level; above highest uses highest', ...);
test('newest run older than 24 h throws WindUnavailableError', ...);
test('newest run 404 falls back to previous run', ...);
```

- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Order: at each level, interpolate u, v and gh bilinearly in space and linearly in time; then find the two levels whose heights bracket the balloon's altitude and interpolate between them linearly in log-pressure.
  - Read `.bin.gz` through `DecompressionStream('gzip')`.
  - Use climb tiles while `utcMs` is within their hours and `altAslM` is below the 850 hPa height; otherwise use cruise tiles.
  - Also produces `cruiseLevelHeight(p, utcMs, groundM): {levelHpa:number; heightM:number}` for the route.
  - Cache tiles in a `Map` keyed by product, run and tile.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: wind loader and sampler`

### Task 5: Ascent and route

**Files:**
- Create: `src/flight/ascent.ts`, `src/flight/route.ts`
- Test: `tests/flight/route.test.ts`

**Interfaces:**
- Consumes: `WindField.sample` and `prepare` (Task 4), `destination` and `wrapLon` (Task 1)
- Produces:
  - `altitudeAt(tSec:number, groundM:number, cruiseTargetM:number): number`, which climbs at 1.5 m/s from `groundM + 1.5` to `cruiseTargetM`
  - `cruiseLevel(groundM:number, levelHeights: Record<number,number>): number`, which returns 850, or the lowest of 700, 600 and 500 whose height is at least `groundM + 600`
  - Ground height for the route comes from Mapterhorn at z7, taking the highest of the 3 x 3 pixels around each point (about 10 tiles for a long route).
  - `type RoutePoint = {tSec:number; lat:number; lon:number; altM:number; groundM:number; speedMs:number; headingDeg:number}`
  - `computeRoute(start: LatLon, releaseUtcMs:number, wind: WindField, ground: (p:LatLon)=>Promise<number>): Promise<Route>`
  - `Route = {points: RoutePoint[]; hourly: LatLon[]; release:number; runId:string}`. The 10-minute points cover 0 to 72 h, and `hourly` has 73 entries.
  - `positionAt(route, utcMs): RoutePoint`, interpolated

- [ ] **Step 1: Write the failing tests**

```ts
test('climb: 300 s after release at sea level the balloon is ~451 m up', () => expect(altitudeAt(300, 0, 1500)).toBeCloseTo(451.5, 0));
test('climb reaches cruise 1500 m from sea level after ~999 s and stays', () => { expect(altitudeAt(999, 0, 1500)).toBeCloseTo(1500, 0); expect(altitudeAt(5000, 0, 1500)).toBe(1500); });
test('cruise level over Manchester is 850 hPa', () => expect(cruiseLevel(80, {850:1480,700:3050,600:4250,500:5650})).toBe(850));
test('cruise level over Mexico City (2240 m) is 700 hPa', () => expect(cruiseLevel(2240, {850:1480,700:3100,600:4300,500:5800})).toBe(700));
test('cruise level over La Paz (3640 m) is 500 hPa', () => expect(cruiseLevel(3640, {850:1480,700:3100,600:4250,500:5800})).toBe(500));
test('constant 10 m/s westerly wind (u=+10) for 72 h from (0, 0) moves ~2592 km east', async () => { const r = await computeRoute(...uniform u=10...); expect(haversineKm(r.hourly[0], r.hourly[72])).toBeCloseTo(2592, -1); expect(r.hourly).toHaveLength(73); });
test('route crossing 180° stays continuous (no step > 50 km between 10-min points)', ...);
test('ground rising mid-route moves the balloon to a higher pressure level', ...);
test('route crossing 86°N keeps flying with no wall (latitude can exceed 85)', ...);
test('route rebuilt from 73 link points is drawn no lower than ground + 600 m', ...);
test('positionAt halfway between points interpolates', ...);
```

- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Use a midpoint (RK2) step every 10 minutes.
  - At each step, `ground(p)` comes from the terrain sampler (Task 7 supplies the real one; tests pass a stub).
  - Call `wind.prepare` lazily as the route moves into new tiles.
- [ ] **Step 4: Run.** Expected: PASS. Then time a 72 h route with synthetic tiles in Node. Expected: under 300 ms.
- [ ] **Step 5: Commit** `feat: ascent model and route integration`

### Task 6: Data proof part 1, SK check-in

**Files:**
- Create: `src/debug/routeproof.ts`, `debug.html`

**Interfaces:**
- Consumes: Tasks 1 to 5

- [ ] **Step 1: Build `debug.html`.** On a plain 2D canvas, draw the real route from Albert Square, Manchester (53.4794, −2.2453) using the live deployed winds. Show:
  - each hour's point;
  - the total distance, top speed and landing place;
  - the run id.
- [ ] **Step 2: Deploy a preview.** Send SK the link with a one-line explanation. Wait for his OK before Task 9.
- [ ] **Step 3: Commit** `chore: route data proof page`

### Task 7: Terrain and faceted ground

**Files:**
- Create: `src/world/terrain.ts`, `src/world/terrainsrc.ts`
- Modify: `src/world/palette.ts` (add land colours)
- Test: `tests/world/terrain.test.ts`

**Interfaces:**
- Produces:
  - `decodeTerrarium(rgba: Uint8ClampedArray, size:number): Float32Array` (metres = R*256 + G + B/256 − 32768)
  - `terraceHeight(h:number, slope:number): number`, which steps at a fixed 10 m and blends in only where `slope` > 0.12, fully at 0.3
  - `buildGround(heights: Float32Array, size:number, bounds, landcover: LandcoverGrid): MeshBuffers` (flat-shaded, non-indexed, with vertex colours)
  - `MeshBuffers = {position: Float32Array; normal: Float32Array; color: Float32Array}`
  - `terrainTile(z,x,y): Promise<Float32Array>` in `terrainsrc.ts`: reads the Mapterhorn `planet.pmtiles` archive (global Copernicus 30 m, z0 to z12) with the `pmtiles` library over HTTP range requests, and the regional high-resolution archives where they exist. Above z12 it crops and upsamples the z12 tile. Decode the image with `createImageBitmap(blob, {colorSpaceConversion:'none', premultiplyAlpha:'none'})`. Confirm the archive URLs from mapterhorn.com before coding, and record them in `config.ts`. If browser range requests are refused, fall back to the AWS Terrain Tiles (Terrarium) and note it for SK.
  - `LandcoverGrid = {size:number; classes: Uint8Array}`: one land-cover class per ground cell, filled by `meshjob.ts` from the vector tile (wood, grass, farmland, sand, rock, built-up, water).
- `palette.ts` exports `CONTOUR.land` (`#e6d6a2`, `#b9cd86`, `#a0c078`, `#88b06c`, `#76a063`), `CONTOUR.cliff` (`#d4a982`), `CONTOUR.waterDeep` (`#2b7fb0`), `CONTOUR.waterShallow` (`#8fd3cf`), `CONTOUR.building` (`#f4efe5`, `#ebe3d4`) and `CONTOUR.roof` (`#d9bfa4`, `#c9ad92`, `#9fa6aa`).

- [ ] **Step 1: Write the failing tests**

```ts
test('terrarium decode of (128,0,0) is 0 m', () => expect(decodeTerrarium(new Uint8ClampedArray([128,0,0,255]),1)[0]).toBe(0));
test('terrace leaves flat ground unchanged', () => expect(terraceHeight(37, 0.05)).toBe(37));
test('terrace on steep ground snaps to 10 m steps', () => expect(terraceHeight(37, 0.5) % 10).toBeCloseTo(0, 5));
test('buildGround emits 3 vertices per triangle with shared face normals', ...);
test('no ground colour is more saturated than the balloon', () => allColours(CONTOUR).forEach(c => expect(saturation(c)).toBeLessThan(saturation('#ff5a12'))));
```

- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** with the signatures above. Faceting copies the prototype's approach (`toNonIndexed` plus per-face colour) but takes real heights.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: terrain decode, terraces and faceted ground`

### Task 8: Vector tiles to Contour meshes

**Files:**
- Create: `src/world/vector.ts`, `src/world/buildings.ts`, `src/world/landcover.ts`, `src/world/meshjob.ts`, `src/world/worker.ts`
- Test: `tests/world/meshjob.test.ts`, fixture `tests/fixtures/omt_14_8089_5300.pbf` (download once from OpenFreeMap and commit it)

**Interfaces:**
- Consumes: `buildGround` and `CONTOUR` (Task 7)
- Produces:
  - `decodeVectorTile(buf, z,x,y): Features`, with `Features = {water, landuse, landcover, park, transportation, building, place, water_name}` in local metres
  - `buildTileMeshes(features, heights, z,x,y, region: RegionStyle): TileMeshes`
  - `TileMeshes = {ground: MeshBuffers; water: MeshBuffers; buildings: MeshBuffers; roofs: MeshBuffers; trees: Float32Array /* instance matrices */; lamps: Float32Array; labels: Label[]}`
  - `worker.ts` answers `{type:'build', z,x,y, region, vectorUrl, terrain: Float32Array, hiddenFootprints: {lat,lon,radiusM}[]}` with the `TileMeshes` above, sent as transferable buffers. `hiddenFootprints` comes from landmarks (Task 20); buildings whose centroid falls inside one are skipped. The OpenFreeMap tile URL template comes from `https://tiles.openfreemap.org/planet` (TileJSON, versioned) read once at boot.
- Rules:
  - Buildings are extruded to `render_height`, starting from `render_min_height`.
  - Buildings under 12 m get a pitched roof along their longest side.
  - Built-up land use with no buildings in a cell gets gap-fill houses at a density of about one per 350 m².
  - Trees are placed only inside `landcover` class `wood` and `park` polygons, and along tree rows where present.
  - The water edge gets a deep band.

- [ ] **Step 1: Write the failing tests** on the fixture tile (Albert Square, Manchester).

```ts
test('fixture has buildings with heights', () => expect(f.building.filter(b => b.height > 20).length).toBeGreaterThan(50));
test('Manchester Town Hall area produces building geometry', () => expect(m.buildings.position.length).toBeGreaterThan(30000));
test('no tree instance falls outside a wood or park polygon', ...);
test('low building gets a roof, tall one does not', ...);
test('mesh building for one z14 tile takes < 150 ms in Node', ...);
```

- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Use `@mapbox/vector-tile` and `pbf`, `earcut` for polygons, and a 2D grid hash to check gap-fill coverage.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: vector tiles to Contour meshes in a worker`

### Task 9: Data proof part 2, SK check-in

**Files:**
- Create: `src/debug/tileproof.ts`, `tileproof.html`

- [ ] **Step 1: Render the 3x3 z14 tiles around Albert Square** in three.js. Use the Contour look with fixed golden-hour light and a slow orbit camera.
- [ ] **Step 2: Check it against the impeccable craft floor and the prototype frames.** Capture a 390 x 844 screenshot with Playwright.
- [ ] **Step 3: Deploy a preview and send it to SK** with the screenshot. Wait for his OK before Task 10.
- [ ] **Step 4: Commit** `chore: tile data proof page`

### Task 10: Streaming world and level of detail

**Files:**
- Create: `src/world/lod.ts`, `src/world/stream.ts`
- Test: `tests/world/lod.test.ts`

**Interfaces:**
- Consumes: worker (Task 8), `lonLatToTile` and `wrapLon` (Task 1)
- Produces:
  - `WorldStream.groundAt(p: LatLon): number` and `WorldStream.buildingTopAt(p: LatLon, radiusM:number): number`, read from loaded tiles (for the camera director and landmarks).
  - `tilesFor(camera: {lat;lon;altM;headingDeg}, budget): TileKey[]`, with `TileKey={z,x,y}`:
    - z14 within 1.5 km of the camera's ground point;
    - z13 out to 5 km (buildings exist in OpenMapTiles only at z13 and z14, so the city must not vanish from 1.5 km up);
    - z12 out to 10 km, ground, water and land use only;
    - z10 out to 40 km;
    - z7 out to the horizon. Far tiles carry ground, water and land use only.
  - `class WorldStream { constructor(scene, workerPool, region: (p)=>RegionStyle); update(camera): void; dispose(): void }`, with at most 40 tiles alive and at most 6 builds in flight.

- [ ] **Step 1: Write the failing tests**

```ts
test('near tiles are z14 and far tiles z7', ...);
test('tile set across the date line includes x=0 and x=2^z-1', ...);
test('budget never exceeds 40 tiles', ...);
test('moving 1 km reuses at least 80% of tiles', ...);
```

- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Fade in each new tile over 400 ms.
  - Hide the seam between levels of detail with a matching ground colour and the haze.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: streaming world with level of detail`

### Task 11: Sky, haze and lights

**Files:**
- Create: `src/world/sky.ts`, `src/world/clouds.ts`
- Modify: `src/world/stream.ts` (window and lamp emissive driven by `night`)

**Interfaces:**
- Consumes: `sunPosition`, `moonPosition` and `lightFor` (Task 2)
- Produces: `class Sky { constructor(scene); update(utcMs, p: LatLon): Light }`
  - Sets the sun, moon, hemisphere light, sky dome, stars and the fog colour and distance.
  - Haze starts at 20% of the far distance.
- Produces: `class Clouds { constructor(scene); update(dtSec, windAtCruise:{u:number;v:number}): void }`
  - 8 to 14 soft, faceted fair-weather clouds below cruise height, drifting with the wind and casting shadows, so long sea crossings stay alive.
  - Occasional small boats on sea tiles come from the stream as instanced meshes.

- [ ] **Step 1: Write a Playwright test** that renders the tile proof scene at four fixed times (dawn, noon, golden hour, midnight in Manchester) and saves screenshots. It asserts the mean luminance order midnight < dawn < golden < noon.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Windows use a world-space window pattern; the prototype's `withWindows` shader patch is the reference.
  - Lit windows and street lamps scale with `night`.
  - Add a city glow where building density is high.
- [ ] **Step 4: Run.** Expected: PASS. Look at the four screenshots against section 7 of the spec.
- [ ] **Step 5: Commit** `feat: real sun sky, haze and night lights`

### Task 12: Balloon, person and launch

**Files:**
- Create: `src/balloon/balloon.ts`, `src/balloon/person.ts`
- Test: `tests/balloon/rope.test.ts`

**Interfaces:**
- Produces:
  - `class Balloon { constructor(scene); setState(p: RoutePoint, dtSec:number, sun: Light): void; mesh: THREE.Object3D; displayScale(cameraDistM:number): number }`
    - Real radius 0.15 m.
    - `displayScale` returns 1 below 20 m of camera distance and grows smoothly to at most 40x at 2 km, so the balloon stays visible.
    - Squash and stretch come from vertical acceleration; it leans into the wind and spins slowly.
    - The rope has 20 verlet segments of 0.06 m.
    - A stylised soft shadow decal is projected straight down onto the ground.
  - `class Person { constructor(scene, at: LatLon, facingDeg:number); play(onRelease:()=>void): void }`
    - Timeline: hold (0 to 1.2 s), open hand at 1.2 s (`onRelease`), look up (1.2 to 3 s), arm half-raised (2 to 3.5 s).
    - Simple capsule body, no face, neutral clothing in the chalk palette.

- [ ] **Step 1: Write the failing tests**

```ts
test('rope keeps segment lengths within 2% after 600 steps of wind', ...);
test('displayScale is 1 at 5 m and <= 40 at 3000 m', ...);
```

- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Use `design-skills:interaction-design` for the launch timing and easing. The prototype's balloon shape, squash and rope are the reference.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: balloon physics look, person and launch`

### Task 13: Camera director

**Files:**
- Create: `src/camera/director.ts`
- Test: `tests/camera/director.test.ts`

**Interfaces:**
- Consumes: `Balloon`, `RoutePoint`, and `groundAt(p): number` from `WorldStream`
- Produces: `class Director { constructor(camera); mode: 'film'|'ride'|'above'|'side'|'launch'|'replay'; update(b: RoutePoint, dtSec, groundAt): void; set(mode): void }`
  - Shots follow section 8 of the spec.
  - Film mode cycles ride for 40 s, circling for 30 s, side-on for 30 s and straight down for 20 s.
  - Positions are smoothed with a critically damped spring (time constant 1.2 s).
  - After smoothing, the camera is clamped to stay at least 8 m above the ground and above building tops within 30 m.
  - With `prefers-reduced-motion`, film mode only uses ride and circling, with slower turns.

- [ ] **Step 1: Write the failing tests**

```ts
test('camera never below ground + 8 m over a 300 m hill', ...);
test('film schedule order and durations', ...);
test('switching to side-on converges within 4 s', ...);
test('reduced motion excludes side-on and straight-down', ...);
test('film mode switches shot within 3 s of a coast-crossing event', ...);
test('in ride the projected balloon height stays between 18% and 35% of the viewport', ...);
```

- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: directed camera`

### Task 14: Links and "Your balloons"

**Files:**
- Create: `src/flight/codec.ts`, `src/flight/store.ts`
- Test: `tests/flight/codec.test.ts`, `tests/flight/store.test.ts`, `e2e/link.spec.ts`

**Interfaces:**
- Produces:
  - `encodeBalloon(b: SavedBalloon): Promise<string>` and `decodeBalloon(s): Promise<SavedBalloon>`, which rejects with `BadLinkError`
    - `SavedBalloon = {v:1; name:string; start:LatLon; release:number; hourly:LatLon[73]; runId:string}`
    - Binary layout: lat/lon at 1e-4°, then hourly deltas as zigzag variable-length integers (longitude deltas wrapped to ±180° first), release in minutes as uint32, then `deflate-raw` via `CompressionStream`, then base64url.
    - The link form is `/?b=<payload>`, under 600 characters.
  - `store.list(): SavedBalloon[]`, `store.add(b)` and `store.remove(id)`. All three are wrapped in try/catch and return `[]` when storage is unavailable.

- [ ] **Step 1: Write the failing tests**

```ts
test('round trip keeps every hourly point within 15 m', ...);
test('a fast high-latitude route (5° per hour) and a date-line route round-trip correctly', ...);

test('link length under 600 chars for a 2,600 km route', ...);
test('corrupted payload throws BadLinkError, UI shows "This balloon link is broken. Let go of a new one?"', ...);
test('opening a link after 72 h shows the landed state and the card says "Landed near"', ...);
test('store works with localStorage throwing', ...);
```

- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** A link route is replayed from its stored hourly points, smoothed with a Catmull-Rom curve; it is never recomputed.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: shareable links and saved balloons`

### Task 15: Start screen, search, featured cities and location

**Files:**
- Create: `src/ui/start.ts`, `src/ui/search.ts`, `src/flight/startspot.ts`, `scripts/cities.ts`, `data/cities.json`, `src/ui/styles.css`, `public/og.png` (1200 x 627 golden-hour preview), `public/fonts/archivo-subset.woff2`
- Test: `tests/ui/search.test.ts`, `tests/flight/startspot.test.ts`, `e2e/start.spec.ts`

**Interfaces:**
- Produces:
  - `searchPlaces(q:string, signal): Promise<Place[]>`
    - Calls `https://geocoding-api.open-meteo.com/v1/search?name=<q>&count=8&language=en`, debounced 250 ms.
    - `Place={name; admin1?; country; lat; lon}`.
    - The suggestion label is "Windermere, England, United Kingdom".
  - `toOpenSpace(p: LatLon, features): LatLon` moves a searched start that lands inside a building to the nearest square, park or street within 150 m.
  - `cities.json` also stores `launch.headingDeg`, the direction from the launch spot to the main landmark, so the launch camera frames it.
  - `cities.json` is generated from the CSV with `npm run cities`. Fields: `{id, country, city, tier, batch, launch:{lat,lon,label}, landmarks:string[], notes?}`.
  - `start.ts` renders the search, "Use my location" and featured cities from the launch batch, plus "Your balloons" (Task 14), over a live golden-hour scene of the last-used or default city (London).

- [ ] **Step 1: Write the failing tests**

```ts
test('suggestion label includes region and country', ...);
test('no results shows "No places found. Try a nearby town."', ...);
test('Use my location starts the route at the exact GPS position', ...);
test('a searched start inside a building moves to open space', ...);
test('location refused falls back to search with no repeat prompt', ...); // e2e with permission denied
test('cities.json has 120 entries, 24 in launch batch', ...);
test('e2e: first visit shows "From London" and Let go works without searching', ...);
test('e2e: text contrast over noon, snow and sand scenes is at least 4.5:1 (sample pixels behind each text box)', ...);
test('search input follows the combobox pattern (role, aria-expanded, aria-activedescendant)', ...);
test('index.html has Open Graph and X card tags and a 1200x627 preview image', ...);
test('no request goes to fonts.googleapis.com', ...);
```

- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Read impeccable's craft floor first.
  - Text sits on soft gradient shading, never in boxes.
  - Clock and figures use condensed bold numerals. The face is the builder's choice, but never Inter or Fraunces; Archivo with its width axis matches the prototype.
  - The only orange is the Let go button.
  - Run the unslop checklist on the finished screen.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: start screen, search, featured cities, my location`

### Task 16: Live flight, HUD and facts

**Files:**
- Create: `src/ui/hud.ts`, `src/ui/facts.ts`, `src/world/places.ts`, `src/ui/notice.ts`
- Modify: `src/main.ts`
- Test: `tests/ui/facts.test.ts`, `e2e/live.spec.ts`

**Interfaces:**
- Consumes: `computeRoute` and `positionAt` (Task 5), `Director`, `Balloon`, `Person`, `WorldStream`, `Sky`, `localTime`, `nextSunEvent`
- Produces:
  - `placeOver(p: LatLon, labels: Label[]): Promise<string>`, giving "the North Sea", "Leeds" or "the Lake District". It prefers water names over sea, then the nearest town within 5 km, then a park or peak, from loaded tile labels; anywhere else (the landing place, replay names, far points) it uses `gazetteer.ts`.
  - `gazetteer.ts`: `nearestPlace(p): Promise<{name:string; kind:'town'|'sea'|'region'; country?:string}>` from `data/gazetteer/` tiles built by `scripts/gazetteer.ts` from GeoNames `cities5000` (CC BY 4.0) and Natural Earth marine and geography regions (public domain). Credit "Place names: GeoNames" in the footer.
  - `factsFor(state): string[]` produces:
    - wind speed and direction;
    - time to cross the nearest town at the current speed;
    - distance from home;
    - what it is over;
    - local time;
    - sunrise or sunset;
    - time to landing.
  - The fact line rotates every 6 s.
  - The HUD shows the local time, height, speed, "Over ...", and the 72 h progress line with its knot.
  - `notice.ts` shows the simulation notice and wind-unavailable errors in plain text.
- Release flow:
  1. Let go: start the person's animation.
  2. `computeRoute` runs alongside it.
  3. On release, the balloon follows the route from release time at real speed.
  4. The page writes the link (Task 14).

- [ ] **Step 1: Write the failing tests**

```ts
test('facts use km/h and British spelling', ...);
test('crossing time for Leeds at 31 km/h is "about 23 minutes"', ...);
test('over the sea reads "Over the North Sea"', ...);
test('wind unavailable shows "We can't get today's winds right now. Try again in a few minutes."', ...);
test('e2e: Let go from London shows person, then balloon rising, HUD height increasing within 10 s', ...);
test('chrome fades out on Let go and the HUD fades back in at about 20 s', ...);
test('string line shows "Day 1 of 3" and a tick at local midnight', ...);
test('Pause stops camera movement and fact rotation', ...);
test('fact line is aria-live off; status region announces launch, country change and landing only', ...);
test('route not ready at 1.2 s: person holds with idle sway, wind error after 6 s', ...);
```

- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Use `design:ux-copy` for the wording of every fact and message.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: live flight with HUD and facts`

### Task 17: Landing card and sharing

**Files:**
- Create: `src/ui/card.ts`
- Test: `tests/ui/card.test.ts`, `e2e/card.spec.ts`

**Interfaces:**
- Produces: `renderCard(route, scene): Promise<Blob>`, a 1080 x 1350 PNG laid out exactly as spec section 6.5, and `showCard(route)`, which offers Share card, Save image and Copy link.
- Card text:
  - kicker: "Expected to land near" (or "Landed near");
  - headline: "<Start> to <Landing place>";
  - stats: distance, time aloft and top speed;
  - footer: the date, then the card credit line from Global Constraints.
- Sharing:
  - Share uses `navigator.share({files})` where `navigator.canShare` allows it.
  - Otherwise the page downloads the image.

- [ ] **Step 1: Write the failing tests**

```ts
test('card is exactly 1080x1350', ...);
test('headline for Manchester to Bergen fits on two lines at the chosen size', ...);
test('share falls back to download when canShare is false', ...);
test('in the LinkedIn or X in-app browser the card opens full screen with "Press and hold to save" and "Open in your browser"', ...);
test('share text is "My balloon from Manchester is expected to land near Bergen."', ...);
test('a sea landing reads "Expected to come down in the North Sea"', ...);
```

- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Render a fresh frame of the route's landing area at golden hour into an offscreen canvas, then lay out the text in 2D canvas.
- [ ] **Step 4: Run.** Expected: PASS. Look at the PNG against unslop's "one bright element" rule.
- [ ] **Step 5: Commit** `feat: landing postcard and sharing`

### Task 18: Whole-trip replay

**Files:**
- Create: `src/ui/replay.ts`
- Modify: `src/camera/director.ts` (replay shot)

**Interfaces:**
- Produces: `playReplay(route, opts:{seconds:20}): Promise<void>`
  - A high, wide camera follows a trail drawn behind the balloon.
  - Sky time runs with the route, so night sweeps across.
  - Large place names fade in as each place is crossed.
  - The screen is labelled "Forecast route".
  - It ends by calling `showCard`.
  - It honours reduced motion with a static route view.

- [ ] **Step 1: Write a failing e2e test** (timing per spec section 8: 2 s climb, 15 s travel, 2 s descent, 1 s hold, at most five place names). Pressing "Show me the whole trip" shows the "Forecast route" label, then the card appears within 22 s, then "Back to live" returns to live with HUD time equal to now.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Use `design-skills:interaction-design` for pacing.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: whole-trip replay`

### Task 19: Regional building styles

**Files:**
- Modify: `src/world/palette.ts`
- Test: `tests/world/palette.test.ts`

**Interfaces:**
- Produces: `regionStyle(p: LatLon): RegionStyle`, with `RegionStyle = {walls:string[]; roofs:string[]; roofPitch:number}`
  - The lookup goes by country and city bounding boxes.
  - Defined styles:
    - Paris: cream stone and grey zinc mansard roofs.
    - London: brick and slate.
    - Barcelona: ochre.
    - New York: brownstone plus glass towers.
    - Mumbai: warm plaster.
    - Dubai: sand and glass.
    - Tokyo: pale grey with dense low-rise.
    - Default: Contour chalk.

- [ ] **Step 1: Write the failing tests.** Paris returns zinc roofs. A point in the North Sea returns default. No regional colour has a saturation above 0.35.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: regional building styles`

### Task 20: Landmark system and the first landmark

**Files:**
- Create: `src/landmarks/types.ts`, `src/landmarks/registry.ts`, `src/landmarks/models/london-elizabeth-tower.ts`, `src/landmarks/models/london-palace-of-westminster.ts`
- Test: `tests/landmarks/registry.test.ts`

**Interfaces:**
- Produces:
  - `interface Landmark { id:string; cityId:string; at: LatLon; headingDeg:number; footprintRadiusM:number; build(style: RegionStyle): THREE.Group; animate?(group, utcMs, light: Light): void }`
  - `landmarksNear(p: LatLon, km:number): Promise<Landmark[]>` lazy-imports the model modules by id.
  - The stream hides any OSM building whose centroid falls inside a landmark's footprint.
  - Each landmark module must be under 30 KB gzipped and under 4,000 triangles, and use Contour colours only.

- [ ] **Step 1: Write the failing tests**

```ts
test('Elizabeth Tower is returned within 1 km of Parliament Square', ...);
test('OSM buildings inside the footprint are hidden', ...);
test('every model is under 4,000 triangles', ...);
```

- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Model the Elizabeth Tower and the Palace of Westminster in code: faceted, chalk stone, a clock face that lights at dusk.
- [ ] **Step 4: Run.** Expected: PASS. Capture the London launch at golden hour and send it to SK as the first landmark preview.
- [ ] **Step 5: Commit** `feat: landmark system with Westminster`

### Task 21: Launch batch landmarks (24 cities)

**Files:**
- Create: `src/landmarks/models/<id>.ts`, one per landmark, for every city whose `batch` is "Launch batch" in `data/cities.json`
- Test: extend `tests/landmarks/registry.test.ts`

**Interfaces:**
- Consumes: the `Landmark` interface (Task 20)

- [ ] **Step 1: Confirm every launch spot against OpenStreetMap.** For each launch-batch city, move the launch spot onto an open public space. Update `docs/reference/launch-cities.csv`, regenerate `cities.json`, and record the changes in `docs/for-sk/launch-spots.md` for SK to copy into his sheet.
- [ ] **Step 2: Write the failing test.** Every launch-batch city has its first-listed landmark (the hero one in the CSV's "Landmarks to model") as a module, and every module passes the triangle and size limits. The other listed landmarks for these cities follow in the weekly batches.
- [ ] **Step 3: Model the landmarks city by city.** Commit after each city with `feat: landmarks for <city>`.
- [ ] **Step 4: Get SK's sign-off on rights flags.** For each row with a rights note (Paris, Tokyo, Sydney, Dubai, Singapore, Rio de Janeiro), send SK a screenshot and the note. Do not ship the model until he replies OK. Paris never gets the night light show.
- [ ] **Step 5: Run all tests.** Expected: PASS.

### Task 22: Fallbacks, footer, performance

**Files:**
- Create: `src/fallback/fallback2d.ts`, `e2e/perf.spec.ts`, `e2e/fallback.spec.ts`
- Modify: `index.html` (footer credits), `src/main.ts`

**Interfaces:**
- Produces:
  - `startFallback(route|undefined)` draws the route on a 2D canvas with the coastline from z5 vector tiles, plus the HUD, facts and card.
  - WebGL context loss triggers a reload of the scene, or the fallback if it happens twice.

- [ ] **Step 1: Write the failing e2e tests.** Run them at 390 x 844 with CPU throttle 4x and network "Fast 4G".
  - First canvas paint is under 2,000 ms.
  - The route is ready within 2,000 ms after Let go.
  - Hard caps hold during 20 s of live flight: under 600,000 triangles and 250 draw calls (read from `renderer.info`).
  - `?fps=1` shows an on-screen frame counter so SK can check smoothness on his own phone (software rendering in CI makes frame times meaningless).
  - With WebGL disabled, the fallback shows the route and the card.
  - The footer contains every credit and "A Still Signal build".
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement and tune** until the tests pass (stop after three tuning rounds and report what is left).
  - Cap the device pixel ratio.
  - Use one shadow-casting light, with a shadow frustum of 300 m around the balloon.
  - Instance trees, lamps and roofs.
  - Merge building meshes per tile.
  - Lower the level of detail if the frame time goes over budget.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: fallbacks, credits and performance budget`

### Task 23: Design and accessibility passes

**Files:**
- Modify: as findings require

- [ ] **Step 1: Run impeccable `critique`** on the start, live, replay and card screens at 390 x 844, then `polish`. Apply the fixes.
- [ ] **Step 2: Run the unslop audit and checklist** on the interface chrome. Fix every sign it finds.
- [ ] **Step 3: Run `design-skills:accessibility-audit` (WCAG 2.2 AA).** Check:
  - text contrast over the scene, using the shading under the text;
  - focus rings;
  - button labels;
  - reduced motion;
  - screen-reader text for the HUD.

  Fix the findings.
- [ ] **Step 4: Run a `design:ux-copy` pass** on every string. All copy must be British spelling, with no exclamation marks and no trailing full stops on labels.
- [ ] **Step 5: Re-run all tests and capture** desktop and mobile screenshots into `docs/review/`. Expected: PASS.
- [ ] **Step 6: Commit** `chore: design, copy and accessibility passes`

### Task 24: Launch and hand back

- [ ] **Step 1: Merge to `main`.** The production deploy goes green. Open the production URL on a phone and let go from London, Windermere and Auckland (the date line case).
- [ ] **Step 2: Use superpowers:verification-before-completion.** Every "Done means" item in the brief (`docs/reference/01_let_go_of_a_balloon.md`) and every goal in spec section 3 must be shown, not claimed.
- [ ] **Step 3: Write `docs/for-sk/handback.md`** with:
  - the live link;
  - three 1080 x 1920 phone screenshots: the London launch at golden hour, the ride view over the moors, and the landing card;
  - a 15-second recording plan, shot by shot: Let go, rise past Big Ben, ride view, whole-trip replay, card;
  - three hook ideas for the post.
- [ ] **Step 4: Optional own web address.** If SK wants one, explain the cost (about £10 to £15 a year) and the steps, click by click.
- [ ] **Step 5: Commit** `docs: hand back`

### Task 25: After launch, weekly landmark batches

- [ ] **Each week, repeat Task 21's steps for the next set of Tier 1 cities**, chosen by SK. Then do the same for Tier 2. Each batch ends with a preview link and screenshots SK can post.
