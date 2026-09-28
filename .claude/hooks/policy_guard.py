#!/usr/bin/env python3
"""policy-guard: PreToolUse hook for the moin repository's non-negotiable session policies.

Complements the settings.json permission rules, which match only the command text Claude
usually writes (`git -C . push`, `/usr/bin/git push`, `sh -c '...'` slip past them), and the
kit's git_guard (which protects uncommitted work). Registered for Bash, the file tools
(Read/Edit/Write/MultiEdit/NotebookEdit/Grep) and MCP tools. Blocks (exit 2, reason to Claude):

  secrets (INV-15)    reading/grepping/copying/sourcing/staging files in policy/secret-paths.json;
                      `grep -r` over a directory that holds one; `git add -A` that would stage one
  no-AI text (A-22)   AI-tool mentions or attribution (policy/no-ai-mentions.json) in commit, tag
                      and merge messages, commit trailers, and gh PR/issue/release text; also in
                      the title/body/message fields of MCP tools (GitHub MCP, remote GitHub tools)
  push                any push to main/master; --force/-f/+refspec; --all/--mirror; and push forms
                      the `ask` rule cannot see (git -C/-c/--git-dir, absolute git path, sh -c,
                      eval), so every push reaches the founder's approval prompt
  hook bypass         --no-verify, `git commit -n`, core.hooksPath overrides, HUSKY=0, LEFTHOOK=0
  infrastructure      terraform/tofu apply, destroy, import, state, force-unlock, taint, untaint,
                      login, workspace delete, and -auto-approve anywhere (QG-05: founder only)
  providers           stripe and twilio CLIs; aws with a production profile or credential/
                      destructive operations; psql/pg_dump/pg_restore against a non-local host
                      (INV-16)
  spec files          any write to BLUEPRINT.md (read-only); whole-file reads of PLAN.md or
                      BLUEPRINT.md (use .claude/bin/plan_section.py or Read with limit <= 400)

Fails closed: unparseable hook input, an unparseable command, an unreadable policy file or an
internal error blocks the call. Stays fast: git is only consulted for push/add checks.
Options: --log FILE  append one JSON line per block decision.
"""

from __future__ import annotations

import argparse
import contextlib
import datetime as dt
import fnmatch
import json
import os
import re
import subprocess
import sys
from collections.abc import Iterator, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
from git_guard import (  # kit tokenizer, pinned by kit-manifest.json
    ASSIGNMENT_RE,
    REDIRECT_RE,
    SEPARATORS,
    GuardParseError,
    expand,
    git_alias,
    strip_heredocs,
    strip_prefixes,
    tokenize,
)

EXIT_ALLOW, EXIT_BLOCK = 0, 2
POLICY_DIR = Path(__file__).resolve().parent.parent / "policy"
PROTECTED_BRANCHES = frozenset({"main", "master"})
SPEC_FILES = frozenset({"PLAN.md", "BLUEPRINT.md"})
READ_ONLY_SPEC = "BLUEPRINT.md"
MAX_SPEC_READ_LINES = 400
MAX_NESTING = 3
MAX_MESSAGE_FILE_BYTES = 256 * 1024
MAX_WALK_ENTRIES = 20000
MAX_GLOB_MATCHES = 2000
FILE_TOOLS = frozenset({"Read", "Edit", "Write", "MultiEdit", "NotebookEdit", "Grep"})
WRITE_TOOLS = frozenset({"Edit", "Write", "MultiEdit", "NotebookEdit"})
MCP_TEXT_KEYS = frozenset(
    {"title", "body", "message", "commit_message", "commit_title", "description", "notes"}
)
SHELLS = frozenset({"sh", "bash", "zsh", "dash", "ksh"})
EXTRA_WRAPPERS = frozenset({"setsid", "stdbuf", "ionice", "chrt", "taskset", "unbuffer", "doas"})
# Commands that never read file content: a secret path as their argument is harmless.
NON_READING = frozenset({"echo", "printf", "rm", "rmdir", "ls", "test", "[", "touch", "stat"})
NON_READING_GIT = frozenset({"status", "check-ignore", "ls-files", "rm", "log", "diff"})
RECURSIVE_GREPS = frozenset({"grep", "egrep", "fgrep"})
IGNORE_AWARE_SEARCH = frozenset({"rg", "ag"})
SPEC_WHOLE_READERS = frozenset({"cat", "less", "more", "bat", "batcat", "nl", "tac"})
INPLACE_EDITORS = frozenset({"sed", "perl", "ruby"})
WRITERS = frozenset({"tee", "truncate", "dd", "mv", "cp", "install", "rsync", "ln", "shred"})
INTERPRETERS = frozenset({"python", "python3", "node", "ruby", "perl", "php", "deno", "bun"})
TERRAFORM = frozenset({"terraform", "tofu"})
TERRAFORM_BLOCKED = frozenset(
    {"apply", "destroy", "import", "state", "force-unlock", "taint", "untaint", "login"}
)
PROVIDER_CLIS = frozenset({"stripe", "twilio"})
DESTROYERS = frozenset({"rm", "rmdir", "unlink", "shred", "truncate"})
MODE_CHANGERS = frozenset({"chmod", "chown", "chgrp", "chattr", "setfacl"})
COPIERS = frozenset({"cp", "mv", "install", "ln", "rsync"})
GIT_PLUMBING = frozenset(
    {
        "update-index",
        "read-tree",
        "checkout-index",
        "commit-tree",
        "update-ref",
        "symbolic-ref",
        "replace",
        "filter-branch",
        "filter-repo",
        "fast-import",
    }
)
GIT_VALUE_FLAGS = frozenset(
    {
        "-m",
        "--message",
        "-F",
        "--file",
        "--conflict",
        "-s",
        "--strategy",
        "-X",
        "--strategy-option",
        "--source",
        "-U",
        "--unified",
        "--onto",
        "-o",
        "--push-option",
    }
)
SENSITIVE_GIT_CONFIG = (
    "core.fsmonitor",
    "core.sshcommand",
    "core.editor",
    "core.pager",
    "filter.",
    "include.",
    "includeif.",
    "credential.",
    "alias.",
    "diff.external",
    "sequence.editor",
    "gpg.program",
)
SEND_FLAGS = (
    "-d",
    "--data",
    "--data-raw",
    "--data-binary",
    "--data-urlencode",
    "--json",
    "-F",
    "--form",
    "-T",
    "--upload-file",
    "--post-data",
    "--post-file",
)
GH_BLOCKED = frozenset(
    {
        ("pr", "merge"),
        ("pr", "ready"),
        ("release", "*"),
        ("secret", "*"),
        ("variable", "*"),
        ("ruleset", "*"),
        ("auth", "*"),
        ("repo", "delete"),
        ("repo", "edit"),
        ("repo", "archive"),
        ("repo", "rename"),
        ("workflow", "run"),
        ("workflow", "enable"),
        ("workflow", "disable"),
    }
)
GH_API_WRITE_ALLOWED = (
    ("PATCH", r"repos/[^/]+/[^/]+/pulls/\d+"),
    ("POST", r"repos/[^/]+/[^/]+/(?:issues|pulls)/\d+/comments"),
    ("POST", r"repos/[^/]+/[^/]+/pulls"),
)
PATCH_FILE_RE = re.compile(r"^(?:\+\+\+ |--- |diff --git a/)(?:[ab]/)?(\S+)", re.MULTILINE)
PROTECTED_TEXT_RE = re.compile(
    r"\.claude/(?:settings(?:\.local)?\.json|hooks|agents|policy|gates\.json|bin|kit-manifest\.json|kit)\b"
    r"|['\"]\.claude['\"]|~/\.(?:bashrc|profile|bash_profile|zshrc)\b"
)
WRITE_CODE_RE = re.compile(
    r"open\([^)]*['\"][wax]b?\+?['\"]|write_text|write_bytes|writeFile|appendFile|\.unlink\(|rmtree"
    r"|os\.remove|os\.rename|os\.replace|shutil\.(?:copy|move)|\bchmod\b|\bsed\s+(?:-[a-zA-Z]*i|--in-place)"
    r"|\btee\b|\brm\s|\bmv\s|\bcp\s|\bln\s|fs\.(?:rm|unlink|rename|copyFile|chmod|write)"
    r"|(?:^|[\s;|&(])>>?\s*['\"]?[^\s'\"]*\.claude"
)
PIPE_TO_SHELL_RE = re.compile(
    r"\b(?:curl|wget)\b[^|;&\n]*\|\s*(?:sudo\s+)?(?:(?:ba|z|da|k)?sh|python3?|node|perl|ruby|bun|deno)\b"
)
SUBST_TO_SHELL_RE = re.compile(
    r"(?:(?:ba|z|da|k)?sh|source|\.|eval)\s+(?:-c\s+)?['\"]?(?:<\(|\$\(|`)\s*(?:curl|wget)\b"
)
PG_CLIENTS = frozenset({"psql", "pg_dump", "pg_dumpall", "pg_restore", "pgcli"})
LOCAL_DB_HOSTS = frozenset(
    {"", "localhost", "127.0.0.1", "::1", "0.0.0.0", "host.docker.internal"}  # noqa: S104
)
MESSAGE_GIT_SUBS = frozenset({"commit", "tag", "merge", "notes", "commit-tree"})
KNOWN_GIT_SUBS = frozenset({"push", "commit", "tag", "merge", "notes", "commit-tree", "add"})
GH_TEXT_COMMANDS = frozenset(
    {
        ("pr", "create"),
        ("pr", "edit"),
        ("pr", "comment"),
        ("pr", "review"),
        ("issue", "create"),
        ("issue", "edit"),
        ("issue", "comment"),
        ("release", "create"),
        ("release", "edit"),
        ("api", ""),
    }
)
GH_TEXT_FLAGS = frozenset({"--title", "-t", "--body", "-b", "--notes", "-n"})
GH_FILE_FLAGS = frozenset({"--body-file", "-F", "--notes-file", "--input"})
GH_API_FIELD_FLAGS = frozenset({"-f", "-F", "--field", "--raw-field"})
HOOK_BYPASS_ENV = ("HUSKY", "LEFTHOOK", "SKIP", "PRE_COMMIT_ALLOW_NO_CONFIG")
DOLLAR_VAR_RE = re.compile(r"\$(?:\{[A-Za-z_][A-Za-z0-9_]*\}|[A-Za-z_][A-Za-z0-9_]*)")
CAT_INNER_RE = re.compile(r"^\s*cat\s+([^\s<]+)\s*$")
SUBST_TOKEN_RE = re.compile(r"\$\(__S([0-9]+)__\)")
HEREDOC_START_RE = re.compile(r"<<-?\s*(['\"]?)([A-Za-z_][A-Za-z0-9_]*)\1")
INLINE_SECRET_RE = re.compile(
    r"(?<![A-Za-z0-9_])(\.env(?:\.[A-Za-z0-9_-]+)?|[A-Za-z0-9_./-]*\.(?:tfvars|tfstate|pem|p12|pfx)"
    r"|id_(?:rsa|ed25519|ecdsa))(?![A-Za-z0-9_-])"
)


