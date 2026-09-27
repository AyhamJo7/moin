"""plan_section.py against a synthetic plan and the real PLAN.md."""

from __future__ import annotations

import unittest
from pathlib import Path

from helpers import BIN, REPO_ROOT, run, temp_dir, write

TOOL = BIN / "plan_section.py"
FIXTURE = """# Plan

## Status Ledger

| Phase | Status |
|---|---|
| P01 | NOT_STARTED |

---

## Architectural Principles and Invariants

| ID | Invariant |
|---|---|
| INV-01 | Tenant rows are protected. |

---

# Execution Roadmap

<a id="p01--first"></a>
## P01 — First

### Checklist
- [ ] **P01.01 Alpha** `[G:PILOT]`
  - [ ] P01.01.01 First item
    continuation of the first item
  - [ ] P01.01.02 Verify: alpha works
- [x] **P01.02 Beta** `[G:PILOT]`
  - [x] P01.02.01 Done item — EV-P01-001

### Required evidence
EV-P01-001.

---

<a id="p02--second"></a>
## P02 — Second

### Checklist
- [ ] **P02.01 Gamma** `[G:PILOT]`
  - [ ] P02.01.01 Only item

---

# Cross-Phase Quality Gates

| ID | Gate |
|---|---|
| QG-09 | Sensitive-area review |
"""


class SyntheticPlanTest(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = temp_dir()
        self.plan = write(Path(self._tmp.name), "PLAN.md", FIXTURE)

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def out(self, *args: str) -> tuple[int, str]:
        res = run(TOOL, ["--plan", str(self.plan), *args])
        return res.returncode, res.stdout

    def test_phase_slice_stops_before_the_next_phase(self) -> None:
        code, out = self.out("P01")
        self.assertEqual(code, 0)
        self.assertTrue(out.startswith("PLAN.md:L21-L"))
        self.assertIn("### Required evidence", out)
        self.assertNotIn("P02", out)
        self.assertNotIn("---", out.splitlines()[-1])

    def test_last_phase_stops_at_the_next_top_level_heading(self) -> None:
        code, out = self.out("P02")
        self.assertEqual(code, 0)
        self.assertIn("P02.01.01 Only item", out)
        self.assertNotIn("Quality Gates", out)

    def test_checklist_section_and_item(self) -> None:
        _, section = self.out("P01.01")
        self.assertIn("P01.01.01 First item", section)
        self.assertIn("continuation", section)
        self.assertIn("P01.01.02 Verify", section)
        self.assertNotIn("P01.02", section)
        _, item = self.out("P01.01.01")
        self.assertIn("continuation", item)
        self.assertNotIn("P01.01.02", item)

    def test_named_sections_and_ids(self) -> None:
        _, ledger = self.out("--ledger")
        self.assertIn("| P01 | NOT_STARTED |", ledger)
        self.assertNotIn("Invariants", ledger)
        _, inv = self.out("--invariants")
        self.assertIn("INV-01", inv)
        _, row = self.out("--id", "QG-09")
        self.assertIn("PLAN.md:L", row)
        self.assertIn("Sensitive-area review", row)
        _, phases = self.out("--phases")
        self.assertEqual(phases.split(), ["P01", "L21", "P02", "L37"])

    def test_not_found_and_usage_errors(self) -> None:
        self.assertEqual(self.out("P09")[0], 1)
        self.assertEqual(self.out("P01.09")[0], 1)
        self.assertEqual(self.out("--id", "ADR-9999")[0], 1)
        self.assertEqual(self.out()[0], 2)
        self.assertEqual(run(TOOL, ["--plan", "/nonexistent/PLAN.md", "P01"]).returncode, 2)


@unittest.skipUnless((REPO_ROOT / "PLAN.md").is_file(), "PLAN.md not present")
class RealPlanTest(unittest.TestCase):
    def test_every_phase_anchor_slices(self) -> None:
        res = run(TOOL, ["--phases"])
        phases = res.stdout.split()[::2]
        self.assertEqual(phases, [f"P{n:02d}" for n in range(34)])
        for phase in phases:
            with self.subTest(phase=phase):
                out = run(TOOL, [phase])
                self.assertEqual(out.returncode, 0)
                self.assertIn(f"## {phase} ", out.stdout)
                self.assertIn("### Required evidence", out.stdout)

    def test_documented_entry_points(self) -> None:
        for args, needle in [
            (["P02.04.03"], ".env.example"),
            (["--ledger"], "| P02 | Engineering foundation |"),
            (["--invariants"], "| INV-20 |"),
            (["--conventions"], "### Evidence rules"),
            (["--id", "EXT-24"], "GitHub"),
            (["--id", "A-22"], "no AI mentions"),
        ]:
            with self.subTest(args=args):
                out = run(TOOL, args)
                self.assertEqual(out.returncode, 0)
                self.assertIn(needle, out.stdout)


if __name__ == "__main__":
    unittest.main()
