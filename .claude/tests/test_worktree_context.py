# ruff: noqa: E402
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from typing import Any
from unittest.mock import patch

BASE = Path(__file__).resolve().parents[1] / "hooks"
sys.path.insert(0, str(BASE))
import _kit
import claim_check
import stop_guard
import worktree_context

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "bin"))
import gates


def git(path: Path, *args: str) -> str:
    proc = subprocess.run(
        ["git", "-C", str(path), *args], capture_output=True, text=True, check=True
    )
    return proc.stdout.strip()


class LinkedWorktreeContext(unittest.TestCase):
    def test_active_worktree_governs_progress_and_claims(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / "root"
            root.mkdir()
            git(root, "init", "-b", "main")
            git(root, "config", "user.email", "test@example.test")
            git(root, "config", "user.name", "Test")
            (root / "PROGRESS.md").write_text("---\nstatus: active\nmode: autonomous\n---\n")
            git(root, "add", "PROGRESS.md")
            git(root, "commit", "-m", "base")
            branch = Path(temp) / "branch"
            git(root, "worktree", "add", "-b", "feature", str(branch))
            with patch.dict(os.environ, {"CLAUDE_PROJECT_DIR": str(root)}):
                payload: dict[str, Any] = {
                    "session_id": "linked-session",
                    "cwd": str(root),
                    "tool_input": {"command": f"cd {branch} && git status"},
                }
                self.assertEqual(worktree_context.capture(payload, root), branch)
                self.assertEqual(_kit.repo_root(str(root), "linked-session"), branch)
                self.assertEqual(claim_check.active_root(payload), (branch, None))
                self.assertNotEqual(_kit.evidence_dir(root), _kit.evidence_dir(branch))
                root_evidence = {
                    "head": git(root, "rev-parse", "HEAD"),
                    "result": "pass",
                    "gates": [],
                    "fingerprint_before": gates.fingerprint(root),
                    "fingerprint_after": gates.fingerprint(root),
                    "code_fingerprint_before": gates.fingerprint(root, exclude_docs=True),
                    "code_fingerprint_after": gates.fingerprint(root, exclude_docs=True),
                }
                (_kit.evidence_dir(root) / "latest-full.json").write_text(json.dumps(root_evidence))
                self.assertIsNone(claim_check.completion_problem(root))
                self.assertFalse((_kit.evidence_dir(branch) / "latest-full.json").exists())
                self.assertIn(
                    "no `gates full` evidence", claim_check.completion_problem(branch) or ""
                )
                state: dict[str, Any] = {}
                crons = {"session_crons": [{"id": "watch"}]}
                self.assertIsNone(stop_guard.stall_check(branch, crons, state))
                root_fp = stop_guard.loop_fingerprint(root)
                (branch / "new-work.txt").write_text("progress")
                self.assertIsNone(stop_guard.stall_check(branch, crons, state))
                self.assertEqual(state["stalls"], 0)
                self.assertEqual(stop_guard.loop_fingerprint(root), root_fp)
                self.assertIsNone(stop_guard.stall_check(branch, crons, state))
                self.assertIsNotNone(stop_guard.stall_check(branch, crons, state))
                git(branch, "add", "new-work.txt")
                git(branch, "commit", "-m", "progress in linked worktree")
                # The hook records again after every tool call that names the worktree.
                self.assertEqual(worktree_context.capture(payload, root), branch)
                (_kit.evidence_dir(branch) / "latest-full.json").write_text(
                    json.dumps(root_evidence)
                )
                self.assertIn("different tree", claim_check.completion_problem(branch) or "")
                git(root, "worktree", "remove", "--force", str(branch))
                # Stall and type checks fall back to the cwd root instead of raising.
                self.assertEqual(_kit.repo_root(str(root), "linked-session"), root)
                # A claim does not: the removed branch's work is not on root, whose evidence passes.
                fallback, removed = claim_check.active_root(payload)
                self.assertEqual(fallback, root)
                self.assertIn("was removed", removed or "")
                claim = {**payload, "last_assistant_message": "All gates are green."}
                with patch.dict(os.environ, {"GATES_CONFIG": "gates.json"}):
                    _, problem = claim_check.evaluate(claim, 900)
                self.assertIn("was removed", problem or "")
                # The recorded commit decides, not the branch: resetting it to root changes nothing.
                work = git(root, "rev-parse", "feature")
                git(root, "branch", "-f", "feature", "main")
                self.assertIn("was removed", claim_check.active_root(payload)[1] or "")
                # Once the work is on root (squash merge), root's evidence may stand for it.
                git(root, "merge", "--squash", work)
                git(root, "commit", "-m", "squash feature")
                self.assertEqual(claim_check.active_root(payload), (root, None))
                # Another repository holding the same content is not this session's checkout.
                other = Path(temp) / "other"
                git(Path(temp), "clone", "-q", str(root), str(other))
                foreign = {**payload, "cwd": str(other)}
                self.assertIn("was removed", claim_check.active_root(foreign)[1] or "")
                # A revert after the merge takes the work off root again.
                git(root, "revert", "--no-edit", "HEAD")
                self.assertIn("was removed", claim_check.active_root(payload)[1] or "")
                branch.mkdir()
                git(branch, "init", "-b", "main")
                with self.assertRaisesRegex(RuntimeError, "no longer valid"):
                    _kit.repo_root(str(root), "linked-session")
                with self.assertRaisesRegex(RuntimeError, "no longer valid"):
                    claim_check.active_root(payload)


if __name__ == "__main__":
    unittest.main()
