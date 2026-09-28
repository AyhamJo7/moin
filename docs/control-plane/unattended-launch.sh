#!/usr/bin/env bash
# Founder-run launcher for unattended moin sessions (--dangerously-skip-permissions).
#
# The in-repo guards block aws/ssh/terraform plan and secret reads, but in-band guards can fail
# (Phase C showed a guard-file removal making hooks fail open). This launcher makes the credentials
# unreachable as a second layer: AWS config/credentials point at /dev/null, AWS_* and the ssh agent
# are removed from the environment, and git may only use HTTPS (GitHub via the gh credential helper).
#
# Usage (from anywhere):  docs/control-plane/unattended-launch.sh [claude args...]
# Sessions cannot start this script themselves: nested `claude` invocations are blocked.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO"

if [ "$(git branch --show-current)" = "main" ]; then
  echo "refusing: start unattended work on a feature branch, not main" >&2
  exit 2
fi
if [ ! -f .claude/settings.json ] || [ ! -x .claude/hooks/policy_guard.py ]; then
  echo "refusing: guard files missing on this branch (.claude/settings.json, policy_guard.py)" >&2
  exit 2
fi

exec env \
  -u AWS_PROFILE -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY -u AWS_SESSION_TOKEN \
  -u AWS_DEFAULT_PROFILE -u SSH_AUTH_SOCK -u GH_TOKEN -u GITHUB_TOKEN \
  AWS_CONFIG_FILE=/dev/null \
  AWS_SHARED_CREDENTIALS_FILE=/dev/null \
  GIT_SSH_COMMAND="false" \
  claude --dangerously-skip-permissions "$@"
