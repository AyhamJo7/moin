#!/usr/bin/env python3
"""mutation-check: prove a regression test detects the bug its fix addresses.

Portable: a single stdlib-only file. It works from ~/.claude/kit/bin/ or when copied
into a repository's .claude/bin/.

Protocol. It never uses `git checkout` or `git restore`:
  1. Record a digest of the fix paths, the tree fingerprint and a `git stash create`
     safety snapshot. Back up untracked fix files.
  2. Build the fix patch:
       committed mode (default):  git diff REF^ REF -- <fix paths>   (REF defaults to HEAD)
       working-tree mode:         git diff HEAD -- <fix paths> + untracked new files
                                  (used when --fix-paths have uncommitted changes)
     Without --fix-paths, the fix paths are every non-test file the commit changed.
  3. Reverse-apply ONLY the fix and run the test. It is expected to FAIL.
  4. Re-apply the fix, verify the fix paths are byte-identical to step 1, and run the
     test again. It is expected to PASS.
  A signal or error at any point after step 3 still re-applies the fix (try/finally).

Verdicts / exit codes:
  KILLED 0          the test fails without the fix and passes with it
  SURVIVED 3        the test passes without the fix: it does not detect the bug
  BROKEN 4          the test fails with the fix in place
  ERROR 5           the fix could not be isolated or applied (nothing was changed)
  RESTORE_FAILED 6  the fix paths differ from the recorded state (recovery info printed)
  INTERRUPTED 7     a signal stopped the run; the fix was re-applied

Evidence: $(git rev-parse --absolute-git-dir)/claude-evidence/mutation/<ts>.json
"""

from __future__ import annotations

import argparse
import contextlib
import datetime as dt
import hashlib
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import time
from collections.abc import Iterator, Sequence
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

EVIDENCE_DIRNAME = "claude-evidence"
EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"
DEFAULT_TIMEOUT_S = 900
KILL_GRACE_S = 5
TAIL_LINES = 40
UNTRACKED_HASH_LIMIT = 8 * 1024**2
DOC_SUFFIXES = (".md", ".mdx", ".rst", ".txt", ".adoc")
TEST_PATH_RE = re.compile(
    r"(^|/)(tests?|__tests__|spec|specs|e2e|testdata|fixtures)/"
    r"|(^|/)test_[^/]*\.py$|_test\.(py|go|rs|ts|js)$"
    r"|\.(test|spec)\.[cm]?[jt]sx?$|(^|/)conftest\.py$"
)

EXIT_KILLED, EXIT_SURVIVED, EXIT_BROKEN, EXIT_ERROR, EXIT_RESTORE_FAILED = 0, 3, 4, 5, 6
EXIT_INTERRUPTED = 7


class MutationError(Exception):
    """The fix could not be isolated or applied; the tree was not modified."""


class Interrupted(Exception):
    """A signal arrived while the fix was reverted."""


# --------------------------------------------------------------------------- git helpers


def git(root: Path, *args: str, check: bool = True) -> str:
    proc = subprocess.run(
        ["git", "-C", str(root), *args], capture_output=True, text=True, check=False
    )
    if check and proc.returncode != 0:
        raise MutationError(f"git {' '.join(args)} failed: {proc.stderr.strip()}")
    return proc.stdout


def git_bytes(root: Path, *args: str) -> bytes:
    return subprocess.run(["git", "-C", str(root), *args], capture_output=True, check=False).stdout


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
    raise MutationError("not inside a git repository (use --repo DIR)")


def head_sha(root: Path) -> str:
    return git(root, "rev-parse", "--verify", "--quiet", "HEAD", check=False).strip() or "UNBORN"


