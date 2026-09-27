"""Shared helpers for the kit-only hooks (commit_guard, ts_edit_check, stop_guard,
session_context, stopfailure_checkpoint). Portable hooks (git_guard, claim_check) do NOT
import this module.
"""

from __future__ import annotations

import contextlib
import datetime as dt
import fcntl
import hashlib
import json
import os
import re
import shutil
import signal
import subprocess
import time
from collections.abc import Iterator, Sequence
from dataclasses import dataclass
from pathlib import Path

STATE = Path(os.environ.get("CLAUDE_KIT_STATE", str(Path.home() / ".claude" / "kit" / "state")))
TSC_ERROR_RE = re.compile(
    r"^(?P<file>.+?)\((?P<line>\d+),(?P<col>\d+)\): error (?P<code>TS\d+): (?P<msg>.*)$"
)
MYPY_ERROR_RE = re.compile(r"^(?P<file>[^:\n]+\.pyi?):(?P<line>\d+):(?:\d+:)? error: (?P<msg>.*)$")
TS_SUFFIXES = (".ts", ".tsx", ".mts", ".cts")
SLOW_MARK_TTL_S = 12 * 3600
LOCK_WAIT_S = 3.0


def now_iso() -> str:
    return dt.datetime.now(dt.UTC).isoformat(timespec="seconds")


def headless() -> bool:
    entry = os.environ.get("CLAUDE_CODE_ENTRYPOINT", "")
    return entry.startswith("sdk") and os.environ.get("CLAUDE_CODE_REMOTE") != "true"


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


def log_decision(path: str | None, hook: str, record: dict[str, object]) -> None:
    if not path:
        return
    try:
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        record = {"ts": now_iso(), "hook": hook, **record}
        with open(path, "a", encoding="utf-8") as fh:
            fh.write(json.dumps(record) + "\n")
    except OSError:
        pass


def toplevel(start: Path) -> Path | None:
    if not start.is_dir():
        return None
    proc = subprocess.run(
        ["git", "-C", str(start), "rev-parse", "--show-toplevel"],
        capture_output=True,
        text=True,
        check=False,
    )
    return Path(proc.stdout.strip()) if proc.returncode == 0 else None


def repo_root(cwd: str | None) -> Path | None:
    for cand in (cwd, os.environ.get("CLAUDE_PROJECT_DIR")):
        if cand:
            top = toplevel(Path(cand))
            if top:
                return top
    return None


def git_lines(root: Path, *args: str) -> list[str]:
    proc = subprocess.run(
        ["git", "-C", str(root), *args], capture_output=True, text=True, check=False
    )
    sep = "\0" if "-z" in args else "\n"
    return [p for p in proc.stdout.split(sep) if p.strip()]


def git_dir(root: Path) -> Path:
    return Path(git_lines(root, "rev-parse", "--absolute-git-dir")[0])


def evidence_dir(root: Path) -> Path:
    override = os.environ.get("GATES_EVIDENCE_DIR")
    path = Path(override) if override else git_dir(root) / "claude-evidence"
    path.mkdir(parents=True, exist_ok=True)
    return path


def changed_files(root: Path) -> list[str]:
    head = git_lines(root, "rev-parse", "--verify", "--quiet", "HEAD")
    tracked = git_lines(root, "diff", "--name-only", "-z", head[0]) if head else []
    untracked = git_lines(root, "ls-files", "--others", "--exclude-standard", "-z")
    return sorted(set(tracked) | set(untracked))


def read_ledger(root: Path) -> dict[str, str] | None:
    """Front matter of <root>/PROGRESS.md (`key: value` lines between --- markers)."""
    path = root / "PROGRESS.md"
    try:
        text = path.read_text(errors="replace")
    except OSError:
        return None
    if not text.startswith("---"):
        return {}
    end = text.find("\n---", 3)
    if end < 0:
        return {}
    meta: dict[str, str] = {}
    for line in text[3:end].splitlines():
        key, sep, value = line.partition(":")
        if sep and key.strip():
            meta[key.strip().lower()] = value.strip()
    return meta


