#!/usr/bin/env bash
# Release gate (plan §5.5): browser bundles must not ship source maps, and our own code must not call console.*.
# Framework-internal console.error calls (Next/React error paths) are allowed; anything from our source is not.
set -euo pipefail
STATIC="apps/web/.next/static"
[ -d "$STATIC" ] || { echo "build apps/web first"; exit 1; }
fail=0
maps=$(find "$STATIC" -name '*.map' | wc -l | tr -d ' ')
if [ "$maps" != "0" ]; then echo "FAIL: $maps source map files in browser bundle"; fail=1; fi
if grep -rq 'sourceMappingURL' "$STATIC" --include='*.js'; then echo "FAIL: sourceMappingURL reference in browser bundle"; fail=1; fi
# Our own code must have zero console calls (ESLint enforces this at source level too).
if grep -rnE '\bconsole\.(log|info|debug|warn|trace|table|dir)\(' apps/web/src packages/shared/src; then echo "FAIL: console call in source"; fail=1; fi
[ "$fail" = 0 ] && echo "OK: no source maps, no console calls in our code"
exit $fail
