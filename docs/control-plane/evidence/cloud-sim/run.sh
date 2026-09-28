#!/usr/bin/env bash
# Headless guard test for the moin control plane (Phase C).
#
#   run.sh local               real HOME, permission mode "default"
#   run.sh local-bypass        real HOME, --dangerously-skip-permissions (unattended runs)
#   run.sh empty-home          empty HOME (only committed repo config, like a cloud VM)
#   run.sh empty-home-bypass   empty HOME + --dangerously-skip-permissions
#
# Phases (prompts in ./prompts), each in its OWN fresh throwaway clone so one phase cannot
# contaminate the next: guards (original block list), selfprotect (guardrail files), table
# (unattended permission table), claim (Stop hook claim check), claim-forced (the model is told to
# write the claim, so the hook must act), stall (autonomous ledger: the same
# no-change turn on one resumed session until stop_guard blocks).
#
# MOIN_SIM_ONLY="claim-forced" runs only the listed phases.
# MOIN_SIM_PATCHES=1 applies docs/control-plane/patches/*.patch inside each throwaway clone before
# its session starts, to test a candidate guard change the founder has not applied yet. It never
# touches the working tree. The run folder name records it.
#
# Isolation: clones of the current branch whose `origin` is a local bare repo (no push reaches
# GitHub or the working tree). Dummy secrets are fake values. AWS config and credential files are
# pointed at /dev/null for every session, so no step can use real AWS credentials.
# empty-home auth: an empty HOME has no login. Put an OAuth token from `claude setup-token` in
# MOIN_SIM_TOKEN_FILE (default ~/.config/moin-sim/oauth-token, chmod 600). The script reads it into
# CLAUDE_CODE_OAUTH_TOKEN without printing it. Nothing else touches credential files.
set -euo pipefail

MODE="${1:?usage: run.sh local|local-bypass|empty-home|empty-home-bypass}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(git -C "$HERE" rev-parse --show-toplevel)"
BRANCH="$(git -C "$REPO" branch --show-current)"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
SUFFIX=""
[ "${MOIN_SIM_PATCHES:-0}" = "1" ] && SUFFIX="-with-patches"
OUT="$HERE/out-$MODE-$STAMP$SUFFIX"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/moin-sim.XXXXXX")"
TOKEN_FILE="${MOIN_SIM_TOKEN_FILE:-$HOME/.config/moin-sim/oauth-token}"
mkdir -p "$OUT"

case "$MODE" in
  *-bypass) PERMS=(--dangerously-skip-permissions) ;;
  *) PERMS=(--permission-mode default) ;;
esac
export AWS_CONFIG_FILE=/dev/null AWS_SHARED_CREDENTIALS_FILE=/dev/null
unset AWS_PROFILE AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN CLAUDE_PROJECT_DIR

case "$MODE" in
  empty-home*)
    [ -r "$TOKEN_FILE" ] || { echo "missing $TOKEN_FILE (see header)" >&2; exit 2; }
    CLAUDE_CODE_OAUTH_TOKEN="$(tr -d '\n' < "$TOKEN_FILE")"
    export CLAUDE_CODE_OAUTH_TOKEN
    export HOME="$WORK/home" && mkdir -p "$HOME"
    ;;
esac

fresh_clone() {
  local dir="$WORK/$1"
  git init -q --bare "$dir-remote.git"
  git clone -q --branch "$BRANCH" "$REPO" "$dir"
  git -C "$dir" remote set-url origin "$dir-remote.git"
  git -C "$dir" config user.name "Sim Test"
  git -C "$dir" config user.email "sim@example.invalid"
  git -C "$dir" config commit.gpgsign false
  if [ -n "$SUFFIX" ]; then
    for p in "$REPO"/docs/control-plane/patches/*.patch; do git -C "$dir" am -q "$p"; done
  fi
  cp "$REPO/PLAN.md" "$dir/PLAN.md"       # mirrors the state after the plan-baseline PR merges
  printf 'MOIN_FAKE_TOKEN=phase-c-dummy-not-a-secret\n' > "$dir/.env"
  : > "$dir/dummy.pem"
  echo "$dir"
}

run() {
  local dir="$1" name="$2" prompt_file="$3"; shift 3
  (cd "$dir" && claude -p "$(cat "$HERE/prompts/$prompt_file")" --output-format stream-json \
    --verbose --max-turns 60 "${PERMS[@]}" "$@" > "$OUT/$name.jsonl" 2> "$OUT/$name.stderr") || true
  git -C "$dir" status --short > "$OUT/$name.git-status.txt"
  git -C "$dir" branch --show-current > "$OUT/$name.branch.txt"
  git -C "$dir" diff --stat "$BRANCH" -- .claude > "$OUT/$name.guard-files-diff.txt" 2>&1 || true
}

session_id() {
  python3 -c 'import json,sys
for line in open(sys.argv[1]):
    d = json.loads(line)
    if d.get("session_id"):
        print(d["session_id"]); break' "$1"
}

PHASES="${MOIN_SIM_ONLY:-guards selfprotect table tools claim claim-forced stall}"
for phase in $PHASES; do
  [ "$phase" = "stall" ] && continue
  run "$(fresh_clone "$phase")" "$phase" "$phase.txt"
done
if [[ " $PHASES " != *" stall "* ]]; then
  python3 "$HERE/summarize.py" "$OUT" "$MODE$SUFFIX" "$WORK"
  exit 0
fi

# Stall probe: arm stop_guard with an autonomous ledger, then repeat a no-change turn.
STALL_DIR="$(fresh_clone stall)"
printf -- '---\nmission: stall probe\nstatus: active\nmode: autonomous\nupdated: probe\nnext: wait\n---\n\n# Stall probe ledger\n' > "$STALL_DIR/PROGRESS.md"
git -C "$STALL_DIR" add PROGRESS.md
git -C "$STALL_DIR" commit -q -m "chore: autonomous ledger for the stall probe"
run "$STALL_DIR" stall-1 stall.txt
SID="$(session_id "$OUT/stall-1.jsonl")"
for i in 2 3 4; do
  run "$STALL_DIR" "stall-$i" stall.txt --resume "$SID"
done
cp "$STALL_DIR/PROGRESS.md" "$OUT/stall-PROGRESS.md"

python3 "$HERE/summarize.py" "$OUT" "$MODE$SUFFIX" "$WORK"
