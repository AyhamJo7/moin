#!/usr/bin/env bash
# Starts the `web` role of the built image the way the demo and a deployment run it (read-only root,
# scratch tmpfs, non-root) and fetches what a browser would: the page, then every script and
# stylesheet it references. `next build` succeeding proves none of this; the standalone output
# leaves `.next/static` out unless the image copies it (M2D-2), and an image without it renders
# HTML whose scripts all return 404. Usage: scripts/check-web-image.sh <image>
set -euo pipefail

image="${1:?usage: check-web-image.sh <image>}"
name="moin-web-check-$$"
port="${CHECK_WEB_IMAGE_PORT:-3000}"
base="http://127.0.0.1:${port}"
html="$(mktemp)"
headers="$(mktemp)"

cleanup() {
  docker rm -f "$name" >/dev/null 2>&1 || true
  rm -f "$html" "$headers"
}
trap cleanup EXIT

docker run -d --name "$name" --read-only --tmpfs /tmp -p "127.0.0.1:${port}:3000" \
  -e PORT=3000 -e HOSTNAME=0.0.0.0 -e OWNER_API_ORIGIN=http://127.0.0.1:3101 \
  "$image" node web/apps/web/server.js >/dev/null

# Bounded wait: 90 attempts, 2 s apart (the image may be an emulated arm64 build).
up=0
for _ in $(seq 1 90); do
  if [ "$(curl -s -o "$html" -w '%{http_code}' "$base/" || true)" = 200 ]; then up=1; break; fi
  sleep 2
done
if [ "$up" != 1 ]; then
  docker logs "$name" >&2 || true
  echo "the web image did not serve / with 200" >&2
  exit 1
fi

count=0
while read -r asset; do
  code="$(curl -s -o /dev/null -D "$headers" -w '%{http_code}' "${base}${asset}")"
  type="$(grep -i '^content-type:' "$headers" | tr -d '\r' || true)"
  [ "$code" = 200 ] || { echo "$asset returned $code" >&2; exit 1; }
  case "$asset" in
    *.js) echo "$type" | grep -qi 'javascript' || { echo "$asset has content type: $type" >&2; exit 1; } ;;
    *.css) echo "$type" | grep -qi 'text/css' || { echo "$asset has content type: $type" >&2; exit 1; } ;;
  esac
  count=$((count + 1))
done < <(grep -o '/_next/static/[^"?]*\.\(js\|css\)' "$html" | sort -u)

[ "$count" -gt 0 ] || { echo "the page references no static assets" >&2; exit 1; }
[ "$(curl -s -o /dev/null -w '%{http_code}' "${base}/icon.svg")" = 200 ] || { echo "public/icon.svg is missing from the image" >&2; exit 1; }
echo "web image ok: / and ${count} static assets served, public assets present"
