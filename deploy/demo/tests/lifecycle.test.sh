#!/usr/bin/env bash
# Lifecycle tests for deploy/demo/demo.sh (M2D-2, remediation of review finding F1).
#
# They drive the real script through its command line with a fake `docker`, `ss`, `curl` and
# `python3` on PATH, so no container, port or demo data is touched. The fake `docker compose`
# fails exactly as the real one does when DEMO_SIMULATOR_TOKEN is unset (interpolation error), which
# is what made the original script read its own running stack as "absent" and then call its own
# ports a conflict. Everything the script decided is read back from what it asked the fakes to do.
set -uo pipefail

SCRIPT="${DEMO_SCRIPT_UNDER_TEST:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/demo.sh}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
BIN="$WORK/bin"
mkdir -p "$BIN"
failures=0
checks=0

# ---- fakes -------------------------------------------------------------------------------------
# State comes from the environment: FAKE_STATE absent|running|stopped, FAKE_TOKEN (the api
# container's CALL_SIMULATOR_TOKEN; FAKE_TOKEN_UNREADABLE=1 hides it), FAKE_BUSY (ports held by
# someone else), FAKE_DAEMON_DOWN=1, FAKE_PS_ERROR=1. Calls are appended to $FAKE_LOG.
cat >"$BIN/docker" <<'FAKE'
#!/usr/bin/env bash
echo "docker $*" >>"$FAKE_LOG"
case "$1" in
  info)
    if [ "${FAKE_DAEMON_DOWN:-}" = 1 ]; then echo "Cannot connect to the Docker daemon" >&2; exit 1; fi
    exit 0 ;;
  ps)
    if [ "${FAKE_DAEMON_DOWN:-}" = 1 ] || [ "${FAKE_PS_ERROR:-}" = 1 ]; then echo "error during connect" >&2; exit 1; fi
    all=0 project="" service=""
    for a in "$@"; do
      case "$a" in
        -a) all=1 ;;
        label=com.docker.compose.project=*) project="${a#*=*=}" ;;
        label=com.docker.compose.service=*) service="${a#*=*=}" ;;
      esac
    done
    [ "$project" = moin-demo ] || exit 0
    case "${FAKE_STATE:-absent}" in
      absent) exit 0 ;;
      stopped) [ "$all" = 1 ] || exit 0 ;;
    esac
    for svc in edge oidc api web postgres; do
      if [ -z "$service" ] || [ "$service" = "$svc" ]; then echo "id-$svc"; fi
    done ;;
  inspect)
    echo "PATH=/usr/bin"
    if [ "${FAKE_TOKEN_UNREADABLE:-}" != 1 ]; then echo "CALL_SIMULATOR_TOKEN=${FAKE_TOKEN}"; fi ;;
  compose)
    # The real Compose refuses to parse the file without the token (`${DEMO_SIMULATOR_TOKEN:?...}`).
    if [ -z "${DEMO_SIMULATOR_TOKEN:-}" ]; then
      echo "error while interpolating services.api.environment.CALL_SIMULATOR_TOKEN: required variable DEMO_SIMULATOR_TOKEN is missing a value" >&2
      exit 1
    fi
    echo "compose $*" >>"$FAKE_LOG"
    case " $* " in
      *" up "*)
        echo "UP token_sha=$(printf %s "$DEMO_SIMULATOR_TOKEN" | sha256sum | cut -c1-16)" >>"$FAKE_LOG"
        printf %s "$DEMO_SIMULATOR_TOKEN" >"$FAKE_UP_TOKEN" ;;
    esac
    exit 0 ;;
