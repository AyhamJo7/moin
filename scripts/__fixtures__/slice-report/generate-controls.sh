#!/usr/bin/env bash
# Regenerates the control reports in this directory with the installed Playwright. Each control is
# the real JSON reporter output of a ten-test suite that has the acceptance suite's exact file name,
# project and titles, with trivial bodies; one test of it is made to pass, fail as expected
# (test.fail), skip, flake on a retry or time out. Run from the repository root:
#   bash scripts/__fixtures__/slice-report/generate-controls.sh
set -euo pipefail
ROOT="$(pwd)"
OUT="$ROOT/scripts/__fixtures__/slice-report"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
TITLES=(
  "a simulated callback call reaches the owner on Heute and stays there"
  "the owner completes a callback with Erledigt and it stays completed"
  "a stale view gets a truthful conflict message and the current state"
  "a response lost after the commit is reconciled by reading the task, not reported as a failure"
  "a lost response that cannot be read back is unknown, and the refreshed view shows the truth"
  "a request that never reached the server is unknown to the browser; the retry completes once, by keyboard"
  "a callback committed while Heute is open appears by itself, once, without a reload"
  "a completion reaches another open session, and a replay of the call does not reopen it"
  "an outage leaves the list as it is, and the page reconciles when the network returns"
  "a revoked session shows the signed-out page and no task data"
)
# control name | zero-based index of the altered test | retries | body of the altered test
make() {
  local name="$1" index="$2" retries="$3" body="$4" dir="$WORK/$1" spec i
  mkdir -p "$dir"
  cat >"$dir/playwright.config.ts" <<CFG
import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '.', retries: $retries, timeout: 1500,
  reporter: [['json', { outputFile: 'report.json' }]],
  projects: [{ name: 'chromium' }],
});
CFG
  spec="import { expect, test } from '@playwright/test';"$'\n'
  for i in "${!TITLES[@]}"; do
    if [ "$i" = "$index" ]; then
      spec+="test('${TITLES[$i]}', async ({}, info) => { $body });"$'\n'
    else
      spec+="test('${TITLES[$i]}', () => { expect(1).toBe(1); });"$'\n'
    fi
  done
  printf '%s' "$spec" >"$dir/today-callback.spec.ts"
  (cd "$dir" && NODE_PATH="$ROOT/node_modules" "$ROOT/node_modules/.bin/playwright" test -c playwright.config.ts >/dev/null 2>&1 || true)
  # Machine-specific absolute paths out, everything else verbatim.
  sed -e "s#$dir#/control#g" -e "s#$ROOT#/repo#g" -e "s#/home/[^\"]*/bin/node#/node#g" "$dir/report.json" >"$OUT/control-$name.json"
}
make all-pass 0 0 "expect(1).toBe(1);"
make test-fail 3 0 "test.fail(); expect(1).toBe(2);"
make skip 3 0 "test.skip();"
make flaky 3 1 "expect(info.retry).toBeGreaterThan(0);"
make timeout 3 0 "await new Promise((resolve) => setTimeout(resolve, 5000));"
