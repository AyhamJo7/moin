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
        (state / f"{key}.json").write_text(
            json.dumps({"worktree": str(root), "common_dir": str(common)})
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
