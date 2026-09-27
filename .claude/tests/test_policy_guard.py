"""policy_guard.py on real repositories with realistic hook payloads."""

from __future__ import annotations

import json
import re
import shutil
import unittest
from collections.abc import Mapping
from pathlib import Path

from helpers import CLAUDE_DIR, HOOKS, base_env, git, make_repo, run_hook, temp_dir, write

GUARD = HOOKS / "policy_guard.py"
AI_POLICY = CLAUDE_DIR / "policy" / "no-ai-mentions.json"


class PolicyGuardCase(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = temp_dir()
        self.tmp = Path(self._tmp.name)
        self.repo = make_repo(self.tmp)
        self.home = self.tmp / "home"
        write(self.home, ".aws/credentials", "[default]\naws_access_key_id = FAKE\n")
        write(self.repo, ".env", "API_TOKEN=fake-value-for-tests\n")
        write(self.repo, ".env.example", "API_TOKEN=\n")
        write(self.repo, "PLAN.md", "# plan\n")
        write(self.repo, "BLUEPRINT.md", "# blueprint\n")
        write(self.repo, "docs/notes.md", "notes\n")
        write(self.repo, "msg-ai.txt", "chore: tidy\n\nWritten with help from Anthropic tools.\n")
        write(self.repo, "body-ai.md", "Summary\n\nhttps://claude.ai/code/session_01ABC\n")
        write(self.repo, "body-ok.md", "## What\nAdds the health route.\n")
        self.env = base_env(HOME=str(self.home), CLAUDE_PROJECT_DIR=str(self.repo))

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def bash(self, command: str) -> tuple[int, str]:
        payload = {"tool_name": "Bash", "tool_input": {"command": command}, "cwd": str(self.repo)}
        res = run_hook(GUARD, payload, env=self.env)
        return res.returncode, res.stderr

    def tool(self, name: str, tool_input: Mapping[str, object]) -> tuple[int, str]:
        payload = {"tool_name": name, "tool_input": tool_input, "cwd": str(self.repo)}
        res = run_hook(GUARD, payload, env=self.env)
        return res.returncode, res.stderr

    def assert_blocked(self, command: str, needle: str = "") -> None:
        code, err = self.bash(command)
        self.assertEqual(code, 2, f"expected block: {command!r}\n{err}")
        if needle:
            self.assertIn(needle, err, command)

    def assert_allowed(self, command: str) -> None:
        code, err = self.bash(command)
        self.assertEqual(code, 0, f"expected allow: {command!r}\n{err}")
        self.assertEqual(err, "")


class SecretsTest(PolicyGuardCase):
    def test_reading_secret_files_is_blocked_in_every_form(self) -> None:
        for command in [
            "cat .env",
            "head -1 .env",
            "/bin/cat .env",
            "base64 .env",
            "cp .env /tmp/leak",
            "source .env",
            ". ./.env",
            "cat .env*",
            "cat *",
            "git show HEAD:.env",
            "cat ~/.aws/credentials",
            "cat terraform.tfvars",
            "cat /mnt/c/Users/someone/.aws/credentials",
            "python3 -c \"print(open('.env').read())\"",
            "node -e \"require('dotenv').config(); console.log(process.env)\"",
            "grep -r API_TOKEN .",
            "grep -rn TOKEN",
            "rg -uu API_TOKEN",
            "sh -c 'cat .env'",
            "echo $(cat .env)",
            "echo x > .env",
            "python3 - <<'EOF'\nprint(open('.env').read())\nEOF",
        ]:
            with self.subTest(command=command):
                self.assert_blocked(command, "INV-15")

    def test_staging_secret_files_is_blocked(self) -> None:
        self.assert_blocked("git add .env", "INV-15")
        self.assert_blocked("git add -A && git commit -m 'chore: x'", "secret-bearing")
        self.assert_blocked("git add .", "secret-bearing")

    def test_harmless_secret_adjacent_commands_pass(self) -> None:
        for command in [
            "cat .env.example",
            "ls -la .env",
            "test -f .env && echo present",
            "rm .env",
            "grep -rn notes docs",
            "git grep API_TOKEN",
            "rg API_TOKEN",
            "echo '.env' >> .gitignore",
            "git add docs/notes.md",
        ]:
            with self.subTest(command=command):
                self.assert_allowed(command)

    def test_gitignored_secret_allows_git_add_all(self) -> None:
        write(self.repo, ".gitignore", ".env\n.env.*\n!.env.example\n")
        self.assert_allowed("git add -A")

    def test_file_tools(self) -> None:
        blocked: list[tuple[str, Mapping[str, object]]] = [
            ("Read", {"file_path": str(self.repo / ".env")}),
            ("Read", {"file_path": ".env"}),
            ("Read", {"file_path": str(self.home / ".aws" / "credentials")}),
            ("Read", {"file_path": "/mnt/c/Users/someone/.aws/credentials"}),
            ("Edit", {"file_path": ".env.local", "old_string": "a", "new_string": "b"}),
            ("Write", {"file_path": "prod.tfvars", "content": "x"}),
            ("Grep", {"pattern": "TOKEN", "path": str(self.repo)}),
            ("Grep", {"pattern": "TOKEN"}),
        ]
        for name, tool_input in blocked:
            with self.subTest(tool=name, input=tool_input):
                code, err = self.tool(name, tool_input)
                self.assertEqual(code, 2, err)
        allowed: list[tuple[str, Mapping[str, object]]] = [
            ("Read", {"file_path": str(self.repo / ".env.example")}),
            ("Read", {"file_path": str(self.repo / "docs" / "notes.md")}),
            ("Write", {"file_path": "docs/new.md", "content": "x"}),
            ("Grep", {"pattern": "notes", "path": str(self.repo / "docs")}),
        ]
        for name, tool_input in allowed:
            with self.subTest(tool=name, input=tool_input):
                self.assertEqual(self.tool(name, tool_input), (0, ""))

    def test_grep_tool_allowed_once_secret_is_gitignored(self) -> None:
        write(self.repo, ".gitignore", ".env\n")
        self.assertEqual(self.tool("Grep", {"pattern": "TOKEN", "path": str(self.repo)}), (0, ""))


class PushTest(PolicyGuardCase):
    def test_non_canonical_and_protected_pushes_are_blocked(self) -> None:
        for command in [
            "git -C . push",
            "git -c push.default=current push",
            "git --git-dir=.git push origin feat/p02-01-example",
            "/usr/bin/git push origin feat/p02-01-example",
            "sh -c 'git push origin feat/p02-01-example'",
            'bash -c "git push"',
            "eval git push origin feat/p02-01-example",
            "echo $(git push origin feat/p02-01-example)",
            "GIT_DIR=.git git push origin feat/p02-01-example",
            "git push origin main",
            "git push origin HEAD:main",
            "git push origin feat/x:refs/heads/master",
            "git push --force origin feat/p02-01-example",
            "git push -f origin feat/p02-01-example",
            "git push origin +feat/p02-01-example",
            "git push --all origin",
            "git push --no-verify origin feat/p02-01-example",
            "timeout 30 git -C . push",
        ]:
            with self.subTest(command=command):
                self.assert_blocked(command)

    def test_canonical_feature_branch_pushes_pass_to_the_ask_rule(self) -> None:
        for command in [
            "git push -u origin feat/p02-01-example",
            "git push origin HEAD",
            "git push",
            "git push --force-with-lease origin feat/p02-01-example",
        ]:
            with self.subTest(command=command):
                self.assert_allowed(command)

    def test_plain_push_from_main_is_blocked(self) -> None:
        git(self.repo, "switch", "-q", "main")
        self.assert_blocked("git push", "main")
        self.assert_blocked("git push origin HEAD", "main")

    def test_git_alias_for_push_is_resolved(self) -> None:
        git(self.repo, "config", "alias.pm", "push origin main")
        self.assert_blocked("git pm", "main")


class HookBypassTest(PolicyGuardCase):
    def test_skipping_hooks_is_blocked(self) -> None:
        for command in [
            "git commit --no-verify -m 'fix: x'",
            "git commit -nm 'fix: x'",
            "git commit -n -m 'fix: x'",
            "HUSKY=0 git commit -m 'fix: x'",
            "LEFTHOOK=0 git commit -m 'fix: x'",
            "git -c core.hooksPath=/dev/null commit -m 'fix: x'",
        ]:
            with self.subTest(command=command):
                self.assert_blocked(command)


class NoAiMentionsTest(PolicyGuardCase):
    def test_policy_examples_are_executable(self) -> None:
        data = json.loads(AI_POLICY.read_text(encoding="utf-8"))
        patterns = [re.compile(p["regex"]) for p in data["patterns"]]
        for example in data["block_examples"]:
            with self.subTest(block=example):
                self.assertTrue(any(p.search(example) for p in patterns))
        for example in data["allow_examples"]:
            with self.subTest(allow=example):
                self.assertFalse(any(p.search(example) for p in patterns))

    def test_policy_block_examples_block_real_commits(self) -> None:
        data = json.loads(AI_POLICY.read_text(encoding="utf-8"))
        for example in data["block_examples"]:
            with self.subTest(example=example):
                write(self.repo, "msg.txt", example)
                self.assert_blocked("git commit -F msg.txt", "A-22")
        for example in data["allow_examples"]:
            with self.subTest(example=example):
                write(self.repo, "msg.txt", example)
                self.assert_allowed("git commit -F msg.txt")

    def test_every_message_channel_is_checked(self) -> None:
        heredoc = (
            "git commit -m \"$(cat <<'EOF'\nfix(api): handle empty body\n\n"
            'Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>\nEOF\n)"'
        )
        for command in [
            "git commit -m 'fix: tweak retry loop, generated with Claude'",
            heredoc,
            "git commit -F msg-ai.txt",
            "git commit -am 'chore: AI-generated cleanup'",
            "git commit --trailer 'Co-authored-by: Claude <x@example.com>' -m 'fix: y'",
            'git commit -m "$MSG"',
            "git tag -a v0.1.0 -m 'release prepared by codex'",
            "git merge --no-ff -m 'Merge with Claude-Session: https://claude.ai/code/s' feat/x",
            "gh pr create --title 'chore: x' --body '\U0001f916 Generated with Claude Code'",
            "gh pr create --title 'chore: x' --body-file body-ai.md",
            "gh pr edit 2 --body 'See https://claude.ai/code/session_01ABC'",
            "gh issue comment 3 --body 'Anthropic says hi'",
            "gh api repos/o/r/pulls -f title='x' -f body='Generated by Claude'",
            "gh api repos/o/r/pulls -F body=@body-ai.md",
        ]:
            with self.subTest(command=command):
                self.assert_blocked(command)

    def test_domain_language_and_heredoc_messages_pass(self) -> None:
        heredoc = (
            "git commit -m \"$(cat <<'EOF'\nfeat(ai): add model gateway\n\n"
            'Routes all calls through the EU project (ADR-0012).\nEOF\n)"'
        )
        for command in [
            "git commit -m 'feat(ai): add model gateway with EU routing'",
            heredoc,
            "git add docs/notes.md && git commit -m 'docs: add notes'",
            "gh pr create --title 'feat(api): add health route' --body-file body-ok.md",
            "gh pr view 2",
        ]:
            with self.subTest(command=command):
                self.assert_allowed(command)

    def test_mcp_text_fields(self) -> None:
        code, err = self.tool(
            "mcp__github__create_pull_request",
            {"owner": "o", "repo": "r", "title": "chore: x", "body": "Generated with Claude Code"},
        )
        self.assertEqual(code, 2, err)
        code, _ = self.tool(
            "mcp__github__push_files",
            {"message": "chore: sync\n\nClaude-Session: https://claude.ai/code/x", "files": []},
        )
        self.assertEqual(code, 2)
        self.assertEqual(
            self.tool("mcp__github__create_pull_request", {"title": "chore: x", "body": "Adds x."}),
            (0, ""),
        )


class InfrastructureAndProvidersTest(PolicyGuardCase):
    def test_founder_only_operations_are_blocked(self) -> None:
        for command in [
            "terraform apply",
            "terraform destroy -auto-approve",
            "terraform -chdir=infrastructure/terraform/envs/staging apply",
            "cd infrastructure && terraform state rm aws_s3_bucket.x",
            "terraform import aws_s3_bucket.x b",
            "terraform workspace delete staging",
            "tofu apply",
            "stripe listen",
            "twilio phone-numbers:list",
            "AWS_PROFILE=moin-prod-admin aws s3 ls",
            "aws --profile moin-prod-admin sts get-caller-identity",
            "aws secretsmanager get-secret-value --secret-id x",
            "aws configure list",
            "aws ec2 terminate-instances --instance-ids i-1",
            "psql -h db.example.com -U app",
            "pg_dump postgres://app@prod.abc.eu-central-1.rds.amazonaws.com/moin",
            "PGHOST=10.0.0.5 psql",
        ]:
            with self.subTest(command=command):
                self.assert_blocked(command)

    def test_local_and_read_only_forms_pass(self) -> None:
        for command in [
            "terraform fmt -recursive",
            "terraform validate",
            "terraform init -backend=false",
            "terraform plan",
            "aws sts get-caller-identity",
            "psql -h localhost -U moin",
            "psql -h postgres -U moin",
        ]:
            with self.subTest(command=command):
                self.assert_allowed(command)


class SpecFilesTest(PolicyGuardCase):
    def test_blueprint_is_read_only_and_specs_are_not_read_whole(self) -> None:
        for command in [
            "sed -i s/a/b/ BLUEPRINT.md",
            "echo x >> BLUEPRINT.md",
            "rm BLUEPRINT.md",
            "git rm BLUEPRINT.md",
            "cat PLAN.md",
            "less BLUEPRINT.md",
        ]:
            with self.subTest(command=command):
                self.assert_blocked(command)
        for command in ["head -n 50 PLAN.md", "sed -n '1,40p' PLAN.md", "grep -n P02 PLAN.md"]:
            with self.subTest(command=command):
                self.assert_allowed(command)
        spec_writes: list[tuple[str, Mapping[str, object]]] = [
            ("Edit", {"file_path": "BLUEPRINT.md", "old_string": "a", "new_string": "b"}),
            ("Write", {"file_path": str(self.repo / "BLUEPRINT.md"), "content": "x"}),
            ("Read", {"file_path": "PLAN.md"}),
            ("Read", {"file_path": "PLAN.md", "offset": 1, "limit": 1000}),
        ]
        for name, tool_input in spec_writes:
            with self.subTest(tool=name, input=tool_input):
                self.assertEqual(self.tool(name, tool_input)[0], 2)
        self.assertEqual(
            self.tool("Read", {"file_path": "PLAN.md", "offset": 5, "limit": 120}), (0, "")
        )


class FailClosedTest(PolicyGuardCase):
    def test_unparseable_inputs_block(self) -> None:
        self.assertEqual(run_hook(GUARD, "{ not json", env=self.env).returncode, 2)
        self.assertEqual(run_hook(GUARD, {"tool_name": "Bash"}, env=self.env).returncode, 2)
        self.assert_blocked("echo 'unterminated", "could not parse")

    def test_missing_policy_file_blocks(self) -> None:
        clone = self.tmp / "clone" / ".claude"
        shutil.copytree(HOOKS, clone / "hooks", ignore=shutil.ignore_patterns("__pycache__"))
        payload = {"tool_name": "Bash", "tool_input": {"command": "ls"}, "cwd": str(self.repo)}
        res = run_hook(clone / "hooks" / "policy_guard.py", payload, env=self.env)
        self.assertEqual(res.returncode, 2)
        self.assertIn("policy files unreadable", res.stderr)

    def test_unrelated_tools_and_commands_pass_silently(self) -> None:
        self.assert_allowed("ls -la && git status && python3 --version")
        self.assertEqual(self.tool("TaskStop", {"task_id": "x"}), (0, ""))


if __name__ == "__main__":
    unittest.main()
