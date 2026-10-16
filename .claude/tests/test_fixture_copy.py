"""Keep temporary control-plane fixtures bounded independently of live worktrees."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import test_control_plane

EXCLUDED = ("worktrees", "node_modules", "state", "__pycache__")


def make_source(parent: Path) -> tuple[Path, Path]:
    """A control-plane source with configuration and hooks, plus an external directory."""
    source = parent / "source"
    (source / "hooks").mkdir(parents=True)
    (source / "settings.json").write_text("{}")
    (source / "hooks/guard.py").write_text("# fixture")
    external = parent / "external"
    external.mkdir()
    (external / "payload").write_text("must not be duplicated")
    output = parent / "output"
    output.mkdir()
    return source, external


def clone(source: Path, parent: Path) -> Path:
    with patch.object(test_control_plane, "CLAUDE_DIR", source):
        return test_control_plane.clone_control_plane(parent / "output")


class FixtureCopyTest(unittest.TestCase):
    def test_copy_excludes_runtime_trees_and_preserves_configuration(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            parent = Path(tmp)
            source, external = make_source(parent)
            for excluded in EXCLUDED:
                (source / excluded).mkdir()
                (source / excluded / "do-not-copy").write_text("runtime data")
            # pnpm links inside a runtime tree are skipped with it, not refused.
            (source / "node_modules/linked").symlink_to(external, target_is_directory=True)
            copy = clone(source, parent)
            self.assertEqual((copy / ".claude/settings.json").read_text(), "{}")
            self.assertTrue((copy / ".claude/hooks/guard.py").is_file())
            for excluded in EXCLUDED:
                with self.subTest(excluded=excluded):
                    self.assertFalse((copy / ".claude" / excluded).exists())

    def test_copy_refuses_symlinks_instead_of_following_or_keeping_them(self) -> None:
        for name in ("linked-dir", "hooks/linked-file.py"):
            with self.subTest(link=name), tempfile.TemporaryDirectory() as tmp:
                parent = Path(tmp)
                source, external = make_source(parent)
                target = external if name == "linked-dir" else external / "payload"
                (source / name).symlink_to(target, target_is_directory=target.is_dir())
                with self.assertRaisesRegex(ValueError, "symlink in the control-plane fixture"):
                    clone(source, parent)
                self.assertEqual([p.name for p in (parent / "output").rglob("payload")], [])
                self.assertEqual((external / "payload").read_text(), "must not be duplicated")

    def test_failed_setup_cleans_up_its_temporary_directory(self) -> None:
        cases = (
            ("ControlPlaneCheckTest", "test_clean_copy_passes", "clone_control_plane"),
            (
                "HookWiringTest",
                "test_every_handler_starts_and_accepts_a_harmless_event",
                "make_repo",
            ),
        )
        for cls, method, failing in cases:
            with self.subTest(cls=cls), tempfile.TemporaryDirectory() as parent:
                temporary = tempfile.TemporaryDirectory(dir=parent)
                path = Path(temporary.name)
                case = getattr(test_control_plane, cls)(method)
                with (
                    patch.object(test_control_plane, "temp_dir", return_value=temporary),
                    patch.object(test_control_plane, failing, side_effect=OSError("setup failed")),
                ):
                    result = unittest.TestResult()
                    case.run(result)
                self.assertEqual(len(result.errors), 1, result.errors)
                self.assertFalse(path.exists())
