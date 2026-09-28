#!/usr/bin/env bash
# moin cloud environment setup script.
# Paste into claude.ai/code → environment "moin" → Setup script (see docs/control-plane/CONTROL_PLANE_REPORT.md,
# founder action F-04). Runs as root on Ubuntu 24.04 x86_64 before the session starts; keep it under ~5 min
# so the environment is cached. Pins must equal .nvmrc / package.json packageManager / .terraform-version
# once P02 creates them: .claude/bin/control_plane_check.py (the first gate) enforces this.
set -euo pipefail

readonly NODE_VERSION=24.21.0
readonly PNPM_VERSION=10.34.5
readonly TERRAFORM_VERSION=1.16.4
readonly GITLEAKS_VERSION=8.30.1
readonly WORK=/tmp/moin-setup

log() { printf '[moin-setup] %s\n' "$*"; }
mkdir -p "$WORK"

install_node() {
  local name="node-v${NODE_VERSION}-linux-x64" base="https://nodejs.org/dist/v${NODE_VERSION}"
  curl -fsSL -o "$WORK/${name}.tar.xz" "${base}/${name}.tar.xz"
  curl -fsSL -o "$WORK/SHASUMS256.txt" "${base}/SHASUMS256.txt"
  (cd "$WORK" && grep " ${name}.tar.xz\$" SHASUMS256.txt | sha256sum -c -)
  tar -xJf "$WORK/${name}.tar.xz" -C /opt
  ln -sfn "/opt/${name}" /opt/node24
  for b in node npm npx corepack; do ln -sfn "/opt/node24/bin/$b" "/usr/local/bin/$b"; done
  # shellcheck disable=SC2016  # $PATH must expand at login, not now
  printf 'export PATH=/opt/node24/bin:$PATH\n' > /etc/profile.d/00-moin-node.sh
  /opt/node24/bin/npm install -g "pnpm@${PNPM_VERSION}"
  ln -sfn /opt/node24/bin/pnpm /usr/local/bin/pnpm
}

install_terraform() {
  local zip="terraform_${TERRAFORM_VERSION}_linux_amd64.zip"
  local base="https://releases.hashicorp.com/terraform/${TERRAFORM_VERSION}"
  curl -fsSL -o "$WORK/$zip" "${base}/${zip}"
  curl -fsSL -o "$WORK/tf.sums" "${base}/terraform_${TERRAFORM_VERSION}_SHA256SUMS"
  (cd "$WORK" && grep " ${zip}\$" tf.sums | sha256sum -c -)
  python3 -m zipfile -e "$WORK/$zip" "$WORK/tf"
  install -m 0755 "$WORK/tf/terraform" /usr/local/bin/terraform
}

install_gitleaks() {
  # GitHub release assets of repositories not attached to the session return 403 in cloud sessions;
  # the Go module proxy is on the Trusted allowlist. GOTOOLCHAIN=auto fetches a newer Go if needed.
  GOTOOLCHAIN=auto GOBIN=/usr/local/bin \
    go install "github.com/zricethezav/gitleaks/v8@v${GITLEAKS_VERSION}"
}

command -v jq >/dev/null || { apt-get update -qq && apt-get install -y -qq jq; }
install_node & p1=$!
install_terraform & p2=$!
install_gitleaks & p3=$!
fail=0
for p in "$p1" "$p2" "$p3"; do wait "$p" || fail=1; done
log "node $(node -v 2>&1) | pnpm $(pnpm -v 2>&1) | $(terraform -version 2>&1 | head -1) | gitleaks $(gitleaks version 2>&1) | $(jq --version 2>&1)"
exit "$fail"