def fingerprint(root: Path) -> str:
    """Same algorithm as gates.py's fingerprint(root) (kept in sync by a test)."""
    base = head_sha(root)
    h = hashlib.sha256()
    h.update(base.encode())
    h.update(b"\0diff\0")
    h.update(
        git_bytes(
            root,
            "diff",
            base if base != "UNBORN" else EMPTY_TREE,
            "--binary",
            "--no-color",
            "--no-ext-diff",
        )
    )
    h.update(b"\0untracked\0")
    listing = git(root, "ls-files", "--others", "--exclude-standard", "-z")
    for rel in sorted(p for p in listing.split("\0") if p):
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


def paths_digest(root: Path, paths: Sequence[str]) -> str:
    h = hashlib.sha256()
    for rel in sorted(paths):
        path = root / rel
        h.update(rel.encode() + b"\0")
        h.update(hashlib.sha256(path.read_bytes()).digest() if path.is_file() else b"<absent>")
    return h.hexdigest()


def evidence_dir(root: Path) -> Path:
    override = os.environ.get("GATES_EVIDENCE_DIR")
    base = (
        Path(override)
        if override
        else Path(git(root, "rev-parse", "--absolute-git-dir").strip()) / EVIDENCE_DIRNAME
    )
    path = base / "mutation"
    path.mkdir(parents=True, exist_ok=True)
    return path


def is_test_path(rel: str) -> bool:
    return bool(TEST_PATH_RE.search(rel))


# --------------------------------------------------------------------------- the fix


@dataclass
class Fix:
    mode: str  # committed | working-tree
    ref: str | None
    paths: list[str]
    untracked: list[str]
    patch: bytes


def uncommitted(root: Path, paths: Sequence[str]) -> tuple[list[str], list[str]]:
    """(tracked paths with changes vs HEAD, untracked files) among the given pathspecs."""
    base = head_sha(root)
    tracked = git(
        root, "diff", "--name-only", "-z", base if base != "UNBORN" else EMPTY_TREE, "--", *paths
    )
    untracked = git(root, "ls-files", "--others", "--exclude-standard", "-z", "--", *paths)
    return (
        sorted(p for p in tracked.split("\0") if p),
        sorted(p for p in untracked.split("\0") if p),
    )


def build_fix(root: Path, ref: str, fix_paths: Sequence[str]) -> Fix:
    if fix_paths:
        changed, untracked = uncommitted(root, fix_paths)
        if changed or untracked:
            base = head_sha(root)
            patch = (
                git_bytes(
                    root,
                    "diff",
                    "--binary",
                    base if base != "UNBORN" else EMPTY_TREE,
                    "--",
                    *changed,
                )
                if changed
                else b""
            )
            return Fix("working-tree", None, changed, untracked, patch)
    sha = git(root, "rev-parse", "--verify", f"{ref}^{{commit}}").strip()
    parent = git(root, "rev-parse", "--verify", "--quiet", f"{sha}^", check=False).strip()
    if not parent:
        raise MutationError(f"{ref} is a root commit: nothing to diff the fix against")
    in_commit = [p for p in git(root, "diff", "--name-only", "-z", parent, sha).split("\0") if p]
    paths = (
        [
            p
            for p in in_commit
            if any(p == f or p.startswith(f.rstrip("/") + "/") for f in fix_paths)
        ]
        if fix_paths
        else [p for p in in_commit if not is_test_path(p) and not p.endswith(DOC_SUFFIXES)]
    )
    if not paths:
        raise MutationError(
            f"no fix changes found in {ref} (only test files?); pass --fix-paths explicitly"
        )
    dirty, _ = uncommitted(root, paths)
    if dirty:
        raise MutationError(
            "fix paths have uncommitted changes: "
            + ", ".join(dirty)
            + " (commit them, or pass --fix-paths to use working-tree mode)"
        )
    patch = git_bytes(root, "diff", "--binary", parent, sha, "--", *paths)
    return Fix("committed", sha, paths, [], patch)


# --------------------------------------------------------------------------- test runs