class PolicyError(Exception):
    """A policy file is missing or malformed."""


@dataclass
class Policy:
    ai_patterns: list[tuple[str, re.Pattern[str]]]
    basename_globs: list[str]
    basename_exceptions: list[str]
    home_paths: list[str]
    absolute_globs: list[str]
    protected_globs: list[tuple[str, re.Pattern[str]]] = field(default_factory=list)
    home_protected: list[str] = field(default_factory=list)
    trunk_refs: list[str] = field(default_factory=list)
    evasion_markers: list[str] = field(default_factory=list)
    net_allowed: list[str] = field(default_factory=list)
    net_local: list[str] = field(default_factory=list)
    blocked_clients: list[str] = field(default_factory=list)


@dataclass
class SimpleCommand:
    words: list[str]
    env: dict[str, str]
    redirects: list[tuple[str, str]] = field(default_factory=list)
    text: str = ""


@dataclass
class Context:
    policy: Policy
    cwd: Path
    raw: str
    heredocs: list[str]
    reasons: list[str] = field(default_factory=list)
    substs: list[str] = field(default_factory=list)
    executed_heredocs: list[str] = field(default_factory=list)
    root: Path = field(default_factory=Path.cwd)

    def block(self, reason: str) -> None:
        if reason not in self.reasons:
            self.reasons.append(reason)


# --------------------------------------------------------------------------- policy files


def load_policy(directory: Path = POLICY_DIR) -> Policy:
    try:
        ai = json.loads((directory / "no-ai-mentions.json").read_text(encoding="utf-8"))
        sec = json.loads((directory / "secret-paths.json").read_text(encoding="utf-8"))
        prot = json.loads((directory / "protected-paths.json").read_text(encoding="utf-8"))
        net = json.loads((directory / "network.json").read_text(encoding="utf-8"))
        patterns = [(str(p["id"]), re.compile(str(p["regex"]))) for p in ai["patterns"]]
        return Policy(
            ai_patterns=patterns,
            basename_globs=[str(g) for g in sec["basename_globs"]],
            basename_exceptions=[str(g) for g in sec["basename_exceptions"]],
            home_paths=[str(g) for g in sec["home_paths"]],
            absolute_globs=[str(g) for g in sec["absolute_globs"]],
            protected_globs=[(str(g), glob_regex(str(g))) for g in prot["repo_globs"]],
            home_protected=[str(g) for g in prot["home_paths"]],
            trunk_refs=[str(g) for g in prot["trunk_refs"]],
            evasion_markers=[str(g) for g in prot["evasion_markers"]],
            net_allowed=[str(h).lower() for h in net["allowed_hosts"]],
            net_local=[str(h).lower() for h in net["local_hosts"]],
            blocked_clients=[str(c) for c in net["blocked_clients"]],
        )
    except (OSError, ValueError, KeyError, TypeError, re.error) as exc:
        raise PolicyError(f"{type(exc).__name__}: {exc}") from exc


def ai_mentions(policy: Policy, text: str) -> list[str]:
    return [pid for pid, rx in policy.ai_patterns if rx.search(text)]


def secret_name(policy: Policy, name: str) -> bool:
    if any(fnmatch.fnmatchcase(name, g) for g in policy.basename_exceptions):
        return False
    return any(fnmatch.fnmatchcase(name, g) for g in policy.basename_globs)


def secret_path(policy: Policy, path: Path) -> str | None:
    """Why `path` is secret-bearing, or None. Checks the literal and the symlink-resolved path."""
    home = Path(os.path.expanduser("~"))
    forms = {Path(os.path.normpath(path))}
    with contextlib.suppress(OSError, RuntimeError):
        forms.add(path.resolve())
    for form in forms:
        if secret_name(policy, form.name):
            return f"`{form.name}` is a secret-bearing file"
        for rel in policy.home_paths:
            base = home / rel
            if form == base or base in form.parents:
                return f"`~/{rel}` holds credentials"
        text = str(form)
        if any(fnmatch.fnmatchcase(text, g) for g in policy.absolute_globs):
            return f"`{text}` holds credentials"
    return None


# --------------------------------------------------------------------------- parsing


def heredoc_executed(line: str, start: int) -> bool:
    """Whether the heredoc opened at `start` feeds an interpreter or shell (directly or via a
    pipe). A heredoc written to a file (`cat > f <<EOF`) is content, not code."""
    owner = re.split(r"&&|\|\||;|\$\(|\|", line[:start])[-1].split()
    words = [w for w in owner if not ASSIGNMENT_RE.match(w)]
    head = re.sub(r"[0-9.]+$", "", os.path.basename(words[0])) if words else ""
    runs = head in INTERPRETERS or head in SHELLS or head in ("source", ".", "eval")
    piped = re.search(
        r"\|\s*(?:sudo\s+)?(?:ba|z|da|k)?sh\b|\|\s*(?:python3?|node|perl|ruby)\b", line[start:]
    )
    return runs or bool(piped)


def heredoc_bodies(command: str) -> list[tuple[bool, str]]:
    """(executed, body) for every heredoc in the command."""
    bodies: list[tuple[bool, str]] = []
    lines = command.split("\n")
    i = 0
    while i < len(lines):
        m = HEREDOC_START_RE.search(lines[i])
        executed = heredoc_executed(lines[i], m.start()) if m else False
        i += 1
        if not m:
            continue
        body: list[str] = []
        while i < len(lines) and lines[i].strip() != m.group(2):
            body.append(lines[i])
            i += 1
        bodies.append((executed, "\n".join(body)))
        i += 1
    return bodies


def simple_commands(text: str) -> list[SimpleCommand]:
    """Split a command line into simple commands, keeping redirection operators and targets."""
    cmds: list[SimpleCommand] = []
    words: list[str] = []
    redirects: list[tuple[str, str]] = []
    tokens = tokenize(text)
    i = 0

    def flush() -> None:
        if words or redirects:
            rest, env = strip_prefixes(list(words))
            cmds.append(SimpleCommand(rest, env, list(redirects), " ".join(words)))
        words.clear()
        redirects.clear()

    while i < len(tokens):
        tok = tokens[i]
        if tok in SEPARATORS or (tok and set(tok) <= set(";&|()")):
            flush()
        elif REDIRECT_RE.match(tok):
            if words and words[-1].isdigit():
                words.pop()
            target = tokens[i + 1] if i + 1 < len(tokens) else ""
            if not tok.endswith("&") and not tok.startswith("<<"):
                redirects.append((tok, target))
            i += 1
        else:
            words.append(tok)
        i += 1
    flush()
    return cmds


def unwrap(words: list[str], env: dict[str, str]) -> tuple[list[str], dict[str, str]]:
    """Strip wrappers the kit tokenizer does not know (setsid, stdbuf, xargs, ...)."""
    while words:
        head = os.path.basename(words[0])
        if head in EXTRA_WRAPPERS or head == "xargs":
            i = 1
            while i < len(words) and words[i].startswith("-"):
                i += 1
            words = words[i:]
            words, more = strip_prefixes(words)
            env = {**env, **more}
            continue
        break
    return words, env


