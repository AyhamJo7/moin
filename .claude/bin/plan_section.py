#!/usr/bin/env python3
"""plan-section: print one part of PLAN.md so sessions never load the whole plan.

PLAN.md is ~6,250 lines. Agents read only what "How to Use This Plan" allows: Conventions,
the Status Ledger, Principles and Invariants, the target phase, and the IDs it references.

Usage (from the repository root):
    plan_section.py P02                 the phase section (anchor <a id="p02--..."> to the next)
    plan_section.py P02.04              one checklist section (with its items)
    plan_section.py P02.04.03           one checklist item
    plan_section.py --ledger            the Status Ledger (single source of status)
    plan_section.py --conventions       status model, gate tiers, IDs, evidence rules
    plan_section.py --invariants        principles and INV-01..INV-20
    plan_section.py --section "Testing Strategy"   any heading, to the next heading of its level
    plan_section.py --id QG-09          the row(s) defining an ID (ADR/EXT/DG/QG/LG/FS/A/R/BR/INV/...)
    plan_section.py --phases            phase anchors with line numbers
Options: --plan PATH (default: PLAN.md at the repository root), --numbered (prefix line numbers).
BLUEPRINT.md is never read whole: `--id BR-048` prints the traceability row with its line range,
then read exactly that range (Read with offset/limit, or sed -n 'a,bp').

Output starts with `PLAN.md:L<a>-L<b>`. Exit codes: 0 found, 1 not found, 2 usage/missing file.
"""

from __future__ import annotations

import argparse
import re
import sys
from collections.abc import Sequence
from pathlib import Path

EXIT_OK, EXIT_NOT_FOUND, EXIT_USAGE = 0, 1, 2
DEFAULT_PLAN = Path(__file__).resolve().parents[2] / "PLAN.md"
PHASE_ANCHOR_RE = re.compile(r'^<a id="(p\d{2})--[^"]*"></a>\s*$')
HEADING_RE = re.compile(r"^(#{1,6})\s+(.*?)\s*$")
CHECK_SECTION_RE = re.compile(r"^- \[[ xX]\] \*\*(P\d{2}\.\d{2})\b")
CHECK_ITEM_RE = re.compile(r"^\s+- \[[ xX]\] (P\d{2}\.\d{2}\.\d{2})\b")
PHASE_ARG_RE = re.compile(r"^[Pp](\d{2})$")
SECTION_ARG_RE = re.compile(r"^[Pp](\d{2})\.(\d{2})$")
ITEM_ARG_RE = re.compile(r"^[Pp](\d{2})\.(\d{2})\.(\d{2})$")
MAX_ID_ROWS = 12
NAMED = {
    "ledger": "Status Ledger",
    "conventions": "Conventions",
    "invariants": "Architectural Principles and Invariants",
}


class PlanError(Exception):
    """A requested part does not exist."""


Span = tuple[int, int]  # 0-based [start, end)


def heading_span(lines: Sequence[str], title: str) -> Span:
    wanted = title.strip().lower()
    for i, line in enumerate(lines):
        m = HEADING_RE.match(line)
        if m and m.group(2).lower() == wanted:
            level = len(m.group(1))
            for j in range(i + 1, len(lines)):
                n = HEADING_RE.match(lines[j])
                if n and len(n.group(1)) <= level:
                    return i, trim(lines, i, j)
            return i, trim(lines, i, len(lines))
    raise PlanError(f"no heading named {title!r}")


def trim(lines: Sequence[str], start: int, end: int) -> int:
    """Drop trailing blank lines, `---` rules and the next phase's anchor."""
    while end > start + 1 and (
        not lines[end - 1].strip()
        or lines[end - 1].strip() == "---"
        or PHASE_ANCHOR_RE.match(lines[end - 1])
    ):
        end -= 1
    return end


def phase_anchors(lines: Sequence[str]) -> list[tuple[str, int]]:
    return [
        (m.group(1).upper(), i)
        for i, line in enumerate(lines)
        if (m := PHASE_ANCHOR_RE.match(line))
    ]


def phase_span(lines: Sequence[str], phase: str) -> Span:
    anchors = phase_anchors(lines)
    for k, (name, start) in enumerate(anchors):
        if name == phase:
            end = anchors[k + 1][1] if k + 1 < len(anchors) else next_top_heading(lines, start)
            return start, trim(lines, start, end)
    raise PlanError(f'no anchor for {phase} (expected <a id="{phase.lower()}--...">)')


