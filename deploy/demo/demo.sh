#!/usr/bin/env bash
# The packaged KlarDesk demo (M2D-2). Local, synthetic, not a production baseline.
# Usage: deploy/demo/demo.sh up|stop|start|restart|restart-api|down|reset --yes|status|logs [svc]|call [text]|check
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$DIR/../.." && pwd)"
PROJECT=moin-demo
APP_URL=http://localhost:3000
KEYCLOAK_PORT=8081
APP_PORT=3000
REALM_FILE="$REPO/docker/keycloak/realm-moin-local.json"
OWNER_EMAIL=inhaber@musterrestaurant.example
DB_USER=moin_owner

# Compose needs DEMO_SIMULATOR_TOKEN just to parse the file (`${...:?}`). Commands that only read
# or restart existing containers get a placeholder, which never reaches a container: it cannot, as
# none of them creates or re-creates one. `up` (and `create`/`run`) use the real token or stop.
compose() {
  local token="${DEMO_SIMULATOR_TOKEN:-}"
  case "${1:-}" in
    up | create | run)
      [ -n "$token" ] || die "internal error: the simulator token was not prepared before '$1'"
      ;;
    *) token="${token:-read-only-placeholder}" ;;
  esac
  DEMO_SIMULATOR_TOKEN="$token" docker compose -p "$PROJECT" -f "$DIR/docker-compose.yml" "$@"
}

die() { echo "demo: $*" >&2; exit 1; }

need() { command -v "$1" >/dev/null 2>&1 || die "$1 is required"; }

# Discovery asks Docker for containers by the Compose project label. That is read-only, needs no
# Compose file and so no token, prints nothing and exits 0 when the project has no containers, and
# exits non-zero when Docker itself cannot answer: an empty result and an error are different things.
project_containers() { docker ps "$@" -q --filter "label=com.docker.compose.project=$PROJECT"; }

service_container() { project_containers -a --filter "label=com.docker.compose.service=$1"; }

# absent | running | stopped; non-zero when Docker cannot be queried.
project_state() {
  local all running
  all="$(project_containers -a)" || return 1
  if [ -z "$all" ]; then echo absent; return 0; fi
  running="$(project_containers)" || return 1
  if [ -n "$running" ]; then echo running; else echo stopped; fi
}

# The simulated-call bearer is generated once per install and read back from the existing (running or
# stopped) api container; it is never written to a file or printed. Prints nothing when the project has
# no api container yet. Returns 1 if Docker cannot answer, 2 if the container exists but its token is
# unreadable or the api container is not unique: never a silent rotation.
simulator_token() {
  local ids env token
  ids="$(service_container api)" || return 1
  [ -n "$ids" ] || return 0
  [ "$(wc -l <<<"$ids")" -eq 1 ] || return 2
  env="$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$ids")" || return 1
  token="$(sed -n 's/^CALL_SIMULATOR_TOKEN=//p' <<<"$env" | head -n 1)"
  [ -n "$token" ] || return 2
  printf '%s\n' "$token"
}

# The token the next `up` must use: the existing project's, else a fresh one. Whatever a caller left in
# DEMO_SIMULATOR_TOKEN is ignored, so an inherited value can never rotate a running demo's token.
export_token() {
  local token status=0
  token="$(simulator_token)" || status=$?
  case "$status" in
    0) ;;
    1) die "cannot read the demo's containers from Docker; is it running?" ;;
    *) die "the demo's api container exists but its simulator token cannot be read (or it is not unique); refusing to rotate it. Run: deploy/demo/demo.sh reset --yes (deletes demo data) and then up" ;;
  esac
  if [ -z "$token" ]; then token="demo-$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')"; fi
  export DEMO_SIMULATOR_TOKEN="$token"
}

# Bounded: waits for a service's own health check, then gives up with the service's last log lines.
wait_healthy() {
  local svc="$1" id state
  id="$(compose ps -a -q "$svc")"
  for _ in $(seq 1 60); do
    state="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$id")"
    if [ "$state" = healthy ]; then return 0; fi
    sleep 2
  done
  compose logs --tail 20 "$svc" >&2 || true
  die "$svc did not become healthy within 120 s (last state: $state)"
}

port_busy() { ss -ltn "sport = :$1" 2>/dev/null | grep -q LISTEN; }

# The ports are ours exactly when the edge container (the only one that publishes them) is running.
preflight() {
  need docker; need curl; need python3; need ss
  docker info >/dev/null 2>&1 || die "Docker is not running (start Docker Desktop and enable WSL integration)"
  local edge
  edge="$(project_containers --filter "label=com.docker.compose.service=edge")" ||
    die "cannot query Docker for the demo project"
  if [ -z "$edge" ]; then
    for p in "$APP_PORT" "$KEYCLOAK_PORT"; do
      if port_busy "$p"; then die "port $p is already in use by something other than the demo; stop it (a dev server may use 3000)"; fi
    done
  fi
}