def mask_substitutions(text: str, table: list[str]) -> tuple[str, list[str]]:
    """Replace each $(...) / `...` (outside single quotes) by a `$(__S<n>__)` placeholder.
    Returns the masked text and the inner texts found at this level."""
    out: list[str] = []
    found: list[str] = []
    i, n, in_single = 0, len(text), False
    while i < n:
        ch = text[i]
        if ch == "\\" and not in_single:
            out.append(text[i : i + 2])
            i += 2
            continue
        if ch == "'":
            in_single = not in_single
        elif not in_single and text.startswith("$(", i):
            depth, j = 1, i + 2
            while j < n and depth:
                depth += {"(": 1, ")": -1}.get(text[j], 0)
                j += 1
            if depth:
                raise GuardParseError("unbalanced $( ... )")
            inner = text[i + 2 : j - 1]
            table.append(inner)
            found.append(inner)
            out.append(f"$(__S{len(table) - 1}__)")
            i = j
            continue
        elif not in_single and ch == "`":
            j = text.find("`", i + 1)
            if j < 0:
                raise GuardParseError("unbalanced backtick")
            inner = text[i + 1 : j]
            table.append(inner)
            found.append(inner)
            out.append(f"$(__S{len(table) - 1}__)")
            i = j + 1
            continue
        out.append(ch)
        i += 1
    return "".join(out), found


def iter_commands(
    ctx: Context, text: str, cwd: Path, depth: int = 0
) -> Iterator[tuple[SimpleCommand, Path, bool]]:
    """Every simple command in `text` with its cwd and whether it is nested: inside $(...),
    backticks, `sh -c '...'` or `eval` (forms the permission rules cannot see)."""
    if depth > MAX_NESTING:
        raise GuardParseError("command nesting too deep to check")
    masked, inners = mask_substitutions(strip_heredocs(text), ctx.substs)
    nested_here = depth > 0
    for cmd in simple_commands(masked):
        cmd.words, cmd.env = unwrap(cmd.words, cmd.env)
        if not cmd.words:
            continue
        head = os.path.basename(cmd.words[0])
        if head in ("cd", "pushd") and len(cmd.words) > 1 and cmd.words[1] != "-":
            target = Path(os.path.expanduser(expand(cmd.words[1], {})))
            cwd = target if target.is_absolute() else cwd / target
            continue
        if head in SHELLS and "-c" in cmd.words:
            idx = cmd.words.index("-c")
            if idx + 1 < len(cmd.words):
                yield from iter_commands(ctx, unmask(ctx, cmd.words[idx + 1]), cwd, depth + 1)
                continue
        if head == "eval" and len(cmd.words) > 1:
            yield from iter_commands(ctx, unmask(ctx, " ".join(cmd.words[1:])), cwd, depth + 1)
            continue
        yield cmd, cwd, nested_here
    for inner in inners:
        yield from iter_commands(ctx, inner, cwd, depth + 1)


def unmask(ctx: Context, text: str) -> str:
    return SUBST_TOKEN_RE.sub(lambda m: "$(" + ctx.substs[int(m.group(1))] + ")", text)


# --------------------------------------------------------------------------- helpers


def resolve(cwd: Path, token: str) -> Path:
    token = token.replace("${PWD}", str(cwd)).replace("$PWD", str(cwd))
    path = Path(os.path.expanduser(expand(token, {})))
    return path if path.is_absolute() else cwd / path


def git_out(cwd: Path, *args: str) -> list[str]:
    proc = subprocess.run(
        ["git", "-C", str(cwd), *args], capture_output=True, text=True, check=False, timeout=10
    )
    if proc.returncode != 0:
        return []
    sep = "\0" if "-z" in args else "\n"
    return [p for p in proc.stdout.split(sep) if p.strip()]


def path_tokens(token: str) -> list[str]:
    """Path candidates inside a token: `HEAD:.env`, `--file=.env`, `@.env` (curl)."""
    out = [token]
    for sep in (":", "="):
        if sep in token:
            out.append(token.rsplit(sep, 1)[1])
    if token.startswith("@"):
        out.append(token[1:])
    return [t for t in out if t]


def glob_expand(cwd: Path, token: str) -> list[Path]:
    if not any(ch in token for ch in "*?["):
        return [resolve(cwd, token)]
    base = Path(os.path.expanduser(token))
    pattern = str(base if base.is_absolute() else cwd / base)
    import glob  # only needed for globbed arguments

    matches = glob.glob(pattern, include_hidden=True)[:MAX_GLOB_MATCHES]
    return [Path(m) for m in matches]


def secrets_under(policy: Policy, directory: Path, *, honor_gitignore: bool) -> list[str]:
    """Secret-bearing files under `directory` that the given search would read."""
    if honor_gitignore:
        listed = git_out(directory, "ls-files", "-z", "--cached", "--others", "--exclude-standard")
        if listed or (directory / ".git").exists() or git_out(directory, "rev-parse", "--git-dir"):
            return [p for p in listed if secret_name(policy, Path(p).name)]
    found: list[str] = []
    seen = 0
    skip = {".git", "node_modules", ".turbo", ".next", "dist", "coverage", ".venv", "__pycache__"}
    for root, dirs, files in os.walk(directory):
        dirs[:] = [d for d in dirs if d not in skip]
        for name in files:
            seen += 1
            if secret_name(policy, name):
                found.append(os.path.relpath(os.path.join(root, name), directory))
        if seen > MAX_WALK_ENTRIES:
            found.append(f"(more than {MAX_WALK_ENTRIES} files; narrow the path)")
            break
    return found


def current_branch(cwd: Path) -> str:
    out = git_out(cwd, "rev-parse", "--abbrev-ref", "HEAD")
    return out[0].strip() if out else ""


def read_message_file(ctx: Context, cwd: Path, value: str) -> str | None:
    if value in ("-", "/dev/stdin"):
        return "\n".join(ctx.heredocs) if ctx.heredocs else None
    path = resolve(cwd, value)
    try:
        with path.open("rb") as fh:
            return fh.read(MAX_MESSAGE_FILE_BYTES).decode("utf-8", errors="replace")
    except OSError:
        return None


def message_value(ctx: Context, cwd: Path, value: str, env: dict[str, str]) -> str | None:
    """The checkable text of a -m/--title/--body value, or None if it cannot be determined."""
    subst = SUBST_TOKEN_RE.fullmatch(value.strip())
    if subst:
        inner = ctx.substs[int(subst.group(1))]
        cat = CAT_INNER_RE.match(inner)
        if cat:
            return read_message_file(ctx, cwd, cat.group(1))
        if "<<" in inner and ctx.heredocs:
            return "\n".join(ctx.heredocs)
        return None
    if SUBST_TOKEN_RE.search(value):
        return None
    expanded = expand(value, env)
    if DOLLAR_VAR_RE.search(expanded):
        return None
    return expanded


# --------------------------------------------------------------------------- self-protection


def glob_regex(pattern: str) -> re.Pattern[str]:
    out = []
    i = 0
    while i < len(pattern):
        if pattern.startswith("**", i):
            out.append(".*")
            i += 2
        elif pattern[i] == "*":
            out.append("[^/]*")
            i += 1
        else:
            out.append(re.escape(pattern[i]))
            i += 1
    return re.compile("".join(out) + r"\Z")


def glob_base(pattern: str) -> str:
    return pattern.split("*", 1)[0].rstrip("/")


def path_forms(path: Path) -> set[Path]:
    forms = {Path(os.path.normpath(path))}
    with contextlib.suppress(OSError, RuntimeError):
        forms.add(path.resolve())
    return forms


def relative_forms(ctx: Context, path: Path) -> set[str]:
    rels: set[str] = set()
    for form in path_forms(path):
        for root in path_forms(ctx.root):
            with contextlib.suppress(ValueError):
                rel = form.relative_to(root).as_posix()
                rels.add("." if rel in ("", ".") else rel)
    return rels


def protected_reason(ctx: Context, path: Path) -> str | None:
    """Why `path` itself is a protected control-plane file (or protected directory)."""
    for rel in relative_forms(ctx, path):
        for pattern, rx in ctx.policy.protected_globs:
            if rx.match(rel) or (rel == glob_base(pattern) and "*" in pattern):
                return f"`{rel}` is a protected control-plane path"
    home = Path(os.path.expanduser("~"))
    for form in path_forms(path):
        for rel_home in ctx.policy.home_protected:
            base = home / rel_home
            if form == base or base in form.parents:
                return f"`~/{rel_home}` is a protected settings path"
    return None


def contains_protected(ctx: Context, path: Path) -> bool:
    """`path` is an ancestor directory of protected content (e.g. `.`, `.claude`, `~`)."""
    for rel in relative_forms(ctx, path):
        for pattern, _ in ctx.policy.protected_globs:
            base = glob_base(pattern)
            if rel == "." or base.startswith(rel + "/"):
                return True
    home = Path(os.path.expanduser("~"))
    for form in path_forms(path):
        for rel_home in ctx.policy.home_protected:
            if form in (home / rel_home).parents:
                return True
    return False


def protect_block(ctx: Context, what: str, why: str) -> None:
    ctx.block(
        f"{what}: {why}. Guardrail files are founder-only (.claude/policy/protected-paths.json): "
        "read them freely, but ask the founder to change them."
    )


def positionals(args: list[str], with_value: frozenset[str] = frozenset()) -> list[str]:
    out: list[str] = []
    i = 0
    after_dashes = False
    while i < len(args):
        arg = args[i]
        if after_dashes or not arg.startswith("-") or arg == "-":
            out.append(arg)
        elif arg == "--":
            after_dashes = True
        elif arg in with_value:
            i += 1
        i += 1
    return out


def recursive_flag(args: list[str]) -> bool:
    return any(
        a in ("--recursive", "-R", "-r")
        or (a.startswith("-") and not a.startswith("--") and ("r" in a[1:] or "R" in a[1:]))
        for a in args
    )


