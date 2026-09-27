#!/usr/bin/env python3
"""ts-edit-check (kit): PostToolUse hook for Edit/Write on TypeScript files.

Runs an incremental `tsc --noEmit -p <owning tsconfig>` whose buildinfo lives in
~/.claude/kit/state/tsc/ (never the repo's tracked tsbuildinfo). It reports ONLY errors in
the file just edited, so a half-done multi-file refactor stays quiet. Errors elsewhere are
caught at Stop and at commit. Budget 5 s. Slower projects are marked "slow" and skipped
for 12 h. Composite projects (tsconfig "references") are left to the gates.
Quiet on success. Fails closed on unparseable input (exit 2: the message is shown to Claude).
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from collections.abc import Sequence
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _kit

HOOK = "ts_edit_check"
BUDGET_S = 5.0
MAX_SHOWN = 10


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--skip-headless", action="store_true")
    parser.add_argument("--log")
    parser.add_argument("--budget", type=float, default=BUDGET_S)
    parser.add_argument("--defer-to-repo", action="store_true")
    opts, _ = parser.parse_known_args(argv)
    if opts.defer_to_repo and _kit.deferred_to_repo(Path(__file__)):
        _kit.log_decision(
            opts.log,
            HOOK,
            {"decision": "defer", "repo": os.environ.get("CLAUDE_PROJECT_DIR", "")},
        )
        return 0
    if opts.skip_headless and _kit.headless():
        _kit.log_decision(
            opts.log,
            HOOK,
            {"decision": "skip", "entrypoint": os.environ.get("CLAUDE_CODE_ENTRYPOINT", "")},
        )
        return 0
    try:
        payload = json.loads(sys.stdin.read())
        if not isinstance(payload, dict):
            raise ValueError("not a JSON object")
    except ValueError as exc:
        print(f"ts-edit-check: could not parse hook input ({exc}).", file=sys.stderr)
        return 2
    tool_input = payload.get("tool_input")
    raw = tool_input.get("file_path") if isinstance(tool_input, dict) else None
    if not isinstance(raw, str):
        return 0
    file = Path(raw)
    if (
        file.suffix not in _kit.TS_SUFFIXES
        or "node_modules" in file.parts
        or raw.startswith("/mnt/")
    ):
        return 0
    if not file.is_file():
        return 0
    stop = _kit.toplevel(file.parent)
    tsconfig = _kit.find_tsconfig(file, stop)
    if tsconfig is None:
        return 0
    result = _kit.run_tsc(tsconfig, stop, opts.budget)
    _kit.log_decision(
        opts.log, HOOK, {"file": str(file), "status": result.status, "took": result.duration_s}
    )
    if result.status != "errors":
        return 0
    target = file.resolve()
    mine = [e for e in result.errors if e.file == target]
    if not mine:
        return 0
    lines = [e.render(stop) for e in mine[:MAX_SHOWN]]
    more = len(mine) - len(lines)
    reason = (
        f"TypeScript errors in {file.name} after this edit "
        f"(tsc -p {tsconfig}, {result.duration_s}s):\n  "
        + "\n  ".join(lines)
        + (f"\n  (+{more} more)" if more > 0 else "")
    )
    print(json.dumps({"decision": "block", "reason": reason}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
