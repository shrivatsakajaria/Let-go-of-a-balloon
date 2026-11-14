#!/usr/bin/env bash
# Fail (exit 1) when the newest wind run on the live site is more than MAX_AGE_HOURS old (default 18).
#
# Why: the site offers a flight only while it has a wind run under 48 hours old that reaches the
# landing (src/wind/loader.ts). Failing the Deploy run at 18 hours gives GitHub's "run failed" email
# a day and more of warning before visitors see "We can't get today's winds right now".
#
# MANIFEST: a local file (the manifest this run just deployed) or empty for the live one at
#           $SITE_URL/winds/manifest.json (SITE_URL is set once, from src/config.ts, by the workflow).
# NOW:      seconds since 1970, for tests; defaults to the current time.
# Tested by tests/ci/windage.test.ts.
set -u

MAX_AGE_HOURS="${MAX_AGE_HOURS:-18}"
NOW="${NOW:-$(date -u +%s)}"
MANIFEST="${MANIFEST:-}"

if [ -n "$MANIFEST" ]; then
  body=$(cat -- "$MANIFEST" 2>/dev/null) || body=""
  where="$MANIFEST"
else
  where="${SITE_URL:?SITE_URL is not set}/winds/manifest.json"
  # the query string skips any cached copy of the manifest (it is cached for 5 minutes)
  body=$(curl -fsS -m 30 --retry 2 "${where}?fresh=${NOW}" 2>/dev/null) || body=""
fi

result=$(printf '%s' "$body" | python3 -c '
import datetime as dt, json, sys
now, limit = float(sys.argv[1]), float(sys.argv[2])
try:
    runs = json.load(sys.stdin).get("runs", [])
    times = []
    for r in runs:
        t = dt.datetime.strptime(str(r["issued"]), "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=dt.timezone.utc)
        times.append((t.timestamp(), str(r.get("id", ""))))
except Exception:
    print("unreadable")
    sys.exit(0)
if not times:
    print("none")
    sys.exit(0)
issued, run_id = max(times)
age = (now - issued) / 3600
print(("ok" if age <= limit else "stale") + f" {run_id} {age:.0f}")
' "$NOW" "$MAX_AGE_HOURS")

# A line for the run's summary page, when there is one.
summary() {
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then echo "$1" >> "$GITHUB_STEP_SUMMARY"; fi
}

read -r state run age <<< "$result"
case "$state" in
  ok)
    echo "Newest wind run on the live site: ${run}, ${age} h old (limit ${MAX_AGE_HOURS} h)."
    summary "Live winds: newest run ${run}, ${age} h old (limit ${MAX_AGE_HOURS} h)."
    ;;
  stale)
    summary "**Live winds are ${age} h old** (run ${run}; limit ${MAX_AGE_HOURS} h). Let go stops working at 48 h."
    echo "::error title=Winds are getting old::The newest wind run on the live site is ${run}, ${age} h old (limit ${MAX_AGE_HOURS} h). Let go stops working once it is 48 h old. See docs/for-sk/03-keep-it-running.md."
    exit 1
    ;;
  none)
    summary "**No wind runs on the live site.** Let go does not work."
    echo "::error title=No winds on the live site::${where} lists no wind runs, so Let go does not work. See docs/for-sk/03-keep-it-running.md."
    exit 1
    ;;
  *)
    summary "**Could not read the live wind manifest.**"
    echo "::error title=No winds on the live site::Could not read ${where}, so Let go may not work. See docs/for-sk/03-keep-it-running.md."
    exit 1
    ;;
esac
