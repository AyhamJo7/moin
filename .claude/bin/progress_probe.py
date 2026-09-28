#!/usr/bin/env python3
"""progress-probe: is a long-running process actually making progress?

Fingerprints external signals and compares them with the previous probe of the same name:
  --repo DIR     HEAD + working-tree fingerprint (commits, diffs, new files)
  --log FILE     size, mtime and the last 4 KB (log growth)
  --cmd "SHELL"  stdout and exit code of a command, e.g. a DB status query

Results:  BASELINE (first probe) | PROGRESS | NO PROGRESS (n consecutive)
Exit codes: 0 baseline/progress/no-progress below the threshold, 3 = stalled
            (n >= --stall-after, default 2), 2 = usage error.

State:    ~/.claude/kit/state/probes/<name>.json   (override: $PROGRESS_PROBE_STATE_DIR)
Evidence: <git-dir>/claude-evidence/probe-latest.json in the current repo (or the first --repo)
          The Stop-hook claim check reads it to back "running fine" claims.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import re
import subprocess
import sys
from collections.abc import Sequence
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
import gates

DEFAULT_STALL_AFTER = 2
CMD_TIMEOUT_S = 60
LOG_TAIL_BYTES = 4096
HISTORY_KEEP = 20
EXIT_OK, EXIT_USAGE, EXIT_STALLED = 0, 2, 3
NAME_RE = re.compile(r"^[A-Za-z0-9._-]{1,64}$")


def state_dir() -> Path:
    override = os.environ.get("PROGRESS_PROBE_STATE_DIR")
    base = Path(override) if override else Path.home() / ".claude" / "kit" / "state" / "probes"
    base.mkdir(parents=True, exist_ok=True)
    return base


def now_iso() -> str:
    return dt.datetime.now(dt.UTC).isoformat(timespec="seconds")


def probe_repo(path: Path) -> tuple[str, str]:
    root = gates.toplevel(path)
    if root is None:
        return "missing", f"{path} is not a git repository"
    head = gates.head_sha(root)
    changed = len(gates.changed_paths(root))
    fp = gates.fingerprint(root)
    return fp, f"HEAD {head[:10]}, {changed} changed files, tree {fp[:8]}"


def probe_log(path: Path) -> tuple[str, str]:
    try:
        st = path.stat()
        with path.open("rb") as fh:
            fh.seek(max(0, st.st_size - LOG_TAIL_BYTES))
            tail = fh.read()
    except OSError as exc:
        return "missing", f"unreadable: {exc}"
    digest = hashlib.sha256(f"{st.st_size}:{st.st_mtime_ns}".encode() + tail).hexdigest()
    return digest, f"{st.st_size} bytes"


def probe_cmd(cmd: str) -> tuple[str, str]:
    try:
        proc = subprocess.run(
            ["bash", "-c", cmd], capture_output=True, text=True, timeout=CMD_TIMEOUT_S, check=False
        )
    except subprocess.TimeoutExpired:
        return "timeout", f"timed out after {CMD_TIMEOUT_S}s"
    digest = hashlib.sha256(f"{proc.returncode}\0{proc.stdout}".encode()).hexdigest()
    first = proc.stdout.strip().splitlines()[0][:120] if proc.stdout.strip() else "(no output)"
    return digest, f"exit {proc.returncode}: {first}"


def collect(repos: Sequence[str], logs: Sequence[str], cmds: Sequence[str]) -> dict[str, list[str]]:
    signals: dict[str, list[str]] = {}
    for r in repos:
        signals[f"repo:{Path(r).resolve()}"] = list(probe_repo(Path(r)))
    for lg in logs:
        signals[f"log:{Path(lg).resolve()}"] = list(probe_log(Path(lg)))
    for c in cmds:
        signals[f"cmd:{c}"] = list(probe_cmd(c))
    return signals


def write_repo_evidence(target: Path | None, record: dict[str, Any]) -> str | None:
    if target is None:
        return None
    root = gates.toplevel(target)
    if root is None:
        return None
    path = gates.evidence_dir(root) / "probe-latest.json"
    path.write_text(json.dumps(record, indent=2))
    return str(path)


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="progress-probe", description=__doc__.split("\n", 1)[0])
    parser.add_argument("name", help="probe name (one per monitored process)")
    parser.add_argument("--repo", action="append", default=[])
    parser.add_argument("--log", action="append", default=[])
    parser.add_argument("--cmd", action="append", default=[])
    parser.add_argument("--stall-after", type=int, default=DEFAULT_STALL_AFTER)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)
    if not NAME_RE.match(args.name):
        print("progress-probe: name must match [A-Za-z0-9._-]{1,64}", file=sys.stderr)
        return EXIT_USAGE
    if not (args.repo or args.log or args.cmd):
        print("progress-probe: give at least one --repo, --log or --cmd", file=sys.stderr)
        return EXIT_USAGE

    signals = collect(args.repo, args.log, args.cmd)
    state_file = state_dir() / f"{args.name}.json"
    try:
        previous: dict[str, Any] = json.loads(state_file.read_text())
    except (OSError, json.JSONDecodeError):
        previous = {}
    prev_signals: dict[str, list[str]] = previous.get("signals", {})
    changed = [
        f"{key}: {prev_signals[key][1]} -> {val[1]}" if key in prev_signals else f"{key}: new"
        for key, val in signals.items()
        if prev_signals.get(key, [None])[0] != val[0]
    ]
    if not prev_signals:
        result, count = "BASELINE", 0
    elif changed:
        result, count = "PROGRESS", 0
    else:
        result, count = "NO PROGRESS", int(previous.get("consecutive_no_progress", 0)) + 1
    last_change = now_iso() if result != "NO PROGRESS" else previous.get("last_change", now_iso())
    history = ([*previous.get("history", []), {"ts": now_iso(), "result": result}])[-HISTORY_KEEP:]
    state = {
        "name": args.name,
        "signals": signals,
        "last_change": last_change,
        "consecutive_no_progress": count,
        "history": history,
    }
    state_file.write_text(json.dumps(state, indent=2))
    stalled = result == "NO PROGRESS" and count >= args.stall_after
    record = {
        "tool": "progress-probe",
        "name": args.name,
        "ts": now_iso(),
        "result": "STALLED" if stalled else result,
        "changed": changed,
        "consecutive_no_progress": count,
        "last_change": last_change,
    }
    evidence_target = Path(args.repo[0]) if args.repo else Path.cwd()
    record["evidence"] = write_repo_evidence(evidence_target, record)
    if args.json:
        print(json.dumps(record))
    else:
        label = f"{result} ({count} consecutive)" if result == "NO PROGRESS" else result
        print(f"progress-probe {args.name}: {label}")
        for line in changed:
            print(f"  changed  {line}")
        if result == "NO PROGRESS":
            print(f"  unchanged since {last_change}")
            for key, val in signals.items():
                print(f"  same     {key}: {val[1]}")
        if stalled:
            print(
                f"  STALLED: {count} consecutive probes without progress. Stop waiting, "
                "write a BLOCKER note, and report the evidence above."
            )
    return EXIT_STALLED if stalled else EXIT_OK


if __name__ == "__main__":
    sys.exit(main())