def check_protected_paths(ctx: Context, cmd: SimpleCommand, cwd: Path) -> None:
    head = os.path.basename(cmd.words[0])
    args = cmd.words[1:]
    for op, target in cmd.redirects:
        if not op.startswith("<") and (why := protected_reason(ctx, resolve(cwd, target))):
            protect_block(ctx, f"redirect `{op} {target}`", why)
    if head in DESTROYERS:
        recursive = head in ("rmdir",) or recursive_flag(args)
        for arg in positionals(args, frozenset({"-s", "--size"})):
            path = resolve(cwd, arg)
            if why := protected_reason(ctx, path):
                protect_block(ctx, f"`{head} {arg}`", why)
            elif recursive and contains_protected(ctx, path):
                protect_block(ctx, f"`{head} {arg}`", "it contains protected control-plane paths")
    elif head in MODE_CHANGERS:
        for arg in positionals(args, frozenset({"--reference"})):
            path = resolve(cwd, arg)
            if (why := protected_reason(ctx, path)) or (
                recursive_flag(args) and contains_protected(ctx, path)
            ):
                protect_block(ctx, f"`{head} {arg}`", why or "it contains protected paths")
    elif head in COPIERS:
        check_copy(ctx, head, args, cwd)
    elif head == "tee":
        for arg in positionals(args):
            if why := protected_reason(ctx, resolve(cwd, arg)):
                protect_block(ctx, f"`tee {arg}`", why)
    elif head == "dd":
        for arg in args:
            if arg.startswith("of=") and (why := protected_reason(ctx, resolve(cwd, arg[3:]))):
                protect_block(ctx, f"`dd {arg}`", why)
    elif head in INPLACE_EDITORS and any(
        a == "--in-place"
        or a.startswith("--in-place=")
        or (a.startswith("-") and not a.startswith("--") and "i" in a[1:])
        for a in args
    ):
        for arg in positionals(args, frozenset({"-e", "--expression", "-f", "--file"})):
            if why := protected_reason(ctx, resolve(cwd, arg)):
                protect_block(ctx, f"`{head} -i {arg}`", why)
    elif head == "patch":
        texts = [
            *ctx.heredocs,
            *[read_text_file(resolve(cwd, a)) or "" for a in positionals(args)],
        ]
        for text in texts:
            for rel in PATCH_FILE_RE.findall(text):
                if why := protected_reason(ctx, resolve(ctx.root, rel)):
                    protect_block(ctx, "`patch`", why)
    elif head == "find":
        check_find(ctx, args, cwd)
    elif head in ("curl", "wget"):
        for i, arg in enumerate(args):
            is_output = arg in ("-o", "--output", "-O", "--output-document") and i + 1 < len(args)
            if is_output and (why := protected_reason(ctx, resolve(cwd, args[i + 1]))):
                protect_block(ctx, f"`{head} {arg} {args[i + 1]}`", why)
    elif head in ("docker", "podman"):
        check_container(ctx, args, cwd)


def check_copy(ctx: Context, head: str, args: list[str], cwd: Path) -> None:
    target_dir = next(
        (args[i + 1] for i, a in enumerate(args[:-1]) if a in ("-t", "--target-directory")),
        None,
    )
    pos = positionals(
        args, frozenset({"-t", "--target-directory", "-S", "--suffix", "-m", "--mode"})
    )
    if head == "mv":
        for arg in pos:
            path = resolve(cwd, arg)
            if (why := protected_reason(ctx, path)) or contains_protected(ctx, path):
                protect_block(ctx, f"`mv {arg}`", why or "it contains protected paths")
    if target_dir is None and len(pos) < 2:
        return
    dest = resolve(cwd, target_dir if target_dir is not None else pos[-1])
    sources = pos if target_dir is not None else pos[:-1]
    candidates = [dest]
    if dest.is_dir() or (target_dir is None and pos[-1].endswith("/")) or target_dir is not None:
        candidates += [dest / Path(s.rstrip("/")).name for s in sources]
    for path in candidates:
        if why := protected_reason(ctx, path):
            protect_block(ctx, f"`{head}` onto `{path}`", why)
            return
    if head == "rsync" and "--delete" in " ".join(args) and contains_protected(ctx, dest):
        protect_block(ctx, "`rsync --delete`", "the destination contains protected paths")


def check_find(ctx: Context, args: list[str], cwd: Path) -> None:
    actions = {
        "-delete",
        "-exec",
        "-execdir",
        "-ok",
        "-okdir",
        "-fprint",
        "-fprintf",
        "-fls",
    }
    if not actions & set(args):
        return
    roots = []
    for arg in args:
        if arg.startswith(("-", "(", "!")):
            break
        roots.append(arg)
    for root in roots or ["."]:
        path = resolve(cwd, root)
        if protected_reason(ctx, path) or contains_protected(ctx, path):
            protect_block(ctx, f"`find {root} ... -delete/-exec`", "it reaches protected paths")


def check_container(ctx: Context, args: list[str], cwd: Path) -> None:
    sub = args[0] if args else ""
    local_dest = sub == "cp" and len(args) >= 3 and ":" not in args[-1]
    if local_dest and (why := protected_reason(ctx, resolve(cwd, args[-1]))):
        protect_block(ctx, "`docker cp`", why)
    if sub not in ("run", "create"):
        return
    if "--privileged" in args:
        ctx.block("`docker run --privileged` is not allowed in sessions.")
    for i, arg in enumerate(args):
        spec = ""
        if arg in ("-v", "--volume", "--mount") and i + 1 < len(args):
            spec = args[i + 1]
        elif arg.startswith(("--volume=", "--mount=")):
            spec = arg.split("=", 1)[1]
        if not spec:
            continue
        m = re.search(r"(?:^|,)(?:source|src)=([^,]+)", spec)
        source = m.group(1) if m else spec.split(":", 1)[0]
        if not source.startswith(("/", ".", "~", "$")):
            continue  # named volume
        path = resolve(cwd, source)
        why = protected_reason(ctx, path) or secret_path(ctx.policy, path)
        if why or contains_protected(ctx, path):
            ctx.block(
                f"`docker {sub}` mounts `{source}`, which holds protected or secret paths; mount a "
                "narrower directory (never the repository root, .claude or $HOME)."
            )


def read_text_file(path: Path) -> str | None:
    try:
        if path.is_file():
            with path.open("rb") as fh:
                return fh.read(MAX_MESSAGE_FILE_BYTES).decode("utf-8", errors="replace")
    except OSError:
        return None
    return None


def check_executed_code(ctx: Context, what: str, text: str) -> None:
    for line in text.splitlines():
        if PROTECTED_TEXT_RE.search(line) and WRITE_CODE_RE.search(line):
            protect_block(ctx, what, f"it writes a protected path (`{line.strip()[:80]}`)")
            return


def trusted_script(ctx: Context, path: Path) -> bool:
    """The control plane's own tools (.claude/bin, .claude/hooks) are founder-only files, so
    running them is not a write risk; scanning their source only produces false positives."""
    return protected_reason(ctx, path) is not None


def script_texts(ctx: Context, cmd: SimpleCommand, cwd: Path) -> list[tuple[str, str]]:
    """(label, text) of code this command executes: inline code, script files, npm scripts."""
    head = os.path.basename(cmd.words[0])
    base = re.sub(r"[0-9.]+$", "", head)
    args = cmd.words[1:]
    found: list[tuple[str, str]] = []
    if base in INTERPRETERS or head in INTERPRETERS or head in SHELLS or head in ("source", "."):
        if any(a in ("-c", "-e", "--eval", "-p", "--print") for a in args):
            found.append((f"inline `{head}` code", " ".join(args)))
        else:
            for arg in args:
                if arg.startswith("-"):
                    continue
                path = resolve(cwd, arg)
                text = None if trusted_script(ctx, path) else read_text_file(path)
                if text is not None:
                    found.append((f"script `{arg}`", text))
                break
    elif "/" in cmd.words[0]:
        path = resolve(cwd, cmd.words[0])
        text = None if trusted_script(ctx, path) else read_text_file(path)
        if text is not None:
            found.append((f"script `{cmd.words[0]}`", text))
    elif head in ("pnpm", "npm", "yarn") and len(args) >= 1:
        name = args[1] if args[0] == "run" and len(args) > 1 else args[0]
        package = read_text_file(cwd / "package.json") or read_text_file(ctx.root / "package.json")
        with contextlib.suppress(ValueError, AttributeError, TypeError):
            scripts = json.loads(package or "{}").get("scripts", {})
            if isinstance(scripts.get(name), str):
                found.append((f"package script `{name}`", scripts[name]))
    return found


def check_nested_and_evasion(ctx: Context, cmd: SimpleCommand) -> None:
    head = os.path.basename(cmd.words[0])
    if head == "claude" and not set(cmd.words[1:]) <= {
        "--version",
        "-v",
        "--help",
        "-h",
    }:
        ctx.block(
            "starting another session (`claude ...`) is not allowed: a nested session can load "
            "different settings and run without these guards."
        )


# --------------------------------------------------------------------------- git control-plane rules


def protected_specs(ctx: Context) -> list[str]:
    return sorted({glob_base(p) for p, _ in ctx.policy.protected_globs})


