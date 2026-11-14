#!/usr/bin/env bash
# Decide whether a timer run has anything to deploy. It has when either:
#  - a GFS run newer than the deployed one is ready: both products (1p00 and 0p25) have their f120
#    index file on NOAA's public bucket, as pipeline/gfs_fetch.py run_is_ready() requires; or
#  - the live site was built from another commit than the one checked out here (its /build.json,
#    written by the Build site step). A push or manual run on main that a timer run replaced in the
#    deploy queue then still reaches the live site.
# Prints "new=true|false" and "run=YYYYMMDDHH" lines (suitable for $GITHUB_OUTPUT); the reasons go to
# stderr. Anything it cannot read counts as "deploy" (new=true), never as "nothing to do".
# SITE_URL comes from src/config.ts (the workflow sets it with scripts/site-url.sh).
# BUILD_SHA: the commit being built (default: the checkout's HEAD). Tested by tests/ci/newrun.test.ts.
set -u

BUCKET="https://noaa-gfs-bdp-pds.s3.amazonaws.com"
MANIFEST_URL="${MANIFEST_URL:-${SITE_URL:?SITE_URL is not set}/winds/manifest.json}"
BUILD_JSON_URL="${BUILD_JSON_URL:-${SITE_URL:?SITE_URL is not set}/build.json}"
BUILD_SHA="${BUILD_SHA:-$(git rev-parse HEAD 2>/dev/null || true)}"

# both products' f120 index exist for run day/cycle
ready() {
  local day=$1 cycle=$2 product url code
  for product in 1p00 0p25; do
    url="${BUCKET}/gfs.${day}/${cycle}/atmos/gfs.t${cycle}z.pgrb2.${product}.f120.idx"
    code=$(curl -s -o /dev/null -I -m 20 -w '%{http_code}' "$url" || echo 000)
    [ "$code" = "200" ] || return 1
  done
  return 0
}

latest=""
for day_offset in 0 1; do
  day=$(date -u -d "-${day_offset} day" +%Y%m%d)
  for cycle in 18 12 06 00; do
    if ready "$day" "$cycle"; then
      latest="${day}${cycle}"
      break 2
    fi
  done
done

deployed=$(curl -fsS -m 20 "$MANIFEST_URL" 2>/dev/null | python3 -c '
import json, sys
try:
    m = json.load(sys.stdin)
    ids = [str(r.get("id", "")) for r in m.get("runs", []) if isinstance(r, dict)]
    ids = ["".join(c for c in i if c.isdigit()) for i in ids]
    ids = [i for i in ids if i]
    print(max(ids) if ids else "")
except Exception:
    print("")
' 2>/dev/null || true)
deployed=$(echo "$deployed" | tr -dc '0-9')

live_sha=$(curl -fsS -m 20 "${BUILD_JSON_URL}?fresh=$(date -u +%s)" 2>/dev/null | python3 -c '
import json, sys
try:
    print(str(json.load(sys.stdin).get("sha", "")))
except Exception:
    print("")
' 2>/dev/null || true)
live_sha=$(echo "$live_sha" | tr -dc '0-9a-f')

new=false
if [ -z "$latest" ]; then
  echo "No GFS run with both f120 files found for today or yesterday." >&2
else
  echo "Newest run with f120: ${latest}; deployed: ${deployed:-none}" >&2
  if [ -z "$deployed" ] || [ "$latest" -gt "$deployed" ]; then
    new=true
  fi
fi

if [ -n "$BUILD_SHA" ]; then
  echo "Live site built from: ${live_sha:-unknown}; this checkout: ${BUILD_SHA}" >&2
  if [ "$live_sha" != "$BUILD_SHA" ]; then
    echo "The live site runs other code than this checkout: deploying it." >&2
    new=true
  fi
fi

echo "new=${new}"
echo "run=${latest}"
