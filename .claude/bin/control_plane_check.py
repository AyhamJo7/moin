#!/usr/bin/env python3
"""control-plane-check: drift and tamper checks for the repository's session control plane.

Run from anywhere inside the repository (it is the first gate in .claude/gates.json):

  kit-manifest   every file in .claude/kit-manifest.json exists with the recorded sha256
  settings       .claude/settings.json parses; attribution object hides commit/PR text and the
                 session URL; bypass mode disabled; core deny rules present; every hook path
                 exists and is executable; no repo hook runs with --skip-headless
  claude-md      CLAUDE.md < 200 lines, no @PLAN.md / @BLUEPRINT.md import, and its INV index
                 equals the invariant table in PLAN.md
  skills         every .claude/skills/*/SKILL.md has name, description and
                 disable-model-invocation: true
  agents         every .claude/agents/*.md has name/description/tools and no write tools
  rules          every .claude/rules/*.md has a paths: frontmatter list
  policy         policy JSON parses; each no-AI example behaves as documented
  gates          .claude/gates.json parses and keeps the control-plane gate first
  cloud-pins     .claude/cloud/setup.sh pins equal .nvmrc / package.json packageManager /
                 .terraform-version once P02 creates them (skipped, with a note, before then)

Exit 0 when every check passes, 1 otherwise. Output: one line per check.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
import sys
from collections.abc import Callable, Sequence
from pathlib import Path
from typing import Any

EXIT_OK, EXIT_FAIL = 0, 1
MAX_CLAUDE_MD_LINES = 200
REQUIRED_DENY = (
    "Read(.env)",
    "Read(.env.*)",
    "Read(!.env.example)",
    "Edit(/BLUEPRINT.md)",
    "Bash(terraform apply *)",
    "Bash(terraform destroy *)",
    "Bash(gh pr merge *)",
    "Bash(git push --force *)",
)
WRITE_TOOLS = {"Edit", "Write", "MultiEdit", "NotebookEdit"}
FRONTMATTER_RE = re.compile(r"\A---\n(.*?)\n---\n", re.DOTALL)
IMPORT_RE = re.compile(r"(?<![`\w])@(?:\./)?(PLAN|BLUEPRINT)\.md\b")
INV_RE = re.compile(r"\bINV-(\d{2})\b")
INV_ROW_RE = re.compile(r"^\|\s*INV-(\d{2})\s*\|")
PIN_RE = re.compile(r"^readonly (NODE_VERSION|PNPM_VERSION|TERRAFORM_VERSION)=(\S+)", re.MULTILINE)
PATH_PLACEHOLDER = "${CLAUDE_PROJECT_DIR}"


class Check:
    def __init__(self, root: Path) -> None:
        self.root = root
        self.claude = root / ".claude"
        self.failed = False

    def report(self, name: str, problems: list[str], note: str = "") -> None:
        if problems:
            self.failed = True
            print(f"FAIL {name}: " + "; ".join(problems))
        else:
            print(f"OK   {name}" + (f" ({note})" if note else ""))


def frontmatter(path: Path) -> dict[str, str]:
    m = FRONTMATTER_RE.match(path.read_text(encoding="utf-8"))
    if not m:
        return {}
    fields: dict[str, str] = {}
    for line in m.group(1).splitlines():
        key, sep, value = line.partition(":")
        if sep and not line.startswith((" ", "-")):
            fields[key.strip()] = value.strip()
    return fields


def check_manifest(c: Check) -> None:
    problems: list[str] = []
    try:
        manifest = json.loads((c.claude / "kit-manifest.json").read_text(encoding="utf-8"))
        files: dict[str, Any] = manifest["files"]
    except (OSError, ValueError, KeyError) as exc:
        c.report("kit-manifest", [f"unreadable: {exc}"])
        return
    for rel, meta in files.items():
        path = c.root / rel
        if not path.is_file():
            problems.append(f"{rel} missing")
        elif hashlib.sha256(path.read_bytes()).hexdigest() != meta.get("sha256"):
            problems.append(f"{rel} differs from the pinned hash (drift or tampering)")
    c.report(
        "kit-manifest", problems, f"{len(files)} files @ kit {str(manifest.get('kit_commit'))[:7]}"
    )


def hook_paths(settings: dict[str, Any]) -> list[tuple[str, list[str]]]:
    found: list[tuple[str, list[str]]] = []
    for groups in (settings.get("hooks") or {}).values():
        for group in groups:
            for hook in group.get("hooks", []):
                parts = [str(hook.get("command", "")), *[str(a) for a in hook.get("args", [])]]
                found.append((str(hook.get("command", "")), parts))
    return found


def check_settings(c: Check) -> None:
    problems: list[str] = []
    try:
        settings = json.loads((c.claude / "settings.json").read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        c.report("settings", [f"unreadable: {exc}"])
        return
    attribution = settings.get("attribution")
    if attribution != {"commit": "", "pr": "", "sessionUrl": False}:
        problems.append("attribution must be the object form {commit:'', pr:'', sessionUrl:false}")
    perms = settings.get("permissions") or {}
    if perms.get("disableBypassPermissionsMode") != "disable":
        problems.append("permissions.disableBypassPermissionsMode must be 'disable'")
    deny = set(perms.get("deny") or [])
    problems += [f"deny rule missing: {r}" for r in REQUIRED_DENY if r not in deny]
    hooks = hook_paths(settings)
    if not hooks:
        problems.append("no hooks registered")
    for _command, parts in hooks:
        if "--skip-headless" in parts or "--defer-to-repo" in parts:
            problems.append("repo hooks must not use --skip-headless/--defer-to-repo")
        for part in parts:
            if part.startswith(PATH_PLACEHOLDER):
                path = c.root / part[len(PATH_PLACEHOLDER) :].lstrip("/")
                if not path.is_file() or not os.access(path, os.X_OK):
                    problems.append(f"{part} is not an executable file")
    c.report("settings", problems, f"{len(hooks)} hook handlers")


def plan_invariants(root: Path) -> set[str]:
    return {
        m.group(1)
        for line in (root / "PLAN.md").read_text(encoding="utf-8").splitlines()
        if (m := INV_ROW_RE.match(line))
    }


def check_claude_md(c: Check) -> None:
    problems: list[str] = []
    path = c.root / "CLAUDE.md"
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as exc:
        c.report("claude-md", [f"unreadable: {exc}"])
        return
    lines = text.count("\n") + (0 if text.endswith("\n") else 1)
    if lines >= MAX_CLAUDE_MD_LINES:
        problems.append(f"{lines} lines (limit < {MAX_CLAUDE_MD_LINES})")
    if IMPORT_RE.search(text):
        problems.append("imports PLAN.md or BLUEPRINT.md with @ (they must be read on demand)")
    try:
        in_plan = plan_invariants(c.root)
    except OSError:
        problems.append("PLAN.md unreadable (it must be committed; see the plan-baseline PR)")
        in_plan = set()
    in_md = set(INV_RE.findall(text))
    if in_plan and in_md != in_plan:
        missing = sorted(in_plan - in_md)
        extra = sorted(in_md - in_plan)
        problems.append(f"INV index drift: missing {missing}, unknown {extra}")
    c.report("claude-md", problems, f"{lines} lines, {len(in_md)} invariants")


def check_skills(c: Check) -> None:
    problems: list[str] = []
    skills = sorted((c.claude / "skills").glob("*/SKILL.md"))
    for path in skills:
        fm = frontmatter(path)
        name = path.parent.name
        if fm.get("name") != name or not fm.get("description"):
            problems.append(f"{name}: needs name: {name} and a description")
        if fm.get("disable-model-invocation") != "true":
            problems.append(f"{name}: needs disable-model-invocation: true")
    if not skills:
        problems.append("no skills found")
    c.report("skills", problems, f"{len(skills)} skills")


def check_agents(c: Check) -> None:
    problems: list[str] = []
    agents = sorted((c.claude / "agents").glob("*.md"))
    for path in agents:
        fm = frontmatter(path)
        tools = {t.strip() for t in fm.get("tools", "").split(",") if t.strip()}
        if fm.get("name") != path.stem or not fm.get("description") or not tools:
            problems.append(f"{path.stem}: needs name, description and an explicit tools list")
        if tools & WRITE_TOOLS:
            problems.append(
                f"{path.stem}: reviewers are read-only; remove {sorted(tools & WRITE_TOOLS)}"
            )
    if not agents:
        problems.append("no agents found")
    c.report("agents", problems, f"{len(agents)} agents")


def check_rules(c: Check) -> None:
    problems: list[str] = []
    rules = sorted((c.claude / "rules").glob("*.md"))
    for path in rules:
        m = FRONTMATTER_RE.match(path.read_text(encoding="utf-8"))
        if not m or not re.search(r"^paths:\s*\n(\s+- .+\n?)+", m.group(1) + "\n", re.MULTILINE):
            problems.append(f"{path.name}: needs a paths: list")
    if not rules:
        problems.append("no rules found")
    c.report("rules", problems, f"{len(rules)} path-scoped rules")


def check_policy(c: Check) -> None:
    problems: list[str] = []
    try:
        ai = json.loads((c.claude / "policy" / "no-ai-mentions.json").read_text(encoding="utf-8"))
        json.loads((c.claude / "policy" / "secret-paths.json").read_text(encoding="utf-8"))
        patterns = [re.compile(p["regex"]) for p in ai["patterns"]]
    except (OSError, ValueError, KeyError, re.error) as exc:
        c.report("policy", [f"unreadable: {exc}"])
        return
    problems += [
        f"not blocked: {e!r}"
        for e in ai["block_examples"]
        if not any(p.search(e) for p in patterns)
    ]
    problems += [
        f"wrongly blocked: {e!r}"
        for e in ai["allow_examples"]
        if any(p.search(e) for p in patterns)
    ]
    c.report("policy", problems, f"{len(patterns)} patterns")


def check_gates(c: Check) -> None:
    problems: list[str] = []
    try:
        gates = json.loads((c.claude / "gates.json").read_text(encoding="utf-8"))
        names = [g["name"] for g in gates["gates"]]
    except (OSError, ValueError, KeyError, TypeError) as exc:
        c.report("gates", [f"unreadable: {exc}"])
        return
    if not names or names[0] != "control-plane":
        problems.append("the control-plane gate must stay first")
    c.report("gates", problems, ", ".join(names))


def check_cloud_pins(c: Check) -> None:
    script = c.claude / "cloud" / "setup.sh"
    try:
        pins = dict(PIN_RE.findall(script.read_text(encoding="utf-8")))
    except OSError as exc:
        c.report("cloud-pins", [f"unreadable: {exc}"])
        return
    problems: list[str] = []
    compared: list[str] = []
    nvmrc = c.root / ".nvmrc"
    if nvmrc.is_file():
        compared.append(".nvmrc")
        want = nvmrc.read_text(encoding="utf-8").strip().lstrip("v")
        if pins.get("NODE_VERSION") != want:
            problems.append(f"NODE_VERSION {pins.get('NODE_VERSION')} != .nvmrc {want}")
    package = c.root / "package.json"
    if package.is_file():
        compared.append("package.json")
        try:
            manager = str(json.loads(package.read_text(encoding="utf-8")).get("packageManager", ""))
        except ValueError:
            manager = ""
        want = manager.split("@", 1)[1].split("+", 1)[0] if manager.startswith("pnpm@") else ""
        if pins.get("PNPM_VERSION") != want:
            problems.append(
                f"PNPM_VERSION {pins.get('PNPM_VERSION')} != packageManager {manager!r}"
            )
    tfv = c.root / ".terraform-version"
    if tfv.is_file():
        compared.append(".terraform-version")
        want = tfv.read_text(encoding="utf-8").strip()
        if pins.get("TERRAFORM_VERSION") != want:
            problems.append(f"TERRAFORM_VERSION {pins.get('TERRAFORM_VERSION')} != {want}")
    missing = [k for k in ("NODE_VERSION", "PNPM_VERSION", "TERRAFORM_VERSION") if k not in pins]
    problems += [f"setup.sh pin {k} missing" for k in missing]
    note = f"compared with {', '.join(compared)}" if compared else "no pin files yet (P02.02.01/08)"
    c.report("cloud-pins", problems, note)


CHECKS: tuple[Callable[[Check], None], ...] = (
    check_manifest,
    check_settings,
    check_claude_md,
    check_skills,
    check_agents,
    check_rules,
    check_policy,
    check_gates,
    check_cloud_pins,
)


def repo_root() -> Path:
    proc = subprocess.run(
        ["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True, check=False
    )
    if proc.returncode == 0:
        return Path(proc.stdout.strip())
    return Path(__file__).resolve().parents[2]


def main(argv: Sequence[str] | None = None) -> int:
    root = Path(argv[0]) if argv else repo_root()
    check = Check(root)
    for fn in CHECKS:
        try:
            fn(check)
        except Exception as exc:  # report, never crash silently
            check.report(fn.__name__.removeprefix("check_"), [f"{type(exc).__name__}: {exc}"])
    return EXIT_FAIL if check.failed else EXIT_OK


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
