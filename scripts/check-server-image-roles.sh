#!/usr/bin/env bash
# Every long-running role of the server image must start from the BUILT image, not just from the
# source tree. The image used to ship four of the six workspace packages the server imports, so the
# voice and worker roles died with ERR_MODULE_NOT_FOUND (@moin/telephony, @moin/integrations) while
# the API role, the build and every other check passed. This starts api, voice and worker the way a
# deployment runs them (read-only root, scratch tmpfs, non-root, no new privileges) against a
# database nothing listens on and, for the worker, the local queue emulator the compose file pins
# (the worker refuses to start without its queue, which is its own contract), and requires /healthz
# to answer 200 from each: liveness needs no database, so a role that dies on import or
# configuration fails here. Run from the repository root. Usage: scripts/check-server-image-roles.sh <image>
set -euo pipefail

image="${1:?usage: check-server-image-roles.sh <image>}"
base_port="${CHECK_ROLES_BASE_PORT:-39400}"
names=()
fail=0
network="moin-role-check-net-$$"

cleanup() {
  for name in "${names[@]}"; do
    docker rm -f "$name" >/dev/null 2>&1 || true
  done
  docker network rm "$network" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# The queue emulator is the image the compose file pins, with the compose file's queue definitions.
sqs_image="$(awk '/^  sqs:/ {found = 1} found && /image:/ {print $2; exit}' docker-compose.yml)"
[ -n "$sqs_image" ] || { echo "no sqs image in docker-compose.yml" >&2; exit 1; }
docker network create "$network" >/dev/null
sqs_name="moin-role-check-sqs-$$"
names+=("$sqs_name")
docker run -d --name "$sqs_name" --network "$network" --network-alias sqs \
  -v "$PWD/docker/elasticmq/elasticmq.conf:/opt/elasticmq.conf:ro" "$sqs_image" >/dev/null
for _ in $(seq 1 60); do
  docker exec "$sqs_name" sh -c 'nc -z 127.0.0.1 9324' >/dev/null 2>&1 && break
  sleep 1
done

role_env() {
  case "$1" in
    voice)
      echo "-e TWILIO_AUTH_TOKEN=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa -e VOICE_PUBLIC_ORIGIN=https://voice.example.test -e VOICE_WEBSOCKET_ORIGIN=wss://voice.example.test"
      ;;
    worker)
      echo "-e SQS_REGION=eu-central-1 -e SQS_ENDPOINT=http://sqs:9324 -e SQS_QUEUE_JOBS=moin-jobs -e AWS_ACCESS_KEY_ID=local -e AWS_SECRET_ACCESS_KEY=local"
      ;;
    *) echo "" ;;
  esac
}

port="$base_port"
for role in api voice worker; do
  port=$((port + 1))
  name="moin-role-check-${role}-$$"
  names+=("$name")
  # shellcheck disable=SC2046 # role_env prints fixed, space-free -e arguments on purpose.
  docker run -d --name "$name" --network "$network" --read-only --tmpfs /tmp --security-opt no-new-privileges \
    -p "127.0.0.1:${port}:3000" \
    -e NODE_ENV=development -e SERVER_ROLE="$role" -e PORT=3000 \
    -e DATABASE_URL=postgres://moin:unused@127.0.0.1:1/moin \
    -e APP_ORIGIN=http://localhost:3000 \
    -e AUTH_LOCAL_TOKEN_KEY=local-v1:local-development-only \
    $(role_env "$role") \
    "$image" node "apps/server/dist/main-${role}.js" >/dev/null

  code=000
  # Bounded wait: 60 attempts, 1 s apart (the image may be an emulated arm64 build).
  for _ in $(seq 1 60); do
    if [ "$(docker inspect -f '{{.State.Running}}' "$name")" != "true" ]; then
      break
    fi
    code="$(curl -s --max-time 2 -o /dev/null -w '%{http_code}' "http://127.0.0.1:${port}/healthz" || true)"
    [ "$code" = 200 ] && break
    sleep 1
  done

  if [ "$code" = 200 ]; then
    echo "ok   role ${role}: /healthz 200 from the built image"
  else
    echo "FAIL role ${role}: no /healthz 200 (last status ${code}, running=$(docker inspect -f '{{.State.Running}}' "$name"))" >&2
    docker logs "$name" 2>&1 | tail -8 >&2
    fail=1
  fi
done

exit "$fail"