def ref_exists(cwd: Path, ref: str) -> bool:
    proc = subprocess.run(
        [
            "git",
            "-C",
            str(cwd),
            "rev-parse",
            "--verify",
            "--quiet",
            f"{ref}^{{commit}}",
        ],
        capture_output=True,
        check=False,
        timeout=10,
    )
    return proc.returncode == 0


def trunk_ok(ctx: Context, cwd: Path, ref: str) -> bool:
    if ref not in ctx.policy.trunk_refs:
        return False
    proc = subprocess.run(
        ["git", "-C", str(cwd), "cat-file", "-e", f"{ref}:.claude/settings.json"],
        capture_output=True,
        check=False,
        timeout=10,
    )
    return proc.returncode == 0


def protected_diff(ctx: Context, cwd: Path, *revs: str) -> list[str]:
    return git_out(cwd, "diff", "--name-only", *revs, "--", *protected_specs(ctx))


def resolve_target(cwd: Path, target: str) -> str | None:
    """The commit-ish git will use for `target`, including git's DWIM: `git switch main` with no
    local `main` creates it from the single remote-tracking `*/main`."""
    if ref_exists(cwd, target):
        return target
    remote = git_out(cwd, "for-each-ref", "--format=%(refname:short)", f"refs/remotes/*/{target}")
    return remote[0].strip() if len(remote) == 1 else None


def guard_target(
    ctx: Context, cwd: Path, what: str, target: str, *, three_dot: bool = False
) -> None:
    resolved = resolve_target(cwd, target)
    if resolved is None:
        return  # git will fail on an unknown ref
    target = resolved
    changed = protected_diff(
        ctx,
        cwd,
        f"HEAD...{target}" if three_dot else "HEAD",
        *(() if three_dot else (target,)),
    )
    if changed and not trunk_ok(ctx, cwd, target):
        protect_block(
            ctx,
            f"`git {what}`",
            f"it would change protected files ({', '.join(changed[:4])}); only the founder-merged "
            f"trunk ({', '.join(ctx.policy.trunk_refs)}) may bring control-plane changes",
        )


def pathspec_hits(ctx: Context, cwd: Path, specs: list[str]) -> bool:
    return any(
        s in (".", ":/", "*", ":(top)")
        or protected_reason(ctx, resolve(cwd, s))
        or contains_protected(ctx, resolve(cwd, s))
        for s in specs
    )


def check_git_control_plane(ctx: Context, sub: str, args: list[str], cwd: Path) -> None:
    pos = positionals(args, GIT_VALUE_FLAGS)
    if sub in GIT_PLUMBING and not (
        sub == "update-index" and set(args) <= {"-q", "--refresh", "--really-refresh"}
    ):
        ctx.block(
            f"`git {sub}` can rewrite the working tree or history behind the guards; not allowed."
        )
        return
    if sub in ("rm", "mv") and pathspec_hits(ctx, cwd, pos):
        protect_block(ctx, f"`git {sub} {' '.join(pos)}`", "it removes or moves protected paths")
    elif sub == "restore":
        source = next((a.split("=", 1)[1] for a in args if a.startswith("--source=")), None)
        for i, a in enumerate(args[:-1]):
            if a in ("-s", "--source"):
                source = args[i + 1]
        if source and pathspec_hits(ctx, cwd, pos) and protected_diff(ctx, cwd, "HEAD", source):
            protect_block(
                ctx,
                f"`git restore --source {source}`",
                "it would restore other versions of protected files",
            )
    elif sub in ("checkout", "switch"):
        check_git_switch(ctx, sub, args, cwd)
    elif sub == "reset" and {"--hard", "--merge", "--keep"} & set(args):
        guard_target(ctx, cwd, f"reset {' '.join(args)}", pos[0] if pos else "HEAD")
    elif sub == "merge" and not {"--abort", "--continue", "--quit"} & set(args):
        for target in pos:
            guard_target(ctx, cwd, f"merge {target}", target, three_dot=True)
    elif sub == "rebase" and not {"--abort", "--continue", "--skip", "--quit"} & set(args):
        onto = next((args[i + 1] for i, a in enumerate(args[:-1]) if a == "--onto"), None)
        target = onto or (pos[0] if pos else "@{u}")
        guard_target(ctx, cwd, f"rebase {target}", target, three_dot=True)
    elif sub == "pull":
        target = f"{pos[0]}/{pos[1]}" if len(pos) >= 2 else "@{u}"
        resolved = (
            git_out(cwd, "rev-parse", "--abbrev-ref", target) if target == "@{u}" else [target]
        )
        guard_target(
            ctx,
            cwd,
            f"pull {' '.join(pos)}".strip(),
            resolved[0].strip() if resolved else target,
            three_dot=True,
        )
    elif sub in ("cherry-pick", "revert") and not {
        "--abort",
        "--continue",
        "--skip",
        "--quit",
    } & set(args):
        for spec in pos:
            commits = git_out(cwd, "rev-list", spec) if ".." in spec else [spec]
            for commit in commits[:200]:
                if ref_exists(cwd, commit) and protected_diff(ctx, cwd, f"{commit}^", commit):
                    protect_block(
                        ctx,
                        f"`git {sub} {spec}`",
                        "a picked commit changes protected files",
                    )
                    return
    elif sub == "stash" and pos[:1] in (["pop"], ["apply"]):
        ref = pos[1] if len(pos) > 1 else "stash@{0}"
        files = git_out(cwd, "stash", "show", "--name-only", "--include-untracked", ref)
        if any(protected_reason(ctx, resolve(ctx.root, f)) for f in files):
            protect_block(ctx, f"`git stash {pos[0]}`", "the stash changes protected files")
    elif sub in ("apply", "am"):
        texts = [read_text_file(resolve(cwd, p)) for p in pos] if pos else list(ctx.heredocs)
        if not texts or any(t is None for t in texts):
            ctx.block(f"`git {sub}`: the patch content cannot be checked; use a patch file.")
            return
        for text in texts:
            for rel in PATCH_FILE_RE.findall(text or ""):
                if why := protected_reason(ctx, resolve(ctx.root, rel)):
                    protect_block(ctx, f"`git {sub}`", why)
                    return
    elif sub == "clean" and any(
        ("x" in a[1:] or "X" in a[1:]) for a in args if a.startswith("-") and not a.startswith("--")
    ):
        local = ctx.root / ".claude" / "settings.local.json"
        if local.exists() and (not pos or pathspec_hits(ctx, cwd, pos)):
            protect_block(ctx, "`git clean -x`", "it would delete .claude/settings.local.json")
    elif sub == "config":
        check_git_config(ctx, args)


def check_git_switch(ctx: Context, sub: str, args: list[str], cwd: Path) -> None:
    if "--" in args:
        idx = args.index("--")
        before = positionals(args[:idx], GIT_VALUE_FLAGS | {"-b", "-B", "-c", "-C", "--orphan"})
        specs = args[idx + 1 :]
        if (
            before
            and pathspec_hits(ctx, cwd, specs)
            and protected_diff(ctx, cwd, "HEAD", before[0])
        ):
            protect_block(
                ctx,
                f"`git {sub} {before[0]} -- ...`",
                "it would check out other versions of protected files",
            )
        return
    start = None
    for i, a in enumerate(args[:-1]):
        if a in ("-b", "-B", "-c", "-C", "--orphan"):
            rest = positionals(args[i + 2 :], GIT_VALUE_FLAGS)
            start = rest[0] if rest else None
            break
    else:
        pos = positionals(args, GIT_VALUE_FLAGS | {"-b", "-B", "-c", "-C", "--orphan"})
        if not pos:
            return
        if resolve_target(cwd, pos[0]) is not None:
            if len(pos) > 1:
                if pathspec_hits(ctx, cwd, pos[1:]) and protected_diff(ctx, cwd, "HEAD", pos[0]):
                    protect_block(
                        ctx,
                        f"`git {sub} {pos[0]} <paths>`",
                        "it would check out other versions of protected files",
                    )
                return
            start = pos[0]
    if start and start not in ("-",):
        guard_target(ctx, cwd, f"{sub} {start}", start)


def check_git_config(ctx: Context, args: list[str]) -> None:
    reading = {
        "--get",
        "--get-all",
        "--get-regexp",
        "--list",
        "-l",
        "--show-origin",
        "--show-scope",
    }
    if reading & set(args):
        return
    pos = positionals(args, frozenset({"--file", "-f", "--blob", "--type"}))
    if not pos:
        return
    key = pos[0].lower()
    if "--global" in args or "--system" in args:
        ctx.block("`git config --global/--system` changes other repositories; not allowed.")
    elif key == "core.hookspath" or key.startswith(SENSITIVE_GIT_CONFIG):
        ctx.block(
            f"`git config {pos[0]}` can run code or bypass hooks behind the guards; not allowed."
        )


# --------------------------------------------------------------------------- unattended permission table


def url_host(token: str) -> str | None:
    m = re.match(r"^(?:[a-zA-Z][a-zA-Z0-9+.-]*://)?(?:[^@/\s]*@)?(\[[^\]]+\]|[^:/\s?#]+)", token)
    if not m:
        return None
    host = m.group(1).strip("[]").lower()
    return host if ("." in host or host in ("localhost", "::1")) else None


def host_allowed(allowed: list[str], host: str) -> bool:
    for entry in allowed:
        if entry.startswith("*.") and (host == entry[2:] or host.endswith(entry[1:])):
            return True
        if host == entry:
            return True
    return False


