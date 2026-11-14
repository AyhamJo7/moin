#!/usr/bin/env bash
# Installs the lean control plane staged in this directory. Run once by the founder from the
# repository root: bash docs/control-plane/owner-0009/install.sh
# The previous files stay in git (tag pre-owner-overhaul); undo with
#   git checkout pre-owner-overhaul -- .claude/settings.json .claude/gates.json \
#     .claude/hooks/policy_guard.py .claude/policy/merge-gate.json
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(git -C "$here" rev-parse --show-toplevel)"

python3 "$here/policy_guard.py" --self-test
python3 -m json.tool "$here/settings.json" >/dev/null
python3 -m json.tool "$here/gates.json" >/dev/null
python3 -m json.tool "$here/merge-gate.json" >/dev/null

install -m 0644 "$here/settings.json" "$root/.claude/settings.json"
install -m 0644 "$here/gates.json" "$root/.claude/gates.json"
install -m 0644 "$here/merge-gate.json" "$root/.claude/policy/merge-gate.json"
install -m 0755 "$here/policy_guard.py" "$root/.claude/hooks/policy_guard.py"

echo "installed: settings.json, gates.json, policy/merge-gate.json, hooks/policy_guard.py"
echo "restart the session (or run /next in a new one) so the new hook list is loaded"