def ledger_log_tail(root: Path, lines: int = 4) -> list[str]:
    try:
        text = (root / "PROGRESS.md").read_text(errors="replace")
    except OSError:
        return []
    marker = text.rfind("\n## Log")
    if marker < 0:
        return []
    entries = [ln for ln in text[marker:].splitlines()[1:] if ln.strip().startswith("-")]
    return entries[-lines:]


# --------------------------------------------------------------------------- TypeScript


@dataclass
class TypeError_:
    file: Path
    line: int
    code: str
    message: str

    def render(self, root: Path | None = None) -> str:
        shown = self.file
        if root:
            with contextlib.suppress(ValueError):
                shown = self.file.relative_to(root)
        return f"{shown}:{self.line} {self.code} {self.message}"


@dataclass
class CheckResult:
    status: str  # ok | errors | timeout | unsupported | unavailable | locked | slow
    errors: list[TypeError_]
    detail: str = ""
    duration_s: float = 0.0


def walk_up(start: Path, name: str, stop: Path | None) -> Path | None:
    cur = start if start.is_dir() else start.parent
    while True:
        cand = cur / name
        if cand.exists():
            return cand
        if (stop is not None and cur == stop) or cur.parent == cur or cur == Path.home():
            return None
        cur = cur.parent


def find_tsconfig(file: Path, stop: Path | None) -> Path | None:
    return walk_up(file, "tsconfig.json", stop)


def find_tsc(tsconfig: Path, stop: Path | None) -> Path | None:
    cur = tsconfig.parent
    while True:
        cand = cur / "node_modules" / ".bin" / "tsc"
        if cand.exists():
            return cand
        if (stop is not None and cur == stop) or cur.parent == cur or cur == Path.home():
            return None
        cur = cur.parent


def has_references(tsconfig: Path) -> bool:
    try:
        return bool(re.search(r'"references"\s*:', tsconfig.read_text(errors="replace")))
    except OSError:
        return True


def _key(path: Path) -> str:
    return hashlib.sha256(str(path.resolve()).encode()).hexdigest()[:16]


def _slow_marks() -> dict[str, float]:
    try:
        data = json.loads((STATE / "tsc" / "slow.json").read_text())
        return {k: float(v) for k, v in data.items()} if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def _mark_slow(tsconfig: Path) -> None:
    marks = _slow_marks()
    marks[str(tsconfig.resolve())] = time.time()
    (STATE / "tsc").mkdir(parents=True, exist_ok=True)
    (STATE / "tsc" / "slow.json").write_text(json.dumps(marks))


def is_marked_slow(tsconfig: Path) -> bool:
    ts = _slow_marks().get(str(tsconfig.resolve()))
    return ts is not None and time.time() - ts < SLOW_MARK_TTL_S


@contextlib.contextmanager
def file_lock(path: Path, wait_s: float) -> Iterator[bool]:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a+") as fh:
        deadline = time.monotonic() + wait_s
        acquired = False
        while True:
            try:
                fcntl.flock(fh, fcntl.LOCK_EX | fcntl.LOCK_NB)
                acquired = True
                break
            except BlockingIOError:
                if time.monotonic() >= deadline:
                    break
                time.sleep(0.05)
        try:
            yield acquired
        finally:
            if acquired:
                fcntl.flock(fh, fcntl.LOCK_UN)


def run_group(cmd: Sequence[str], cwd: Path, timeout_s: float) -> tuple[int | None, str, float]:
    start = time.monotonic()
    proc = subprocess.Popen(
        list(cmd),
        cwd=cwd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        stdin=subprocess.DEVNULL,
        text=True,
        start_new_session=True,
    )
    try:
        out, _ = proc.communicate(timeout=max(0.1, timeout_s))
        code: int | None = proc.returncode
    except subprocess.TimeoutExpired:
        with contextlib.suppress(ProcessLookupError):
            os.killpg(proc.pid, signal.SIGKILL)
        out, _ = proc.communicate()
        code = None
    return code, out or "", round(time.monotonic() - start, 2)


