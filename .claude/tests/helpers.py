"""Shared test helpers: real temporary git repositories and real hook/tool invocations."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from collections.abc import Mapping, Sequence
from pathlib import Path

CLAUDE_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = CLAUDE_DIR.parent
HOOKS = CLAUDE_DIR / "hooks"
BIN = CLAUDE_DIR / "bin"


def git(repo: Path, *args: str) -> str:
    return subprocess.run(
        ["git", "-C", str(repo), *args], capture_output=True, text=True, check=True
    ).stdout


def write(root: Path, rel: str, content: str) -> Path:
    path = root / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    return path


def make_repo(parent: Path, branch: str = "feat/p02-01-example") -> Path:
    """A committed repo on a feature branch (main exists too)."""
    root = parent / "repo"
    root.mkdir()
    git(root, "init", "-q", "-b", "main")
    git(root, "config", "user.name", "Test")
    git(root, "config", "user.email", "test@example.invalid")
    git(root, "config", "commit.gpgsign", "false")
    write(root, "README.md", "# fixture\n")
    git(root, "add", "-A")
    git(root, "commit", "-q", "-m", "chore: initial")
    git(root, "switch", "-q", "-c", branch)
    return root


def base_env(**extra: str) -> dict[str, str]:
    env = dict(os.environ)
    for key in (
        "CLAUDE_PROJECT_DIR",
        "AWS_PROFILE",
        "PGHOST",
        "GATES_CONFIG",
        "GATES_EVIDENCE_DIR",
    ):
        env.pop(key, None)
    env.pop("CLAUDE_CODE_REMOTE", None)
    env.update(extra)
    return env


def run(
    script: Path,
    args: Sequence[str] = (),
    *,
    stdin: str | None = None,
    env: Mapping[str, str] | None = None,
    cwd: Path | None = None,
    timeout: float = 120,
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(script), *args],
        input=stdin,
        env=dict(env) if env is not None else base_env(),
        cwd=cwd,
        capture_output=True,
        text=True,
        timeout=timeout,
        check=False,
    )


def run_hook(
    script: Path,
    payload: Mapping[str, object] | str,
    *,
    env: Mapping[str, str] | None = None,
    args: Sequence[str] = (),
) -> subprocess.CompletedProcess[str]:
    data = payload if isinstance(payload, str) else json.dumps(payload)
    return run(script, args, stdin=data, env=env)


def temp_dir() -> tempfile.TemporaryDirectory[str]:
    return tempfile.TemporaryDirectory(prefix="moin-cp-test-")