@dataclass
class TestRun:
    exit_code: int | None
    timed_out: bool
    duration_s: float
    tail: str

    @property
    def passed(self) -> bool:
        return self.exit_code == 0 and not self.timed_out


_CURRENT_PGID: list[int] = []


def _group_alive(pgid: int) -> bool:
    try:
        os.killpg(pgid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def kill_group(pgid: int) -> None:
    if not _group_alive(pgid):
        return
    with contextlib.suppress(ProcessLookupError):
        os.killpg(pgid, signal.SIGTERM)
    deadline = time.monotonic() + KILL_GRACE_S
    while time.monotonic() < deadline and _group_alive(pgid):
        time.sleep(0.1)
    with contextlib.suppress(ProcessLookupError):
        os.killpg(pgid, signal.SIGKILL)


def run_test(cmd: str, root: Path, timeout_s: float) -> TestRun:
    start = time.monotonic()
    with tempfile.TemporaryFile() as log:
        proc = subprocess.Popen(
            ["bash", "-c", cmd],
            cwd=root,
            stdout=log,
            stderr=subprocess.STDOUT,
            stdin=subprocess.DEVNULL,
            start_new_session=True,
        )
        _CURRENT_PGID.append(proc.pid)
        timed_out = False
        try:
            code: int | None = proc.wait(timeout=timeout_s)
        except subprocess.TimeoutExpired:
            timed_out = True
            kill_group(proc.pid)
            proc.wait()
            code = None
        finally:
            _CURRENT_PGID.pop()
            kill_group(proc.pid)
        log.seek(0)
        text = log.read().decode("utf-8", errors="replace")
    return TestRun(
        code,
        timed_out,
        round(time.monotonic() - start, 2),
        "\n".join(text.splitlines()[-TAIL_LINES:]),
    )


def _on_signal(signum: int, _frame: object) -> None:
    for pgid in list(_CURRENT_PGID):
        kill_group(pgid)
    raise Interrupted(f"signal {signum}")


# --------------------------------------------------------------------------- protocol


@dataclass
class Report:
    verdict: str
    repo: str
    head: str
    mode: str
    fix_ref: str | None
    fix_paths: list[str]
    untracked_fix_files: list[str]
    test: str
    started: str
    tool: str = "mutation-check"
    finished: str = ""
    without_fix: dict[str, Any] | None = None
    with_fix: dict[str, Any] | None = None
    restored: bool = False
    tree_changed_by_tests: bool = False
    safety_snapshot: str = ""
    patch_file: str = ""
    untracked_backup: str = ""
    notes: list[str] = field(default_factory=list)


def apply_patch(root: Path, patch_file: Path, *, reverse: bool, check_only: bool = False) -> None:
    args = ["apply", "--binary", "--whitespace=nowarn"]
    if reverse:
        args.append("-R")
    if check_only:
        args.append("--check")
    proc = subprocess.run(
        ["git", "-C", str(root), *args, str(patch_file)],
        capture_output=True,
        text=True,
        check=False,
    )
    if proc.returncode != 0:
        raise MutationError(
            f"git {' '.join(args)} failed: {proc.stderr.strip() or proc.stdout.strip()}"
        )


@contextlib.contextmanager
def signals_ignored() -> Iterator[None]:
    """Keep a second Ctrl-C/SIGTERM from aborting the restore half-way."""
    previous = {s: signal.getsignal(s) for s in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP)}
    for sig in previous:
        signal.signal(sig, signal.SIG_IGN)
    try:
        yield
    finally:
        for sig, handler in previous.items():
            signal.signal(sig, handler)


def restore_fix(root: Path, fix: Fix, patch_file: Path, backup: Path, report: Report) -> None:
    try:
        if fix.patch:
            apply_patch(root, patch_file, reverse=False)
    except MutationError as exc:
        report.notes.append(f"re-applying the fix failed: {exc}")
    for rel in fix.untracked:
        try:
            (root / rel).parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(backup / rel, root / rel)
        except OSError as exc:
            report.notes.append(f"restoring untracked {rel} failed: {exc}")


