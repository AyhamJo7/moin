#!/usr/bin/env python3
"""claim-check: Stop hook that blocks completion/progress claims without matching evidence.

Portable: a single stdlib-only file. Install at user level (~/.claude/kit/hooks/) or copy it,
together with gates.py, into a repository:
    .claude/hooks/claim_check.py   +   .claude/bin/gates.py   +   .claude/gates.json
    "Stop": [{"hooks": [{"type": "command",
               "command": "${CLAUDE_PROJECT_DIR}/.claude/hooks/claim_check.py"}]}]

When Claude's final message claims completion ("all gates green", "fixed", "complete",
"ready to merge", "ready for reconfirmation", ...) in a repo that has .claude/gates.json,
the latest `gates full` evidence must be PASS for the current code, with no skipped or
failed gates. Documentation-only edits don't invalidate it. Otherwise the stop is blocked
(exit 2) with the reason.

When the message claims ongoing progress ("running fine", "progressing", "on track") while
the repo is gate-configured OR the session has background tasks or scheduled wakeups, a
progress-probe record from the last 15 minutes showing PROGRESS is required.

Messages that explicitly say UNVERIFIED / BLOCKED / "not verified" are accepted as honest.
Loop-safe: at most 2 consecutive blocks per session, and it respects stop_hook_active.
Fails closed: unparseable input or an internal error blocks once (rate-limited to once per
2 minutes, so a broken hook can't trap a session).
Options: --skip-headless and --defer-to-repo (user-level install only), --log FILE,
--probe-max-age SECONDS.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from collections.abc import Sequence
from pathlib import Path
from typing import Any

EXIT_ALLOW, EXIT_BLOCK = 0, 2
MAX_CONSECUTIVE_BLOCKS = 2
FAIL_CLOSED_COOLDOWN_S = 120
DEFAULT_PROBE_MAX_AGE_S = 900
STATUS_TIMEOUT_S = 60

COMPLETION_PATTERNS = [
    r"\ball (?:of )?(?:the )?(?:\d+ )?(?:gates|checks|tests)\b[^.\n]{0,40}?\b(?:are |were )?"
    r"(?:green|pass(?:ed|ing)?)\b",
    r"\b(?:gates?|ci|checks?|build|test suite|tests?) (?:is |are )?(?:all )?green\b",
    r"\b(?:is|are|now|everything(?:'s| is)?)\s+(?:fully\s+)?"
    r"(?:complete|completed|done|finished|fixed|resolved)\b",
    r"\b(?:fully|successfully)\s+(?:implemented|fixed|verified|completed|closed|resolved)\b",
    r"\bready (?:to merge|to ship|for (?:merge|launch|release|production|reconfirmation|re-?review))\b",
    r"\b(?:closure|campaign|mission|task|work|implementation|fix) (?:is )?(?:complete|done)\b",
    r"\ball (?:\d+ )?(?:findings?|issues?|blockers?|items?|defects?) "
    r"(?:are |have been )?(?:closed|fixed|resolved|addressed)\b",
]
PROGRESS_PATTERNS = [
    r"\b(?:running|proceeding|working) (?:fine|smoothly|autonomously|as expected|well|normally)\b",
    r"\b(?:is|are) (?:progressing|making progress|on track)\b",
    r"\b(?:making|good|steady) progress\b",
]
EXEMPT_PATTERNS = [
    r"\bUNVERIFIED\b",
    r"\bBLOCKED\b",
    r"\bnot (?:yet )?(?:been )?verified\b",
    r"\bunable to verify\b",
]
CODE_BLOCK_RE = re.compile(r"```.*?```", re.S)
INLINE_CODE_RE = re.compile(r"`[^`\n]*`")


def first_match(patterns: Sequence[str], text: str, flags: int = re.I) -> str | None:
    for pat in patterns:
        m = re.search(pat, text, flags)
        if m:
            return m.group(0)
    return None


def prose(message: str) -> str:
    return INLINE_CODE_RE.sub(" ", CODE_BLOCK_RE.sub(" ", message))


def toplevel(start: str | None) -> Path | None:
    if not start or not Path(start).is_dir():
        return None
    proc = subprocess.run(
        ["git", "-C", start, "rev-parse", "--show-toplevel"],
        capture_output=True,
        text=True,
        check=False,
    )
    return Path(proc.stdout.strip()) if proc.returncode == 0 else None


def active_root(payload: dict[str, Any]) -> Path | None:
    """Use the worktree observed for this session, not the checkout housing this hook."""
    project = os.environ.get("CLAUDE_PROJECT_DIR")
    session = payload.get("session_id")
    if project and isinstance(session, str) and session:
        key = hashlib.sha256(session.encode()).hexdigest()[:24]
        path = Path(project) / ".claude" / "state" / "worktrees" / f"{key}.json"
        if path.exists():
            data = json.loads(path.read_text())
            candidate = Path(data["worktree"])
            expected = Path(data["common_dir"]).resolve()
            for checkout in (Path(project), candidate):
                proc = subprocess.run(
                    [
                        "git",
                        "-C",
                        str(checkout),
                        "rev-parse",
                        "--path-format=absolute",
                        "--git-common-dir",
                    ],
                    capture_output=True,
                    text=True,
                    check=False,
                )
                if proc.returncode != 0 or Path(proc.stdout.strip()).resolve() != expected:
                    raise RuntimeError("active session worktree is no longer valid")
            root = toplevel(str(candidate))
            if root is None or root.resolve() != candidate.resolve():
                raise RuntimeError("active session worktree was replaced")
            return root
    return toplevel(str(payload.get("cwd") or "")) or toplevel(project)


def evidence_dir(root: Path) -> Path:
    override = os.environ.get("GATES_EVIDENCE_DIR")
    if override:
        path = Path(override)
    else:
        git_dir = subprocess.run(
            ["git", "-C", str(root), "rev-parse", "--absolute-git-dir"],
            capture_output=True,
            text=True,
            check=True,
        ).stdout.strip()
        path = Path(git_dir) / "claude-evidence"
    path.mkdir(parents=True, exist_ok=True)
    return path


def gates_script() -> list[str] | None:
    candidates = [Path(__file__).resolve().parent.parent / "bin" / "gates.py"]
    project = os.environ.get("CLAUDE_PROJECT_DIR")
    if project:
        candidates.append(Path(project) / ".claude" / "bin" / "gates.py")
    for cand in candidates:
        if cand.is_file():
            return [sys.executable, str(cand)]
    found = shutil.which("gates")
    return [found] if found else None


def gates_command_hint() -> str:
    cmd = gates_script()
    return " ".join(cmd[1:] if cmd and cmd[0] == sys.executable else (cmd or ["gates"]))


def gate_status(root: Path) -> dict[str, Any]:
    cmd = gates_script()
    if cmd is None:
        raise RuntimeError("gates runner not found (expected ../bin/gates.py next to this hook)")
    proc = subprocess.run(
        [*cmd, "--repo", str(root), "status", "--json"],
        capture_output=True,
        text=True,
        timeout=STATUS_TIMEOUT_S,
        check=False,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"gates status failed: {proc.stderr.strip()[:300]}")
    data = json.loads(proc.stdout)
    if not isinstance(data, dict):
        raise RuntimeError("gates status returned non-object JSON")
    return data


def completion_problem(root: Path) -> str | None:
    status = gate_status(root)
    head = str(status.get("head", "?"))[:10]
    changed = len(status.get("changed_files", []))
    full = status.get("tiers", {}).get("full")
    where = f"HEAD {head}, {changed} changed file(s)"
    if not full:
        return f"no `gates full` evidence exists for this repo ({where})"
    if full.get("result") != "pass":
        return f"the latest `gates full` result is {str(full.get('result')).upper()} ({where})"
    if full.get("failed"):
        return f"the latest `gates full` has failed gates: {full['failed']}"
    if full.get("skipped"):
        return (
            f"the latest `gates full` skipped {full['skipped']}; those gates were NOT verified "
            f"(say so explicitly as UNVERIFIED)"
        )
    if not full.get("matches_code"):
        return (
            f"the latest passing `gates full` was for a different tree (evidence @ "
            f"{str(full.get('head'))[:10]}); the code changed since ({where})"
        )
    return None


def progress_problem(root: Path, max_age_s: float) -> str | None:
    path = evidence_dir(root) / "probe-latest.json"
    try:
        record = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        return "no progress signal was recorded (no progress-probe evidence)"
    try:
        age = time.time() - dt.datetime.fromisoformat(str(record.get("ts"))).timestamp()
    except ValueError:
        return "the progress-probe record has no valid timestamp"
    if age > max_age_s:
        return f"the latest progress-probe is {int(age // 60)} min old"
    if record.get("result") != "PROGRESS":
        return f"the latest progress-probe says {record.get('result')}"
    return None


# --------------------------------------------------------------------------- state / output


def state_file(root: Path) -> Path:
    return evidence_dir(root) / "claim-check-state.json"


def load_count(root: Path, session: str) -> int:
    try:
        data = json.loads(state_file(root).read_text())
        return int(data.get(session, 0)) if isinstance(data, dict) else 0
    except (OSError, ValueError):
        return 0


def save_count(root: Path, session: str, count: int) -> None:
    try:
        path = state_file(root)
        data = json.loads(path.read_text()) if path.exists() else {}
        if not isinstance(data, dict):
            data = {}
        data[session] = count
        path.write_text(json.dumps(dict(list(data.items())[-50:])))
    except (OSError, ValueError):
        pass


def log_decision(path: str | None, record: dict[str, object]) -> None:
    if not path:
        return
    try:
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        record = {
            "ts": dt.datetime.now(dt.UTC).isoformat(timespec="seconds"),
            "hook": "claim_check",
            **record,
        }
        with open(path, "a", encoding="utf-8") as fh:
            fh.write(json.dumps(record) + "\n")
    except OSError:
        pass


def fail_closed(message: str, log: str | None) -> int:
    marker = Path(tempfile.gettempdir()) / f"claim-check-failclosed-{os.getuid()}"
    try:
        if time.time() - marker.stat().st_mtime < FAIL_CLOSED_COOLDOWN_S:
            return EXIT_ALLOW
    except OSError:
        pass
    marker.touch()
    print(f"claim-check: {message}; blocking once to fail closed.", file=sys.stderr)
    log_decision(log, {"decision": "block", "reason": message[:300], "fail_closed": True})
    return EXIT_BLOCK


def deferred_to_repo(hook_path: Path) -> bool:
    """True when the session's project registers its own copy of this hook in
    .claude/settings.json, so the user-level copy stands down and exactly one copy runs.
    Any doubt (no project dir, unreadable settings, we ARE the repo copy) keeps this copy on."""
    project = os.environ.get("CLAUDE_PROJECT_DIR")
    if not project:
        return False
    repo_copy = Path(project) / ".claude" / "hooks" / hook_path.name
    try:
        if not repo_copy.is_file() or repo_copy.resolve() == hook_path.resolve():
            return False
        settings = json.loads((Path(project) / ".claude" / "settings.json").read_text())
    except (OSError, ValueError):
        return False
    hooks = settings.get("hooks") if isinstance(settings, dict) else None
    return f".claude/hooks/{hook_path.name}" in json.dumps(hooks)


def headless() -> bool:
    entry = os.environ.get("CLAUDE_CODE_ENTRYPOINT", "")
    return entry.startswith("sdk") and os.environ.get("CLAUDE_CODE_REMOTE") != "true"


def evaluate(payload: dict[str, Any], max_age_s: float) -> tuple[Path | None, str | None]:
    message = payload.get("last_assistant_message")
    if not isinstance(message, str) or not message.strip():
        return None, None
    text = prose(message)
    if first_match(EXEMPT_PATTERNS, text, flags=0):
        return None, None
    completion = first_match(COMPLETION_PATTERNS, text)
    progress = first_match(PROGRESS_PATTERNS, text)
    if not completion and not progress:
        return None, None
    root = active_root(payload)
    if root is None:
        return None, None
    configured = (root / ".claude" / "gates.json").is_file() or bool(os.environ.get("GATES_CONFIG"))
    background = bool(payload.get("background_tasks")) or bool(payload.get("session_crons"))
    problems: list[str] = []
    if completion and configured:
        problem = completion_problem(root)
        if problem:
            problems.append(
                f'the final message claims "{completion}", but {problem}. Run `{gates_command_hint()} '
                f"full` and report its result, or restate what was not verified as UNVERIFIED/BLOCKED."
            )
    if progress and (configured or background):
        problem = progress_problem(root, max_age_s)
        if problem:
            problems.append(
                f'the final message claims ongoing progress ("{progress}"), but {problem}. Show a '
                "progress signal from this turn (new commits, diff stat, log growth or "
                "`progress-probe` output), or say the state is unknown."
            )
    return root, " | ".join(problems) if problems else None


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--skip-headless", action="store_true")
    parser.add_argument("--log")
    parser.add_argument("--probe-max-age", type=float, default=DEFAULT_PROBE_MAX_AGE_S)
    parser.add_argument("--defer-to-repo", action="store_true")
    opts, _ = parser.parse_known_args(argv)
    if opts.defer_to_repo and deferred_to_repo(Path(__file__)):
        log_decision(
            opts.log,
            {"decision": "defer", "repo": os.environ.get("CLAUDE_PROJECT_DIR", "")},
        )
        return EXIT_ALLOW
    if opts.skip_headless and headless():
        log_decision(
            opts.log,
            {"decision": "skip", "entrypoint": os.environ.get("CLAUDE_CODE_ENTRYPOINT", "")},
        )
        return EXIT_ALLOW
    try:
        payload = json.loads(sys.stdin.read())
        if not isinstance(payload, dict):
            raise ValueError("not a JSON object")
    except ValueError as exc:
        return fail_closed(f"could not parse hook input ({exc})", opts.log)
    session = str(payload.get("session_id") or "unknown")
    try:
        root, problem = evaluate(payload, opts.probe_max_age)
    except Exception as exc:
        return fail_closed(f"internal error ({type(exc).__name__}: {exc})", opts.log)
    if root is None:
        return EXIT_ALLOW
    count = load_count(root, session)
    if problem is None or (payload.get("stop_hook_active") and count >= MAX_CONSECUTIVE_BLOCKS):
        save_count(root, session, 0)
        return EXIT_ALLOW
    save_count(root, session, count + 1)
    print(f"claim-check: {problem}", file=sys.stderr)
    log_decision(opts.log, {"decision": "block", "repo": str(root), "reason": problem[:400]})
    return EXIT_BLOCK


if __name__ == "__main__":
    sys.exit(main())