esac
FAKE
cat >"$BIN/ss" <<'FAKE'
#!/usr/bin/env bash
port="${2##*:}"
echo "State Recv-Q Send-Q Local Address:Port"
case ",${FAKE_BUSY:-}," in *",$port,"*) echo "LISTEN 0 4096 127.0.0.1:$port 0.0.0.0:*" ;; esac
exit 0
FAKE
printf '#!/usr/bin/env bash\nexit 0\n' >"$BIN/curl"
printf '#!/usr/bin/env bash\necho fake-keycloak-subject\n' >"$BIN/python3"
chmod +x "$BIN"/*

# ---- harness -----------------------------------------------------------------------------------
# run <name> <command...>: runs demo.sh with the current FAKE_* variables; sets $OUT, $ERR, $STATUS.
run() {
  : >"$WORK/log"
  rm -f "$WORK/up_token"
  OUT="$WORK/out" ERR="$WORK/err"
  FAKE_LOG="$WORK/log" FAKE_UP_TOKEN="$WORK/up_token" PATH="$BIN:$PATH" "$SCRIPT" "$@" >"$OUT" 2>"$ERR"
  STATUS=$?
}

check() { # check <description> <condition...>
  local description="$1"
  shift
  checks=$((checks + 1))
  if "$@"; then return 0; fi
  failures=$((failures + 1))
  echo "FAIL: $description"
  echo "  --- status=$STATUS stdout:"; sed 's/^/  | /' "$OUT"
  echo "  --- stderr:"; sed 's/^/  | /' "$ERR"
  echo "  --- calls:"; sed 's/^/  | /' "$WORK/log"
}

ok() { [ "$STATUS" -eq 0 ]; }
fails() { [ "$STATUS" -ne 0 ]; }
said() { grep -qi -e "$1" "$OUT" "$ERR"; }
not_said() { ! grep -qi -e "$1" "$OUT" "$ERR"; }
logged() { grep -q -e "$1" "$WORK/log"; }
not_logged() { ! grep -q -e "$1" "$WORK/log"; }
sha() { printf %s "$1" | sha256sum | cut -c1-16; }
used_token() { [ -f "$WORK/up_token" ] && [ "$(cat "$WORK/up_token")" = "$1" ]; }
no_leak() { ! grep -qF -e "$1" "$OUT" "$ERR"; }

RECOVERED="demo-recovered-token-0123456789abcdef"
unset DEMO_SIMULATOR_TOKEN
export FAKE_TOKEN="$RECOVERED"

# ---- 1. initial start, token unset -------------------------------------------------------------
export FAKE_STATE=absent FAKE_BUSY=""
run up
check "1 absent project, token unset: up succeeds" ok
check "1 a fresh token is created and used for up" test -s "$WORK/up_token"
fresh_token() { local t; t="$(cat "$WORK/up_token")"; [ "$t" != "$RECOVERED" ] && [ "$t" != read-only-placeholder ] && [ "${#t}" -gt 20 ]; }
check "1 the fresh token is not the recovered one or a placeholder" fresh_token
check "1 the fresh token is not printed" no_leak "$(cat "$WORK/up_token")"

# ---- 2/3. running demo, token unset: the same project, not a port conflict ---------------------
export FAKE_STATE=running FAKE_BUSY="3000,8081"
run up
check "2 running demo, token unset: up succeeds (its own ports are not a conflict)" ok
check "2 not reported as a port conflict" not_said "already in use"
check "2 the existing token is reused for up" used_token "$RECOVERED"
check "2 up never used the placeholder" not_logged "token_sha=$(sha read-only-placeholder)"
check "2 nothing is deleted or recreated" not_logged " down"
check "2 the token is not printed" no_leak "$RECOVERED"
run up
check "3 a repeated up succeeds again" ok
check "3 and keeps the same token" used_token "$RECOVERED"

# ---- 4. stopped demo, token unset --------------------------------------------------------------
export FAKE_STATE=stopped FAKE_BUSY=""
run up
check "4 stopped demo, token unset: up succeeds" ok
check "4 the stopped container's token is recovered" used_token "$RECOVERED"

# ---- 5. a query error is an error, never an absent project -------------------------------------
export FAKE_STATE=running FAKE_BUSY="3000,8081" FAKE_PS_ERROR=1
run up
check "5 a failing container query stops up" fails
check "5 it says it cannot query Docker" said "cannot query docker"
check "5 it does not claim a port conflict" not_said "already in use"
check "5 nothing was started" not_logged "UP token_sha"
unset FAKE_PS_ERROR

# ---- 6. Docker unavailable ---------------------------------------------------------------------
export FAKE_DAEMON_DOWN=1
run up
check "6 Docker unavailable: up fails" fails
check "6 with an actionable message" said "docker is not running"
unset FAKE_DAEMON_DOWN

# ---- 7/8. something else holds a port ----------------------------------------------------------
for state in absent stopped; do
  export FAKE_STATE=$state FAKE_BUSY="3000"
  run up
  check "7 $state demo, foreign process on 3000: refused" fails
  check "7 and names port 3000" said "port 3000 is already in use"
  check "7 and nothing was started" not_logged "UP token_sha"
  export FAKE_BUSY="8081"
  run up
  check "8 $state demo, foreign process on 8081: refused" fails
  check "8 and names port 8081" said "port 8081 is already in use"
done

# ---- 9. an unreadable token fails closed instead of rotating -----------------------------------
export FAKE_STATE=running FAKE_BUSY="3000,8081" FAKE_TOKEN_UNREADABLE=1
run up
check "9 an existing api container with no readable token: up refuses" fails
check "9 and says it will not rotate" said "refusing to rotate"
check "9 and starts nothing" not_logged "UP token_sha"
unset FAKE_TOKEN_UNREADABLE

# ---- 10. an inherited token never replaces the running demo's -----------------------------------
DEMO_SIMULATOR_TOKEN=inherited-token-from-the-caller run up
check "10 an inherited token is ignored for a running demo" used_token "$RECOVERED"

# ---- 11. stop / start / down keep the data -----------------------------------------------------
export FAKE_STATE=running FAKE_BUSY=""
run stop
check "11 stop works without a token" ok
check "11 stop only stops" logged "compose -p moin-demo .* stop"
check "11 stop removes nothing" not_logged " down"
export FAKE_STATE=stopped
run start
check "11 start works with the token unset" ok
check "11 start re-creates nothing under a different token" used_token "$RECOVERED"
check "11 start never deletes volumes" not_logged "down.* -v"
run down
check "11 down works without a token" ok
check "11 down keeps the volumes" not_logged "down.* -v"

# ---- 12. reset safeguards ----------------------------------------------------------------------
run reset
check "12 reset without --yes is refused" fails
check "12 and touches nothing" not_logged "compose"
run reset --yes
check "12 reset --yes removes only the demo project's volumes" logged "compose -p moin-demo -f .*docker-compose.yml down -v --remove-orphans"

echo "demo lifecycle: $((checks - failures)) of $checks checks passed"
[ "$failures" -eq 0 ]
