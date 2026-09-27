#!/usr/bin/env python3
"""commit-guard (kit): PreToolUse hook run before `git commit`.

- Type-checks the TypeScript/Python projects touched by the commit (incremental tsc with
  buildinfo outside the repo; mypy on the committed .py files).
    errors in files being committed  -> block (exit 2, errors shown to Claude)
    errors elsewhere in the project  -> warning via additionalContext
    budget exceeded / tool missing   -> explicit UNVERIFIED note, the commit proceeds
- Reminds Claude when PROGRESS.md is active but not part of the commit.
- Warns when a generated *.tsbuildinfo is staged.
Escape hatch for emergency checkpoints: `CLAUDE_SKIP_COMMIT_CHECK=1 git commit ...`.
Fails closed on unparseable input. Internal budget (default 20 s) < hook timeout (60 s).
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from collections import defaultdict
from collections.abc import Sequence
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _kit
from git_guard import GitCall, GuardParseError, has_short_flag, parse_git_calls, split_opts

HOOK = "commit_guard"
DEFAULT_BUDGET_S = 20.0
MAX_ERRORS_SHOWN = 15
COMMIT_VALUE_OPTS = frozenset(
    {
        "-m",
        "--message",
        "-F",
        "--file",
        "-C",
        "-c",
        "--author",
        "--date",
        "--fixup",
        "--squash",
        "-t",
        "--template",
        "--trailer",
        "--cleanup",
    }
)


def committed_files(root: Path, call: GitCall) -> list[str]:
    opts, pos, after = split_opts(call.args, COMMIT_VALUE_OPTS)
    paths = (after or []) + pos
    if call.after_mutation and not paths:
        # e.g. `git add -A && git commit`: nothing is staged yet when this hook runs, so check
        # everything that could end up in the commit (changed + untracked files).
        return _kit.changed_files(root)
    if paths:
        return _kit.git_lines(
            root, "diff", "HEAD", "--name-only", "-z", "--diff-filter=ACMR", "--", *paths
        )
    files = set(_kit.git_lines(root, "diff", "--cached", "--name-only", "-z", "--diff-filter=ACMR"))
    if "--all" in opts or has_short_flag(opts, "a"):
        files |= set(_kit.git_lines(root, "diff", "--name-only", "-z", "--diff-filter=ACMR"))
    return sorted(files)


def check_commit(
    root: Path, files: Sequence[str], budget_s: float, *, state_known: bool = True
) -> tuple[list[str], list[str]]:
    """Returns (blocking error lines, context notes)."""
    deadline = time.monotonic() + budget_s
    committed = {(root / f).resolve() for f in files}
    blocking: list[str] = []
    notes: list[str] = []

    ts_projects: dict[Path, list[Path]] = defaultdict(list)
    py_projects: dict[Path, list[Path]] = defaultdict(list)
    for rel in files:
        path = root / rel
        if "node_modules" in path.parts or not path.is_file():
            continue
        if path.suffix in _kit.TS_SUFFIXES:
            cfg = _kit.find_tsconfig(path, root)
            if cfg:
                ts_projects[cfg].append(path)
        elif path.suffix == ".py":
            proj = _kit.find_mypy_project(path, root)
            if proj:
                py_projects[proj].append(path)

    checks: list[tuple[str, Path, _kit.CheckResult]] = []
    for cfg in ts_projects:
        remaining = deadline - time.monotonic()
        if remaining <= 1:
            notes.append(f"typecheck of {cfg.relative_to(root)} not run: budget spent (UNVERIFIED)")
            continue
        checks.append(("tsc", cfg, _kit.run_tsc(cfg, root, remaining)))
    for proj, pyfiles in py_projects.items():
        remaining = deadline - time.monotonic()
        if remaining <= 1:
            notes.append(
                f"mypy in {proj.relative_to(root) or '.'} not run: budget spent (UNVERIFIED)"
            )
            continue
        checks.append(("mypy", proj, _kit.run_mypy(proj, pyfiles, root, remaining)))

    for tool, where, result in checks:
        label = f"{tool} {where.relative_to(root) if where != root else '.'}"
        if result.status in ("timeout", "unavailable", "unsupported", "locked", "slow"):
            notes.append(f"{label}: not verified ({result.status}: {result.detail})")
            continue
        mine = [e for e in result.errors if e.file in committed]
        other = [e for e in result.errors if e.file not in committed]
        blocking += [e.render(root) for e in mine]
        if other:
            notes.append(
                f"{label}: {len(other)} error(s) in files NOT in this commit, e.g. "
                + "; ".join(e.render(root) for e in other[:3])
            )

    meta = _kit.read_ledger(root)
    ledger_active = meta is not None and meta.get("status", "").lower() == "active"
    if state_known and ledger_active and "PROGRESS.md" not in files:
        notes.append(
            "PROGRESS.md (status: active) is not part of this commit: record the item, the commit "
            "SHA, the evidence path and the next step in the ledger."
        )
    generated = [f for f in files if f.endswith(".tsbuildinfo")]
    if generated:
        notes.append(f"generated file(s) staged: {', '.join(generated)}; unstage unless intended.")
    return blocking, notes


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--skip-headless", action="store_true")
    parser.add_argument("--log")
    parser.add_argument("--budget", type=float, default=DEFAULT_BUDGET_S)
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
        print(
            f"commit-guard: could not parse hook input ({exc}); blocking to fail closed.",
            file=sys.stderr,
        )
        return 2
    tool_input = payload.get("tool_input")
    command = tool_input.get("command") if isinstance(tool_input, dict) else None
    if (
        payload.get("tool_name") != "Bash"
        or not isinstance(command, str)
        or "commit" not in command
    ):
        return 0
    cwd = Path(str(payload.get("cwd") or os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd()))
    try:
        calls = [c for c in parse_git_calls(command, cwd) if c.sub == "commit"]
    except GuardParseError:
        return 0  # git_guard (same event) blocks unparseable git commands
    blocking: list[str] = []
    notes: list[str] = []
    for call in calls:
        if call.env.get("CLAUDE_SKIP_COMMIT_CHECK") == "1":
            notes.append(
                "commit check skipped via CLAUDE_SKIP_COMMIT_CHECK=1: "
                "note this in the ledger (UNVERIFIED)."
            )
            continue
        root = _kit.toplevel(call.cwd)
        if root is None:
            continue
        files = committed_files(root, call)
        b, n = check_commit(root, files, opts.budget, state_known=not call.after_mutation)
        blocking += b
        notes += n
    if blocking:
        shown = blocking[:MAX_ERRORS_SHOWN]
        more = len(blocking) - len(shown)
        print(
            "commit-guard: blocked, type errors in files being committed:\n  "
            + "\n  ".join(shown)
            + (f"\n  (+{more} more)" if more > 0 else "")
            + "\nFix them first. For an emergency checkpoint only, prefix the command with "
            "CLAUDE_SKIP_COMMIT_CHECK=1 and record it in the ledger.",
            file=sys.stderr,
        )
        _kit.log_decision(opts.log, HOOK, {"decision": "block", "errors": len(blocking)})
        return 2
    if notes:
        print(
            json.dumps(
                {
                    "hookSpecificOutput": {
                        "hookEventName": "PreToolUse",
                        "additionalContext": "commit-guard: " + " | ".join(notes),
                    }
                }
            )
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
