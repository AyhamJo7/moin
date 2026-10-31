"""merge_gate.py: the decision rules, the verdict parser, the shipped policy, and the gh /
verify-head / codex plumbing (run against fakes on PATH)."""

from __future__ import annotations

import dataclasses
import datetime as dt
import json
import os
import shutil
import stat
import sys
import unittest
from pathlib import Path
from typing import Any

from helpers import BIN, CLAUDE_DIR, base_env, run, temp_dir, write

sys.path.insert(0, str(BIN))
import merge_gate

HEAD = "a" * 40
OTHER = "b" * 40
TODAY = dt.date(2026, 11, 2)
FILES = ["apps/web/src/today/card.tsx"]
APPROVE = "LOW apps/web/src/today/card.tsx:3 naming.\n\nVERDICT: APPROVE\n"


def policy(**changes: Any) -> merge_gate.Policy:
    return dataclasses.replace(merge_gate.load_policy(), trial_until=TODAY, **changes)


def pr(**changes: Any) -> dict[str, Any]:
    data: dict[str, Any] = {
        "number": 7,
        "state": "OPEN",
        "isDraft": True,
        "baseRefName": "main",
        "headRefOid": HEAD,
        "title": "feat(p13): show the callback reason",
        "body": "Adds the reason to the card.",
    }
    data.update(changes)
    return data


class RefusalsTest(unittest.TestCase):
    def check(self, **kw: Any) -> list[str]:
        args: dict[str, Any] = {
            "policy": policy(),
            "pr": pr(),
            "files": FILES,
            "ci_verdict": "VERIFIED",
            "today": TODAY,
        }
        args.update(kw)
        return merge_gate.refusals(**args)

    def assert_refused(self, fragment: str, **kw: Any) -> None:
        reasons = self.check(**kw)
        self.assertTrue(any(fragment in r for r in reasons), reasons)

    def test_all_conditions_met(self) -> None:
        self.assertEqual(self.check(), [])

    def test_ci_not_verified(self) -> None:
        for verdict in ("FAILED", "PENDING"):
            self.assert_refused("not VERIFIED", ci_verdict=verdict)

    def test_shape(self) -> None:
        self.assert_refused("not OPEN", pr=pr(state="MERGED"))
        self.assert_refused("not main", pr=pr(baseRefName="release"))

    def test_ai_mention_in_text(self) -> None:
        self.assert_refused("A-22", pr=pr(body="Co-Authored-By: x <x@example.com>"))

    def test_permanent_founder_paths(self) -> None:
        later = dt.date(2030, 1, 1)
        for path in (
            ".github/workflows/verify.yml",
            ".claude/policy/merge-gate.json",
            "scripts/check-rls-catalog.ts",
            "lefthook.yml",
            "infrastructure/envs/prod/main.tf",
        ):
            with self.subTest(path=path):
                self.assert_refused("founder-merged", files=[*FILES, path], today=later)

    def test_trial_paths_until_the_date(self) -> None:
        path = "packages/db/migrations/0040_roles.sql"
        self.assert_refused("founder-merged", files=[path], today=TODAY)
        self.assertEqual(self.check(files=[path], today=TODAY + dt.timedelta(days=1)), [])


class VerdictTest(unittest.TestCase):
    def test_final_line_decides(self) -> None:
        self.assertEqual(merge_gate.parse_verdict(APPROVE), "APPROVE")
        self.assertEqual(merge_gate.parse_verdict("x\n**VERDICT: APPROVE**\n\n"), "APPROVE")
        self.assertEqual(
            merge_gate.parse_verdict("HIGH a.ts:1 bug\nVERDICT: REQUEST_CHANGES"), "REQUEST_CHANGES"
        )

    def test_anything_else_is_no_verdict(self) -> None:
        for text in (
            "",
            "Looks fine to me.",
            "VERDICT: APPROVE\nbut one more HIGH finding",
            "VERDICT: APPROVE if the tests pass",
        ):
            with self.subTest(text=text):
                self.assertIsNone(merge_gate.parse_verdict(text))


class ShippedPolicyTest(unittest.TestCase):
    def test_policy_loads(self) -> None:
        shipped = merge_gate.load_policy()
        self.assertEqual(shipped.base, "main")
        self.assertIn(".github/*", shipped.founder_paths)
        self.assertIn(".claude/*", shipped.founder_paths)
        self.assertTrue(shipped.ai_patterns)


FAKE_GH = """#!/usr/bin/env python3
import json, os, sys
from pathlib import Path
state = Path(os.environ["FAKE_TOOL_DIR"])
args = sys.argv[1:]
with (state / "calls.log").open("a") as f:
    f.write(json.dumps(args) + "\\n")
fx = json.loads((state / "fixture.json").read_text())
if args[:2] == ["pr", "view"]:
    views = state / "views"
    n = int(views.read_text()) if views.exists() else 0
    views.write_text(str(n + 1))
    print(json.dumps(fx["pr_after"] if n and "pr_after" in fx else fx["pr"]))
elif args[:2] == ["pr", "diff"]:
    print(fx["diff"])
elif args[:1] == ["api"] and args[2].endswith("/files"):
    print("\\n".join(fx["files"]))
elif args[:2] not in (["pr", "ready"], ["pr", "merge"]):
    sys.exit(1)
"""
FAKE_VERIFY = """#!/usr/bin/env python3
import json, os
from pathlib import Path
fx = json.loads((Path(os.environ["FAKE_TOOL_DIR"]) / "fixture.json").read_text())
print(json.dumps({"verdict": fx["ci"]}))
"""
FAKE_CODEX = """#!/usr/bin/env python3
import json, os, sys
from pathlib import Path
state = Path(os.environ["FAKE_TOOL_DIR"])
args = sys.argv[1:]
(state / "codex.json").write_text(json.dumps({"args": args, "stdin": sys.stdin.read()}))
fx = json.loads((state / "fixture.json").read_text())
Path(args[args.index("--output-last-message") + 1]).write_text(fx["review"])
"""


