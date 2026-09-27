#!/usr/bin/env python3
"""stop-guard (kit): Stop hook for loop stall detection and a TypeScript check at turn end.

Stall detection is armed when the Stop input lists scheduled wakeups (`session_crons`, from
/loop, ScheduleWakeup or CronCreate) or PROGRESS.md front matter says
`mode: autonomous` + `status: active`. It fingerprints HEAD, the working tree, the ledger
and the latest progress-probe record at every Stop. After two consecutive armed Stops with
an identical fingerprint it blocks once: stop the loop, write a BLOCKER, end the turn.

The TypeScript check runs incremental tsc (buildinfo in kit state) for projects with changed
.ts/.tsx files and reports errors. Each distinct error set is reported only once per session,
so pre-existing errors don't nag every turn. Python is left to commit-guard and gates, which
avoids racing the ruff Stop hook.

It never blocks twice in a row (it respects stop_hook_active). Fails closed on unparseable
input (blocks once, rate-limited).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import tempfile
import time
from collections.abc import Sequence
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "bin"))
import _kit
import gates

HOOK = "stop_guard"
STALL_AFTER = 2
TS_BUDGET_S = 15.0
MAX_TS_ERRORS = 15
FAIL_CLOSED_COOLDOWN_S = 120


def state_path(session: str) -> Path:
    safe = hashlib.sha256(session.encode()).hexdigest()[:24]
    path = _kit.STATE / "stop" / f"{safe}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def load_state(session: str) -> dict[str, Any]:
    try:
        data = json.loads(state_path(session).read_text())
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def loop_fingerprint(root: Path) -> str:
    h = hashlib.sha256(gates.fingerprint(root).encode())
    for name in ("PROGRESS.md",):
        path = root / name
        h.update(path.read_bytes() if path.is_file() else b"-")
    probe = _kit.evidence_dir(root) / "probe-latest.json"
    h.update(probe.read_bytes() if probe.is_file() else b"-")
    return h.hexdigest()


def stall_check(root: Path, payload: dict[str, Any], state: dict[str, Any]) -> str | None:
    crons = payload.get("session_crons") or []
    meta = _kit.read_ledger(root) or {}
    armed = bool(crons) or (
        meta.get("mode", "").lower() == "autonomous" and meta.get("status", "").lower() == "active"
    )
    fp = loop_fingerprint(root)
    previous = state.get("fingerprint")
    state["fingerprint"] = fp
    if not armed:
        state["stalls"] = 0
        return None
    if payload.get("stop_hook_active"):
        return None
    state["stalls"] = int(state.get("stalls", 0)) + 1 if fp == previous else 0
    if state["stalls"] < STALL_AFTER:
        return None
    state["stalls"] = 0
    head = gates.head_sha(root)[:10]
    cron_ids = ", ".join(str(c.get("id")) for c in crons if isinstance(c, dict)) or "none"
    return (
        f"stall-detect: {STALL_AFTER} consecutive loop iterations ended with no change "
        f"(HEAD {head}, working tree, PROGRESS.md and progress-probe evidence all unchanged). "
        f"Stop the loop now (ScheduleWakeup stop / CronDelete; scheduled: {cron_ids}), write a "
        "BLOCKER entry in PROGRESS.md (what was tried, why it isn't progressing, what is "
        "needed), then end the turn. If you are waiting on an external process, run "
        "progress-probe and report its output instead of claiming progress."
    )


def ts_check(root: Path, state: dict[str, Any]) -> str | None:
    changed = [root / f for f in _kit.changed_files(root) if f.endswith(_kit.TS_SUFFIXES)]
    configs = {
        cfg
        for f in changed
        if f.is_file() and "node_modules" not in f.parts
        for cfg in [_kit.find_tsconfig(f, root)]
        if cfg
    }
    if not configs:
        return None
    deadline = time.monotonic() + TS_BUDGET_S
    errors: list[_kit.TypeError_] = []
    for cfg in sorted(configs):
        remaining = deadline - time.monotonic()
        if remaining <= 1:
            break
        result = _kit.run_tsc(cfg, root, remaining)
        errors += result.errors
    if not errors:
        state["ts_reported"] = ""
        return None
    rendered = sorted({e.render(root) for e in errors})
    digest = hashlib.sha256("\n".join(rendered).encode()).hexdigest()
    if state.get("ts_reported") == digest:
        return None
    state["ts_reported"] = digest
    shown = rendered[:MAX_TS_ERRORS]
    more = len(rendered) - len(shown)
    return (
        f"tsc reports {len(rendered)} error(s) in project(s) with changed TypeScript files:\n  "
        + "\n  ".join(shown)
        + (f"\n  (+{more} more)" if more > 0 else "")
        + "\nFix them (or state they are pre-existing and UNVERIFIED) before finishing."
    )


def fail_closed(message: str) -> int:
    marker = Path(tempfile.gettempdir()) / f"stop-guard-failclosed-{os.getuid()}"
    try:
        if time.time() - marker.stat().st_mtime < FAIL_CLOSED_COOLDOWN_S:
            return 0
    except OSError:
        pass
    marker.touch()
    print(f"stop-guard: {message}; blocking once to fail closed.", file=sys.stderr)
    return 2


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
        return fail_closed(f"could not parse hook input ({exc})")
    root = _kit.repo_root(str(payload.get("cwd") or ""))
    if root is None:
        return 0
    session = str(payload.get("session_id") or "unknown")
    state = load_state(session)
    try:
        problems = [p for p in (stall_check(root, payload, state), None) if p]
        if not payload.get("stop_hook_active"):
            ts = ts_check(root, state)
            if ts:
                problems.append(ts)
    except Exception as exc:
        return fail_closed(f"internal error ({type(exc).__name__}: {exc})")
    finally:
        state_path(session).write_text(json.dumps(state))
    if not problems:
        return 0
    print("\n\n".join(problems), file=sys.stderr)
    _kit.log_decision(
        opts.log, HOOK, {"decision": "block", "repo": str(root), "reasons": len(problems)}
    )
    return 2


if __name__ == "__main__":
    sys.exit(main())
