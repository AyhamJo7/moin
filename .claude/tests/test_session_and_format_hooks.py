"""session_bootstrap.py and format_on_edit.py: silent on greenfield, active once P02 files exist."""

from __future__ import annotations

import os
import re
import stat
import subprocess
import unittest
from pathlib import Path

from helpers import HOOKS, base_env, make_repo, run_hook, temp_dir, write

BOOT = HOOKS / "session_bootstrap.py"
FMT = HOOKS / "format_on_edit.py"


def executable(path: Path, body: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("#!/usr/bin/env bash\n" + body, encoding="utf-8")
    path.chmod(path.stat().st_mode | stat.S_IXUSR)


def node_version() -> str:
    out = subprocess.run(["node", "-v"], capture_output=True, text=True, check=False).stdout
    m = re.search(r"\d+\.\d+\.\d+", out)
    return m.group(0) if m else ""


class HookCase(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = temp_dir()
        self.tmp = Path(self._tmp.name)
        self.repo = make_repo(self.tmp)
        self.fakebin = self.tmp / "fakebin"
        self.env = base_env(CLAUDE_PROJECT_DIR=str(self.repo))

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def boot(self, env: dict[str, str] | None = None) -> tuple[int, str]:
        res = run_hook(BOOT, {"cwd": str(self.repo), "source": "startup"}, env=env or self.env)
        return res.returncode, res.stdout


class SessionBootstrapTest(HookCase):
    def test_greenfield_is_silent(self) -> None:
        self.assertEqual(self.boot(), (0, ""))

    def test_pin_mismatches_are_reported_once_pin_files_exist(self) -> None:
        write(self.repo, ".nvmrc", "0.0.1\n")
        write(self.repo, "package.json", '{"packageManager": "pnpm@0.0.2"}')
        write(self.repo, ".terraform-version", "0.0.3\n")
        code, out = self.boot()
        self.assertEqual(code, 0)
        self.assertIn("## Toolchain (moin)", out)
        for want in ("pinned 0.0.1", "pinned 0.0.2", "pinned 0.0.3"):
            self.assertIn(want, out)

    @unittest.skipUnless(node_version(), "node not installed")
    def test_matching_pin_is_silent(self) -> None:
        write(self.repo, ".nvmrc", f"v{node_version()}\n")
        self.assertEqual(self.boot(), (0, ""))

    def test_unparseable_input_is_reported_not_blocking(self) -> None:
        res = run_hook(BOOT, "{ nope", env=self.env)
        self.assertEqual(res.returncode, 0)
        self.assertIn("could not parse", res.stdout)

    def test_cloud_installs_dependencies_only_remotely(self) -> None:
        write(self.repo, "pnpm-lock.yaml", "lockfileVersion: '9.0'\n")
        executable(
            self.fakebin / "pnpm", 'mkdir -p node_modules && echo "$@" > node_modules/.args\n'
        )
        path = f"{self.fakebin}{os.pathsep}{os.environ['PATH']}"
        self.assertEqual(self.boot(base_env(CLAUDE_PROJECT_DIR=str(self.repo), PATH=path)), (0, ""))
        self.assertFalse((self.repo / "node_modules").exists())
        remote = base_env(CLAUDE_PROJECT_DIR=str(self.repo), PATH=path, CLAUDE_CODE_REMOTE="true")
        code, out = self.boot(remote)
        self.assertEqual(code, 0)
        self.assertIn("dependencies installed", out)
        self.assertEqual(
            (self.repo / "node_modules" / ".args").read_text().strip(), "install --frozen-lockfile"
        )

    def test_cloud_install_failure_is_reported(self) -> None:
        write(self.repo, "pnpm-lock.yaml", "lockfileVersion: '9.0'\n")
        executable(self.fakebin / "pnpm", 'echo "ERR_PNPM_OUTDATED_LOCKFILE" >&2; exit 1\n')
        path = f"{self.fakebin}{os.pathsep}{os.environ['PATH']}"
        code, out = self.boot(
            base_env(CLAUDE_PROJECT_DIR=str(self.repo), PATH=path, CLAUDE_CODE_REMOTE="true")
        )
        self.assertEqual(code, 0)
        self.assertIn("FAILED", out)
        self.assertIn("ERR_PNPM_OUTDATED_LOCKFILE", out)


class FormatOnEditTest(HookCase):
    def edit(self, rel: str) -> tuple[int, str]:
        payload = {
            "tool_name": "Edit",
            "tool_input": {"file_path": str(self.repo / rel)},
            "cwd": str(self.repo),
        }
        res = run_hook(FMT, payload, env=self.env)
        return res.returncode, res.stderr

    def test_no_formatter_is_a_silent_no_op(self) -> None:
        write(self.repo, "src/a.ts", "const a=1\n")
        self.assertEqual(self.edit("src/a.ts"), (0, ""))
        self.assertEqual((self.repo / "src/a.ts").read_text(), "const a=1\n")

    def test_repo_prettier_formats_code_but_never_markdown(self) -> None:
        executable(
            self.repo / "node_modules/.bin/prettier",
            'for f; do :; done; printf "formatted\\n" > "$f"\n',
        )
        write(self.repo, "src/a.ts", "const a=1\n")
        write(self.repo, "docs/b.md", "| a |b|\n")
        self.assertEqual(self.edit("src/a.ts"), (0, ""))
        self.assertEqual((self.repo / "src/a.ts").read_text(), "formatted\n")
        self.assertEqual(self.edit("docs/b.md"), (0, ""))
        self.assertEqual((self.repo / "docs/b.md").read_text(), "| a |b|\n")

    def test_formatter_error_is_surfaced(self) -> None:
        executable(
            self.repo / "node_modules/.bin/prettier",
            'echo "SyntaxError: Unexpected token" >&2; exit 2\n',
        )
        write(self.repo, "src/a.ts", "const = \n")
        code, err = self.edit("src/a.ts")
        self.assertEqual(code, 2)
        self.assertIn("SyntaxError", err)

    def test_files_outside_the_repository_are_ignored(self) -> None:
        executable(self.repo / "node_modules/.bin/prettier", "exit 3\n")
        outside = write(self.tmp, "elsewhere/x.ts", "x\n")
        payload = {
            "tool_name": "Write",
            "tool_input": {"file_path": str(outside)},
            "cwd": str(self.repo),
        }
        self.assertEqual(run_hook(FMT, payload, env=self.env).returncode, 0)


if __name__ == "__main__":
    unittest.main()