@contextlib.contextmanager
def signals_raise() -> Iterator[None]:
    previous = {s: signal.getsignal(s) for s in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP)}
    for sig in previous:
        signal.signal(sig, _on_signal)
    try:
        yield
    finally:
        for sig, handler in previous.items():
            signal.signal(sig, handler)


def mutation_check(
    root: Path, test: str, ref: str, fix_paths: Sequence[str], timeout_s: float
) -> Report:
    fix = build_fix(root, ref, fix_paths)
    ev_dir = evidence_dir(root)
    stamp = dt.datetime.now(dt.UTC).strftime("%Y%m%dT%H%M%SZ")
    report = Report(
        verdict="ERROR",
        repo=str(root),
        head=head_sha(root),
        mode=fix.mode,
        fix_ref=fix.ref,
        fix_paths=fix.paths,
        untracked_fix_files=fix.untracked,
        test=test,
        started=dt.datetime.now(dt.UTC).isoformat(timespec="seconds"),
    )
    patch_file = ev_dir / f"{stamp}.patch"
    patch_file.write_bytes(fix.patch)
    report.patch_file = str(patch_file)
    report.safety_snapshot = git(root, "stash", "create", check=False).strip()
    all_paths = fix.paths + fix.untracked
    digest_before = paths_digest(root, all_paths)
    fp_before = fingerprint(root)
    backup = ev_dir / f"{stamp}-untracked"
    for rel in fix.untracked:
        (backup / rel).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(root / rel, backup / rel)
    if fix.untracked:
        report.untracked_backup = str(backup)
    if fix.patch:
        apply_patch(root, patch_file, reverse=True, check_only=True)

    reverted = False
    interrupted = False
    without: TestRun | None = None
    with_fix: TestRun | None = None
    with signals_raise():
        try:
            if fix.patch:
                apply_patch(root, patch_file, reverse=True)
            for rel in fix.untracked:
                (root / rel).unlink()
            reverted = True
            without = run_test(test, root, timeout_s)
            report.without_fix = asdict(without)
        except Interrupted:
            interrupted = True
        finally:
            with signals_ignored():
                if reverted:
                    restore_fix(root, fix, patch_file, backup, report)
                report.restored = paths_digest(root, all_paths) == digest_before
        if not report.restored:
            report.verdict = "RESTORE_FAILED"
            return finish(report, ev_dir, stamp)
        if interrupted:
            report.verdict = "INTERRUPTED"
            report.notes.append("interrupted while the fix was reverted; the fix was re-applied")
            return finish(report, ev_dir, stamp)
        try:
            with_fix = run_test(test, root, timeout_s)
            report.with_fix = asdict(with_fix)
        except Interrupted:
            report.verdict = "INTERRUPTED"
            report.notes.append("interrupted during the with-fix run (fix already in place)")
            return finish(report, ev_dir, stamp)

    if without is None or with_fix is None:  # unreachable: both runs completed above
        raise MutationError("internal: missing test run result")
    report.tree_changed_by_tests = fingerprint(root) != fp_before
    if report.tree_changed_by_tests:
        report.notes.append("the test run modified files outside the fix paths")
    if not with_fix.passed:
        report.verdict = "BROKEN"
    elif without.passed:
        report.verdict = "SURVIVED"
    else:
        report.verdict = "KILLED"
        if without.timed_out:
            report.notes.append("without the fix the test timed out (counted as a failure)")
    return finish(report, ev_dir, stamp)


def finish(report: Report, ev_dir: Path, stamp: str) -> Report:
    report.finished = dt.datetime.now(dt.UTC).isoformat(timespec="seconds")
    data = json.dumps(asdict(report), indent=2)
    (ev_dir / f"{stamp}.json").write_text(data)
    (ev_dir / "latest.json").write_text(data)
    return report