def check_network(ctx: Context, cmd: SimpleCommand) -> None:
    head = os.path.basename(cmd.words[0])
    args = cmd.words[1:]
    if args and set(args) <= {"--version", "-V", "--help", "-h"}:
        return
    value_flags = {
        "-o",
        "--output",
        "-O",
        "--output-document",
        "-H",
        "--header",
        "-A",
        "--user-agent",
        "-e",
        "--referer",
        "-m",
        "--max-time",
        "--connect-timeout",
        "-w",
        "--write-out",
        "-u",
        "--user",
        "--retry",
        "-x",
        "--proxy",
        "-X",
        "--request",
        "--method",
        "-d",
        "--data",
        "--data-raw",
        "--data-binary",
        "--data-urlencode",
        "--json",
        "-F",
        "--form",
        "-T",
        "--upload-file",
        "--post-data",
        "--post-file",
        "-P",
        "--directory-prefix",
    }
    urls = [a for a in positionals(args, frozenset(value_flags)) if url_host(a)]
    method = next(
        (
            args[i + 1].upper()
            for i, a in enumerate(args[:-1])
            if a in ("-X", "--request", "--method")
        ),
        "GET",
    )
    sends = any(a in SEND_FLAGS or a.startswith(tuple(f + "=" for f in SEND_FLAGS)) for a in args)
    if not urls:
        ctx.block(
            f"`{head}`: no checkable URL. Give an explicit https:// URL on the allowlist (.claude/policy/network.json)."
        )
        return
    for url in urls:
        host = url_host(url) or ""
        if host in ctx.policy.net_local:
            continue
        if not host_allowed(ctx.policy.net_allowed, host):
            ctx.block(
                f"`{head}` to `{host}` is not on the network allowlist (.claude/policy/network.json)."
            )
        elif method not in ("GET", "HEAD") or sends:
            ctx.block(
                f"`{head}` may only GET/HEAD remote hosts (no uploads or {method}); `{host}` is remote."
            )


def check_piped_network(ctx: Context) -> None:
    raw = strip_heredocs(ctx.raw)
    if PIPE_TO_SHELL_RE.search(raw) or SUBST_TO_SHELL_RE.search(raw):
        ctx.block("downloading code and piping it into a shell or interpreter is not allowed.")


def check_unattended_table(ctx: Context, cmd: SimpleCommand) -> None:
    head = os.path.basename(cmd.words[0])
    args = cmd.words[1:]
    if head in ("curl", "wget"):
        check_network(ctx, cmd)
    elif head in ctx.policy.blocked_clients:
        ctx.block(f"`{head}` opens remote shells or raw connections; not allowed in sessions.")
    elif head == "npx" or head == "bunx" or (head == "pnpm" and args[:1] == ["dlx"]):
        ctx.block(
            f"`{head}` downloads and runs unpinned packages; use `pnpm exec` with a declared devDependency."
        )
    elif (
        head == "npm"
        and args[:1]
        and args[0] in ("install", "i", "ci", "add", "exec", "x", "uninstall")
    ):
        ctx.block("this repository uses pnpm (A-22); `npm install/exec` is not allowed.")
    elif head == "aws":
        ctx.block("the AWS CLI is founder-only (EXT-09; no AWS credentials in sessions).")


# --------------------------------------------------------------------------- Bash rules


def check_text(ctx: Context, what: str, text: str | None) -> None:
    if text is None:
        ctx.block(
            f"{what}: the message text cannot be determined before it runs (a variable or "
            "command substitution). Use a literal -m/--body, a heredoc, or a file (-F / "
            "--body-file) so it can be checked for AI-tool mentions (A-22)."
        )
        return
    hits = ai_mentions(ctx.policy, text)
    if hits:
        ctx.block(
            f"{what}: mentions an AI coding tool or tool attribution ({', '.join(hits)}). "
            "A-22: commit, tag and PR text never mention AI tools; describe the change itself. "
            "Patterns: .claude/policy/no-ai-mentions.json."
        )


def git_parts(words: list[str], cwd: Path) -> tuple[list[str], str, list[str], Path]:
    """(global options, subcommand, args, effective cwd) of a git invocation."""
    globals_: list[str] = []
    call_cwd = cwd
    i = 1
    while i < len(words):
        arg = words[i]
        if arg in ("-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path"):
            globals_ += words[i : i + 2]
            if arg == "-C" and i + 1 < len(words):
                call_cwd = resolve(call_cwd, words[i + 1])
            i += 2
        elif arg.startswith("-"):
            globals_.append(arg)
            i += 1
        else:
            break
    if i >= len(words):
        return globals_, "", [], call_cwd
    sub, args = words[i], words[i + 1 :]
    if sub not in KNOWN_GIT_SUBS and call_cwd.is_dir():
        alias = git_alias(call_cwd, sub)
        if alias:
            sub, args = alias[0], alias[1:] + args
    return globals_, sub, args, call_cwd


def short_cluster_value(args: list[str], i: int, letter: str) -> tuple[str | None, int]:
    """Value of a short option `letter` inside a cluster like -am 'msg' or -mmsg."""
    tok = args[i]
    pos = tok.index(letter, 1)
    rest = tok[pos + 1 :]
    if rest:
        return rest, i + 1
    return (args[i + 1] if i + 1 < len(args) else None), i + 2


def check_git_message(
    ctx: Context, cmd: SimpleCommand, sub: str, args: list[str], cwd: Path
) -> None:
    texts: list[tuple[str, str | None]] = []
    i = 0
    while i < len(args):
        arg = args[i]
        value: str | None
        if arg in ("-m", "--message", "--trailer") and i + 1 < len(args):
            texts.append((arg, message_value(ctx, cwd, args[i + 1], cmd.env)))
            i += 2
            continue
        if arg.startswith(("--message=", "--trailer=")):
            texts.append((arg, message_value(ctx, cwd, arg.split("=", 1)[1], cmd.env)))
        elif arg in ("-F", "--file") and i + 1 < len(args):
            texts.append((arg, read_message_file(ctx, cwd, args[i + 1])))
            i += 2
            continue
        elif arg.startswith("--file="):
            texts.append((arg, read_message_file(ctx, cwd, arg.split("=", 1)[1])))
        elif arg.startswith("-") and not arg.startswith("--") and len(arg) > 1:
            letters = arg[1:]
            if sub == "commit" and "n" in letters.split("m")[0].split("F")[0]:
                ctx.block("`git commit -n` skips the commit hooks (--no-verify); not allowed.")
            for letter in ("m", "F"):
                if letter in letters:
                    value, i = short_cluster_value(args, i, letter)
                    if letter == "m":
                        texts.append(
                            (
                                "-m",
                                None if value is None else message_value(ctx, cwd, value, cmd.env),
                            )
                        )
                    else:
                        texts.append(
                            ("-F", None if value is None else read_message_file(ctx, cwd, value))
                        )
                    break
            else:
                i += 1
            continue
        i += 1
    for flag, text in texts:
        check_text(ctx, f"`git {sub}` {flag}", text)


def refspec_targets(args: list[str]) -> tuple[list[str], list[str]]:
    """(options, refspecs) of git push arguments (the first positional is the remote)."""
    opts: list[str] = []
    positionals: list[str] = []
    i = 0
    with_value = {"--repo", "--receive-pack", "--exec", "--push-option", "-o", "--signed"}
    while i < len(args):
        arg = args[i]
        if arg.startswith("-"):
            opts.append(arg)
            if arg in with_value and i + 1 < len(args):
                i += 1
        else:
            positionals.append(arg)
        i += 1
    return opts, positionals[1:]


def check_push(
    ctx: Context, cmd: SimpleCommand, globals_: list[str], args: list[str], cwd: Path, nested: bool
) -> None:
    redirected_repo = any(k in cmd.env for k in ("GIT_DIR", "GIT_WORK_TREE"))
    if nested or cmd.words[0] != "git" or globals_ or redirected_repo:
        ctx.block(
            "this push form hides its target (git -C/-c/--git-dir, an absolute git path, sh -c or "
            "eval). Push with the plain form from the repository root: `git push -u origin <branch>` "
            "(any branch except main/master)."
        )
    opts, refspecs = refspec_targets(args)
    if "--no-verify" in opts:
        ctx.block("`git push --no-verify` skips the pre-push hooks; not allowed.")
    if any(
        o in ("--force", "-f") or (o.startswith("-") and not o.startswith("--") and "f" in o[1:])
        for o in opts
    ):
        ctx.block("force push is not allowed (use --force-with-lease on your own branch).")
    if any(
        o in ("--all", "--mirror", "--tags", "--prune") or o.startswith("--delete") or o == "-d"
        for o in opts
    ):
        ctx.block("push of all refs, tags, mirrors or deletions is founder-only.")
    targets: list[str] = []
    for spec in refspecs:
        if spec.startswith(":"):
            ctx.block(f"`{spec}` deletes a remote branch; branch deletion is founder-only.")
            continue
        if spec.startswith("+"):
            ctx.block(f"`{spec}` is a forced refspec; not allowed.")
            spec = spec[1:]
        dest = spec.split(":", 1)[1] if ":" in spec else spec
        if dest in ("HEAD", "@") or dest == "":
            dest = current_branch(cwd)
        targets.append(dest.removeprefix("refs/heads/"))
    if not refspecs:
        targets.append(current_branch(cwd))
    for dest in targets:
        if dest in PROTECTED_BRANCHES:
            ctx.block(
                f"push to `{dest}` is not allowed: trunk changes land only as squash-merged PRs "
                "(Release Strategy). Push a short-lived branch and open a PR."
            )


