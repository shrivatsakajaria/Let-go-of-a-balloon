# Let go of a balloon

A small website that shows where a balloon would drift if you let it go. It is a static site with no server. It is built with Vite and TypeScript and hosted on Cloudflare Pages.

## Commands

```
npm install      # install the tools
npm run dev      # start a local copy of the site
npm run build    # build the site into dist/ (type check, then Vite)
npm start        # serve the built site locally (after npm run build)
```

Node 22 or newer is needed (`.nvmrc` says 22).

## Test

```
npm test                       # unit tests (vitest)
npm run e2e                    # browser tests (Playwright; first time: npx playwright install chromium)
pytest pipeline/tests -q       # wind pipeline tests (run inside the Python venv, see below)
```

A few speed checks in the unit tests are skipped when the `CI` environment variable is set, because shared runners are too noisy for them.

The browser tests build the site and serve it on port 4173; `E2E_PORT=4391 npm run e2e` uses another port (two copies of the project testing at once must not share one). `e2e/perf.spec.ts` measures the performance budget on a slowed CPU and network (`PERF_CITIES=1 npx playwright test e2e/perf-cities.spec.ts` checks it in the densest launch cities on the real map, which needs the network), and `e2e/security.spec.ts` runs the site under the security headers from `public/_headers`. Add `?fps=1` to the address to see a frame counter on a real phone.

## Wind pipeline

`pipeline/build_tiles.py` downloads the newest NOAA GFS forecast run, cuts the winds into small tile files and writes them, with a `manifest.json`, to a folder that is published as `/winds` on the site. It keeps the newest four runs in a store folder between runs. Each run reaches forecast hour 120, so the site can use a run until it is 48 hours old (`src/wind/loader.ts` keeps only runs that reach the landing, 72 hours after release). GitHub Actions runs it on two hourly timers.

To run it on your computer, use a virtual environment so nothing is installed globally:

```
python -m venv .venv
. .venv/bin/activate
pip install -r pipeline/requirements.txt -r pipeline/requirements-dev.txt
pytest pipeline/tests -q
python pipeline/build_tiles.py --run latest --store .winds-store --out public/winds
```

## Deploy

`.github/workflows/deploy.yml` deploys to Cloudflare Pages.

- On every push and manual run it checks types, runs the unit and pipeline tests, builds, adds the wind tiles and deploys. A failing check stops the deploy.
- Twice an hour (minutes 17 and 47; GitHub often runs them late or skips them) it checks for a newer GFS run (both products at f120) or newer code on `main` (`scripts/check-new-run.sh`) and, only if there is one, rebuilds and deploys. Timer runs skip the tests and build with `vite build` alone, so a type error in a test cannot stop the winds being refreshed.
- Pushes to `main` go to production. Any other branch becomes a preview link, shown in the run summary. Tags do not deploy. Each Pages branch has its own concurrency queue, so a preview never cancels a live deploy. In the live queue a timer run can cancel a waiting push or manual run on `main`; it then deploys `main` itself, because a timer run also deploys whenever the live `/build.json` names another commit than `main`'s.
- Every run that publishes to production fails when the newest live wind run is over 18 hours old (`scripts/check-wind-age.sh`), so GitHub emails the owner a day before Let go would stop working.
- The site's address is `SITE_URL` in `src/config.ts`: `index.html`'s share tags and the workflow's checks read it from there. For a custom domain, change it there and `CARD_SITE` in `src/ui/card.ts` (the address printed on the card), then add the domain under the Pages project's **Custom domains**.
- The proof pages (`/debug.html`, `/tileproof`, `/world.html`) are built for preview links only, not for production (`vite.config.ts`). `npm run dev` always serves them; `DEBUG_PAGES=1 npm run build` builds them locally.
- `public/_headers` sets the security headers (a Content-Security-Policy that lists every outside service the page uses) and the cache times. A new outside service must be added to its `connect-src`, or the browser blocks it.
- It needs two repository secrets: `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` (see `docs/for-sk/02-github-secrets.md`). Without them the build and tests still run and the deploy is skipped.

## More information

- `docs/for-sk/` has step-by-step guides for setting up the accounts.
- `docs/superpowers/` has the design and the build plan.