VERDICT_TEXT = {
    "KILLED": "the test detects the bug (fails without the fix, passes with it).",
    "SURVIVED": "the test PASSES WITHOUT THE FIX; it does not detect the bug. Strengthen it.",
    "BROKEN": "the test FAILS WITH THE FIX in place. Fix the code or the test first.",
    "RESTORE_FAILED": "the fix paths do not match their recorded state; see recovery below.",
    "ERROR": "could not isolate or apply the fix.",
    "INTERRUPTED": "stopped by a signal; the fix was re-applied (see restored flag).",
}
EXIT_FOR = {
    "KILLED": EXIT_KILLED,
    "SURVIVED": EXIT_SURVIVED,
    "BROKEN": EXIT_BROKEN,
    "RESTORE_FAILED": EXIT_RESTORE_FAILED,
    "ERROR": EXIT_ERROR,
    "INTERRUPTED": EXIT_INTERRUPTED,
}


def describe(run: dict[str, Any] | None) -> str:
    if run is None:
        return "not run"
    if run["timed_out"]:
        return f"TIMEOUT ({run['duration_s']}s)"
    state = "PASS" if run["exit_code"] == 0 else "FAIL"
    return f"{state} (exit {run['exit_code']}, {run['duration_s']}s)"


def print_report(report: Report, evidence: Path) -> None:
    where = f"@ {report.fix_ref[:10]}" if report.fix_ref else "(uncommitted)"
    files = report.fix_paths + report.untracked_fix_files
    print(f"mutation-check: {report.mode} fix {where}, {len(files)} file(s): {', '.join(files)}")
    print(f"  test:        {report.test}")
    print(f"  without fix: {describe(report.without_fix)}   (expected: FAIL)")
    print(f"  with fix:    {describe(report.with_fix)}   (expected: PASS)")
    print(f"  fix restored byte-identical: {'yes' if report.restored else 'NO'}")
    for note in report.notes:
        print(f"  note: {note}")
    print(f"VERDICT: {report.verdict}: {VERDICT_TEXT[report.verdict]}")
    if report.verdict in ("SURVIVED", "BROKEN"):
        run = report.without_fix if report.verdict == "SURVIVED" else report.with_fix
        for line in (run or {}).get("tail", "").splitlines()[-15:]:
            print(f"  | {line}")
    if report.verdict == "RESTORE_FAILED":
        print(f"  RECOVERY: fix patch saved at {report.patch_file} (re-apply: git apply <patch>)")
        if report.safety_snapshot:
            print(f"  safety snapshot of tracked changes: git stash apply {report.safety_snapshot}")
        if report.untracked_backup:
            print(f"  untracked fix files backed up in {report.untracked_backup}")
    print(f"  evidence: {evidence}")


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="mutation-check", description=__doc__.split("\n", 1)[0])
    parser.add_argument("--test", required=True, help="shell command that runs the regression test")
    parser.add_argument(
        "--fix-ref", default="HEAD", help="commit containing the fix (default HEAD)"
    )
    parser.add_argument("--fix-paths", nargs="+", default=[], help="restrict/declare fix files")
    parser.add_argument("--timeout", type=float, default=DEFAULT_TIMEOUT_S)
    parser.add_argument("--repo")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)
    try:
        root = resolve_repo(args.repo)
        report = mutation_check(root, args.test, args.fix_ref, args.fix_paths, args.timeout)
    except MutationError as exc:
        print(f"mutation-check: ERROR: {exc}", file=sys.stderr)
        print("  nothing was changed in the working tree.", file=sys.stderr)
        return EXIT_ERROR
    evidence = evidence_dir(root) / "latest.json"
    if args.json:
        print(evidence.read_text())
    else:
        print_report(report, evidence)
    return EXIT_FOR[report.verdict]


if __name__ == "__main__":
    sys.exit(main())
