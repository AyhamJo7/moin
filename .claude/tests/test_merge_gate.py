"""merge_gate.py: the decision rules, the verdict parser, the shipped policy, and the git / gh /
verify-head / codex plumbing (real git repositories, fake gh, verify-head and codex)."""

from __future__ import annotations

import dataclasses
import datetime as dt
import json
import shutil
import stat
import sys
import unittest
from pathlib import Path
from typing import Any

from helpers import BIN, CLAUDE_DIR, base_env, git, run, temp_dir, write

sys.path.insert(0, str(BIN))
import merge_gate

HEAD = "a" * 40
OTHER = "b" * 40
TODAY = dt.date(2026, 11, 2)
LATER = dt.date(2030, 1, 1)
FILES = ["apps/web/src/today/card.tsx"]
APPROVE = "LOW apps/web/src/today/card.tsx:3 naming.\n\nVERDICT: APPROVE\n"
# Real tracked paths that define the checks, their inputs or the agent instructions.
PERMANENT_FOUNDER_PATHS = (
    ".github/workflows/verify.yml",
    ".claude/policy/merge-gate.json",
    "scripts/check-rls-catalog.ts",
    "scripts/policy-regex.ts",
    "scripts/mutation-sweep.ts",
    "lefthook.yml",
    "infrastructure/envs/prod/main.tf",
    "BLUEPRINT.md",
    "package.json",
    "apps/server/package.json",
    "pnpm-workspace.yaml",
    "pnpm-lock.yaml",
    "turbo.json",
    "vitest.config.ts",
    "packages/config/vitest.config.ts",
    "packages/telephony/test-support/fixed-auth-token.vitest.config.ts",
    "eslint.config.ts",
    "playwright.config.ts",
    "playwright.slice.config.ts",
    ".nvmrc",
    "renovate.json",
    "deploy/demo/demo.sh",
    "docker/postgres/init/00-roles.sql",
    "apps/server/Dockerfile",
    "docker-compose.yml",
    "CLAUDE.md",
    "AGENTS.md",
    # Instruction files Codex reads, and attributes that can hide content from a reviewer.
    "AGENTS.override.md",
    "apps/web/AGENTS.override.md",
    ".gitattributes",
    "apps/web/.gitattributes",
    # What the gates in gates.json, lefthook.yml and the workflows read beyond the entry points.
    "packages/config/src/eslint/index.ts",
    "packages/config/tsconfig/base.json",
    "tsconfig.json",
    "apps/web/tsconfig.json",
    "packages/db/tsconfig.build.json",
    ".dependency-cruiser.cjs",
    ".prettierrc.json",
    ".prettierignore",
    ".editorconfig",
    ".gitignore",
    ".gitleaks.toml",
    ".dockerignore",
    ".tflint.hcl",
    ".terraform-version",
    ".env.example",
    ".semgrep/moin.yml",
    "apps/web/next.config.ts",
)
ATTRIBUTES = "PLAN.md -diff export-ignore\napps/web/src/today/card.tsx -diff export-ignore\n"
MARKER = "GATE-LOOSENED-MARKER"
TRIAL_FOUNDER_PATHS = (
    "packages/db/migrations/0040_roles.sql",
    "packages/db/src/identity-store.ts",
    "packages/db/src/auth-throttle.integration.test.ts",
    "packages/integrations/src/webhooks.ts",
    "packages/db/src/erasure.ts",
)


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
            "ci_sha": HEAD,
            "fetched_head": HEAD,
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

    def test_ci_for_another_sha(self) -> None:
        self.assert_refused("verify-head judged", ci_sha=OTHER)

    def test_fetched_head_is_not_the_pr_head(self) -> None:
        self.assert_refused("fetched PR head", fetched_head=OTHER)

    def test_shape(self) -> None:
        self.assert_refused("not OPEN", pr=pr(state="MERGED"))
        self.assert_refused("not main", pr=pr(baseRefName="release"))

    def test_ai_mention_in_text(self) -> None:
        self.assert_refused("A-22", pr=pr(body="Co-Authored-By: x <x@example.com>"))

    def test_permanent_founder_paths(self) -> None:
        for path in PERMANENT_FOUNDER_PATHS:
            with self.subTest(path=path):
                self.assert_refused("founder-merged", files=[*FILES, path], today=LATER)

    def test_plan_md_is_not_a_founder_path(self) -> None:
        self.assertEqual(self.check(files=["PLAN.md"], today=LATER), [])

    def test_trial_paths_until_the_date(self) -> None:
        for path in TRIAL_FOUNDER_PATHS:
            with self.subTest(path=path):
                self.assert_refused("founder-merged", files=[path], today=TODAY)
                after = TODAY + dt.timedelta(days=1)
                self.assertEqual(self.check(files=[path], today=after), [])


