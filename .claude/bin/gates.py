#!/usr/bin/env python3
"""gates: run a repo's verification gates in order and record evidence.

Portable: a single stdlib-only file. It works from ~/.claude/kit/bin/ or when copied
into a repository's .claude/bin/. It never depends on ~/.claude paths.

Config: <repo>/.claude/gates.json (override with $GATES_CONFIG)
    {
      "needs": ["docker"],                         # preflight requirements for the repo
      "restore_generated": ["frontend/tsconfig.tsbuildinfo"],
      "gates": [
        {"name": "lint", "run": "make lint", "timeout": 600},
        {"name": "unit-jvm", "run": "mvn verify", "requires": ["mvn"]},
        ...
      ],
      "fast": ["lint", "typecheck"],
      "stress": {"run": "uv run pytest -q {targets}", "iterations": 20,
                 "default_targets": "tests/", "timeout": 900}
    }

Evidence: $(git rev-parse --absolute-git-dir)/claude-evidence/ (override: $GATES_EVIDENCE_DIR).
It lives inside .git, so it is never tracked and never shows up as an untracked file.

Subcommands:
    preflight            check needs/requires/disk/git state (exit 3 if a need is missing)
    fast | full          run the "fast" gates or every gate in order (full stops at first failure)
    run NAME...          run the named gates
    stress               run the stress command N times (--targets, --iterations)
    refs                 verify container image references in changed files resolve
    status               latest evidence per tier and whether it matches the current tree
    fingerprint          print the current tree fingerprints

Every gate runs in its own process group (setsid), with a timeout and a group kill, so no
orphaned children survive. Tracked files listed in "restore_generated" that a gate rewrites
are restored afterwards, but only if they were clean before the run.

Exit codes: 0 pass, 1 fail, 2 usage/config error, 3 preflight need missing,
            4 interrupted/incomplete, 5 another gates run holds the lock.
"""

from __future__ import annotations

import argparse
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
import sys
import time
import urllib.error
import urllib.request
from collections.abc import Iterator, Sequence
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

SCHEMA_VERSION = 1
EVIDENCE_DIRNAME = "claude-evidence"
CONFIG_RELPATH = Path(".claude") / "gates.json"
EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"
DEFAULT_GATE_TIMEOUT_S = 1800
KILL_GRACE_S = 10
STRAGGLER_GRACE_S = 5
TAIL_LINES = 30
TAIL_BYTES = 64 * 1024
KEEP_RUNS = 30
STRESS_DEFAULT_ITERATIONS = 20
MIN_FREE_BYTES = 5 * 1024**3
UNTRACKED_HASH_LIMIT = 8 * 1024**2
DOCKER_PROBE_TIMEOUT_S = 8
MANIFEST_TIMEOUT_S = 20
DOC_SUFFIXES = (".md", ".mdx", ".rst", ".txt", ".adoc")
DOC_PREFIXES = ("docs/",)
TIERS = ("full", "fast", "stress", "refs")

EXIT_PASS, EXIT_FAIL, EXIT_USAGE, EXIT_PREFLIGHT, EXIT_INCOMPLETE, EXIT_LOCKED = 0, 1, 2, 3, 4, 5


class GatesError(Exception):
    """Configuration or usage error (exit 2)."""


class Interrupted(Exception):
    """The runner received SIGINT/SIGTERM/SIGHUP."""


# --------------------------------------------------------------------------- git helpers


def git(root: Path, *args: str, check: bool = True) -> str:
    proc = subprocess.run(
        ["git", "-C", str(root), *args], capture_output=True, text=True, check=False
    )
    if check and proc.returncode != 0:
        raise GatesError(f"git {' '.join(args)} failed: {proc.stderr.strip()}")
    return proc.stdout


def git_bytes(root: Path, *args: str) -> bytes:
    proc = subprocess.run(["git", "-C", str(root), *args], capture_output=True, check=False)
    return proc.stdout


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


def resolve_repo(explicit: str | None) -> Path:
    candidates = [explicit] if explicit else [os.getcwd(), os.environ.get("CLAUDE_PROJECT_DIR")]
    for cand in candidates:
        if cand:
            top = toplevel(Path(cand))
            if top:
                return top
    raise GatesError("not inside a git repository (use --repo DIR)")


def head_sha(root: Path) -> str:
    out = git(root, "rev-parse", "--verify", "--quiet", "HEAD", check=False).strip()
    return out or "UNBORN"


def branch_name(root: Path) -> str:
    return git(root, "rev-parse", "--abbrev-ref", "HEAD", check=False).strip() or "?"


def is_doc(path: str) -> bool:
    return path.endswith(DOC_SUFFIXES) or path.startswith(DOC_PREFIXES)


def changed_paths(root: Path) -> list[str]:
    """Tracked changes vs HEAD plus untracked (non-ignored) files, repo-relative."""
    base = head_sha(root)
    tracked = git(root, "diff", "--name-only", "-z", base if base != "UNBORN" else EMPTY_TREE)
    untracked = git(root, "ls-files", "--others", "--exclude-standard", "-z")
    paths = {p for p in (tracked + untracked).split("\0") if p}
    return sorted(paths)


