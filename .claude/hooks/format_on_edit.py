#!/usr/bin/env python3
"""format-on-edit: PostToolUse hook (Edit/Write/MultiEdit) that formats the edited file.

- Code and config files (ts, tsx, js, mjs, cjs, mts, cts, json, yml, yaml, css, html) with the
  repository's own prettier (`node_modules/.bin/prettier`), once P02 installs it.
- Terraform files (.tf, .tfvars.example excluded) with `terraform fmt` when terraform is on PATH.
Markdown is never reformatted (PLAN.md tables and evidence records keep their layout).
Silent no-op when the formatter is absent. A formatter error is reported to Claude on stderr with
exit code 2 (PostToolUse cannot block; it only surfaces the message).
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

PRETTIER_SUFFIXES = frozenset(
    {
        ".ts",
        ".tsx",
        ".js",
        ".mjs",
        ".cjs",
        ".mts",
        ".cts",
        ".json",
        ".yml",
        ".yaml",
        ".css",
        ".html",
    }
)
FORMAT_TIMEOUT_S = 15
EXIT_OK, EXIT_REPORT = 0, 2


def run(cmd: list[str], cwd: Path) -> tuple[int, str]:
    try:
        proc = subprocess.run(
            cmd, cwd=cwd, capture_output=True, text=True, timeout=FORMAT_TIMEOUT_S, check=False
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        return 1, str(exc)
    return proc.returncode, (proc.stderr or proc.stdout).strip()


def main() -> int:
    try:
        payload = json.loads(sys.stdin.read())
        raw = payload["tool_input"]["file_path"]
    except (ValueError, KeyError, TypeError):
        return EXIT_OK
    root = Path(os.environ.get("CLAUDE_PROJECT_DIR") or payload.get("cwd") or os.getcwd())
    path = Path(raw) if Path(raw).is_absolute() else root / raw
    if not path.is_file() or root not in path.resolve().parents:
        return EXIT_OK
    if path.suffix in PRETTIER_SUFFIXES:
        prettier = root / "node_modules" / ".bin" / "prettier"
        if not prettier.exists():
            return EXIT_OK
        code, out = run([str(prettier), "--write", "--log-level", "warn", str(path)], root)
    elif path.suffix == ".tf" and shutil.which("terraform"):
        code, out = run(["terraform", "fmt", str(path)], root)
    else:
        return EXIT_OK
    if code != 0:
        print(f"format-on-edit: {path.name} was not formatted: {out[-500:]}", file=sys.stderr)
        return EXIT_REPORT
    return EXIT_OK


if __name__ == "__main__":
    sys.exit(main())