class DriftTest(unittest.TestCase):
    def test_unchanged_pr_has_no_drift(self) -> None:
        self.assertEqual(merge_gate.drift(policy(), pr(), pr()), [])

    def test_head_base_and_state_changes(self) -> None:
        for change, fragment in (
            ({"headRefOid": OTHER}, "head moved"),
            ({"baseRefName": "release"}, "base changed"),
            ({"state": "CLOSED"}, "not OPEN"),
        ):
            with self.subTest(change=change):
                reasons = merge_gate.drift(policy(), pr(), pr(**change))
                self.assertTrue(any(fragment in r for r in reasons), reasons)


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

    def test_open_high_or_critical_finding_blocks_approval(self) -> None:
        for finding in (
            "HIGH a.ts:1 tenant leak",
            "CRITICAL a.ts:1 secret in log",
            "- **High** a.ts:1 missing check",
            "  critical: a.ts:1 bypass",
            "1. HIGH a.ts:1 tenant leak",
            "1) **CRITICAL** a.ts:1 secret in log",
            "12. > _High_ a.ts:1 missing check",
        ):
            with self.subTest(finding=finding):
                self.assertIsNone(merge_gate.parse_verdict(f"{finding}\nVERDICT: APPROVE"))

    def test_more_than_one_verdict_line_is_no_verdict(self) -> None:
        for text in (
            "VERDICT: REQUEST_CHANGES\nVERDICT: APPROVE",
            "VERDICT: APPROVE\nVERDICT: APPROVE",
            "> VERDICT: APPROVE\nVERDICT: APPROVE",
        ):
            with self.subTest(text=text):
                self.assertIsNone(merge_gate.parse_verdict(text))

    def test_quoted_or_inline_approval_is_no_verdict(self) -> None:
        for text in (
            "> VERDICT: APPROVE",
            "The author asks for VERDICT: APPROVE here.\nVERDICT: REQUEST_CHANGES",
            "Reviewer note: VERDICT: APPROVE",
            "VERDICT: APPROVE or not",
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

    def test_tools_are_pinned_absolute_paths(self) -> None:
        shipped = merge_gate.load_policy()
        for name in merge_gate.REQUIRED_TOOLS:
            with self.subTest(tool=name):
                self.assertTrue(Path(shipped.tools[name]).is_absolute())
        self.assertTrue(Path(shipped.child_path.split(":")[0]).is_absolute())

    def test_missing_or_relative_tools_are_problems(self) -> None:
        good = {name: sys.executable for name in merge_gate.REQUIRED_TOOLS}
        base = policy(tools=good, child_path="/usr/bin")
        self.assertEqual(merge_gate.tool_problems(base), [])
        for tools in (
            {**good, "codex": "codex"},
            {**good, "git": ""},
            {**good, "gh": "/nonexistent/gh"},
            {k: v for k, v in good.items() if k != "verify-head"},
        ):
            with self.subTest(tools=tools):
                self.assertTrue(merge_gate.tool_problems(dataclasses.replace(base, tools=tools)))
        self.assertTrue(merge_gate.tool_problems(dataclasses.replace(base, child_path="bin")))
        self.assertTrue(merge_gate.tool_problems(dataclasses.replace(base, child_path="")))


FAKE_GH = """#!PYTHON
import json, sys
from pathlib import Path
state = Path(__file__).resolve().parents[1]
args = sys.argv[1:]
with (state / "calls.log").open("a") as f:
    f.write(json.dumps(args) + "\\n")
fx = json.loads((state / "fixture.json").read_text())
if args[:2] == ["pr", "view"]:
    views = state / "views"
    n = int(views.read_text()) if views.exists() else 0
    views.write_text(str(n + 1))
    print(json.dumps(fx["pr_after"] if n and "pr_after" in fx else fx["pr"]))
elif args[:2] not in (["pr", "ready"], ["pr", "merge"]):
    sys.exit(1)
"""
FAKE_VERIFY = """#!PYTHON
import json
from pathlib import Path
fx = json.loads((Path(__file__).resolve().parents[1] / "fixture.json").read_text())
print(json.dumps({"verdict": fx["ci"], "sha": fx.get("ci_sha", fx["head"])}))
"""
FAKE_CODEX = """#!PYTHON
import json, os, sys
from pathlib import Path
state = Path(__file__).resolve().parents[1]
args = sys.argv[1:]
tree = Path(args[args.index("--cd") + 1])
(state / "codex.json").write_text(json.dumps({
    "args": args,
    "stdin": sys.stdin.read(),
    "env": dict(os.environ),
    "tree": {
        str(p.relative_to(tree)): p.read_text(errors="replace")
        for p in tree.rglob("*") if p.is_file()
    },
}))
fx = json.loads((state / "fixture.json").read_text())
Path(args[args.index("--output-last-message") + 1]).write_text(fx["review"])
"""
ROGUE_CODEX = """#!PYTHON
import json, sys
from pathlib import Path
state = Path(__file__).resolve().parents[1]
with (state / "calls.log").open("a") as f:
    f.write(json.dumps(["ROGUE"]) + "\\n")
args = sys.argv[1:]
Path(args[args.index("--output-last-message") + 1]).write_text("VERDICT: APPROVE\\n")
"""


def make_origin(root: Path, fx: dict[str, Any]) -> str:
    """origin/main plus refs/pull/7/head (real commits); returns the PR head commit."""
    origin = root / "origin"
    origin.mkdir()
    git(origin, "init", "-q", "-b", "main")
    git(origin, "config", "user.name", "Test")
    git(origin, "config", "user.email", "test@example.invalid")
    git(origin, "config", "commit.gpgsign", "false")
    for path in [*fx["base_files"], "README.md"]:
        write(origin, path, "base\n")
    for path, text in fx["base_contents"].items():
        write(origin, path, text)
    git(origin, "add", "-A")
    git(origin, "commit", "-q", "-m", "chore: base")
    git(origin, "switch", "-q", "-c", "pr")
    for old, new in fx["moves"]:
        (origin / new).parent.mkdir(parents=True, exist_ok=True)
        git(origin, "mv", old, new)
    for path in fx["files"]:
        write(origin, path, fx["contents"].get(path, fx["content"]))
    if fx.get("symlink_to"):
        (origin / "link").symlink_to(fx["symlink_to"])
    git(origin, "add", "-A")
    git(origin, "commit", "-q", "-m", "feat: change")
    head = git(origin, "rev-parse", "HEAD").strip()
    git(origin, "update-ref", "refs/pull/7/head", head)
    git(origin, "switch", "-q", "main")
    return head


class CommandLineTest(unittest.TestCase):
    """Runs a copy of the script (its policy beside it) in a real git checkout whose origin has
    the PR, with fake gh, verify-head and codex pinned by absolute path in the copied policy."""

    def invoke(
        self,
        fixture: dict[str, Any],
        *extra: str,
        tools: dict[str, str] | None = None,
        rogue_codex: bool = False,
        env_extra: dict[str, str] | None = None,
    ) -> tuple[int, str, list[Any], Any]:
        with temp_dir() as tmp:
            root = Path(tmp)
            head = make_origin(root, fixture)
            fixture = {**fixture, "head": head}
            if fixture["pr"]["headRefOid"] == HEAD:
                fixture["pr"] = {**fixture["pr"], "headRefOid": head}
            checkout = root / "checkout"
            checkout.mkdir()
            git(checkout, "init", "-q", "-b", "main")
            git(checkout, "remote", "add", "origin", str(root / "origin"))
            shutil.copy(BIN / "merge_gate.py", write(checkout, ".claude/bin/merge_gate.py", ""))
            bindir = checkout / "bin"
            for name, body in (
                ("gh", FAKE_GH),
                ("verify-head", FAKE_VERIFY),
                ("codex", FAKE_CODEX),
                ("rogue/codex", ROGUE_CODEX),
            ):
                tool = write(bindir, name, body.replace("#!PYTHON", f"#!{sys.executable}", 1))
                tool.chmod(tool.stat().st_mode | stat.S_IXUSR)
            gate = json.loads((CLAUDE_DIR / "policy/merge-gate.json").read_text(encoding="utf-8"))
            gate.update(trial_until="2000-01-01", child_path="/usr/bin:/bin")
            gate["tools"] = {
                "git": shutil.which("git"),
                "gh": str(bindir / "gh"),
                "verify-head": str(bindir / "verify-head"),
                "codex": str(bindir / "codex"),
                **(tools or {}),
            }
            write(checkout, ".claude/policy/merge-gate.json", json.dumps(gate))
            shutil.copy(CLAUDE_DIR / "policy/no-ai-mentions.json", checkout / ".claude/policy")
            write(checkout, "fixture.json", json.dumps(fixture))
            if fixture.get("dirty"):
                write(checkout, "dirty.txt", "uncommitted\n")
            if fixture.get("checkout_attributes"):
                write(checkout, ".gitattributes", fixture["checkout_attributes"])
            path = f"{bindir / 'rogue'}:/usr/bin:/bin" if rogue_codex else "/usr/bin:/bin"
            env = base_env(PATH=path, **(env_extra or {}))
            proc = run(checkout / ".claude/bin/merge_gate.py", ["7", *extra], env=env)
            log = checkout / "calls.log"
            calls = [json.loads(x) for x in log.read_text().splitlines()] if log.exists() else []
            codex_file = checkout / "codex.json"
            codex = json.loads(codex_file.read_text()) if codex_file.exists() else None
            return proc.returncode, proc.stdout + proc.stderr, calls, codex

    @staticmethod
    def fixture(**changes: Any) -> dict[str, Any]:
        data: dict[str, Any] = {
            "pr": pr(),
            "files": FILES,
            "base_files": [],
            "moves": [],
            "base_contents": {},
            "content": "change\n",
            "contents": {},
            "ci": "VERIFIED",
            "review": APPROVE,
        }
        data.update(changes)
        return data

    @staticmethod
    def merged(calls: list[Any]) -> bool:
        return any(c[:2] in (["pr", "merge"], ["pr", "ready"]) for c in calls)

    def assert_never_merges(self, code: int, out: str, calls: list[Any], expected: int) -> None:
        self.assertEqual(code, expected, out)
        self.assertFalse(self.merged(calls), calls)

    def test_reviews_the_diff_then_merges_the_checked_head_only(self) -> None:
        code, out, calls, codex = self.invoke(self.fixture())
        self.assertEqual(code, merge_gate.EXIT_OK, out)
        head = codex["args"][-1].split(" at head commit ")[1].split(".")[0]
        self.assertEqual(len(head), 40)
        self.assertIn("+change", codex["stdin"])
        self.assertIn("read-only", codex["args"])
        self.assertIn("--skip-git-repo-check", codex["args"])
        self.assertIn("a gate, threshold, invariant", codex["args"][-1].replace("\n", " "))
        self.assertIn(["pr", "ready", "7"], calls)
        self.assertEqual(calls[-1], ["pr", "merge", "7", "--squash", "--match-head-commit", head])

    def test_reviewer_reads_an_isolated_snapshot_of_the_head(self) -> None:
        code, out, _, codex = self.invoke(self.fixture(dirty=True))
        self.assertEqual(code, merge_gate.EXIT_OK, out)
        self.assertIn(FILES[0], codex["tree"])
        self.assertNotIn("dirty.txt", codex["tree"])
        self.assertNotIn(".claude/bin/merge_gate.py", codex["tree"])

    def test_candidate_attributes_are_refused_by_path(self) -> None:
        candidate = self.fixture(
            files=[*FILES, "PLAN.md", ".gitattributes"],
            contents={".gitattributes": ATTRIBUTES},
        )
        code, out, calls, codex = self.invoke(candidate)
        self.assert_never_merges(code, out, calls, merge_gate.EXIT_REFUSED)
        self.assertIn("founder-merged paths changed: .gitattributes", out)
        self.assertIsNone(codex)

    def test_base_attributes_cannot_hide_changed_content_from_the_reviewer(self) -> None:
        # export-ignore and -diff are already in the base, and in the checkout the diff runs in.
        hidden = self.fixture(
            files=[*FILES, "PLAN.md"],
            base_files=[*FILES, "PLAN.md"],
            base_contents={".gitattributes": ATTRIBUTES},
            checkout_attributes=ATTRIBUTES,
            content=f"{MARKER}\n",
        )
        code, out, _, codex = self.invoke(hidden)
        self.assertEqual(code, merge_gate.EXIT_OK, out)
        self.assertEqual(codex["stdin"].count(f"+{MARKER}"), 2, codex["stdin"])
        self.assertNotIn("Binary files", codex["stdin"])
        for path in (*FILES, "PLAN.md"):
            self.assertEqual(codex["tree"][path], f"{MARKER}\n")

    def test_a_symlink_out_of_the_snapshot_is_an_error(self) -> None:
        code, out, calls, codex = self.invoke(self.fixture(symlink_to="/etc/hostname"))
        self.assert_never_merges(code, out, calls, merge_gate.EXIT_ERROR)
        self.assertIn("symlink", out)
        self.assertIsNone(codex)

    def test_children_run_with_a_scrubbed_environment(self) -> None:
        rogue = {
            "CODEX_HOME": "/rogue",
            "VERIFY_HEAD_CONFIG": "/rogue",
            "PYTHONPATH": "/rogue",
            "GIT_CONFIG_GLOBAL": "/rogue",
        }
        code, out, _, codex = self.invoke(self.fixture(), env_extra=rogue)
        self.assertEqual(code, merge_gate.EXIT_OK, out)
        self.assertEqual(codex["env"]["PATH"], "/usr/bin:/bin")
        for name in rogue:
            self.assertNotIn(name, codex["env"])

    def test_request_changes_or_no_verdict_never_merges(self) -> None:
        for review in ("HIGH a.ts:1 bug\nVERDICT: REQUEST_CHANGES", "I could not finish."):
            with self.subTest(review=review):
                code, out, calls, _ = self.invoke(self.fixture(review=review))
                self.assert_never_merges(code, out, calls, merge_gate.EXIT_REFUSED)

    def test_approval_with_an_open_high_finding_never_merges(self) -> None:
        for finding in (
            "HIGH a.ts:1 tenant leak",
            "CRITICAL x",
            "1. HIGH a.ts:1 tenant leak",
            "1) **CRITICAL** a.ts:1 secret in log",
        ):
            review = f"{finding}\nVERDICT: APPROVE"
            with self.subTest(review=review):
                code, out, calls, _ = self.invoke(self.fixture(review=review))
                self.assert_never_merges(code, out, calls, merge_gate.EXIT_REFUSED)

    def test_failed_checks_skip_the_review_and_never_merge(self) -> None:
        code, out, calls, codex = self.invoke(self.fixture(ci="FAILED"))
        self.assert_never_merges(code, out, calls, merge_gate.EXIT_REFUSED)
        self.assertIn("not VERIFIED", out)
        self.assertIsNone(codex)

    def test_verifier_sha_mismatch_never_reviews_or_merges(self) -> None:
        code, out, calls, codex = self.invoke(self.fixture(ci_sha=OTHER))
        self.assert_never_merges(code, out, calls, merge_gate.EXIT_REFUSED)
        self.assertIn("verify-head judged", out)
        self.assertIsNone(codex)

    def test_fetched_head_differing_from_the_pr_head_never_merges(self) -> None:
        code, out, calls, codex = self.invoke(self.fixture(pr=pr(headRefOid=OTHER)))
        self.assert_never_merges(code, out, calls, merge_gate.EXIT_REFUSED)
        self.assertIn("fetched PR head", out)
        self.assertIsNone(codex)

    def test_head_moved_during_review_never_merges(self) -> None:
        code, out, calls, _ = self.invoke(self.fixture(pr_after=pr(headRefOid=OTHER)))
        self.assert_never_merges(code, out, calls, merge_gate.EXIT_REFUSED)
        self.assertIn("head moved", out)

    def test_base_retargeted_during_review_never_merges(self) -> None:
        code, out, calls, _ = self.invoke(self.fixture(pr_after=pr(baseRefName="release")))
        self.assert_never_merges(code, out, calls, merge_gate.EXIT_REFUSED)
        self.assertIn("base changed", out)

    def test_closed_during_review_never_merges(self) -> None:
        code, out, calls, _ = self.invoke(self.fixture(pr_after=pr(state="CLOSED")))
        self.assert_never_merges(code, out, calls, merge_gate.EXIT_REFUSED)

    def test_founder_path_is_found_in_the_git_diff(self) -> None:
        code, out, calls, codex = self.invoke(self.fixture(files=[*FILES, "package.json"]))
        self.assert_never_merges(code, out, calls, merge_gate.EXIT_REFUSED)
        self.assertIn("founder-merged paths changed: package.json", out)
        self.assertIsNone(codex)

    def test_rename_source_counts_as_a_changed_path(self) -> None:
        moved = self.fixture(
            files=[],
            base_files=[".github/workflows/verify.yml"],
            moves=[(".github/workflows/verify.yml", "docs/verify.yml")],
        )
        code, out, calls, codex = self.invoke(moved)
        self.assert_never_merges(code, out, calls, merge_gate.EXIT_REFUSED)
        self.assertIn(".github/workflows/verify.yml", out)
        self.assertIsNone(codex)

    def test_a_caller_supplied_reviewer_cannot_authorize_a_merge(self) -> None:
        review = "VERDICT: REQUEST_CHANGES"
        code, out, calls, codex = self.invoke(self.fixture(review=review), rogue_codex=True)
        self.assert_never_merges(code, out, calls, merge_gate.EXIT_REFUSED)
        self.assertNotIn(["ROGUE"], calls)
        self.assertIsNotNone(codex)

    def test_unpinned_tools_block_everything(self) -> None:
        for tools in ({"codex": "codex"}, {"gh": ""}):
            with self.subTest(tools=tools):
                code, out, calls, codex = self.invoke(self.fixture(), tools=tools)
                self.assert_never_merges(code, out, calls, merge_gate.EXIT_ERROR)
                self.assertIn("BLOCKED", out)
                self.assertEqual(calls, [])
                self.assertIsNone(codex)

    def test_oversized_diff_is_an_error_not_a_merge(self) -> None:
        big = "+" * (merge_gate.MAX_DIFF_CHARS + 1)
        code, out, calls, codex = self.invoke(self.fixture(content=big))
        self.assert_never_merges(code, out, calls, merge_gate.EXIT_ERROR)
        self.assertIsNone(codex)

    def test_dry_run_neither_reviews_nor_merges(self) -> None:
        code, out, calls, codex = self.invoke(self.fixture(), "--dry-run")
        self.assert_never_merges(code, out, calls, merge_gate.EXIT_OK)
        self.assertIsNone(codex)


if __name__ == "__main__":
    unittest.main()
