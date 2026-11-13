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

## Wind pipeline

`pipeline/build_tiles.py` downloads the newest NOAA GFS forecast run, cuts the winds into small tile files and writes them, with a `manifest.json`, to a folder that is published as `/winds` on the site. It keeps the newest four runs in a store folder between runs. GitHub Actions runs it every hour.

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
- Every hour it checks for a newer GFS run and, only if there is one, rebuilds and deploys (tests are skipped then).
- Pushes to `main` go to production. Any other branch becomes a preview link, shown in the run summary.
- It needs two repository secrets: `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` (see `docs/for-sk/02-github-secrets.md`). Without them the build and tests still run and the deploy is skipped.

## More information

- `docs/for-sk/` has step-by-step guides for setting up the accounts.
- `docs/superpowers/` has the design and the build plan.
