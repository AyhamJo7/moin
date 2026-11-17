#!/usr/bin/env python3
"""Record a session's linked worktree from a completed tool call.

The command hook itself may live in CLAUDE_PROJECT_DIR's root checkout. This file records only
an explicit path into a linked worktree belonging to the same Git common directory. A later
read of the root checkout cannot replace that session choice.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
import sys
from pathlib import Path


def git_path(path: Path, *args: str) -> Path | None:
    proc = subprocess.run(
        ["git", "-C", str(path), "rev-parse", *args], capture_output=True, text=True, check=False
    )
    return Path(proc.stdout.strip()).resolve() if proc.returncode == 0 else None


def git_out(path: Path, *args: str) -> str:
    proc = subprocess.run(
        ["git", "-C", str(path), *args], capture_output=True, text=True, check=False
    )
    return proc.stdout.strip() if proc.returncode == 0 else ""


def candidates(payload: dict[str, object]) -> list[Path]:
    tool = payload.get("tool_input")
    if not isinstance(tool, dict):
        return []
    found: list[Path] = []
    for key in ("workdir", "cwd", "file_path", "path"):
        value = tool.get(key)
        if isinstance(value, str) and value.startswith("/"):
            found.append(Path(value))
    command = tool.get("command")
    if isinstance(command, str):
        for match in re.finditer(
            r"(?:^|[;&]|&&)\s*(?:cd\s+|git\s+-C\s+)[\"\']?(/[^\s;\"\']+)", command
        ):
            found.append(Path(match.group(1)))
    return found


def capture(payload: dict[str, object], project: Path) -> Path | None:
    session = payload.get("session_id")
    if not isinstance(session, str) or not session:
        return None
    project_root = git_path(project, "--show-toplevel")
    project_common = git_path(project, "--path-format=absolute", "--git-common-dir")
    if project_root is None or project_common is None:
        return None
    for candidate in candidates(payload):
        probe = candidate if candidate.is_dir() else candidate.parent
        root = git_path(probe, "--show-toplevel")
        common = git_path(probe, "--path-format=absolute", "--git-common-dir")
        if root is None or common != project_common or root == project_root:
            continue
        state = project_root / ".claude" / "state" / "worktrees"
        state.mkdir(parents=True, exist_ok=True)
        key = hashlib.sha256(session.encode()).hexdigest()[:24]
        # Immutable commits, not a branch name: once the worktree is removed, claim_check compares
        # the files `base..head` changed against the fallback checkout to see whether the work landed.
        head = git_out(root, "rev-parse", "HEAD")
        record = state / f"{key}.json"
        try:
            earlier = json.loads(record.read_text())
        except (OSError, ValueError):
            earlier = {}
        # The first fork point recorded for this worktree is kept: once the project checkout has
        # taken the work, a fresh merge-base would equal head and leave nothing to compare.
        base = (
            str(earlier.get("base") or "") if earlier.get("worktree") == str(root) else ""
        ) or git_out(root, "merge-base", "HEAD", git_out(project_root, "rev-parse", "HEAD"))
        record.write_text(
            json.dumps(
                {"worktree": str(root), "common_dir": str(common), "head": head, "base": base}
            )
        )
        return root
    return None


def main() -> int:
    try:
        payload = json.loads(sys.stdin.read())
        project = os.environ.get("CLAUDE_PROJECT_DIR")
        if isinstance(payload, dict) and project:
            capture(payload, Path(project))
    except (OSError, ValueError):
        return 0
    return 0


if __name__ == "__main__":
    sys.exit(main())