def next_top_heading(lines: Sequence[str], start: int) -> int:
    for j in range(start + 2, len(lines)):
        if lines[j].startswith("# "):
            return j
    return len(lines)


def section_span(lines: Sequence[str], section: str) -> Span:
    start_phase, end_phase = phase_span(lines, section[:3])
    for i in range(start_phase, end_phase):
        m = CHECK_SECTION_RE.match(lines[i])
        if m and m.group(1) == section:
            j = i + 1
            while j < end_phase and (lines[j].startswith((" ", "\t")) or not lines[j].strip()):
                if not lines[j].strip() and (
                    j + 1 >= end_phase or not lines[j + 1].startswith(" ")
                ):
                    break
                j += 1
            return i, trim(lines, i, j)
    raise PlanError(f"no checklist section {section} in {section[:3]}")


def item_span(lines: Sequence[str], item: str) -> Span:
    start, end = section_span(lines, item[:6])
    for i in range(start, end):
        m = CHECK_ITEM_RE.match(lines[i])
        if m and m.group(1) == item:
            indent = len(lines[i]) - len(lines[i].lstrip())
            j = i + 1
            while j < end and lines[j].strip() and len(lines[j]) - len(lines[j].lstrip()) > indent:
                j += 1
            return i, j
    raise PlanError(f"no checklist item {item}")


def id_rows(lines: Sequence[str], ident: str) -> list[int]:
    """Lines that define `ident`: a table row whose first cell is the ID, else a heading."""
    cell = re.compile(rf"^\|\s*{re.escape(ident)}\s*\|")
    rows = [i for i, line in enumerate(lines) if cell.match(line)]
    if rows:
        return rows[:MAX_ID_ROWS]
    head = re.compile(rf"^#+\s.*\b{re.escape(ident)}\b")
    return [i for i, line in enumerate(lines) if head.match(line)][:MAX_ID_ROWS]


def render(path: Path, lines: Sequence[str], span: Span, numbered: bool) -> str:
    start, end = span
    out = [f"{path.name}:L{start + 1}-L{end}"]
    for i in range(start, end):
        out.append(f"{i + 1:>5}  {lines[i]}" if numbered else lines[i])
    return "\n".join(out)


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="plan_section.py", description=__doc__.split("\n", 1)[0])
    parser.add_argument("target", nargs="?", help="P02, P02.04 or P02.04.03")
    parser.add_argument("--plan", type=Path, default=DEFAULT_PLAN)
    parser.add_argument("--numbered", action="store_true")
    parser.add_argument("--section")
    parser.add_argument("--id", dest="ident")
    parser.add_argument("--phases", action="store_true")
    for flag in NAMED:
        parser.add_argument(f"--{flag}", action="store_true")
    opts = parser.parse_args(argv)
    try:
        lines = opts.plan.read_text(encoding="utf-8").splitlines()
    except OSError as exc:
        print(f"plan-section: cannot read {opts.plan}: {exc}", file=sys.stderr)
        return EXIT_USAGE
    try:
        if opts.phases:
            print("\n".join(f"{name}  L{i + 1}" for name, i in phase_anchors(lines)))
            return EXIT_OK
        if opts.ident:
            rows = id_rows(lines, opts.ident.strip())
            if not rows:
                raise PlanError(f"no row or heading defines {opts.ident}")
            for i in rows:
                print(f"{opts.plan.name}:L{i + 1}: {lines[i]}")
            return EXIT_OK
        named = [NAMED[f] for f in NAMED if getattr(opts, f)]
        if named or opts.section:
            span = heading_span(lines, named[0] if named else opts.section)
        elif opts.target and (m := ITEM_ARG_RE.match(opts.target)):
            span = item_span(lines, f"P{m.group(1)}.{m.group(2)}.{m.group(3)}")
        elif opts.target and (m := SECTION_ARG_RE.match(opts.target)):
            span = section_span(lines, f"P{m.group(1)}.{m.group(2)}")
        elif opts.target and (m := PHASE_ARG_RE.match(opts.target)):
            span = phase_span(lines, f"P{m.group(1)}")
        else:
            parser.print_usage(sys.stderr)
            return EXIT_USAGE
    except PlanError as exc:
        print(f"plan-section: {exc}", file=sys.stderr)
        return EXIT_NOT_FOUND
    print(render(opts.plan, lines, span, opts.numbered))
    return EXIT_OK


if __name__ == "__main__":
    sys.exit(main())
