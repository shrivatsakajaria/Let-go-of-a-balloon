#!/usr/bin/env bash
# Decide whether a GFS run newer than the deployed one is ready.
# "Ready" means its f096 index file exists on NOAA's public bucket.
# Prints "new=true|false" and "run=YYYYMMDDHH" lines (suitable for $GITHUB_OUTPUT).
# Deployed run id comes from the live manifest; if missing, treat as new.
set -u

BUCKET="https://noaa-gfs-bdp-pds.s3.amazonaws.com"
MANIFEST_URL="${MANIFEST_URL:-https://let-go-of-a-balloon.pages.dev/winds/manifest.json}"

latest=""
for day_offset in 0 1; do
  day=$(date -u -d "-${day_offset} day" +%Y%m%d)
  for cycle in 18 12 06 00; do
    url="${BUCKET}/gfs.${day}/${cycle}/atmos/gfs.t${cycle}z.pgrb2.0p25.f096.idx"
    code=$(curl -s -o /dev/null -I -m 20 -w '%{http_code}' "$url" || echo 000)
    if [ "$code" = "200" ]; then
      latest="${day}${cycle}"
      break 2
    fi
  done
done

if [ -z "$latest" ]; then
  echo "No GFS run with an f096 file found for today or yesterday." >&2
  echo "new=false"
  echo "run="
  exit 0
fi

deployed=$(curl -fsS -m 20 "$MANIFEST_URL" 2>/dev/null | python3 -c '
import json, sys
try:
    m = json.load(sys.stdin)
    print(m.get("run") or m.get("runId") or m.get("run_id") or m.get("cycle") or "")
except Exception:
    print("")
' 2>/dev/null || true)
deployed=$(echo "$deployed" | tr -dc '0-9')

echo "Newest run with f096: ${latest}; deployed: ${deployed:-none}" >&2
if [ -z "$deployed" ] || [ "$latest" -gt "$deployed" ]; then
  echo "new=true"
else
  echo "new=false"
fi
echo "run=${latest}"