# The owner's Keycloak subject, learned through the realm's test client exactly as the browser
# acceptance suite does. The realm file holds only development-only fakes.
owner_subject() {
  python3 - "$REALM_FILE" "$OWNER_EMAIL" "$KEYCLOAK_PORT" <<'PY'
import json, sys, urllib.parse, urllib.request, base64
realm = json.load(open(sys.argv[1]))
email, port = sys.argv[2], sys.argv[3]
client = next(c for c in realm["clients"] if c["clientId"] == "moin-tests")
password = next(u for u in realm["users"] if u["email"] == email)["credentials"][0]["value"]
body = urllib.parse.urlencode({
    "grant_type": "password", "client_id": "moin-tests", "client_secret": client["secret"],
    "username": email, "password": password, "scope": "openid email",
}).encode()
req = urllib.request.Request(f"http://localhost:{port}/realms/moin-local/protocol/openid-connect/token",
                             data=body)
token = json.load(urllib.request.urlopen(req, timeout=15))["id_token"]
payload = token.split(".")[1]
print(json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))["sub"])
PY
}

seed() {
  local sub
  sub="$(owner_subject)" || die "could not read the owner's subject from Keycloak"
  compose exec -T postgres psql -q -U "$DB_USER" -d moin -v "owner_sub=$sub" -f - <"$DIR/seed.sql" >/dev/null
  echo "demo: synthetic tenant and owner are in place"
}

cmd_up() {
  preflight
  export_token
  compose build --quiet migrate
  compose up -d --wait --wait-timeout 300
  seed
  cat <<MSG

KlarDesk demo is up (local, synthetic data, simulated telephony only).
  Open       $APP_URL
  Sign in    $OWNER_EMAIL  (password: the fake in docker/keycloak/realm-moin-local.json)
  Callback   deploy/demo/demo.sh call
MSG
}

cmd_status() {
  compose ps
  # Containers that joined the edge's namespace report healthy from inside even after the edge was
  # restarted underneath them; only a probe from the host tells whether the stack is reachable.
  if [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$APP_URL/__edge" || true)" = 200 ]; then
    echo "edge reachable at $APP_URL"
  else
    echo "edge NOT reachable at $APP_URL (run: deploy/demo/demo.sh restart)" >&2
    exit 1
  fi
}

cmd_call() {
  export_token
  local text="${1:-}"
  compose exec -T -e "DEMO_TEXT=$text" api node -e '
    const samples = [
      "Hallo, hier ist Familie Weber. Bitte rufen Sie mich zurück wegen einer Tischreservierung für Samstag.",
      "Guten Tag, ich möchte für sechs Personen am Freitagabend reservieren. Bitte um Rückruf.",
      "Bitte rufen Sie mich zurück, es geht um eine Geburtstagsfeier im Dezember.",
    ];
    const text = process.env.DEMO_TEXT || samples[Math.floor(Math.random() * samples.length)];
    const callSid = "SIM" + crypto.randomUUID().replaceAll("-", "");
    fetch("http://127.0.0.1:3101/api/dev/simulated-calls", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer " + process.env.CALL_SIMULATOR_TOKEN },
      body: JSON.stringify({ callSid, from: "+4915198765432", to: "+494033330001", utterance: text }),
    }).then(async (r) => {
      const body = await r.text();
      console.log("simulated call (not a real telephone call): HTTP " + r.status + " " + body);
      process.exit(r.status < 300 ? 0 : 1);
    }, (e) => { console.error(String(e)); process.exit(1); });'
}

cmd_check() {
  local base="$APP_URL" code html asset
  html="$(mktemp)"; trap 'rm -f "$html"' RETURN
  code="$(curl -s -o "$html" -w '%{http_code}' "$base/")"
  [ "$code" = 200 ] || die "check: / returned $code"
  local n=0
  while read -r asset; do
    code="$(curl -s -o /dev/null -w '%{http_code}' "$base$asset")"
    [ "$code" = 200 ] || die "check: $asset returned $code"
    n=$((n + 1))
  done < <(grep -o '/_next/static/[^"]*\.\(js\|css\)' "$html" | sort -u)
  [ "$n" -gt 0 ] || die "check: no static assets referenced by /"
  code="$(curl -s -o /dev/null -w '%{http_code}' "$base/api/today")"
  [ "$code" = 401 ] || die "check: unauthenticated /api/today returned $code, expected 401"
  echo "demo: check ok ($n static assets served, API answers, anonymous Today refused)"
}

cmd_reset() {
  [ "${1:-}" = "--yes" ] || die "reset deletes the demo database and the demo Keycloak users; run: demo.sh reset --yes"
  # -p moin-demo and this compose file scope the volume removal to the demo project's own two
  # volumes; nothing of the development stack (project "moin") can be named here.
  compose down -v --remove-orphans
  echo "demo: demo data removed; run demo.sh up for a fresh start"
}

main() {
  case "${1:-}" in
    up) cmd_up ;;
    stop) compose stop ;;
    start) export_token; compose start; compose up -d --wait --wait-timeout 300; seed ;;
    restart) export_token; compose restart edge; compose restart oidc api web; compose up -d --wait --wait-timeout 300 ;;
    restart-api) export_token; compose restart api; wait_healthy api ;;
    down) compose down --remove-orphans ;;
    reset) shift; cmd_reset "${1:-}" ;;
    status) cmd_status ;;
    logs) shift; compose logs --tail 100 "$@" ;;
    call) shift; cmd_call "${1:-}" ;;
    check) cmd_check ;;
    *) sed -n '2,3p' "${BASH_SOURCE[0]}"; exit 2 ;;
  esac
}

# Sourced (by a read-only check), the functions are available and nothing runs.
if [ "${BASH_SOURCE[0]}" = "$0" ]; then main "$@"; fi
