#!/usr/bin/env python3
"""session-context (kit): SessionStart hook that re-injects working state (startup, resume,
clear, compact). It prints only when something applies, at most ~25 lines:

- the active PROGRESS.md ledger: front matter + the last log entries
- the latest StopFailure checkpoint from the last 72 h
- gate evidence status vs the current tree (repos with .claude/gates.json)
- Docker unreachable, when gates.json lists "docker" in needs
- orphaned processes whose cwd is inside the repo (reparented to init/systemd)

Plain stdout from SessionStart is added to Claude's context.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from collections.abc import Sequence
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _kit

HOOK = "session_context"
CHECKPOINT_MAX_AGE_S = 72 * 3600
MAX_ORPHANS = 5
REAPERS = frozenset({"systemd", "init", "(sd-pam)"})
SHELLS = frozenset({"bash", "sh", "zsh", "dash", "fish"})


def ledger_lines(root: Path) -> list[str]:
    meta = _kit.read_ledger(root)
    if not meta or meta.get("status", "").lower() != "active":
        return []
    out = [
        f"- Ledger PROGRESS.md: status=active mode={meta.get('mode', '-')} updated={meta.get('updated', '-')}",
        f"  mission: {meta.get('mission', '-')}",
        f"  next: {meta.get('next', '-')}",
    ]
    out += [f"  {entry.strip()}" for entry in _kit.ledger_log_tail(root, 3)]
    return out


def checkpoint_lines(root: Path) -> list[str]:
    path = _kit.evidence_dir(root) / "latest-checkpoint.md"
    try:
        if time.time() - path.stat().st_mtime > CHECKPOINT_MAX_AGE_S:
            return []
        text = path.read_text(errors="replace")
    except OSError:
        return []
    title = text.splitlines()[0].lstrip("# ").strip() if text else "checkpoint"
    picks = [
        ln.strip()
        for ln in text.splitlines()
        if ln.startswith(("- time:", "- HEAD:", "- uncommitted"))
    ]
    return [
        f"- Last session: {title} ({'; '.join(p.lstrip('- ') for p in picks)}). Details: {path}"
    ]


def gate_lines(root: Path) -> list[str]:
    if not (root / ".claude" / "gates.json").is_file():
        return []
    gates_py = Path(__file__).resolve().parent.parent / "bin" / "gates.py"
    try:
        proc = subprocess.run(
            [sys.executable, str(gates_py), "--repo", str(root), "status", "--json"],
            capture_output=True,
            text=True,
            timeout=8,
            check=False,
        )
        data = json.loads(proc.stdout)
    except (subprocess.TimeoutExpired, ValueError):
        return ["- Gates: status unavailable"]
    tiers = data.get("tiers", {})
    if not tiers:
        return [
            "- Gates: no evidence recorded yet for this repo (run gates full before claiming done)"
        ]
    parts = []
    for tier, info in tiers.items():
        state = "matches current code" if info.get("matches_code") else "STALE"
        skipped = f", skipped {info['skipped']}" if info.get("skipped") else ""
        parts.append(
            f"{tier} {str(info.get('result')).upper()} @ {str(info.get('head'))[:10]} ({state}{skipped})"
        )
    return [f"- Gates: {'; '.join(parts)}"]


def docker_lines(root: Path) -> list[str]:
    try:
        cfg = json.loads((root / ".claude" / "gates.json").read_text())
    except (OSError, ValueError):
        return []
    if "docker" not in (cfg.get("needs") or []):
        return []
    if os.environ.get("DOCKER_HOST") or Path("/var/run/docker.sock").exists():
        return []
    return [
        "- Docker is not reachable from WSL (/var/run/docker.sock missing): Docker gates will be "
        "SKIPPED/UNVERIFIED. Ask the user to start Docker Desktop and enable Settings > Resources > "
        "WSL integration for this distro."
    ]


def terminal_root(comm: str, parent_comm: str, tty_nr: int) -> bool:
    """A terminal's entry shell started directly by WSL's per-terminal relay: a shell with a
    controlling terminal. A leftover `setsid bash -c ...` has no terminal and stays an orphan."""
    return parent_comm.startswith("Relay(") and comm.lstrip("-") in SHELLS and tty_nr != 0


def ancestors(pid: int) -> set[int]:
    """This process and its ancestors: the session's own shell is never an orphan."""
    found: set[int] = set()
    while pid > 1 and pid not in found:
        found.add(pid)
        try:
            stat = (Path("/proc") / str(pid) / "stat").read_text()
            pid = int(stat.rsplit(")", 1)[1].split()[1])
        except (OSError, ValueError, IndexError):
            break
    return found