def untracked_files(root: Path) -> set[str]:
    listing = git(root, "ls-files", "--others", "--exclude-standard", "-z")
    return {p for p in listing.split("\0") if p}


def fingerprint(
    root: Path, *, exclude_docs: bool = False, exclude: frozenset[str] = frozenset()
) -> str:
    """Hash of HEAD + all tracked changes + untracked file contents.

    With exclude_docs=True, documentation files are ignored ("code fingerprint"), so a README
    edit does not invalidate gate evidence.
    """
    base = head_sha(root)
    h = hashlib.sha256()
    h.update(base.encode())
    diff_base = base if base != "UNBORN" else EMPTY_TREE
    pathspec: list[str] = []
    if exclude_docs:
        pathspec = ["--", "."]
        pathspec += [f":(exclude,glob)**/*{suffix}" for suffix in DOC_SUFFIXES]
        pathspec += [f":(exclude){prefix.rstrip('/')}" for prefix in DOC_PREFIXES]
    h.update(b"\0diff\0")
    h.update(
        git_bytes(root, "diff", diff_base, "--binary", "--no-color", "--no-ext-diff", *pathspec)
    )
    h.update(b"\0untracked\0")
    listing = git(root, "ls-files", "--others", "--exclude-standard", "-z")
    for rel in sorted(p for p in listing.split("\0") if p):
        if (exclude_docs and is_doc(rel)) or rel in exclude:
            continue
        path = root / rel
        h.update(rel.encode() + b"\0")
        try:
            st = path.stat()
            if st.st_size > UNTRACKED_HASH_LIMIT:
                h.update(f"{st.st_size}:{st.st_mtime_ns}".encode())
            else:
                h.update(hashlib.sha256(path.read_bytes()).digest())
        except OSError:
            h.update(b"<unreadable>")
    return h.hexdigest()


def evidence_dir(root: Path) -> Path:
    override = os.environ.get("GATES_EVIDENCE_DIR")
    if override:
        path = Path(override)
    else:
        git_dir = Path(git(root, "rev-parse", "--absolute-git-dir").strip())
        path = git_dir / EVIDENCE_DIRNAME
    (path / "logs").mkdir(parents=True, exist_ok=True)
    return path


def utc_stamp() -> str:
    return dt.datetime.now(dt.UTC).strftime("%Y%m%dT%H%M%SZ")


def utc_iso() -> str:
    return dt.datetime.now(dt.UTC).isoformat(timespec="seconds")


# --------------------------------------------------------------------------- config


def config_path(root: Path) -> Path | None:
    override = os.environ.get("GATES_CONFIG")
    if override:
        return Path(override)
    local = root / CONFIG_RELPATH
    if local.is_file():
        return local
    project = os.environ.get("CLAUDE_PROJECT_DIR")
    if project:
        candidate = Path(project) / CONFIG_RELPATH
        if candidate.is_file() and toplevel(Path(project)) == root:
            return candidate
    return None


def load_config(root: Path) -> dict[str, Any]:
    path = config_path(root)
    if path is None or not path.is_file():
        raise GatesError(f"no gates config: expected {root / CONFIG_RELPATH}")
    try:
        cfg = json.loads(path.read_text())
    except json.JSONDecodeError as exc:
        raise GatesError(f"{path}: invalid JSON: {exc}") from exc
    if not isinstance(cfg, dict):
        raise GatesError(f"{path}: top level must be an object")
    gates = cfg.get("gates")
    if not isinstance(gates, list) or not gates:
        raise GatesError(f"{path}: 'gates' must be a non-empty list")
    names: set[str] = set()
    for gate in gates:
        if not isinstance(gate, dict) or not isinstance(gate.get("name"), str):
            raise GatesError(f"{path}: every gate needs a string 'name'")
        if not isinstance(gate.get("run"), str) or not gate["run"].strip():
            raise GatesError(f"{path}: gate {gate['name']!r} needs a non-empty 'run'")
        if gate["name"] in names:
            raise GatesError(f"{path}: duplicate gate name {gate['name']!r}")
        names.add(gate["name"])
    for name in cfg.get("fast", []):
        if name not in names:
            raise GatesError(f"{path}: 'fast' references unknown gate {name!r}")
    cfg["_path"] = str(path)
    return cfg


# --------------------------------------------------------------------------- processes


