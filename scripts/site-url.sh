#!/usr/bin/env bash
# Print the live site's address, read from its one home: SITE_URL in src/config.ts.
# The Deploy workflow puts it in the environment for check-new-run.sh, check-wind-age.sh and
# check-cors.mjs. Tested by tests/ci/workflows.test.ts.
set -eu
here=$(cd "$(dirname "$0")/.." && pwd)
url=$(sed -n "s/^export const SITE_URL = '\([^']*\)';.*/\1/p" "$here/src/config.ts")
if [ -z "$url" ]; then
  echo "SITE_URL not found in src/config.ts" >&2
  exit 1
fi
echo "$url"