def run_tsc(tsconfig: Path, stop: Path | None, timeout_s: float) -> CheckResult:
    if has_references(tsconfig):
        return CheckResult("unsupported", [], "composite project (references): left to gates")
    if is_marked_slow(tsconfig):
        return CheckResult("slow", [], "marked slow earlier: left to gates")
    tsc = find_tsc(tsconfig, stop)
    if tsc is None:
        return CheckResult("unavailable", [], "no node_modules/.bin/tsc found")
    key = _key(tsconfig)
    buildinfo = STATE / "tsc" / f"{key}.tsbuildinfo"
    with file_lock(STATE / "tsc" / f"{key}.lock", LOCK_WAIT_S) as acquired:
        if not acquired:
            return CheckResult("locked", [], "another check of this project is running")
        cmd = [
            str(tsc),
            "--noEmit",
            "-p",
            str(tsconfig),
            "--incremental",
            "--tsBuildInfoFile",
            str(buildinfo),
            "--pretty",
            "false",
        ]
        code, out, took = run_group(cmd, tsconfig.parent, timeout_s)
    if code is None:
        _mark_slow(tsconfig)
        return CheckResult("timeout", [], f"tsc exceeded {timeout_s:.0f}s", took)
    errors: list[TypeError_] = []
    for line in out.splitlines():
        m = TSC_ERROR_RE.match(line.strip())
        if m:
            path = Path(m["file"])
            path = path if path.is_absolute() else (tsconfig.parent / path)
            errors.append(TypeError_(path.resolve(), int(m["line"]), m["code"], m["msg"]))
    if code != 0 and not errors:
        config_err = next((ln for ln in out.splitlines() if "error TS" in ln), out.strip()[:200])
        return CheckResult("unsupported", [], f"tsc failed without file errors: {config_err}", took)
    return CheckResult("errors" if errors else "ok", errors, "", took)


# --------------------------------------------------------------------------- Python / mypy


def find_mypy_project(file: Path, stop: Path | None) -> Path | None:
    cur = file.parent
    while True:
        cand = cur / "pyproject.toml"
        if cand.is_file():
            try:
                if "[tool.mypy" in cand.read_text(errors="replace"):
                    return cur
            except OSError:
                pass
        if (stop is not None and cur == stop) or cur.parent == cur or cur == Path.home():
            return None
        cur = cur.parent


def mypy_command(project: Path, stop: Path | None) -> list[str] | None:
    for base in (project, stop):
        if base is not None and (base / ".venv" / "bin" / "mypy").exists():
            return [str(base / ".venv" / "bin" / "mypy")]
    text = (project / "pyproject.toml").read_text(errors="replace")
    if shutil.which("uv") and ("[project]" in text or "[tool.uv" in text):
        return ["uv", "run", "--offline", "--no-sync", "mypy"]
    return None


def run_mypy(
    project: Path, files: Sequence[Path], stop: Path | None, timeout_s: float
) -> CheckResult:
    cmd = mypy_command(project, stop)
    if cmd is None:
        return CheckResult("unavailable", [], "no mypy in .venv and not a uv project")
    rel = [str(f.relative_to(project)) for f in files]
    code, out, took = run_group(
        [*cmd, "--no-color-output", "--no-error-summary", *rel], project, timeout_s
    )
    if code is None:
        return CheckResult("timeout", [], f"mypy exceeded {timeout_s:.0f}s", took)
    errors = []
    for line in out.splitlines():
        m = MYPY_ERROR_RE.match(line.strip())
        if m:
            errors.append(
                TypeError_((project / m["file"]).resolve(), int(m["line"]), "mypy", m["msg"])
            )
    if code not in (0, 1) or (code == 1 and not errors):
        return CheckResult("unsupported", [], f"mypy exit {code}: {out.strip()[:200]}", took)
    return CheckResult("errors" if errors else "ok", errors, "", took)