def _group_alive(pgid: int) -> bool:
    try:
        os.killpg(pgid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def kill_group(pgid: int, grace_s: float) -> bool:
    """SIGTERM the process group, wait, SIGKILL leftovers. Returns True if anything was alive."""
    if not _group_alive(pgid):
        return False
    with contextlib.suppress(ProcessLookupError):
        os.killpg(pgid, signal.SIGTERM)
    deadline = time.monotonic() + grace_s
    while time.monotonic() < deadline and _group_alive(pgid):
        time.sleep(0.1)
    if _group_alive(pgid):
        with contextlib.suppress(ProcessLookupError):
            os.killpg(pgid, signal.SIGKILL)
    return True


@dataclass
class CommandOutcome:
    exit_code: int | None
    duration_s: float
    timed_out: bool
    stragglers_killed: bool


_CURRENT_PGID: list[int] = []


def run_in_group(
    cmd: str, cwd: Path, log_path: Path, timeout_s: float, env: dict[str, str]
) -> CommandOutcome:
    start = time.monotonic()
    with log_path.open("wb") as log:
        proc = subprocess.Popen(
            ["bash", "-c", cmd],
            cwd=cwd,
            stdout=log,
            stderr=subprocess.STDOUT,
            stdin=subprocess.DEVNULL,
            start_new_session=True,
            env=env,
        )
        _CURRENT_PGID.append(proc.pid)
        timed_out = False
        try:
            exit_code: int | None = proc.wait(timeout=timeout_s)
        except subprocess.TimeoutExpired:
            timed_out = True
            kill_group(proc.pid, KILL_GRACE_S)
            proc.wait()
            exit_code = None
        finally:
            _CURRENT_PGID.pop()
        stragglers = kill_group(proc.pid, STRAGGLER_GRACE_S)
    return CommandOutcome(exit_code, round(time.monotonic() - start, 2), timed_out, stragglers)


def tail(path: Path, lines: int = TAIL_LINES) -> str:
    try:
        with path.open("rb") as fh:
            fh.seek(0, os.SEEK_END)
            size = fh.tell()
            fh.seek(max(0, size - TAIL_BYTES))
            data = fh.read().decode("utf-8", errors="replace")
    except OSError:
        return ""
    return "\n".join(data.splitlines()[-lines:])


def docker_available() -> bool:
    if not shutil.which("docker"):
        return False
    try:
        proc = subprocess.run(
            ["docker", "version", "--format", "{{.Server.Version}}"],
            capture_output=True,
            text=True,
            timeout=DOCKER_PROBE_TIMEOUT_S,
            check=False,
        )
    except subprocess.TimeoutExpired:
        return False
    return proc.returncode == 0 and bool(proc.stdout.strip())


def tool_available(tool: str) -> bool:
    return docker_available() if tool == "docker" else shutil.which(tool) is not None


DOCKER_HINT = (
    "Docker is not reachable. On WSL2: start Docker Desktop and enable Settings > Resources > "
    "WSL integration for this distro (check: `docker version` shows a Server section)."
)


# --------------------------------------------------------------------------- evidence


@dataclass
class GateResult:
    name: str
    cmd: str
    status: str  # pass | fail | timeout | skipped
    exit_code: int | None = None
    duration_s: float = 0.0
    log: str | None = None
    reason: str = ""
    stragglers_killed: bool = False


@dataclass
class RunRecord:
    tier: str
    repo: str
    head: str
    branch: str
    started: str
    fingerprint_before: str
    code_fingerprint_before: str
    config: str
    schema: int = SCHEMA_VERSION
    tool: str = "gates"
    finished: str = ""
    fingerprint_after: str = ""
    code_fingerprint_after: str = ""
    result: str = "incomplete"  # pass | fail | incomplete
    gates: list[GateResult] = field(default_factory=list)
    restored: list[str] = field(default_factory=list)
    artifacts: list[str] = field(default_factory=list)  # untracked files created by the run
    untracked_before: list[str] = field(default_factory=list)
    stress: dict[str, Any] | None = None
    refs: list[dict[str, str]] | None = None


def write_evidence(ev_dir: Path, stamp: str, record: RunRecord) -> Path:
    data = json.dumps(asdict(record), indent=2)
    target = ev_dir / f"{stamp}-{record.tier}.json"
    for path in (target, ev_dir / f"latest-{record.tier}.json"):
        tmp = path.with_suffix(".tmp")
        tmp.write_text(data)
        os.replace(tmp, path)
    prune(ev_dir)
    return target


def prune(ev_dir: Path) -> None:
    runs = sorted(p for p in ev_dir.glob("2*-*.json") if not p.name.startswith("latest-"))
    for old in runs[:-KEEP_RUNS]:
        prefix = old.name.split("-", 1)[0]
        old.unlink(missing_ok=True)
        for log in (ev_dir / "logs").glob(f"{prefix}-*"):
            log.unlink(missing_ok=True)


@contextlib.contextmanager
def run_lock(ev_dir: Path) -> Iterator[None]:
    lock_path = ev_dir / "gates.lock"
    with lock_path.open("a+") as fh:
        try:
            fcntl.flock(fh, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise LockedError(f"another gates run holds {lock_path}") from exc
        try:
            yield
        finally:
            fcntl.flock(fh, fcntl.LOCK_UN)


class LockedError(Exception):
    """Another gates run is active in this repository."""


def _on_signal(signum: int, _frame: object) -> None:
    for pgid in list(_CURRENT_PGID):
        kill_group(pgid, 2)
    raise Interrupted(f"signal {signum}")


def install_signal_handlers() -> None:
    for sig in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
        signal.signal(sig, _on_signal)


# --------------------------------------------------------------------------- generated files


def clean_generated(root: Path, paths: Sequence[str]) -> list[str]:
    clean: list[str] = []
    for rel in paths:
        tracked = git(root, "ls-files", "--error-unmatch", "--", rel, check=False).strip()
        if not tracked:
            continue
        unchanged = (
            subprocess.run(
                ["git", "-C", str(root), "diff", "--quiet", "HEAD", "--", rel], check=False
            ).returncode
            == 0
        )
        if unchanged:
            clean.append(rel)
    return clean


def restore_generated(root: Path, clean_before: Sequence[str]) -> list[str]:
    restored: list[str] = []
    for rel in clean_before:
        changed = (
            subprocess.run(
                ["git", "-C", str(root), "diff", "--quiet", "HEAD", "--", rel], check=False
            ).returncode
            != 0
        )
        if changed:
            content = git_bytes(root, "cat-file", "--filters", f"HEAD:{rel}")
            (root / rel).write_bytes(content)
            restored.append(rel)
    return restored


# --------------------------------------------------------------------------- running tiers


def select_gates(cfg: dict[str, Any], tier: str, names: Sequence[str]) -> list[dict[str, Any]]:
    gates: list[dict[str, Any]] = cfg["gates"]
    if tier == "full":
        return gates
    if tier == "fast":
        wanted = cfg.get("fast") or [g["name"] for g in gates if g["name"] in ("lint", "typecheck")]
    else:
        wanted = list(names)
    by_name = {g["name"]: g for g in gates}
    missing = [n for n in wanted if n not in by_name]
    if missing:
        raise GatesError(f"unknown gate(s): {', '.join(missing)}")
    return [by_name[n] for n in wanted]


def new_record(root: Path, tier: str, cfg: dict[str, Any]) -> RunRecord:
    return RunRecord(
        tier=tier,
        repo=str(root),
        head=head_sha(root),
        branch=branch_name(root),
        started=utc_iso(),
        fingerprint_before=fingerprint(root),
        code_fingerprint_before=fingerprint(root, exclude_docs=True),
        config=str(cfg.get("_path", "")),
        untracked_before=sorted(untracked_files(root)),
    )


def finish_record(root: Path, record: RunRecord, clean_before: Sequence[str]) -> None:
    record.restored = restore_generated(root, clean_before)
    record.artifacts = sorted(untracked_files(root) - set(record.untracked_before))
    skip = frozenset(record.artifacts)
    record.fingerprint_after = fingerprint(root, exclude=skip)
    record.code_fingerprint_after = fingerprint(root, exclude_docs=True, exclude=skip)
    record.finished = utc_iso()


def gate_env(tier: str, name: str) -> dict[str, str]:
    env = dict(os.environ)
    env["GATES_TIER"] = tier
    env["GATES_GATE"] = name
    return env


def print_gate(res: GateResult) -> None:
    label = {"pass": "PASS", "fail": "FAIL", "timeout": "TIMEOUT", "skipped": "SKIP"}[res.status]
    extra = f"exit={res.exit_code} " if res.status == "fail" else ""
    note = f"  ({res.reason})" if res.reason else ""
    print(f"  {label:<7} {res.name:<16} {res.duration_s:7.1f}s {extra}{note}", flush=True)
    if res.status in ("fail", "timeout") and res.log:
        print(f"          log: {res.log}")
        for line in tail(Path(res.log)).splitlines():
            print(f"          | {line}")


def run_tier(root: Path, tier: str, names: Sequence[str], keep_going: bool) -> int:
    cfg = load_config(root)
    gates = select_gates(cfg, tier, names)
    ev_dir = evidence_dir(root)
    stamp = utc_stamp()
    with run_lock(ev_dir):
        record = new_record(root, tier if tier in TIERS else "run", cfg)
        clean_before = clean_generated(root, cfg.get("restore_generated", []))
        changed = len(changed_paths(root))
        print(f"gates {tier} @ {record.head[:10]} on {record.branch} ({changed} changed files)")
        failed = False
        try:
            for gate in gates:
                missing = [t for t in gate.get("requires", []) if not tool_available(t)]
                if missing:
                    res = GateResult(
                        gate["name"],
                        gate["run"],
                        "skipped",
                        reason=f"UNVERIFIED: missing {', '.join(missing)}",
                    )
                elif failed and not keep_going:
                    res = GateResult(
                        gate["name"], gate["run"], "skipped", reason="not run: earlier failure"
                    )
                else:
                    log_path = ev_dir / "logs" / f"{stamp}-{tier}-{gate['name']}.log"
                    outcome = run_in_group(
                        gate["run"],
                        root,
                        log_path,
                        float(gate.get("timeout", DEFAULT_GATE_TIMEOUT_S)),
                        gate_env(tier, gate["name"]),
                    )
                    status = (
                        "timeout"
                        if outcome.timed_out
                        else ("pass" if outcome.exit_code == 0 else "fail")
                    )
                    res = GateResult(
                        gate["name"],
                        gate["run"],
                        status,
                        outcome.exit_code,
                        outcome.duration_s,
                        str(log_path),
                        stragglers_killed=outcome.stragglers_killed,
                    )
                    if outcome.stragglers_killed:
                        res.reason = "killed leftover processes in the gate's group"
                    failed = failed or status != "pass"
                record.gates.append(res)
                print_gate(res)
            record.result = "fail" if failed else "pass"
        except Interrupted:
            record.result = "incomplete"
        finally:
            finish_record(root, record, clean_before)
            path = write_evidence(ev_dir, stamp, record)
        return summarize(record, path)


def summarize(record: RunRecord, path: Path) -> int:
    skipped = [g.name for g in record.gates if g.status == "skipped"]
    passed = sum(1 for g in record.gates if g.status == "pass")
    changed_during = record.fingerprint_after != record.fingerprint_before
    if record.stress:
        runs, fails = record.stress["iterations_run"], record.stress["failures"]
        print(f"RESULT: {record.result.upper()} ({runs - fails}/{runs} iterations passed)")
    else:
        print(f"RESULT: {record.result.upper()} ({passed}/{len(record.gates)} passed)")
    if skipped:
        print(f"  skipped (not verified): {', '.join(skipped)}")
    if record.restored:
        print(f"  restored generated files: {', '.join(record.restored)}")
    if record.artifacts:
        shown = ", ".join(record.artifacts[:5]) + (" ..." if len(record.artifacts) > 5 else "")
        print(f"  untracked artifacts created by the run (not part of the tested tree): {shown}")
        print("  consider adding them to .gitignore")
    if changed_during:
        print("  WARNING: the working tree changed during the run; this evidence won't match HEAD.")
    print(f"  evidence: {path}")
    if record.result == "incomplete":
        return EXIT_INCOMPLETE
    return EXIT_PASS if record.result == "pass" else EXIT_FAIL


def run_stress(root: Path, targets: str | None, iterations: int | None) -> int:
    cfg = load_config(root)
    stress = cfg.get("stress")
    if not isinstance(stress, dict) or not isinstance(stress.get("run"), str):
        raise GatesError("no 'stress' section with a 'run' command in gates.json")
    n = iterations or int(stress.get("iterations", STRESS_DEFAULT_ITERATIONS))
    tgt = targets if targets is not None else str(stress.get("default_targets", ""))
    cmd = stress["run"].replace("{targets}", tgt)
    timeout_s = float(stress.get("timeout", DEFAULT_GATE_TIMEOUT_S))
    ev_dir = evidence_dir(root)
    stamp = utc_stamp()
    with run_lock(ev_dir):
        record = new_record(root, "stress", cfg)
        clean_before = clean_generated(root, cfg.get("restore_generated", []))
        print(f"gates stress x{n} @ {record.head[:10]}: {cmd}")
        runs: list[dict[str, Any]] = []
        try:
            for i in range(1, n + 1):
                log_path = ev_dir / "logs" / f"{stamp}-stress-{i:03d}.log"
                outcome = run_in_group(cmd, root, log_path, timeout_s, gate_env("stress", str(i)))
                ok = outcome.exit_code == 0 and not outcome.timed_out
                runs.append(
                    {
                        "iteration": i,
                        "exit_code": outcome.exit_code,
                        "timed_out": outcome.timed_out,
                        "duration_s": outcome.duration_s,
                        "log": str(log_path) if not ok else None,
                    }
                )
                if ok:
                    log_path.unlink(missing_ok=True)
                mark = "ok" if ok else ("TIMEOUT" if outcome.timed_out else "FAIL")
                print(f"  [{i:>3}/{n}] {mark:<7} {outcome.duration_s:7.1f}s", flush=True)
        except Interrupted:
            record.result = "incomplete"
        else:
            failures = [r for r in runs if r["log"]]
            record.result = "pass" if not failures and len(runs) == n else "fail"
        finally:
            failures = [r for r in runs if r["log"]]
            record.stress = {
                "command": cmd,
                "targets": tgt,
                "iterations_requested": n,
                "iterations_run": len(runs),
                "failures": len(failures),
                "flake_rate": round(len(failures) / len(runs), 4) if runs else None,
                "runs": runs,
            }
            finish_record(root, record, clean_before)
            path = write_evidence(ev_dir, stamp, record)
        print(f"  failures: {len(failures)}/{len(runs)}")
        for r in failures[:2]:
            print(f"  first failing log: {r['log']}")
            for line in tail(Path(r["log"])).splitlines():
                print(f"          | {line}")
        return summarize(record, path)


# --------------------------------------------------------------------------- refs


DOCKERFILE_RE = re.compile(r"^(Dockerfile|Containerfile)(\..*)?$|\.dockerfile$")
COMPOSE_RE = re.compile(r"^(docker-)?compose(\.[\w-]+)?\.ya?ml$")
FROM_RE = re.compile(r"^\s*FROM\s+(?:--platform=\S+\s+)?(\S+)(?:\s+AS\s+(\S+))?", re.I)
IMAGE_RE = re.compile(r"^\s*-?\s*image:\s*[\"']?([^\"'\s#]+)", re.M)
USES_DOCKER_RE = re.compile(r"uses:\s*[\"']?docker://([^\"'\s#]+)")
VAR_DEFAULT_RE = re.compile(r"\$\{[A-Za-z_][A-Za-z0-9_]*:?-([^}]*)\}")
MANIFEST_ACCEPT = ", ".join(
    [
        "application/vnd.oci.image.index.v1+json",
        "application/vnd.docker.distribution.manifest.list.v2+json",
        "application/vnd.docker.distribution.manifest.v2+json",
        "application/vnd.oci.image.manifest.v1+json",
    ]
)


def refs_in_file(rel: str, text: str) -> list[str]:
    name = Path(rel).name
    found: list[str] = []
    if DOCKERFILE_RE.search(name):
        stages: set[str] = set()
        for line in text.splitlines():
            m = FROM_RE.match(line)
            if not m:
                continue
            image, alias = m.group(1), m.group(2)
            if image.lower() != "scratch" and image not in stages:
                found.append(image)
            if alias:
                stages.add(alias)
    elif COMPOSE_RE.match(name) or (
        rel.startswith(".github/workflows/") and rel.endswith((".yml", ".yaml"))
    ):
        found += IMAGE_RE.findall(text)
        found += USES_DOCKER_RE.findall(text)
    return found


def expand_vars(ref: str) -> str | None:
    expanded = VAR_DEFAULT_RE.sub(lambda m: m.group(1), ref)
    return None if "$" in expanded else expanded


def parse_image_ref(ref: str) -> tuple[str, str, str]:
    name, _, digest = ref.partition("@")
    slash, colon = name.rfind("/"), name.rfind(":")
    repo_part, tag = (name[:colon], name[colon + 1 :]) if colon > slash else (name, "latest")
    first = repo_part.split("/", 1)[0]
    if "/" in repo_part and ("." in first or ":" in first or first == "localhost"):
        registry, repo = first, repo_part.split("/", 1)[1]
    else:
        registry, repo = "docker.io", repo_part
    if registry in ("docker.io", "index.docker.io") and "/" not in repo:
        repo = f"library/{repo}"
    return registry, repo, digest or tag


REGISTRIES: dict[str, tuple[str | None, str]] = {
    "docker.io": (
        "https://auth.docker.io/token?service=registry.docker.io&scope=repository:{repo}:pull",
        "https://registry-1.docker.io/v2/{repo}/manifests/{ref}",
    ),
    "index.docker.io": (
        "https://auth.docker.io/token?service=registry.docker.io&scope=repository:{repo}:pull",
        "https://registry-1.docker.io/v2/{repo}/manifests/{ref}",
    ),
    "ghcr.io": (
        "https://ghcr.io/token?scope=repository:{repo}:pull",
        "https://ghcr.io/v2/{repo}/manifests/{ref}",
    ),
    "quay.io": (None, "https://quay.io/v2/{repo}/manifests/{ref}"),
}


def resolve_via_registry(ref: str) -> tuple[str, str]:
    registry, repo, reference = parse_image_ref(ref)
    if registry not in REGISTRIES:
        return "UNVERIFIED", f"registry {registry} not supported without docker"
    token_url, manifest_url = REGISTRIES[registry]
    headers = {"Accept": MANIFEST_ACCEPT}
    try:
        if token_url:
            with urllib.request.urlopen(  # noqa: S310 - fixed https registry URLs
                token_url.format(repo=repo), timeout=MANIFEST_TIMEOUT_S
            ) as resp:
                token = json.loads(resp.read()).get("token", "")
            headers["Authorization"] = f"Bearer {token}"
        req = urllib.request.Request(  # noqa: S310
            manifest_url.format(repo=repo, ref=reference), headers=headers, method="HEAD"
        )
        with urllib.request.urlopen(req, timeout=MANIFEST_TIMEOUT_S):  # noqa: S310
            return "EXISTS", f"{registry} manifest found"
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            return "MISSING", f"{registry} returned 404 for {repo}:{reference}"
        return "UNVERIFIED", f"{registry} returned HTTP {exc.code}"
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        return "UNVERIFIED", f"network error: {exc}"


def resolve_ref(ref: str, use_docker: bool) -> tuple[str, str]:
    expanded = expand_vars(ref)
    if expanded is None:
        return "UNVERIFIED", "contains an unresolved variable"
    if use_docker:
        try:
            proc = subprocess.run(
                ["docker", "manifest", "inspect", expanded],
                capture_output=True,
                text=True,
                timeout=MANIFEST_TIMEOUT_S,
                check=False,
            )
        except subprocess.TimeoutExpired:
            return "UNVERIFIED", "docker manifest inspect timed out"
        if proc.returncode == 0:
            return "EXISTS", "docker manifest inspect ok"
        err = (proc.stderr or proc.stdout).lower()
        if "no such manifest" in err or "not found" in err or "manifest unknown" in err:
            return "MISSING", (proc.stderr or proc.stdout).strip()[:200]
        return "UNVERIFIED", (proc.stderr or proc.stdout).strip()[:200]
    return resolve_via_registry(expanded)


def merge_base(root: Path, base: str | None) -> str:
    candidates = [base] if base else ["origin/HEAD", "origin/main", "origin/master", "main"]
    for cand in candidates:
        if cand and git(root, "rev-parse", "--verify", "--quiet", cand, check=False).strip():
            mb = git(root, "merge-base", "HEAD", cand, check=False).strip()
            if mb:
                return mb
    return head_sha(root)


def run_refs(root: Path, base: str | None, explicit: Sequence[str], as_json: bool) -> int:
    refs: list[tuple[str, str]] = []
    if explicit:
        refs = [("(explicit)", r) for r in explicit]
    else:
        mb = merge_base(root, base)
        tracked = git(root, "diff", "--name-only", "-z", mb).split("\0")
        untracked = git(root, "ls-files", "--others", "--exclude-standard", "-z").split("\0")
        for rel in sorted({p for p in tracked + untracked if p}):
            path = root / rel
            if path.is_file():
                for ref in refs_in_file(rel, path.read_text(errors="replace")):
                    refs.append((rel, ref))
    use_docker = docker_available()
    results = []
    for source, ref in dict.fromkeys(refs):
        status, detail = resolve_ref(ref, use_docker)
        results.append({"source": source, "ref": ref, "status": status, "detail": detail})
    missing = [r for r in results if r["status"] == "MISSING"]
    record = new_record(root, "refs", {"_path": ""})
    record.refs = results
    record.result = "fail" if missing else "pass"
    record.finished = utc_iso()
    record.fingerprint_after = record.fingerprint_before
    record.code_fingerprint_after = record.code_fingerprint_before
    path = write_evidence(evidence_dir(root), utc_stamp(), record)
    if as_json:
        print(json.dumps({"result": record.result, "refs": results, "evidence": str(path)}))
    else:
        via = "docker" if use_docker else "registry API"
        print(f"gates refs ({len(results)} image references, resolved via {via})")
        for r in results:
            print(f"  {r['status']:<10} {r['ref']}  [{r['source']}]  {r['detail']}")
        print(f"RESULT: {record.result.upper()}  evidence: {path}")
    return EXIT_FAIL if missing else EXIT_PASS


# --------------------------------------------------------------------------- status / preflight


def read_latest(ev_dir: Path, tier: str) -> dict[str, Any] | None:
    path = ev_dir / f"latest-{tier}.json"
    try:
        data = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        return None
    return data if isinstance(data, dict) else None


def status_data(root: Path) -> dict[str, Any]:
    ev_dir = evidence_dir(root)
    now = time.time()
    tiers: dict[str, Any] = {}
    for tier in TIERS:
        ev = read_latest(ev_dir, tier)
        if not ev:
            continue
        skip = frozenset(ev.get("artifacts") or [])
        fp = fingerprint(root, exclude=skip)
        code_fp = fingerprint(root, exclude_docs=True, exclude=skip)
        stable = ev.get("fingerprint_after") == ev.get("fingerprint_before")
        code_stable = ev.get("code_fingerprint_after") == ev.get("code_fingerprint_before")
        finished = ev.get("finished") or ev.get("started") or ""
        try:
            age = now - dt.datetime.fromisoformat(finished).timestamp()
        except ValueError:
            age = None
        tiers[tier] = {
            "result": ev.get("result"),
            "head": ev.get("head"),
            "finished": finished,
            "age_s": round(age) if age is not None else None,
            "matches_tree": stable and ev.get("fingerprint_before") == fp,
            "matches_code": code_stable and ev.get("code_fingerprint_before") == code_fp,
            "skipped": [g["name"] for g in ev.get("gates", []) if g.get("status") == "skipped"],
            "failed": [
                g["name"] for g in ev.get("gates", []) if g.get("status") in ("fail", "timeout")
            ],
            "stress": {
                k: (ev.get("stress") or {}).get(k)
                for k in ("iterations_run", "failures", "flake_rate")
            }
            if ev.get("stress")
            else None,
        }
    return {
        "repo": str(root),
        "head": head_sha(root),
        "branch": branch_name(root),
        "fingerprint": fingerprint(root),
        "code_fingerprint": fingerprint(root, exclude_docs=True),
        "changed_files": changed_paths(root),
        "configured": config_path(root) is not None,
        "evidence_dir": str(ev_dir),
        "tiers": tiers,
    }


def run_status(root: Path, as_json: bool) -> int:
    data = status_data(root)
    if as_json:
        print(json.dumps(data))
        return EXIT_PASS
    changed = len(data["changed_files"])
    print(f"gates status @ {data['head'][:10]} on {data['branch']} ({changed} changed files)")
    if not data["tiers"]:
        print("  no evidence recorded yet")
    for tier, info in data["tiers"].items():
        match = "matches current tree" if info["matches_code"] else "STALE (tree changed since)"
        extra = f" skipped={info['skipped']}" if info["skipped"] else ""
        result = str(info["result"]).upper()
        print(f"  {tier:<7} {result:<10} @ {str(info['head'])[:10]}  {match}{extra}")
    return EXIT_PASS


def run_preflight(root: Path, as_json: bool) -> int:
    cfg = load_config(root)
    needs_missing = [n for n in cfg.get("needs", []) if not tool_available(n)]
    requires = sorted({t for g in cfg["gates"] for t in g.get("requires", [])})
    requires_missing = [t for t in requires if t not in needs_missing and not tool_available(t)]
    free = shutil.disk_usage(root).free
    dirty = len(changed_paths(root))
    upstream = git(root, "rev-list", "--left-right", "--count", "@{u}...HEAD", check=False).split()
    info: dict[str, Any] = {
        "repo": str(root),
        "branch": branch_name(root),
        "head": head_sha(root),
        "changed_files": dirty,
        "behind_ahead": upstream if len(upstream) == 2 else None,
        "needs_missing": needs_missing,
        "requires_missing": requires_missing,
        "free_gb": round(free / 1024**3, 1),
    }
    if as_json:
        print(json.dumps(info))
    else:
        print(f"gates preflight: {root} on {info['branch']} @ {info['head'][:10]}")
        print(f"  changed files: {dirty}; behind/ahead upstream: {info['behind_ahead']}")
        print(f"  free disk: {info['free_gb']} GB" + ("  (LOW)" if free < MIN_FREE_BYTES else ""))
        for need in needs_missing:
            print(f"  MISSING need: {need}" + (f" - {DOCKER_HINT}" if need == "docker" else ""))
        for tool in requires_missing:
            gated = [g["name"] for g in cfg["gates"] if tool in g.get("requires", [])]
            print(f"  missing tool {tool}: gates {gated} will be SKIPPED (UNVERIFIED)")
        if not needs_missing and not requires_missing:
            print("  all needs and tool requirements present")
    return EXIT_PREFLIGHT if needs_missing else EXIT_PASS


# --------------------------------------------------------------------------- CLI


def detach(argv: Sequence[str], root: Path) -> int:
    ev_dir = evidence_dir(root)
    log = ev_dir / "logs" / f"{utc_stamp()}-detached.log"
    child_argv = [a for a in argv if a != "--detach"]
    with log.open("wb") as fh:
        proc = subprocess.Popen(
            [sys.executable, str(Path(__file__).resolve()), *child_argv],
            cwd=root,
            stdout=fh,
            stderr=subprocess.STDOUT,
            stdin=subprocess.DEVNULL,
            start_new_session=True,
        )
    print(f"detached gates run: pid {proc.pid}")
    print(f"  output: {log}")
    print("  check with: gates status   (evidence is written when the run ends)")
    return EXIT_PASS


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="gates", description=__doc__.split("\n", 1)[0])
    parser.add_argument("--repo", help="repository root (default: cwd, then $CLAUDE_PROJECT_DIR)")
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("fast", "full"):
        p = sub.add_parser(name)
        p.add_argument("--keep-going", action="store_true")
        p.add_argument("--detach", action="store_true")
    p = sub.add_parser("run")
    p.add_argument("names", nargs="+")
    p.add_argument("--keep-going", action="store_true")
    p.add_argument("--detach", action="store_true")
    p = sub.add_parser("stress")
    p.add_argument("--targets")
    p.add_argument("--iterations", type=int)
    p.add_argument("--detach", action="store_true")
    p = sub.add_parser("refs")
    p.add_argument("--base")
    p.add_argument("--ref", action="append", default=[], help="check an explicit image ref")
    p.add_argument("--json", action="store_true")
    for name in ("status", "preflight"):
        sub.add_parser(name).add_argument("--json", action="store_true")
    sub.add_parser("fingerprint")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    raw = list(sys.argv[1:] if argv is None else argv)
    args = build_parser().parse_args(raw)
    try:
        root = resolve_repo(args.repo)
        if getattr(args, "detach", False):
            return detach(raw, root)
        install_signal_handlers()
        if args.command in ("fast", "full"):
            return run_tier(root, args.command, [], args.keep_going)
        if args.command == "run":
            return run_tier(root, "run", args.names, args.keep_going)
        if args.command == "stress":
            return run_stress(root, args.targets, args.iterations)
        if args.command == "refs":
            return run_refs(root, args.base, args.ref, args.json)
        if args.command == "status":
            return run_status(root, args.json)
        if args.command == "preflight":
            return run_preflight(root, args.json)
        if args.command == "fingerprint":
            print(f"tree {fingerprint(root)}\ncode {fingerprint(root, exclude_docs=True)}")
            return EXIT_PASS
    except GatesError as exc:
        print(f"gates: {exc}", file=sys.stderr)
        return EXIT_USAGE
    except LockedError as exc:
        print(f"gates: {exc}", file=sys.stderr)
        return EXIT_LOCKED
    except Interrupted:
        print("gates: interrupted", file=sys.stderr)
        return EXIT_INCOMPLETE
    return EXIT_USAGE


if __name__ == "__main__":
    sys.exit(main())