def check_add(ctx: Context, args: list[str], cwd: Path) -> None:
    sweeping = any(a in ("-A", "--all", ".", ":/", "--", "*") for a in args) or not args
    dirs = [resolve(cwd, a) for a in args if not a.startswith("-") and resolve(cwd, a).is_dir()]
    if sweeping or dirs:
        untracked = git_out(cwd, "ls-files", "-z", "--others", "--exclude-standard")
        bad = [p for p in untracked if secret_name(ctx.policy, Path(p).name)]
        if bad:
            ctx.block(
                f"`git add` would stage secret-bearing files ({', '.join(bad[:5])}) (INV-15). "
                "Add them to .gitignore (P02.04.03) or stage explicit paths."
            )


def check_git(ctx: Context, cmd: SimpleCommand, cwd: Path, nested: bool) -> None:
    globals_, sub, args, call_cwd = git_parts(cmd.words, cwd)
    joined = " ".join(globals_)
    if "core.hooksPath" in joined or "core.hookspath" in joined.lower():
        ctx.block("overriding core.hooksPath skips the repository's hooks; not allowed.")
    if any(cmd.env.get(k) not in (None, "") for k in HOOK_BYPASS_ENV):
        ctx.block("HUSKY/LEFTHOOK/SKIP environment overrides skip the git hooks; not allowed.")
    if "--no-verify" in args and sub in ("commit", "merge", "push", "rebase", "cherry-pick", "am"):
        ctx.block(f"`git {sub} --no-verify` skips the git hooks; not allowed.")
    if sub == "push":
        check_push(ctx, cmd, globals_, args, call_cwd, nested)
    elif sub in MESSAGE_GIT_SUBS:
        check_git_message(ctx, cmd, sub, args, call_cwd)
    elif sub == "add":
        check_add(ctx, args, call_cwd)
    check_git_control_plane(ctx, sub, args, call_cwd)


def check_gh(ctx: Context, cmd: SimpleCommand, cwd: Path) -> None:
    words = cmd.words
    group = words[1] if len(words) > 1 else ""
    action = words[2] if len(words) > 2 and group != "api" else ""
    if (group, action) in GH_BLOCKED or (group, "*") in GH_BLOCKED:
        ctx.block(f"`gh {group} {action}`".replace(" `", "`") + " is founder-only.")
        return
    if (group, action) == ("pr", "create") and not {"--draft", "-d"} & set(words[3:]):
        ctx.block(
            "`gh pr create` must open a draft (`--draft`); the founder marks PRs ready and merges."
        )
    if group == "api":
        check_gh_api(ctx, words[2:])
    if (group, action) not in GH_TEXT_COMMANDS:
        return
    args = words[2:] if group == "api" else words[3:]
    i = 0
    while i < len(args):
        arg = args[i]
        flag, _, inline = arg.partition("=")
        has_inline = "=" in arg and arg.startswith("--")
        value = inline if has_inline else (args[i + 1] if i + 1 < len(args) else None)
        step = 1 if has_inline else 2
        if group == "api" and flag in GH_API_FIELD_FLAGS:
            field_value = None if value is None else value.split("=", 1)[-1]
            if field_value is not None and field_value.startswith("@"):
                text = read_message_file(ctx, cwd, field_value[1:])
            else:
                text = None if value is None else message_value(ctx, cwd, value, cmd.env)
            check_text(ctx, f"`gh api` {flag}", text)
            i += step
        elif flag in GH_TEXT_FLAGS and group != "api":
            text = None if value is None else message_value(ctx, cwd, value, cmd.env)
            check_text(ctx, f"`gh {group} {action}` {flag}", text)
            i += step
        elif flag in GH_FILE_FLAGS:
            text = None if value is None else read_message_file(ctx, cwd, value)
            check_text(ctx, f"`gh {group} {action}` {flag}", text)
            i += step
        else:
            i += 1


def check_gh_api(ctx: Context, args: list[str]) -> None:
    value_flags = frozenset(
        {
            "-X",
            "--method",
            "-f",
            "-F",
            "--field",
            "--raw-field",
            "-H",
            "--header",
            "--input",
            "-q",
            "--jq",
            "-t",
            "--template",
            "--hostname",
            "--cache",
        }
    )
    pos = positionals(args, value_flags)
    endpoint = (pos[0] if pos else "").lstrip("/")
    fields = [
        args[i + 1] for i, a in enumerate(args[:-1]) if a in ("-f", "-F", "--field", "--raw-field")
    ]
    fields += [a.split("=", 1)[1] for a in args if a.startswith(("--field=", "--raw-field="))]
    explicit = next(
        (args[i + 1].upper() for i, a in enumerate(args[:-1]) if a in ("-X", "--method")), None
    )
    method = explicit or ("POST" if fields or "--input" in args else "GET")
    if endpoint == "graphql":
        if any(re.search(r"\bmutation\b", f) for f in fields):
            ctx.block("`gh api graphql` mutations are not allowed; use the documented gh commands.")
        return
    if method in ("GET", "HEAD"):
        return
    allowed = any(method == m and re.fullmatch(rx, endpoint) for m, rx in GH_API_WRITE_ALLOWED)
    if allowed and re.fullmatch(r"repos/[^/]+/[^/]+/pulls", endpoint):
        allowed = any(re.fullmatch(r"draft=true", f.strip()) for f in fields)
    if not allowed:
        ctx.block(
            f"`gh api -X {method} {endpoint}` is not allowed; sessions may only edit PR title/body, "
            "comment, or open draft PRs through the API."
        )


def check_terraform(ctx: Context, cmd: SimpleCommand) -> None:
    args = [a for a in cmd.words[1:]]
    if any(a in ("-auto-approve", "--auto-approve") for a in args):
        ctx.block("`-auto-approve` is never allowed (QG-05: applies are founder-only).")
    positionals = [a for a in args if not a.startswith("-")]
    if not positionals:
        return
    sub = positionals[0]
    if sub in TERRAFORM_BLOCKED or (sub == "workspace" and "delete" in positionals[1:2]):
        ctx.block(
            f"`terraform {' '.join(positionals[:2])}` changes real infrastructure or state and is "
            "founder-only (QG-05). Allowed: fmt, validate, init -backend=false."
        )
    elif sub == "plan":
        ctx.block(
            "`terraform plan` needs AWS credentials and is founder-only; use `terraform validate`."
        )
    elif sub == "init" and "-backend=false" not in args:
        ctx.block(
            "`terraform init` with a backend needs credentials; use `terraform init -backend=false`."
        )


def db_hosts(cmd: SimpleCommand) -> list[str]:
    hosts: list[str] = []
    words = cmd.words
    for i, arg in enumerate(words):
        if arg in ("-h", "--host") and i + 1 < len(words):
            hosts.append(words[i + 1])
        elif arg.startswith("--host="):
            hosts.append(arg.split("=", 1)[1])
        elif arg.startswith(("postgres://", "postgresql://")) or "host=" in arg:
            m = re.search(r"@([^/:?\s]+)", arg) or re.search(r"host=([^\s&]+)", arg)
            if m:
                hosts.append(m.group(1))
    env_host = cmd.env.get("PGHOST") or os.environ.get("PGHOST")
    if env_host:
        hosts.append(env_host)
    return hosts


def check_db(ctx: Context, cmd: SimpleCommand) -> None:
    for host in db_hosts(cmd):
        local = host in LOCAL_DB_HOSTS or host.startswith("127.") or host.startswith("/")
        if not local and ("." in host or ":" in host):
            ctx.block(
                f"`{os.path.basename(cmd.words[0])}` against `{host}`: only local databases are "
                "allowed from a session (INV-16: production data never leaves production)."
            )


def check_secret_tokens(ctx: Context, cmd: SimpleCommand, cwd: Path) -> None:
    head = os.path.basename(cmd.words[0])
    sub = cmd.words[1] if head == "git" and len(cmd.words) > 1 else ""
    candidates: list[str] = [t for tok in cmd.words[1:] for t in path_tokens(tok)]
    reading = not (head in NON_READING or (head == "git" and sub in NON_READING_GIT))
    targets = [target for _, target in cmd.redirects]
    for token in candidates + targets:
        if not reading and token not in targets:
            continue
        for path in glob_expand(cwd, token):
            why = secret_path(ctx.policy, path)
            if why:
                ctx.block(
                    f"`{head}` would touch `{token}`: {why} (INV-15). Secrets never enter the "
                    "session; use `.env.example` for names, and ask the founder for values."
                )
                return
    if head in RECURSIVE_GREPS and any(
        (a.startswith("-") and not a.startswith("--") and ("r" in a or "R" in a))
        or a in ("--recursive", "--dereference-recursive")
        for a in cmd.words[1:]
    ):
        dirs = [
            resolve(cwd, a)
            for a in cmd.words[1:]
            if not a.startswith("-") and resolve(cwd, a).is_dir()
        ] or [cwd]
        for d in dirs:
            found = secrets_under(ctx.policy, d, honor_gitignore=False)
            if found:
                ctx.block(
                    f"`{head} -r` over `{d}` would read secret-bearing files ({', '.join(found[:3])}). "
                    "Use `git grep` or `rg` (they skip ignored files) or narrow the path (INV-15)."
                )
    if head in IGNORE_AWARE_SEARCH and any(
        a in ("-u", "-uu", "-uuu", "--no-ignore", "--hidden") for a in cmd.words[1:]
    ):
        found = secrets_under(ctx.policy, cwd, honor_gitignore=False)
        if found:
            ctx.block(
                f"`{head}` without ignore rules would read secret-bearing files ({', '.join(found[:3])}) (INV-15)."
            )


