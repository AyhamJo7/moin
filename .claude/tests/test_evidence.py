"""evidence.py on real fixture repositories."""

from __future__ import annotations

import json
import unittest
from pathlib import Path

from helpers import BIN, base_env, git, make_repo, run, temp_dir, write

TOOL = BIN / "evidence.py"
INDEX_HEADER = "# Evidence index\n\n| ID | Item | Date | Commit | Summary | Record |\n|---|---|---|---|---|---|\n"
FAKE_SHA = "0123456789abcdef0123456789abcdef01234567"


class EvidenceCase(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = temp_dir()
        self.repo = make_repo(Path(self._tmp.name))
        self.env = base_env()

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def ev(self, *args: str) -> tuple[int, str, str]:
        res = run(TOOL, args, cwd=self.repo, env=self.env)
        return res.returncode, res.stdout, res.stderr

    def init_registry(self) -> None:
        write(self.repo, "docs/evidence/INDEX.md", INDEX_HEADER)
        git(self.repo, "add", "-A")
        git(self.repo, "commit", "-q", "-m", "docs: evidence registry")


class GreenfieldTest(EvidenceCase):
    def test_before_p02_check_is_a_no_op_and_new_refuses(self) -> None:
        code, out, _ = self.ev("check")
        self.assertEqual(code, 0)
        self.assertIn("not initialised", out)
        code, _, err = self.ev(
            "new",
            "--phase",
            "P02",
            "--item",
            "P02.01",
            "--slug",
            "x",
            "--summary",
            "y",
            "--command",
            "c",
            "--result",
            "PASS",
        )
        self.assertEqual(code, 3)
        self.assertIn("P02.01.04", err)
        self.assertFalse((self.repo / "docs").exists())


class NewRecordTest(EvidenceCase):
    def test_manual_record_is_numbered_and_indexed(self) -> None:
        self.init_registry()
        args = [
            "--phase",
            "P02",
            "--item",
            "P02.05.06",
            "--command",
            "`pnpm test`",
            "--result",
            "PASS",
            "--reviewer",
            "founder",
            "--ci-link",
            "https://example.invalid/run/1",
        ]
        code, out, _ = self.ev("new", *args, "--slug", "harness", "--summary", "Harness passes")
        self.assertEqual(code, 0, out)
        self.assertIn("EV-P02-001", out)
        code, out, _ = self.ev(
            "new", *args, "--slug", "harness-standalone", "--summary", "Standalone"
        )
        self.assertIn("EV-P02-002", out)
        record = (self.repo / "docs/evidence/P02/EV-P02-001-harness.md").read_text()
        for field in (
            "| Commit | `",
            "| Environment | local |",
            "| Result | PASS |",
            "| Item | P02.05.06 |",
        ):
            self.assertIn(field, record)
        index = (self.repo / "docs/evidence/INDEX.md").read_text()
        self.assertEqual(index.count("| EV-P02-"), 2)
        self.assertEqual(self.ev("check", "--phase", "P02")[0], 0)

    def test_record_from_gate_evidence(self) -> None:
        self.init_registry()
        head = git(self.repo, "rev-parse", "HEAD").strip()
        gate_dir = self.repo / ".git" / "claude-evidence"
        gate_dir.mkdir(parents=True)
        (gate_dir / "latest-full.json").write_text(
            json.dumps(
                {
                    "tier": "full",
                    "head": head,
                    "result": "pass",
                    "gates": [
                        {
                            "name": "unit",
                            "cmd": "pnpm turbo test",
                            "status": "pass",
                            "exit_code": 0,
                            "duration_s": 12.5,
                        }
                    ],
                }
            )
        )
        code, _, err = self.ev(
            "new",
            "--phase",
            "P02",
            "--item",
            "P02.06.01",
            "--slug",
            "verify",
            "--summary",
            "verify job passes",
            "--from-gates",
            "full",
        )
        self.assertEqual(code, 0, err)
        record = next((self.repo / "docs/evidence/P02").glob("EV-P02-001-*.md")).read_text()
        self.assertIn(head, record)
        self.assertIn("pnpm turbo test", record)
        self.assertIn("| Result | PASS |", record)

    def test_rejects_bad_input(self) -> None:
        self.init_registry()
        base = ["--summary", "s", "--command", "c", "--result", "r"]
        for bad in (
            ["--phase", "P2", "--item", "P02.01", "--slug", "x"],
            ["--phase", "P02", "--item", "P03.01", "--slug", "x"],
            ["--phase", "P02", "--item", "P02.01", "--slug", "Not Kebab"],
        ):
            with self.subTest(bad=bad):
                self.assertEqual(self.ev("new", *bad, *base)[0], 2)


class CheckTest(EvidenceCase):
    def test_stale_missing_duplicate_and_unticked_evidence(self) -> None:
        self.init_registry()
        head = git(self.repo, "rev-parse", "HEAD").strip()
        good = (
            "| Evidence ID | EV-P02-001 |\n| Item | P02.01.01 |\n| Date (UTC) | 2026-09-28 |\n"
            f"| Commit | `{head}` |\n| Environment | local |\n| Command / procedure | `x` |\n"
            "| Result | PASS |\n| CI run / artifact | link |\n| Reviewer | founder |\n"
        )
        write(
            self.repo,
            "docs/evidence/P02/EV-P02-001-good.md",
            "# EV-P02-001: good\n\n| Field | Value |\n|---|---|\n" + good,
        )
        write(
            self.repo,
            "docs/evidence/P02/EV-P02-002-stale.md",
            "# EV-P02-002\n\n| Field | Value |\n|---|---|\n"
            + good.replace(head, FAKE_SHA).replace("EV-P02-001", "EV-P02-002"),
        )
        rows = "".join(
            f"| {i} | P02.01.01 | 2026-09-28 | `x` | s | r |\n"
            for i in ("EV-P02-001", "EV-P02-002", "EV-P02-003", "EV-P02-003")
        )
        write(self.repo, "docs/evidence/INDEX.md", INDEX_HEADER + rows)
        write(
            self.repo,
            "PLAN.md",
            "- [ ] **P02.01 Governance**\n"
            "  - [x] P02.01.01 Ruleset — EV-P02-001\n"
            "  - [x] P02.01.02 CODEOWNERS\n"
            "  - [x] P02.01.03 Commit check — EV-P02-009\n",
        )
        code, out, _ = self.ev("check", "--phase", "P02")
        self.assertEqual(code, 1, out)
        self.assertIn("| OK | EV-P02-001 |", out)
        self.assertIn("| STALE | EV-P02-002 |", out)
        self.assertIn("| DUPLICATE | EV-P02-003 |", out)
        self.assertIn("| MISSING | EV-P02-003 | in INDEX.md but no record file |", out)
        self.assertIn("| MISSING | P02.01.02 |", out)
        self.assertIn("| MISSING | EV-P02-009 |", out)


if __name__ == "__main__":
    unittest.main()
