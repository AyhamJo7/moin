#!/usr/bin/env bash
# The compiled `migrate` role must fail when it cannot migrate: pointed at a database nothing
# listens on, it exits 1 and says so. It used to log "migration run complete" and exit 0 whatever
# the database was, so a release could proceed against an unmigrated schema (M2D-2, INV-17).
# Needs `pnpm --filter @moin/server build` first. Usage: scripts/check-migrate-role.sh
set -euo pipefail

output="$(mktemp)"
trap 'rm -f "$output"' EXIT

status=0
SERVER_ROLE=migrate NODE_ENV=development LOG_LEVEL=info \
  DATABASE_URL=postgres://nobody:unused@127.0.0.1:1/none \
  node apps/server/dist/main-migrate.js >"$output" 2>&1 || status=$?

if [ "$status" != 1 ]; then
  echo "expected exit 1 from an unreachable database, got $status" >&2
  cat "$output" >&2
  exit 1
fi
if grep -q 'migration run complete' "$output"; then
  echo "the failed run was reported as complete" >&2
  exit 1
fi
grep -q 'migration run failed' "$output" || { echo "the failure was not logged" >&2; cat "$output" >&2; exit 1; }
echo "the migrate role exits 1 and reports failure when the database is unreachable"
