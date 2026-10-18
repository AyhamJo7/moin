#!/usr/bin/env bash
# The image must carry what the schema runner reads at run time: every reviewed SQL migration next
# to `packages/db/src/migrate.ts`. An image without them starts the API and then cannot create or
# upgrade the schema it needs (found by the M2D-2 demo stack). Run from the repository root, which
# supplies the expected count. Usage: scripts/check-server-image.sh <image>
set -euo pipefail

image="${1:?usage: check-server-image.sh <image>}"
expected="$(find packages/db/migrations -maxdepth 1 -name '*.sql' | wc -l)"
[ "$expected" -gt 0 ] || { echo "no migrations in the repository to compare with" >&2; exit 1; }

id="$(docker create "$image")"
trap 'docker rm -f "$id" >/dev/null' EXIT

# Captured whole first: `grep -q` in the pipeline would close it early and, under pipefail, turn a
# match into a failure.
if ! listing="$(docker cp "$id:/app/packages/db/migrations/." - | tar -t)"; then
  echo "cannot read /app/packages/db/migrations in $image" >&2
  exit 1
fi
found="$(grep -c '\.sql$' <<<"$listing" || true)"
if [ "$found" != "$expected" ]; then
  echo "$image carries $found SQL migrations, the repository has $expected" >&2
  exit 1
fi
echo "all $found SQL migrations present in $image"
