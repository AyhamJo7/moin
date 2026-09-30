#!/usr/bin/env python3
"""stopfailure-checkpoint (kit): StopFailure hook that snapshots state when a turn dies on an
API error (usage limit = `rate_limit`, overload, auth, ...).

It writes a Markdown checkpoint (error, time, branch, HEAD, dirty files, ledger next step,
gate evidence status) to <git-dir>/claude-evidence/checkpoints/ plus latest-checkpoint.md.
Those live inside .git, so the working tree stays clean. SessionStart re-injects the latest
one. Claude Code ignores this hook's output, so the checkpoint is a pure side effect.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import subprocess
import sys
from collections.abc import Sequence
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _kit

HOOK = "stopfailure_checkpoint"
MAX_DIRTY_LISTED = 30


def gate_summary(root: Path) -> str:
    gates_py = Path(__file__).resolve().parent.parent / "bin" / "gates.py"
    try:
        proc = subprocess.run(
            [sys.executable, str(gates_py), "--repo", str(root), "status", "--json"],
            capture_output=True,
            text=True,
            timeout=20,
            check=False,
        )
        data = json.loads(proc.stdout)
    except (subprocess.TimeoutExpired, ValueError):
        return "unknown"
    parts = []
    for tier, info in data.get("tiers", {}).items():
        state = "current" if info.get("matches_code") else "stale"
        parts.append(
            f"{tier} {str(info.get('result')).upper()} @ {str(info.get('head'))[:10]} ({state})"
        )
    return "; ".join(parts) or "no gate evidence"


def build(root: Path, payload: dict[str, Any]) -> str:
    head = _kit.git_lines(root, "log", "-1", "--format=%h %s")
    branch = _kit.git_lines(root, "rev-parse", "--abbrev-ref", "HEAD")
    dirty = _kit.git_lines(root, "status", "--porcelain")
    meta = _kit.read_ledger(root) or {}
    lines = [
        f"# Checkpoint: turn ended by API error `{payload.get('error', 'unknown')}`",
        "",
        f"- time: {_kit.now_iso()}",
        f"- error detail: {payload.get('error_details') or payload.get('last_assistant_message') or '-'}",
        f"- session: {payload.get('session_id', '?')}",
        f"- transcript: {payload.get('transcript_path', '?')}",
        f"- repo: {root}",
        f"- branch: {branch[0] if branch else '?'}",
        f"- HEAD: {head[0] if head else 'UNBORN'}",
        f"- ledger: status={meta.get('status', '-')} next={meta.get('next', '-')}",
        f"- gates: {gate_summary(root)}",
        f"- uncommitted files ({len(dirty)}):",
        *[f"  - `{d}`" for d in dirty[:MAX_DIRTY_LISTED]],
    ]
    if len(dirty) > MAX_DIRTY_LISTED:
        lines.append(f"  - ... +{len(dirty) - MAX_DIRTY_LISTED} more")
    lines += [
        "",
        "Resume: read this, then PROGRESS.md; commit/push the dirty work first if it is complete.",
    ]
    return "\n".join(lines) + "\n"


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--skip-headless", action="store_true")
    parser.add_argument("--log")
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
    raw = sys.stdin.read()
    try:
        payload = json.loads(raw)
        if not isinstance(payload, dict):
            raise ValueError("not a JSON object")
    except ValueError:
        payload = {"error": "unparseable-hook-input", "error_details": raw[:500]}
    root = _kit.repo_root(str(payload.get("cwd") or ""), str(payload.get("session_id") or ""))
    if root is None:
        return 0
    out_dir = _kit.evidence_dir(root) / "checkpoints"
    out_dir.mkdir(parents=True, exist_ok=True)
    stamp = dt.datetime.now(dt.UTC).strftime("%Y%m%dT%H%M%SZ")
    text = build(root, payload)
    (out_dir / f"{stamp}.md").write_text(text)
    (_kit.evidence_dir(root) / "latest-checkpoint.md").write_text(text)
    _kit.log_decision(
        opts.log, HOOK, {"decision": "checkpoint", "repo": str(root), "error": payload.get("error")}
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