def check_inline_code(ctx: Context, cmd: SimpleCommand) -> None:
    head = os.path.basename(cmd.words[0])
    base = re.sub(r"[0-9.]+$", "", head)
    if base not in INTERPRETERS and head not in INTERPRETERS:
        return
    code = " ".join(cmd.words[1:])
    if re.search(r"\bdotenv\b|load_dotenv", code):
        ctx.block(f"inline `{head}` code loads a dotenv file (INV-15); not allowed.")
        return
    for m in INLINE_SECRET_RE.finditer(code):
        if not secret_name(ctx.policy, os.path.basename(m.group(1))):
            continue
        ctx.block(f"inline `{head}` code references `{m.group(1)}` (INV-15); not allowed.")
        return


def check_spec_files(ctx: Context, cmd: SimpleCommand, cwd: Path) -> None:
    head = os.path.basename(cmd.words[0])
    for _, target in cmd.redirects:
        if resolve(cwd, target).name == READ_ONLY_SPEC:
            ctx.block("BLUEPRINT.md is read-only (only the founder changes it).")
    args = cmd.words[1:]
    names = {resolve(cwd, a).name for a in args if not a.startswith("-")}
    if READ_ONLY_SPEC in names:
        inplace = head in INPLACE_EDITORS and any(
            a.startswith("-i") or a == "--in-place" for a in args
        )
        git_write = head == "git" and args[:1] in (["rm"], ["mv"])
        if inplace or head in WRITERS or head == "rm" or git_write:
            ctx.block("BLUEPRINT.md is read-only (only the founder changes it).")
    if head in SPEC_WHOLE_READERS and names & SPEC_FILES:
        ctx.block(
            "PLAN.md/BLUEPRINT.md are too large to read whole. Use "
            "`python3 .claude/bin/plan_section.py P02|P02.04|--ledger|--invariants|--id QG-09`, "
            "`grep -n`, `sed -n 'a,bp'`, or Read with offset/limit <= 400."
        )


def check_bash(ctx: Context) -> None:
    for cmd, cwd, nested in iter_commands(ctx, ctx.raw, ctx.cwd):
        head = os.path.basename(cmd.words[0])
        if head == "git":
            check_git(ctx, cmd, cwd, nested)
        elif head == "gh":
            check_gh(ctx, cmd, cwd)
        elif head in TERRAFORM:
            check_terraform(ctx, cmd)
        elif head in PROVIDER_CLIS:
            ctx.block(f"the `{head}` CLI acts on live provider accounts; founder-only.")
        elif head in PG_CLIENTS:
            check_db(ctx, cmd)
        check_secret_tokens(ctx, cmd, cwd)
        check_inline_code(ctx, cmd)
        check_spec_files(ctx, cmd, cwd)
        check_protected_paths(ctx, cmd, cwd)
        check_nested_and_evasion(ctx, cmd)
        check_unattended_table(ctx, cmd)
        for label, text in script_texts(ctx, cmd, cwd):
            check_executed_code(ctx, label, text)
    for body in ctx.executed_heredocs:
        check_executed_code(ctx, "a heredoc script", body)
    check_piped_network(ctx)
    for marker in ctx.policy.evasion_markers:
        if marker in ctx.raw:
            ctx.block(f"`{marker}` would weaken or skip the session guards; not allowed.")
    for body in ctx.executed_heredocs:
        for m in INLINE_SECRET_RE.finditer(body):
            if secret_name(ctx.policy, os.path.basename(m.group(1))) and re.search(
                r"\bopen\(|readFile|read_text|load_dotenv|dotenv|\bcat\b|source\s", body
            ):
                ctx.block(f"a heredoc script reads `{m.group(1)}` (INV-15); not allowed.")
                break


# --------------------------------------------------------------------------- other tools


def check_file_tool(ctx: Context, tool: str, tool_input: dict[str, Any]) -> None:
    key = "notebook_path" if tool == "NotebookEdit" else ("path" if tool == "Grep" else "file_path")
    raw = tool_input.get(key)
    if tool == "Grep" and not raw:
        raw = str(ctx.cwd)
    if not isinstance(raw, str) or not raw:
        ctx.block(f"{tool} input has no {key}; blocking to fail closed.")
        return
    path = resolve(ctx.cwd, raw)
    why = secret_path(ctx.policy, path)
    if why:
        ctx.block(f"{tool} `{raw}`: {why} (INV-15). Use `.env.example` for variable names.")
        return
    if tool in WRITE_TOOLS and (why := protected_reason(ctx, path)):
        protect_block(ctx, f"{tool} `{raw}`", why)
        return
    if tool in WRITE_TOOLS and path.name == READ_ONLY_SPEC:
        ctx.block("BLUEPRINT.md is read-only (only the founder changes it).")
    if tool == "Read" and path.name in SPEC_FILES:
        limit = tool_input.get("limit")
        if not isinstance(limit, int) or limit > MAX_SPEC_READ_LINES:
            ctx.block(
                f"{path.name} is too large to read whole: pass limit <= {MAX_SPEC_READ_LINES} with "
                "an offset, or use `python3 .claude/bin/plan_section.py P02|P02.04|--ledger|"
                "--invariants|--id <ID>`."
            )
    if tool == "Grep" and path.is_dir():
        found = secrets_under(ctx.policy, path, honor_gitignore=True)
        if found:
            ctx.block(
                f"Grep over `{raw}` would read secret-bearing files that are not gitignored "
                f"({', '.join(found[:3])}). Add them to .gitignore or narrow the path."
            )


def check_mcp(ctx: Context, tool: str, tool_input: dict[str, Any]) -> None:
    for key, value in tool_input.items():
        if key in MCP_TEXT_KEYS and isinstance(value, str):
            check_text(ctx, f"{tool} `{key}`", value)


# --------------------------------------------------------------------------- entry point


def log_decision(path: str | None, record: dict[str, object]) -> None:
    if not path:
        return
    try:
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        record = {
            "ts": dt.datetime.now(dt.UTC).isoformat(timespec="seconds"),
            "hook": "policy_guard",
            **record,
        }
        with open(path, "a", encoding="utf-8") as fh:
            fh.write(json.dumps(record) + "\n")
    except OSError:
        pass


def block(message: str, log: str | None, subject: str) -> int:
    print(f"policy-guard: {message}", file=sys.stderr)
    log_decision(log, {"decision": "block", "subject": subject[:300], "reason": message[:600]})
    return EXIT_BLOCK


def project_toplevel(cwd: Path) -> str:
    out = git_out(cwd, "rev-parse", "--show-toplevel") if cwd.is_dir() else []
    return out[0].strip() if out else str(cwd)


def evaluate(payload: dict[str, Any], policy: Policy) -> list[str]:
    tool = payload.get("tool_name")
    tool_input = payload.get("tool_input")
    if not isinstance(tool, str) or not isinstance(tool_input, dict):
        return ["hook input has no tool_name/tool_input; blocking to fail closed."]
    cwd = Path(str(payload.get("cwd") or os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd()))
    root = Path(os.environ.get("CLAUDE_PROJECT_DIR") or project_toplevel(cwd))
    if tool == "Bash":
        command = tool_input.get("command")
        if not isinstance(command, str):
            return ["hook input has no Bash command string; blocking to fail closed."]
        docs = heredoc_bodies(command)
        ctx = Context(policy, cwd, command, [body for _, body in docs], root=root)
        ctx.executed_heredocs = [body for executed, body in docs if executed]
        check_bash(ctx)
        return ctx.reasons
    ctx = Context(policy, cwd, "", [], root=root)
    if tool in FILE_TOOLS:
        check_file_tool(ctx, tool, tool_input)
    elif tool.startswith("mcp__"):
        check_mcp(ctx, tool, tool_input)
    return ctx.reasons


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--log")
    opts, _ = parser.parse_known_args(argv)
    try:
        payload = json.loads(sys.stdin.read())
        if not isinstance(payload, dict):
            raise ValueError("hook input is not a JSON object")
    except ValueError as exc:
        return block(f"could not parse hook input ({exc}); blocking to fail closed.", opts.log, "")
    subject = json.dumps(payload.get("tool_input"))[:300]
    try:
        reasons = evaluate(payload, load_policy())
    except PolicyError as exc:
        return block(
            f"policy files unreadable ({exc}); blocking to fail closed.", opts.log, subject
        )
    except GuardParseError as exc:
        return block(
            f"could not parse this command ({exc}). Rewrite it as simple commands so it can be "
            "checked.",
            opts.log,
            subject,
        )
    except Exception as exc:  # fail closed on any internal error
        return block(
            f"internal error ({type(exc).__name__}: {exc}); blocking to fail closed.",
            opts.log,
            subject,
        )
    if not reasons:
        return EXIT_ALLOW
    return block("blocked by repository policy:\n  - " + "\n  - ".join(reasons), opts.log, subject)


if __name__ == "__main__":
    sys.exit(main())
