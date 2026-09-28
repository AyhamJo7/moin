#!/usr/bin/env python3
"""session-bootstrap: SessionStart hook for toolchain pins (ADR-0002, P02.02.01/08).

Prints only when something is wrong, so the greenfield repository stays silent:
- `node -v` differs from .nvmrc, `pnpm -v` from package.json `packageManager: pnpm@X`,
  `terraform -version` from .terraform-version (each check switches on when its file exists);
- in a remote session (CLAUDE_CODE_REMOTE=true) with a pnpm-lock.yaml but no node_modules, it
  runs `pnpm install --frozen-lockfile` once and reports the outcome in one line.

SessionStart output is context, never a block: every failure is reported and the hook exits 0.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

VERSION_TIMEOUT_S = 10
INSTALL_TIMEOUT_S = 280
VERSION_RE = re.compile(r"(\d+\.\d+\.\d+)")


def tool_version(cmd: list[str]) -> str:
    if shutil.which(cmd[0]) is None:
        return "missing"
    try:
        proc = subprocess.run(
            cmd, capture_output=True, text=True, timeout=VERSION_TIMEOUT_S, check=False
        )
    except (OSError, subprocess.TimeoutExpired):
        return "unavailable"
    m = VERSION_RE.search(proc.stdout + proc.stderr)
    return m.group(1) if m else "unknown"


def pinned(root: Path) -> list[tuple[str, str, list[str]]]:
    """(label, wanted version, version command) for every pin file that exists."""
    pins: list[tuple[str, str, list[str]]] = []
    nvmrc = root / ".nvmrc"
    if nvmrc.is_file():
        pins.append(
            (".nvmrc node", nvmrc.read_text(encoding="utf-8").strip().lstrip("v"), ["node", "-v"])
        )
    package = root / "package.json"
    if package.is_file():
        try:
            manager = str(json.loads(package.read_text(encoding="utf-8")).get("packageManager", ""))
        except ValueError:
            manager = ""
        if manager.startswith("pnpm@"):
            pins.append(("packageManager pnpm", manager[5:].split("+", 1)[0], ["pnpm", "-v"]))
    tfv = root / ".terraform-version"
    if tfv.is_file():
        pins.append(
            (
                ".terraform-version terraform",
                tfv.read_text(encoding="utf-8").strip(),
                ["terraform", "-version"],
            )
        )
    return pins


def cloud_install(root: Path) -> str | None:
    if os.environ.get("CLAUDE_CODE_REMOTE") != "true":
        return None
    if not (root / "pnpm-lock.yaml").is_file() or (root / "node_modules").is_dir():
        return None
    if shutil.which("pnpm") is None:
        return "- pnpm-lock.yaml present but pnpm is missing: check the environment setup script."
    try:
        proc = subprocess.run(
            ["pnpm", "install", "--frozen-lockfile"],
            cwd=root,
            capture_output=True,
            text=True,
            timeout=INSTALL_TIMEOUT_S,
            check=False,
        )
    except subprocess.TimeoutExpired:
        return f"- `pnpm install --frozen-lockfile` did not finish in {INSTALL_TIMEOUT_S} s; run it again."
    if proc.returncode != 0:
        tail = (proc.stderr or proc.stdout).strip().splitlines()[-3:]
        return "- `pnpm install --frozen-lockfile` FAILED: " + " | ".join(tail)
    return "- dependencies installed (`pnpm install --frozen-lockfile`)."


def main() -> int:
    try:
        payload = json.loads(sys.stdin.read())
        cwd = Path(str(payload.get("cwd") or os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd()))
    except (ValueError, AttributeError) as exc:
        print(f"## Toolchain (moin)\n- session-bootstrap could not parse its input ({exc}).")
        return 0
    root = Path(os.environ.get("CLAUDE_PROJECT_DIR") or cwd)
    lines: list[str] = []
    for label, want, cmd in pinned(root):
        have = tool_version(cmd)
        if have != want:
            lines.append(
                f"- {label}: pinned {want}, found {have}. Locally: `nvm use` / pinned binary in ~/.local/bin; in cloud: the setup script."
            )
    note = cloud_install(root)
    if note:
        lines.append(note)
    if lines:
        print("## Toolchain (moin)\n" + "\n".join(lines))
    return 0


if __name__ == "__main__":
    sys.exit(main())
