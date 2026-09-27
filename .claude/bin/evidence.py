#!/usr/bin/env python3
"""evidence: create and check PLAN.md evidence records (EV-Pxx-nnn).

PLAN.md evidence rules: records live in docs/evidence/<phase>/EV-Pxx-nnn-<slug>.md with date,
commit SHA / image digest, environment, command or procedure, result, CI run or artifact link,
and reviewer; they are registered in docs/evidence/INDEX.md; checklist items are ticked only
with an EV ID. Sensitive evidence is stored by reference only (location, SHA-256, date,
counterparty), never committed.

The registry is created by P02.01.04. Until then `new` refuses (exit 3) and `check` reports
"not initialised" (exit 0: nothing to check).

    evidence.py new --phase P02 --item P02.06.07 --slug negative-controls \
        --summary "Four negative-control PRs fail the right job" \
        [--from-gates full|fast|stress|refs] [--command "..."] [--result PASS] \
        [--ci-link URL] [--environment local|cloud] [--reviewer founder]
    evidence.py check [--phase P02]

INDEX.md rows (appended by `new`; P02.01.04 writes the header):
    | ID | Item | Date | Commit | Summary | Record |

`check` statuses: OK, MISSING (referenced but no record/row), INCOMPLETE (required field empty
or `pending`), STALE (commit not in this repository), DUPLICATE (ID registered twice).
A pending CI link or reviewer is reported but is not a problem. Exit 1 if any problem is found.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import subprocess
import sys
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

EXIT_OK, EXIT_PROBLEMS, EXIT_USAGE, EXIT_NOT_INITIALISED = 0, 1, 2, 3
INDEX_REL = Path("docs/evidence/INDEX.md")
PHASE_RE = re.compile(r"^P\d{2}$")
ITEM_RE = re.compile(r"^P\d{2}(\.\d{2}){0,2}$")
SLUG_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
EV_RE = re.compile(r"\bEV-(P\d{2})-(\d{3})\b")
INDEX_ROW_RE = re.compile(r"^\|\s*(EV-P\d{2}-\d{3})\s*\|(.*)\|\s*$")
TICKED_ITEM_RE = re.compile(r"^\s*- \[[xX]\] (?:\*\*)?(P\d{2}\.\d{2}(?:\.\d{2})?)\b(.*)$")
FIELD_RE = re.compile(r"^\|\s*([^|]+?)\s*\|\s*(.*?)\s*\|\s*$")
REQUIRED_FIELDS = (
    "Evidence ID",
    "Item",
    "Date (UTC)",
    "Commit",
    "Environment",
    "Command / procedure",
    "Result",
    "CI run / artifact",
    "Reviewer",
)
PENDING = {"", "pending", "tbd", "todo", "—", "-"}
OPTIONAL_PENDING = {"CI run / artifact", "Reviewer"}


class EvidenceError(Exception):
    """Invalid input or repository state."""


@dataclass
class Finding:
    status: str
    ident: str
    detail: str


def repo_root(start: Path) -> Path:
    proc = subprocess.run(
        ["git", "-C", str(start), "rev-parse", "--show-toplevel"],
        capture_output=True,
        text=True,
        check=False,
    )
    if proc.returncode != 0:
        raise EvidenceError(f"{start} is not inside a git repository")
    return Path(proc.stdout.strip())


def git(root: Path, *args: str) -> str:
    proc = subprocess.run(
        ["git", "-C", str(root), *args], capture_output=True, text=True, check=False
    )
    return proc.stdout.strip() if proc.returncode == 0 else ""


def commit_exists(root: Path, sha: str) -> bool:
    proc = subprocess.run(
        ["git", "-C", str(root), "cat-file", "-e", f"{sha}^{{commit}}"],
        capture_output=True,
        check=False,
    )
    return proc.returncode == 0


def environment() -> str:
    if os.environ.get("CLAUDE_CODE_REMOTE") == "true":
        return "cloud session (Ubuntu 24.04 VM)"
    if os.environ.get("CI"):
        return "CI"
    return "local"


def next_id(root: Path, phase: str) -> str:
    used: set[int] = set()
    phase_dir = root / "docs" / "evidence" / phase
    if phase_dir.is_dir():
        for path in phase_dir.glob(f"EV-{phase}-*.md"):
            m = EV_RE.search(path.name)
            if m:
                used.add(int(m.group(2)))
    for m in EV_RE.finditer((root / INDEX_REL).read_text(encoding="utf-8")):
        if m.group(1) == phase:
            used.add(int(m.group(2)))
    return f"EV-{phase}-{(max(used) + 1 if used else 1):03d}"


def latest_gates(root: Path, tier: str) -> dict[str, Any]:
    git_dir = git(root, "rev-parse", "--absolute-git-dir")
    path = Path(os.environ.get("GATES_EVIDENCE_DIR") or Path(git_dir) / "claude-evidence")
    path = path / f"latest-{tier}.json"
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise EvidenceError(f"no readable gate evidence at {path} ({exc})") from exc
    if not isinstance(data, dict):
        raise EvidenceError(f"{path} is not a gate record")
    return data


def gates_fields(data: dict[str, Any]) -> tuple[str, str, str]:
    """(commit, command/procedure, result) from a gates run record."""
    gates = data.get("gates") or []
    lines = [
        f"`{g.get('cmd', '')}` → {g.get('status', '?')} (exit {g.get('exit_code')}, "
        f"{g.get('duration_s', 0):.1f} s)"
        for g in gates
        if isinstance(g, dict)
    ]
    command = f"`.claude/bin/gates.py {data.get('tier', '?')}`: " + "; ".join(lines)
    result = str(data.get("result", "incomplete")).upper()
    skipped = [g.get("name") for g in gates if isinstance(g, dict) and g.get("status") == "skipped"]
    if skipped:
        result += f" (SKIPPED-UNVERIFIED: {', '.join(str(s) for s in skipped)})"
    return str(data.get("head", "")), command, result


def cmd_new(opts: argparse.Namespace) -> int:
    root = repo_root(Path.cwd())
    if not (root / INDEX_REL).is_file():
        print(
            f"evidence: registry not initialised: {INDEX_REL} is missing (created by "
            "P02.01.04). No record written.",
            file=sys.stderr,
        )
        return EXIT_NOT_INITIALISED
    if not PHASE_RE.match(opts.phase) or not ITEM_RE.match(opts.item):
        raise EvidenceError("--phase must look like P02 and --item like P02.06 or P02.06.07")
    if not opts.item.startswith(opts.phase):
        raise EvidenceError(f"item {opts.item} does not belong to phase {opts.phase}")
    if not SLUG_RE.match(opts.slug):
        raise EvidenceError("--slug must be kebab-case (a-z, 0-9, -)")
    commit, command, result = git(root, "rev-parse", "HEAD"), opts.command or "", opts.result or ""
    if opts.from_gates:
        commit, command, result = gates_fields(latest_gates(root, opts.from_gates))
    if not command or not result:
        raise EvidenceError("give --command and --result, or --from-gates TIER")
    dirty = bool(git(root, "status", "--porcelain", "--untracked-files=no"))
    ident = next_id(root, opts.phase)
    date = dt.datetime.now(dt.UTC).strftime("%Y-%m-%d %H:%M UTC")
    record = root / "docs" / "evidence" / opts.phase / f"{ident}-{opts.slug}.md"
    record.parent.mkdir(parents=True, exist_ok=True)
    rows = {
        "Evidence ID": ident,
        "Item": opts.item,
        "Date (UTC)": date,
        "Commit": f"`{commit}`" + (" (working tree had uncommitted changes)" if dirty else ""),
        "Environment": opts.environment or environment(),
        "Command / procedure": command,
        "Result": result,
        "CI run / artifact": opts.ci_link or "pending",
        "Reviewer": opts.reviewer or "pending",
    }
    body = [f"# {ident}: {opts.summary}", "", "| Field | Value |", "|---|---|"]
    body += [f"| {k} | {v.replace('|', '\\|')} |" for k, v in rows.items()]
    body += ["", "Sensitive material is stored by reference only (PLAN.md evidence rules).", ""]
    record.write_text("\n".join(body), encoding="utf-8")
    rel = record.relative_to(root)
    row = f"| {ident} | {opts.item} | {date[:10]} | `{commit[:12]}` | {opts.summary} | [{rel.name}]({rel.relative_to(INDEX_REL.parent)}) |\n"
    with (root / INDEX_REL).open("a", encoding="utf-8") as fh:
        fh.write(row)
    print(f"{ident} → {rel}")
    return EXIT_OK


def record_fields(path: Path) -> dict[str, str]:
    fields: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        m = FIELD_RE.match(line)
        if m and m.group(1) not in ("Field", "---"):
            fields[m.group(1)] = m.group(2)
    return fields


def check_record(root: Path, ident: str, path: Path) -> list[Finding]:
    fields = record_fields(path)
    found: list[Finding] = []
    for name in REQUIRED_FIELDS:
        value = fields.get(name, "").strip("` ").lower()
        if value in PENDING and name not in OPTIONAL_PENDING:
            found.append(Finding("INCOMPLETE", ident, f"field `{name}` is empty"))
        elif value in PENDING:
            found.append(Finding("INCOMPLETE", ident, f"`{name}` still pending"))
    sha = re.search(r"[0-9a-f]{7,40}", fields.get("Commit", ""))
    if sha and not commit_exists(root, sha.group(0)):
        found.append(Finding("STALE", ident, f"commit {sha.group(0)} is not in this repository"))
    elif not sha:
        found.append(Finding("INCOMPLETE", ident, "no commit SHA"))
    return found


def cmd_check(opts: argparse.Namespace) -> int:
    root = repo_root(Path.cwd())
    index = root / INDEX_REL
    if not index.is_file():
        print(
            f"evidence: registry not initialised ({INDEX_REL} is created by P02.01.04); nothing to check."
        )
        return EXIT_OK
    phase = opts.phase
    registered: dict[str, int] = {}
    findings: list[Finding] = []
    for line in index.read_text(encoding="utf-8").splitlines():
        m = INDEX_ROW_RE.match(line)
        if m and (not phase or m.group(1).startswith(f"EV-{phase}-")):
            registered[m.group(1)] = registered.get(m.group(1), 0) + 1
    for ident, count in registered.items():
        if count > 1:
            findings.append(Finding("DUPLICATE", ident, f"registered {count} times in INDEX.md"))
    records: dict[str, Path] = {}
    for path in sorted((root / "docs" / "evidence").glob("P*/EV-P*.md")):
        m = EV_RE.search(path.name)
        if m and (not phase or m.group(1) == phase):
            records[m.group(0)] = path
    for ident in sorted(set(registered) | set(records)):
        if ident not in records:
            findings.append(Finding("MISSING", ident, "in INDEX.md but no record file"))
        elif ident not in registered:
            findings.append(Finding("MISSING", ident, "record exists but is not in INDEX.md"))
        else:
            findings += check_record(root, ident, records[ident])
    plan = root / "PLAN.md"
    ticked = 0
    if plan.is_file():
        for n, line in enumerate(plan.read_text(encoding="utf-8").splitlines(), 1):
            m = TICKED_ITEM_RE.match(line)
            if not m or (phase and not m.group(1).startswith(phase)):
                continue
            ticked += 1
            ids = [f"EV-{e.group(1)}-{e.group(2)}" for e in EV_RE.finditer(m.group(2))]
            if not ids and not m.group(1).startswith("P00"):
                findings.append(
                    Finding("MISSING", m.group(1), f"PLAN.md:L{n} ticked without an EV ID")
                )
            for ident in ids:
                if ident not in registered:
                    findings.append(
                        Finding(
                            "MISSING",
                            ident,
                            f"cited by {m.group(1)} (PLAN.md:L{n}) but not registered",
                        )
                    )
    problems = [f for f in findings if not (f.status == "INCOMPLETE" and "pending" in f.detail)]
    print("| Status | ID | Detail |\n|---|---|---|")
    for f in findings:
        print(f"| {f.status} | {f.ident} | {f.detail} |")
    ok = [
        i for i in sorted(set(registered) & set(records)) if not any(f.ident == i for f in findings)
    ]
    for ident in ok:
        print(f"| OK | {ident} | record + index + commit present |")
    print(
        f"\n{len(ok)} OK, {len(problems)} problem(s), {ticked} ticked item(s) checked"
        + (f" in {phase}" if phase else "")
    )
    return EXIT_PROBLEMS if problems else EXIT_OK


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="evidence.py", description=__doc__.split("\n", 1)[0])
    sub = parser.add_subparsers(dest="cmd", required=True)
    new = sub.add_parser("new")
    new.add_argument("--phase", required=True)
    new.add_argument("--item", required=True)
    new.add_argument("--slug", required=True)
    new.add_argument("--summary", required=True)
    new.add_argument("--from-gates", choices=("full", "fast", "stress", "refs"))
    new.add_argument("--command")
    new.add_argument("--result")
    new.add_argument("--ci-link")
    new.add_argument("--environment")
    new.add_argument("--reviewer")
    check = sub.add_parser("check")
    check.add_argument("--phase")
    opts = parser.parse_args(argv)
    try:
        return cmd_new(opts) if opts.cmd == "new" else cmd_check(opts)
    except EvidenceError as exc:
        print(f"evidence: {exc}", file=sys.stderr)
        return EXIT_USAGE


if __name__ == "__main__":
    sys.exit(main())
