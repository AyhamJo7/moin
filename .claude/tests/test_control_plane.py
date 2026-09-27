"""control_plane_check.py (clean tree passes; each tamper is caught), reference drift, and the
settings.json hook wiring executed exactly as Claude Code invokes it."""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import unittest
from pathlib import Path

from helpers import BIN, CLAUDE_DIR, REPO_ROOT, base_env, git, run, temp_dir, write

CHECK = BIN / "control_plane_check.py"
PLAN_TOOL = BIN / "plan_section.py"
HAS_PLAN = (REPO_ROOT / "PLAN.md").is_file()
REFERENCE_RE = re.compile(r'--section "([^"]+)"|--id ([A-Z]+-\d+)(?![0-9x])')
PLACEHOLDER = "${CLAUDE_PROJECT_DIR}"


def clone_control_plane(dest: Path) -> Path:
    """A throwaway git repo holding a copy of the control plane, CLAUDE.md and PLAN.md."""
    root = dest / "clone"
    root.mkdir()
    git(root, "init", "-q", "-b", "main")
    shutil.copytree(
        CLAUDE_DIR, root / ".claude", ignore=shutil.ignore_patterns("__pycache__", "state")
    )
    shutil.copy2(REPO_ROOT / "CLAUDE.md", root / "CLAUDE.md")
    shutil.copy2(REPO_ROOT / "PLAN.md", root / "PLAN.md")
    return root


