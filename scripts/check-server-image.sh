#!/usr/bin/env bash
# The server image must carry what the schema runner reads at run time: the reviewed SQL
# migrations next to `packages/db/src/migrate.ts`. An image without them starts the API and then
# cannot create or upgrade the schema it needs (found by the M2D-2 demo stack).
# Usage: scripts/check-server-image.sh <image>
set -euo pipefail

image="${1:?usage: check-server-image.sh <image>}"
id="$(docker create "$image")"
trap 'docker rm -f "$id" >/dev/null' EXIT

# Listed in full first: `grep -q` in the pipeline would close it early and, under pipefail, turn a
# match into a failure.
listing="$(docker cp "$id:/app/packages/db/migrations/." - 2>/dev/null | tar -t 2>/dev/null || true)"
if ! grep -q '\.sql$' <<<"$listing"; then
  echo "no SQL migrations in $image (packages/db/migrations)" >&2
  exit 1
fi
echo "SQL migrations present in $image"