def is_orphan(entry: Path, ppid: int, current_claude: str) -> bool:
    """Reparented to init/systemd/WSL relay, or to a `claude` process that is not this session."""
    if ppid <= 1:
        return True
    parent_comm = (Path("/proc") / str(ppid) / "comm").read_text().strip()
    if parent_comm.startswith("Relay("):  # WSL2 /init relay
        # A shell whose parent is the relay is a terminal's entry shell (wsl.exe --cd),
        # not a leftover child; anything else reparented to the relay is an orphan.
        comm = (entry / "comm").read_text().strip()
        tty_nr = int((entry / "stat").read_text().rsplit(")", 1)[1].split()[4])
        return not terminal_root(comm, parent_comm, tty_nr)
    if parent_comm in REAPERS:
        return True
    if parent_comm == "claude" and str(ppid) != current_claude:
        comm = (entry / "comm").read_text().strip()
        cmdline = (entry / "cmdline").read_bytes().replace(b"\0", b" ").decode(errors="replace")
        return comm not in SHELLS and not is_mcp_server(cmdline)
    return False


def is_mcp_server(cmdline: str) -> bool:
    """A live session's MCP server (e.g. `npm exec @modelcontextprotocol/...`), not a leftover."""
    lowered = cmdline.lower()
    return "mcp" in lowered or "modelcontextprotocol" in lowered


def orphan_lines(root: Path) -> list[str]:
    uid = os.getuid()
    current_claude = os.environ.get("CLAUDE_PID", "")
    found: list[tuple[int, str]] = []
    own = ancestors(os.getpid())
    for entry in Path("/proc").iterdir():
        if not entry.name.isdigit() or int(entry.name) in own:
            continue
        try:
            if entry.stat().st_uid != uid:
                continue
            cwd = os.readlink(entry / "cwd")
            if not (cwd == str(root) or cwd.startswith(str(root) + "/")):
                continue
            stat = (entry / "stat").read_text()
            ppid = int(stat.rsplit(")", 1)[1].split()[1])
            if is_orphan(entry, ppid, current_claude):
                found.append((int(entry.name), (entry / "comm").read_text().strip()))
        except (OSError, ValueError, IndexError):
            continue
    if not found:
        return []
    shown = ", ".join(f"{pid} ({comm})" for pid, comm in found[:MAX_ORPHANS])
    pids = " ".join(str(pid) for pid, _ in found[:MAX_ORPHANS])
    return [f"- Orphaned processes from this repo still running: {shown}. Check, then: kill {pids}"]


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
    try:
        payload = json.loads(sys.stdin.read())
        if not isinstance(payload, dict):
            raise ValueError("not a JSON object")
    except ValueError as exc:
        print(
            f"## Session context (kit)\n- session-context could not parse its hook input ({exc})."
        )
        return 0
    root = _kit.repo_root(str(payload.get("cwd") or ""))
    if root is None:
        return 0
    lines: list[str] = []
    for producer in (ledger_lines, checkpoint_lines, gate_lines, docker_lines, orphan_lines):
        try:
            lines += producer(root)
        except Exception as exc:
            lines.append(f"- ({producer.__name__} failed: {type(exc).__name__}: {exc})")
    if lines:
        print(f"## Session context (auto, {root.name})")
        print("\n".join(lines[:25]))
        _kit.log_decision(
            opts.log, HOOK, {"decision": "context", "repo": str(root), "lines": len(lines)}
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