@unittest.skipUnless(HAS_PLAN, "PLAN.md not present")
class ControlPlaneCheckTest(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = temp_dir()
        self.root = clone_control_plane(Path(self._tmp.name))

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def check(self) -> tuple[int, str]:
        res = run(CHECK, [str(self.root)])
        return res.returncode, res.stdout

    def assert_caught(self, check_name: str, needle: str) -> None:
        code, out = self.check()
        self.assertEqual(code, 1, out)
        line = next((ln for ln in out.splitlines() if ln.startswith(f"FAIL {check_name}")), "")
        self.assertIn(needle, line, out)

    def test_clean_copy_passes(self) -> None:
        code, out = self.check()
        self.assertEqual(code, 0, out)

    def test_edited_kit_file_is_drift(self) -> None:
        guard = self.root / ".claude/hooks/git_guard.py"
        guard.write_text(guard.read_text() + "\n# local tweak\n")
        self.assert_caught("kit-manifest", "git_guard.py differs")

    def test_settings_tampering(self) -> None:
        path = self.root / ".claude/settings.json"
        settings = json.loads(path.read_text())
        settings["attribution"] = False
        settings["permissions"]["deny"].remove("Read(!.env.example)")
        settings["permissions"]["disableBypassPermissionsMode"] = None
        path.write_text(json.dumps(settings))
        code, out = self.check()
        self.assertEqual(code, 1)
        for needle in ("attribution", "disableBypassPermissionsMode", "Read(!.env.example)"):
            self.assertIn(needle, out)

    def test_non_executable_hook_is_caught(self) -> None:
        (self.root / ".claude/hooks/policy_guard.py").chmod(0o644)
        self.assert_caught("settings", "policy_guard.py is not an executable file")

    def test_claude_md_import_length_and_invariant_drift(self) -> None:
        md = self.root / "CLAUDE.md"
        text = md.read_text().replace(
            "- INV-20 billing derives from our own immutable usage ledger\n", ""
        )
        md.write_text(text + "\nSee @PLAN.md\n")
        code, out = self.check()
        self.assertEqual(code, 1)
        self.assertIn("imports PLAN.md", out)
        self.assertIn("missing ['20']", out)
        md.write_text("x\n" * 205)
        self.assert_caught("claude-md", "205 lines")

    def test_skill_without_manual_only_flag_is_caught(self) -> None:
        skill = self.root / ".claude/skills/phase/SKILL.md"
        skill.write_text(skill.read_text().replace("disable-model-invocation: true\n", ""))
        self.assert_caught("skills", "phase: needs disable-model-invocation: true")

    def test_reviewer_with_write_tools_is_caught(self) -> None:
        agent = self.root / ".claude/agents/security-reviewer.md"
        agent.write_text(agent.read_text().replace("tools: Read,", "tools: Edit, Read,", 1))
        self.assert_caught("agents", "read-only")

    def test_cloud_pins_follow_p02_pin_files(self) -> None:
        write(self.root, ".nvmrc", "v24.21.0\n")
        write(self.root, "package.json", '{"packageManager": "pnpm@10.34.5"}')
        write(self.root, ".terraform-version", "1.16.4\n")
        self.assertEqual(self.check()[0], 0)
        write(self.root, ".nvmrc", "v24.99.0\n")
        self.assert_caught("cloud-pins", "NODE_VERSION 24.21.0 != .nvmrc 24.99.0")

    def test_gates_order_is_enforced(self) -> None:
        path = self.root / ".claude/gates.json"
        gates = json.loads(path.read_text())
        gates["gates"].reverse()
        path.write_text(json.dumps(gates))
        self.assert_caught("gates", "control-plane gate must stay first")


@unittest.skipUnless(HAS_PLAN, "PLAN.md not present")
class ReferenceDriftTest(unittest.TestCase):
    def test_every_plan_reference_resolves(self) -> None:
        files = [
            REPO_ROOT / "CLAUDE.md",
            *sorted(CLAUDE_DIR.glob("rules/*.md")),
            *sorted(CLAUDE_DIR.glob("skills/*/SKILL.md")),
            *sorted(CLAUDE_DIR.glob("agents/*.md")),
        ]
        seen: set[tuple[str, str]] = set()
        for path in files:
            for m in REFERENCE_RE.finditer(path.read_text(encoding="utf-8")):
                ref = ("--section", m.group(1)) if m.group(1) else ("--id", m.group(2))
                if ref in seen:
                    continue
                seen.add(ref)
                with self.subTest(file=path.name, ref=ref):
                    self.assertEqual(run(PLAN_TOOL, list(ref)).returncode, 0)
        self.assertGreater(len(seen), 10)


class HookWiringTest(unittest.TestCase):
    """Run every settings.json handler the way Claude Code does (exec form, placeholders substituted)."""

    def setUp(self) -> None:
        self._tmp = temp_dir()
        self.state = Path(self._tmp.name)
        self.settings = json.loads((CLAUDE_DIR / "settings.json").read_text(encoding="utf-8"))

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def invoke(
        self, hook: dict[str, object], payload: dict[str, object]
    ) -> subprocess.CompletedProcess[str]:
        def sub(value: object) -> str:
            text = str(value).replace(PLACEHOLDER, str(REPO_ROOT))
            return text.replace(str(REPO_ROOT / ".claude/state"), str(self.state))

        args = hook.get("args")
        argv = [sub(hook["command"]), *[sub(a) for a in (args if isinstance(args, list) else [])]]
        env = base_env(CLAUDE_PROJECT_DIR=str(REPO_ROOT))
        return subprocess.run(
            argv,
            input=json.dumps(payload),
            capture_output=True,
            text=True,
            env=env,
            timeout=120,
            check=False,
        )

    def test_every_handler_starts_and_accepts_a_harmless_event(self) -> None:
        events: dict[str, dict[str, object]] = {
            "SessionStart": {"cwd": str(REPO_ROOT), "source": "startup", "session_id": "wiring"},
            "PreToolUse": {
                "tool_name": "Bash",
                "tool_input": {"command": "git status"},
                "cwd": str(REPO_ROOT),
            },
            "PostToolUse": {
                "tool_name": "Edit",
                "tool_input": {"file_path": str(REPO_ROOT / "CLAUDE.md")},
                "cwd": str(REPO_ROOT),
            },
            "Stop": {
                "cwd": str(REPO_ROOT),
                "session_id": "wiring",
                "stop_hook_active": False,
                "last_assistant_message": "Read the ledger.",
                "session_crons": [],
                "background_tasks": [],
            },
            "StopFailure": {"cwd": str(REPO_ROOT), "session_id": "wiring", "error": "server_error"},
        }
        count = 0
        for event, groups in self.settings["hooks"].items():
            for group in groups:
                for hook in group["hooks"]:
                    count += 1
                    with self.subTest(event=event, hook=hook["args"]):
                        res = self.invoke(hook, events[event])
                        self.assertEqual(res.returncode, 0, res.stderr)
        self.assertEqual(count, 12)

    def test_policy_guard_blocks_through_the_real_wiring(self) -> None:
        hook = next(
            h
            for g in self.settings["hooks"]["PreToolUse"]
            if g["matcher"] == "Bash"
            for h in g["hooks"]
            if "policy_guard" in h["command"]
        )
        res = self.invoke(
            hook,
            {
                "tool_name": "Bash",
                "tool_input": {"command": "git -C . push"},
                "cwd": str(REPO_ROOT),
            },
        )
        self.assertEqual(res.returncode, 2)
        self.assertIn("bypasses the permission prompt", res.stderr)
        self.assertTrue((self.state / "hooks.log").is_file())

    def test_hooks_are_executable_and_kit_state_stays_out_of_git(self) -> None:
        for path in sorted((CLAUDE_DIR / "hooks").glob("*.py")):
            if path.name != "_kit.py":
                with self.subTest(hook=path.name):
                    self.assertTrue(os.access(path, os.X_OK))
        ignore = (CLAUDE_DIR / ".gitignore").read_text()
        self.assertIn("state/", ignore)


if __name__ == "__main__":
    unittest.main()
