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
PG_CLIENTS = frozenset({"psql", "pg_dump", "pg_dumpall", "pg_restore", "pgcli"})
LOCAL_DB_HOSTS = frozenset(
    {"", "localhost", "127.0.0.1", "::1", "0.0.0.0", "host.docker.internal"}  # noqa: S104
)
AWS_BLOCKED = frozenset(
    {
        ("configure", "*"),
        ("sso", "*"),
        ("secretsmanager", "get-secret-value"),
        ("iam", "create-access-key"),
        ("ssm", "get-parameter"),
        ("ssm", "get-parameters"),
    }
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
PROD_PROFILE_RE = re.compile(r"prod", re.IGNORECASE)
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

    def block(self, reason: str) -> None:
        if reason not in self.reasons:
            self.reasons.append(reason)


# --------------------------------------------------------------------------- policy files


def load_policy(directory: Path = POLICY_DIR) -> Policy:
    try:
        ai = json.loads((directory / "no-ai-mentions.json").read_text(encoding="utf-8"))
        sec = json.loads((directory / "secret-paths.json").read_text(encoding="utf-8"))
        patterns = [(str(p["id"]), re.compile(str(p["regex"]))) for p in ai["patterns"]]
        return Policy(
            ai_patterns=patterns,
            basename_globs=[str(g) for g in sec["basename_globs"]],
            basename_exceptions=[str(g) for g in sec["basename_exceptions"]],
            home_paths=[str(g) for g in sec["home_paths"]],
            absolute_globs=[str(g) for g in sec["absolute_globs"]],
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


def heredoc_bodies(command: str) -> list[str]:
    bodies: list[str] = []
    lines = command.split("\n")
    i = 0
    while i < len(lines):
        m = HEREDOC_START_RE.search(lines[i])
        i += 1
        if not m:
            continue
        body: list[str] = []
        while i < len(lines) and lines[i].strip() != m.group(2):
            body.append(lines[i])
            i += 1
        bodies.append("\n".join(body))
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
            "this push form bypasses the permission prompt (git -C/-c/--git-dir, an absolute "
            "git path, sh -c or eval). Push with the plain form from the repository root: "
            "`git push -u origin <branch>`; it asks the founder for approval."
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


def check_gh(ctx: Context, cmd: SimpleCommand, cwd: Path) -> None:
    words = cmd.words
    group = words[1] if len(words) > 1 else ""
    action = words[2] if len(words) > 2 and group != "api" else ""
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
            "founder-only (QG-05). Allowed: fmt, validate, init -backend=false; plan asks first."
        )


def aws_profile(cmd: SimpleCommand) -> str:
    words = cmd.words
    for i, arg in enumerate(words):
        if arg == "--profile" and i + 1 < len(words):
            return words[i + 1]
        if arg.startswith("--profile="):
            return arg.split("=", 1)[1]
    return cmd.env.get("AWS_PROFILE") or os.environ.get("AWS_PROFILE", "")


def check_aws(ctx: Context, cmd: SimpleCommand) -> None:
    profile = aws_profile(cmd)
    if PROD_PROFILE_RE.search(profile):
        ctx.block(f"AWS profile `{profile}` is production; never used from a session (INV-16).")
    positionals = [a for a in cmd.words[1:] if not a.startswith("-")]
    service = positionals[0] if positionals else ""
    op = positionals[1] if len(positionals) > 1 else ""
    if (service, "*") in AWS_BLOCKED or (service, op) in AWS_BLOCKED:
        ctx.block(f"`aws {service} {op}` handles credentials or secrets; founder-only (INV-15).")
    if op.startswith(("delete-", "terminate-", "put-secret", "deregister-")):
        ctx.block(f"`aws {service} {op}` is destructive; founder-only.")


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
        elif head == "aws":
            check_aws(ctx, cmd)
        elif head in PG_CLIENTS:
            check_db(ctx, cmd)
        check_secret_tokens(ctx, cmd, cwd)
        check_inline_code(ctx, cmd)
        check_spec_files(ctx, cmd, cwd)
    for body in ctx.heredocs:
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


def evaluate(payload: dict[str, Any], policy: Policy) -> list[str]:
    tool = payload.get("tool_name")
    tool_input = payload.get("tool_input")
    if not isinstance(tool, str) or not isinstance(tool_input, dict):
        return ["hook input has no tool_name/tool_input; blocking to fail closed."]
    cwd = Path(str(payload.get("cwd") or os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd()))
    if tool == "Bash":
        command = tool_input.get("command")
        if not isinstance(command, str):
            return ["hook input has no Bash command string; blocking to fail closed."]
        ctx = Context(policy, cwd, command, heredoc_bodies(command))
        check_bash(ctx)
        return ctx.reasons
    ctx = Context(policy, cwd, "", [])
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