class CommandLineTest(unittest.TestCase):
    """Runs a copy of the script (its policy beside it) against fake gh, verify-head and codex."""

    def invoke(self, fixture: dict[str, Any], *extra: str) -> tuple[int, str, list[Any], Any]:
        with temp_dir() as tmp:
            root = Path(tmp)
            shutil.copy(BIN / "merge_gate.py", write(root, ".claude/bin/merge_gate.py", ""))
            gate = json.loads((CLAUDE_DIR / "policy/merge-gate.json").read_text(encoding="utf-8"))
            gate.update(trial_until="2000-01-01")
            write(root, ".claude/policy/merge-gate.json", json.dumps(gate))
            shutil.copy(CLAUDE_DIR / "policy/no-ai-mentions.json", root / ".claude/policy")
            for name, body in (
                ("gh", FAKE_GH),
                ("verify-head", FAKE_VERIFY),
                ("codex", FAKE_CODEX),
            ):
                tool = write(root, f"bin/{name}", body)
                tool.chmod(tool.stat().st_mode | stat.S_IXUSR)
            write(root, "fixture.json", json.dumps(fixture))
            env = base_env(
                FAKE_TOOL_DIR=str(root), PATH=f"{root / 'bin'}{os.pathsep}{os.environ['PATH']}"
            )
            proc = run(root / ".claude/bin/merge_gate.py", ["7", *extra], env=env)
            log = root / "calls.log"
            calls = [json.loads(x) for x in log.read_text().splitlines()] if log.exists() else []
            codex_file = root / "codex.json"
            codex = json.loads(codex_file.read_text()) if codex_file.exists() else None
            return proc.returncode, proc.stdout + proc.stderr, calls, codex

    @staticmethod
    def fixture(**changes: Any) -> dict[str, Any]:
        data: dict[str, Any] = {
            "pr": pr(),
            "files": FILES,
            "ci": "VERIFIED",
            "diff": "diff --git a/x b/x\n+change",
            "review": APPROVE,
        }
        data.update(changes)
        return data

    @staticmethod
    def merged(calls: list[Any]) -> bool:
        return any(c[:2] in (["pr", "merge"], ["pr", "ready"]) for c in calls)

    def test_reviews_the_diff_then_merges_the_checked_head_only(self) -> None:
        code, out, calls, codex = self.invoke(self.fixture())
        self.assertEqual(code, merge_gate.EXIT_OK, out)
        self.assertIn("+change", codex["stdin"])
        self.assertIn("read-only", codex["args"])
        self.assertIn(HEAD, codex["args"][-1])
        self.assertIn(["pr", "ready", "7"], calls)
        self.assertEqual(calls[-1], ["pr", "merge", "7", "--squash", "--match-head-commit", HEAD])

    def test_request_changes_or_no_verdict_never_merges(self) -> None:
        for review in ("HIGH a.ts:1 bug\nVERDICT: REQUEST_CHANGES", "I could not finish."):
            with self.subTest(review=review):
                code, out, calls, _ = self.invoke(self.fixture(review=review))
                self.assertEqual(code, merge_gate.EXIT_REFUSED, out)
                self.assertFalse(self.merged(calls))

    def test_failed_checks_skip_the_review_and_never_merge(self) -> None:
        code, out, calls, codex = self.invoke(self.fixture(ci="FAILED"))
        self.assertEqual(code, merge_gate.EXIT_REFUSED, out)
        self.assertIn("not VERIFIED", out)
        self.assertIsNone(codex)
        self.assertFalse(self.merged(calls))

    def test_head_moved_during_review_never_merges(self) -> None:
        code, out, calls, _ = self.invoke(self.fixture(pr_after=pr(headRefOid=OTHER)))
        self.assertEqual(code, merge_gate.EXIT_REFUSED, out)
        self.assertIn("head moved", out)
        self.assertFalse(self.merged(calls))

    def test_oversized_diff_is_an_error_not_a_merge(self) -> None:
        big = "+" * (merge_gate.MAX_DIFF_CHARS + 1)
        code, out, calls, codex = self.invoke(self.fixture(diff=big))
        self.assertEqual(code, merge_gate.EXIT_ERROR, out)
        self.assertIsNone(codex)
        self.assertFalse(self.merged(calls))

    def test_dry_run_neither_reviews_nor_merges(self) -> None:
        code, out, calls, codex = self.invoke(self.fixture(), "--dry-run")
        self.assertEqual(code, merge_gate.EXIT_OK, out)
        self.assertIsNone(codex)
        self.assertFalse(self.merged(calls))


if __name__ == "__main__":
    unittest.main()
