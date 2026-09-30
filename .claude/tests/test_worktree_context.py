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
                self.assertEqual(claim_check.active_root(payload), branch)
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
                (_kit.evidence_dir(branch) / "latest-full.json").write_text(
                    json.dumps(root_evidence)
                )
                self.assertIn("different tree", claim_check.completion_problem(branch) or "")
                git(root, "worktree", "remove", "--force", str(branch))
                with self.assertRaisesRegex(RuntimeError, "no longer valid"):
                    _kit.repo_root(str(root), "linked-session")
                with self.assertRaisesRegex(RuntimeError, "no longer valid"):
                    claim_check.active_root(payload)
                branch.mkdir()
                git(branch, "init", "-b", "main")
                with self.assertRaisesRegex(RuntimeError, "no longer valid"):
                    _kit.repo_root(str(root), "linked-session")
                with self.assertRaisesRegex(RuntimeError, "no longer valid"):
                    claim_check.active_root(payload)


if __name__ == "__main__":
    unittest.main()
