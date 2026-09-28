#!/usr/bin/env python3
"""git-guard: PreToolUse hook that blocks git commands which would discard uncommitted work.

Portable: a single stdlib-only file. Install at user level (~/.claude/kit/hooks/) or copy
it into a repository's .claude/hooks/ and register it in .claude/settings.json:

    "PreToolUse": [{"matcher": "Bash", "hooks": [{"type": "command",
        "if": "Bash(git *)",
        "command": "${CLAUDE_PROJECT_DIR}/.claude/hooks/git_guard.py", "timeout": 20}]}]

Blocked (exit 2, reason shown to Claude) only when work would actually be lost:
  git checkout -- <paths> / git checkout <ref> -- <paths> / git checkout <paths>|.   dirty paths
  git checkout -f|--force, git switch -f|--discard-changes                       dirty tree
  git restore <paths> (unless --staged only)                                    dirty paths
  git reset --hard                                                              dirty tree
  git clean -f...                                                               untracked files
  git stash drop | git stash clear                                              stashes exist
  git worktree remove --force <path>                                            dirty worktree
  git push --force/-f/--force-with-lease/+ref/--delete/--mirror to main|master  always

Fails closed: unparseable hook input or command, or an internal error, blocks the call.
Runs in milliseconds (a PreToolUse hook that times out does NOT block, so it must stay fast).
Options:
  --skip-headless  allow everything in headless SDK sessions (claude -p workers) unless
                   $CLAUDE_CODE_REMOTE=true. Use only for the user-level install.
  --defer-to-repo  stand down when $CLAUDE_PROJECT_DIR/.claude/settings.json registers the
                   repo's own copy of this hook. Use only for the user-level install.
  --log FILE       append one JSON line per skip or block decision.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import shlex
import subprocess
import sys
from collections.abc import Sequence
from dataclasses import dataclass, field
from pathlib import Path

EXIT_ALLOW, EXIT_BLOCK = 0, 2
MAX_LISTED_PATHS = 8
PROTECTED_BRANCHES = frozenset({"main", "master"})
SEPARATORS = frozenset({";", "&&", "||", "|", "&", "|&", "(", ")", ";;"})
REDIRECT_RE = re.compile(r"^[0-9]*[<>]+&?$")
ASSIGNMENT_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*=")
HEREDOC_RE = re.compile(r"<<-?\s*(['\"]?)([A-Za-z_][A-Za-z0-9_]*)\1")
WRAPPERS = frozenset({"sudo", "command", "exec", "nice", "nohup", "time", "builtin", "env"})
GIT_GLOBAL_WITH_VALUE = frozenset(
    {"-c", "--git-dir", "--work-tree", "--namespace", "--exec-path", "--super-prefix"}
)
NEUTRAL_COMMANDS = frozenset(
    {
        "cd",
        "pushd",
        "popd",
        "export",
        "unset",
        "set",
        "true",
        ":",
        "echo",
        "printf",
        "pwd",
        "ls",
        "cat",
        "head",
        "tail",
        "wc",
        "test",
        "[",
        "sleep",
        "which",
        "type",
        "date",
    }
)
READ_ONLY_GIT = frozenset(
    {
        "status",
        "log",
        "diff",
        "show",
        "rev-parse",
        "ls-files",
        "branch",
        "remote",
        "config",
        "describe",
        "blame",
        "grep",
        "shortlog",
        "reflog",
        "fetch",
        "cat-file",
        "merge-base",
    }
)
KNOWN_SUBCOMMANDS = frozenset(
    {"checkout", "restore", "reset", "clean", "stash", "switch", "worktree", "push"}
)


class GuardParseError(Exception):
    """The command could not be tokenized reliably."""


@dataclass
class GitCall:
    cwd: Path
    sub: str
    args: list[str]
    env: dict[str, str] = field(default_factory=dict)
    text: str = ""
    after_mutation: bool = False  # an earlier command in the same line may change the tree


# --------------------------------------------------------------------------- parsing


def strip_heredocs(command: str) -> str:
    out: list[str] = []
    lines = command.split("\n")
    i = 0
    while i < len(lines):
        line = lines[i]
        out.append(line)
        m = HEREDOC_RE.search(line)
        if m:
            delim = m.group(2)
            i += 1
            while i < len(lines) and lines[i].strip() != delim:
                i += 1
        i += 1
    return "\n".join(out)


def substitutions(command: str) -> list[str]:
    """Inner text of $(...) and `...` (outside single quotes), for nested inspection."""
    found: list[str] = []
    i, n, in_single = 0, len(command), False
    while i < n:
        ch = command[i]
        if ch == "\\" and not in_single:
            i += 2  # escaped character (e.g. \` or \$) is not a substitution
            continue
        if ch == "'" and not in_single:
            in_single = True
        elif ch == "'" and in_single:
            in_single = False
        elif not in_single and command.startswith("$(", i):
            depth, j = 1, i + 2
            while j < n and depth:
                depth += {"(": 1, ")": -1}.get(command[j], 0)
                j += 1
            found.append(command[i + 2 : j - 1])
            i = j
            continue
        elif not in_single and ch == "`":
            j = command.find("`", i + 1)
            if j > i:
                found.append(command[i + 1 : j])
                i = j + 1
                continue
        i += 1
    return found


def tokenize(text: str) -> list[str]:
    lex = shlex.shlex(text.replace("\n", " ; "), posix=True, punctuation_chars=";&|()<>")
    lex.whitespace_split = True
    lex.commenters = "#"
    try:
        return list(lex)
    except ValueError as exc:
        raise GuardParseError(str(exc)) from exc


def segments(tokens: Sequence[str]) -> list[tuple[list[str], bool]]:
    """Simple commands of a line, each with a flag telling whether it had a redirection."""
    segs: list[tuple[list[str], bool]] = [([], False)]
    skip_next = False
    for tok in tokens:
        if skip_next:
            skip_next = False
            continue
        if tok in SEPARATORS or (tok and set(tok) <= set(";&|()")):
            segs.append(([], False))
        elif REDIRECT_RE.match(tok):
            words = segs[-1][0]
            if words and words[-1].isdigit():
                words.pop()  # file-descriptor number of `2>` split off by the tokenizer
            segs[-1] = (words, True)
            skip_next = True
        else:
            segs[-1][0].append(tok)
    return [s for s in segs if s[0]]


def strip_prefixes(seg: list[str]) -> tuple[list[str], dict[str, str]]:
    env: dict[str, str] = {}
    i = 0
    while i < len(seg):
        tok = seg[i]
        if ASSIGNMENT_RE.match(tok):
            key, _, val = tok.partition("=")
            env[key] = val
            i += 1
        elif tok in WRAPPERS:
            i += 1
            while i < len(seg) and seg[i].startswith("-"):
                i += 1
        elif tok == "timeout":
            i += 1
            while i < len(seg) and seg[i].startswith("-"):
                i += 1
            i += 1  # duration
        else:
            break
    return seg[i:], env


VAR_RE = re.compile(r"\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))")


def expand(target: str, shell_vars: dict[str, str]) -> str:
    """Expand $VAR / ${VAR} from assignments earlier in the line, then the environment.
    Unknown variables are left in place, so the path stays unresolvable."""

    def sub(m: re.Match[str]) -> str:
        name = m.group(1) or m.group(2)
        return shell_vars.get(name, os.environ.get(name, m.group(0)))

    return VAR_RE.sub(sub, target)


def resolve_dir(base: Path, target: str, shell_vars: dict[str, str] | None = None) -> Path:
    path = Path(os.path.expanduser(expand(target, shell_vars or {})))
    return path if path.is_absolute() else (base / path)


def git_alias(cwd: Path, name: str) -> list[str] | None:
    proc = subprocess.run(
        ["git", "-C", str(cwd), "config", "--get", f"alias.{name}"],
        capture_output=True,
        text=True,
        check=False,
    )
    value = proc.stdout.strip()
    if proc.returncode != 0 or not value or value.startswith("!"):
        return None
    return shlex.split(value)


def parse_git_calls(command: str, cwd: Path) -> list[GitCall]:
    calls: list[GitCall] = []
    body = strip_heredocs(command)
    texts = [body, *substitutions(body)]
    for text in texts:
        current = cwd
        mutated = False
        shell_vars: dict[str, str] = {}
        for seg, redirected in segments(tokenize(text)):
            words, env = strip_prefixes(seg)
            if not words:
                shell_vars.update({k: expand(v, shell_vars) for k, v in env.items()})
                continue
            head = os.path.basename(words[0])
            if head == "export":
                for tok in words[1:]:
                    if ASSIGNMENT_RE.match(tok):
                        key, _, val = tok.partition("=")
                        shell_vars[key] = expand(val, shell_vars)
            if head in ("cd", "pushd"):
                if len(words) > 1 and words[1] != "-":
                    current = resolve_dir(current, words[1], shell_vars)
                elif len(words) == 1:
                    current = Path.home()
                continue
            if head != "git":
                mutated = mutated or redirected or head not in NEUTRAL_COMMANDS
                continue
            call_cwd, i = current, 1
            while i < len(words):
                arg = words[i]
                if arg == "-C" and i + 1 < len(words):
                    call_cwd = resolve_dir(call_cwd, words[i + 1], shell_vars)
                    i += 2
                elif arg in GIT_GLOBAL_WITH_VALUE and i + 1 < len(words):
                    if arg == "--work-tree":
                        call_cwd = resolve_dir(call_cwd, words[i + 1], shell_vars)
                    i += 2
                elif arg.startswith("--work-tree="):
                    call_cwd = resolve_dir(call_cwd, arg.split("=", 1)[1], shell_vars)
                    i += 1
                elif arg.startswith("-"):
                    i += 1
                else:
                    break
            if i >= len(words):
                continue
            sub, args = words[i], words[i + 1 :]
            if sub not in KNOWN_SUBCOMMANDS and call_cwd.is_dir():
                expansion = git_alias(call_cwd, sub)
                if expansion:
                    sub, args = expansion[0], expansion[1:] + args
            calls.append(GitCall(call_cwd, sub, args, env, " ".join(seg), mutated))
            mutated = mutated or redirected or sub not in READ_ONLY_GIT
    return calls


# --------------------------------------------------------------------------- repo state


def in_repo(cwd: Path) -> bool:
    if not cwd.is_dir():
        return False
    proc = subprocess.run(
        ["git", "-C", str(cwd), "rev-parse", "--is-inside-work-tree"],
        capture_output=True,
        text=True,
        check=False,
    )
    return proc.returncode == 0 and proc.stdout.strip() == "true"


def git_lines(cwd: Path, *args: str) -> list[str]:
    proc = subprocess.run(
        ["git", "-C", str(cwd), *args], capture_output=True, text=True, check=False
    )
    sep = "\0" if "-z" in args else "\n"
    return [p for p in proc.stdout.split(sep) if p.strip()]


def changes(cwd: Path, *, vs_head: bool, paths: Sequence[str] = ()) -> list[str]:
    """Paths whose working-tree content would be lost (vs index, or vs HEAD)."""
    spec = ["--", *paths] if paths else []
    if vs_head:
        head = git_lines(cwd, "rev-parse", "--verify", "--quiet", "HEAD")
        if not head:
            return git_lines(cwd, "diff", "--cached", "--name-only", "-z", *spec)
        return git_lines(cwd, "diff", "HEAD", "--name-only", "-z", *spec)
    return git_lines(cwd, "diff", "--name-only", "-z", *spec)


def is_ref(cwd: Path, name: str) -> bool:
    proc = subprocess.run(
        ["git", "-C", str(cwd), "rev-parse", "--verify", "--quiet", f"{name}^{{commit}}"],
        capture_output=True,
        check=False,
    )
    return proc.returncode == 0


def split_opts(
    args: Sequence[str], with_value: frozenset[str] = frozenset()
) -> tuple[list[str], list[str], list[str] | None]:
    """(options, positionals before --, positionals after -- or None)."""
    opts: list[str] = []
    pos: list[str] = []
    i = 0
    while i < len(args):
        arg = args[i]
        if arg == "--":
            return opts, pos, list(args[i + 1 :])
        if arg.startswith("-") and arg != "-":
            opts.append(arg)
            if arg in with_value and i + 1 < len(args):
                opts.append(args[i + 1])
                i += 1
        else:
            pos.append(arg)
        i += 1
    return opts, pos, None


def has_short_flag(opts: Sequence[str], letter: str) -> bool:
    return any(o.startswith("-") and not o.startswith("--") and letter in o[1:] for o in opts)


# --------------------------------------------------------------------------- rules


def listed(paths: Sequence[str]) -> str:
    shown = ", ".join(paths[:MAX_LISTED_PATHS])
    more = len(paths) - MAX_LISTED_PATHS
    return shown + (f" (+{more} more)" if more > 0 else "")


def destructive_form(call: GitCall) -> bool:
    """True if the call discards working-tree state whenever there is any to discard."""
    sub, args = call.sub, call.args
    if sub == "checkout":
        opts, pos, after = split_opts(args, frozenset({"-b", "-B", "--orphan", "--conflict"}))
        if any(o in ("-b", "-B", "--orphan") for o in opts) and after is None:
            return False
        if after is not None or "--force" in opts or has_short_flag(opts, "f"):
            return True
        return len(pos) > 1 or (len(pos) == 1 and not is_ref(call.cwd, pos[0]))
    if sub == "restore":
        opts, pos, after = split_opts(args, frozenset({"-s", "--source"}))
        staged_only = ("--staged" in opts or has_short_flag(opts, "S")) and not (
            "--worktree" in opts or has_short_flag(opts, "W")
        )
        return not staged_only and bool((after or []) + pos)
    if sub == "reset":
        return "--hard" in args
    if sub == "clean":
        opts, _, _ = split_opts(args, frozenset({"-e", "--exclude"}))
        dry = "--dry-run" in opts or has_short_flag(opts, "n") or has_short_flag(opts, "i")
        return not dry and ("--force" in opts or has_short_flag(opts, "f"))
    if sub == "stash":
        return bool(args) and args[0] in ("drop", "clear")
    if sub == "switch":
        opts, _, _ = split_opts(args, frozenset({"-c", "-C", "--orphan"}))
        return "--discard-changes" in opts or "--force" in opts or has_short_flag(opts, "f")
    if sub == "worktree":
        return bool(args) and args[0] == "remove" and ("--force" in args or "-f" in args)
    return False


def check_call(call: GitCall) -> str | None:
    cwd, sub, args = call.cwd, call.sub, call.args
    if sub == "push":
        return check_push(call)
    if not in_repo(cwd):
        if destructive_form(call) and ("$" in str(cwd) or not cwd.exists()):
            return (
                f"cannot resolve the target directory ({cwd}); a destructive git command must "
                "name a directory that exists before the line runs. Use a literal path"
            )
        return None
    if call.after_mutation and destructive_form(call):
        return (
            "runs after other commands in the same line that may change the working tree; the "
            "guard checks state before the line runs, so it cannot know what would be lost. "
            "Run this git command on its own"
        )
    if sub == "checkout":
        opts, pos, after = split_opts(args, frozenset({"-b", "-B", "--orphan", "--conflict"}))
        if any(o in ("-b", "-B", "--orphan") for o in opts) and after is None:
            return None
        if after is not None:
            lost = changes(cwd, vs_head=bool(pos), paths=after)
            return f"would overwrite uncommitted changes in: {listed(lost)}" if lost else None
        if "--force" in opts or has_short_flag(opts, "f"):
            lost = changes(cwd, vs_head=True)
            return f"force checkout would discard changes in: {listed(lost)}" if lost else None
        if not pos:
            return None
        if is_ref(cwd, pos[0]) and not (cwd / pos[0]).exists():
            if len(pos) == 1:
                return None  # plain branch switch; git refuses to clobber local changes
            lost = changes(cwd, vs_head=True, paths=pos[1:])
            return f"would overwrite uncommitted changes in: {listed(lost)}" if lost else None
        lost = changes(cwd, vs_head=False, paths=pos)
        return f"would discard uncommitted changes in: {listed(lost)}" if lost else None
    if sub == "restore":
        opts, pos, after = split_opts(args, frozenset({"-s", "--source"}))
        staged = "--staged" in opts or has_short_flag(opts, "S")
        worktree = "--worktree" in opts or has_short_flag(opts, "W")
        if staged and not worktree:
            return None
        paths = (after or []) + pos
        if not paths:
            return None
        source = any(o in ("-s", "--source") or o.startswith("--source=") for o in opts)
        lost = changes(cwd, vs_head=source or staged, paths=paths)
        return f"would discard uncommitted changes in: {listed(lost)}" if lost else None
    if sub == "reset":
        if "--hard" in args:
            lost = changes(cwd, vs_head=True)
            return f"reset --hard would discard changes in: {listed(lost)}" if lost else None
        return None
    if sub == "clean":
        opts, pos, after = split_opts(args, frozenset({"-e", "--exclude"}))
        dry = "--dry-run" in opts or has_short_flag(opts, "n") or has_short_flag(opts, "i")
        force = "--force" in opts or has_short_flag(opts, "f")
        if dry or not force:
            return None
        flags = ["-n"]
        flags += ["-d"] if has_short_flag(opts, "d") else []
        flags += ["-x"] if has_short_flag(opts, "x") else []
        flags += ["-X"] if has_short_flag(opts, "X") else []
        doomed = [
            line.removeprefix("Would remove ")
            for line in git_lines(cwd, "clean", *flags, "--", *((after or []) + pos))
        ]
        return f"would delete untracked files: {listed(doomed)}" if doomed else None
    if sub == "stash" and args and args[0] in ("drop", "clear"):
        stashes = git_lines(cwd, "stash", "list")
        return (
            f"stash {args[0]} destroys saved work ({len(stashes)} stash entries)"
            if stashes
            else None
        )
    if sub == "switch":
        opts, _, _ = split_opts(args, frozenset({"-c", "-C", "--orphan"}))
        if "--discard-changes" in opts or "--force" in opts or has_short_flag(opts, "f"):
            lost = changes(cwd, vs_head=True)
            return f"switch would discard changes in: {listed(lost)}" if lost else None
        return None
    if sub == "worktree" and args and args[0] == "remove":
        opts, pos, _ = split_opts(args[1:])
        if ("--force" in opts or has_short_flag(opts, "f")) and pos:
            target = resolve_dir(cwd, pos[-1])
            dirty = git_lines(target, "status", "--porcelain") if target.is_dir() else []
            return f"worktree {target} has uncommitted work: {listed(dirty)}" if dirty else None
    return None


def check_push(call: GitCall) -> str | None:
    opts, pos, _ = split_opts(
        call.args, frozenset({"-o", "--push-option", "--repo", "--receive-pack", "--exec"})
    )
    force = any(
        o in ("--force", "--force-if-includes", "--mirror") or o.startswith("--force-with-lease")
        for o in opts
    ) or has_short_flag(opts, "f")
    delete = "--delete" in opts or has_short_flag(opts, "d")
    refspecs = pos[1:] if pos else []
    targets: list[str] = []
    for spec in refspecs:
        plus = spec.startswith("+")
        spec = spec.lstrip("+")
        dst = spec.split(":", 1)[1] if ":" in spec else spec
        if spec.startswith(":"):
            delete = True
        if plus:
            force = True
        targets.append(dst.removeprefix("refs/heads/"))
    if not refspecs and in_repo(call.cwd):
        current = git_lines(call.cwd, "rev-parse", "--abbrev-ref", "HEAD")
        targets = current[:1]
    if "--mirror" in opts:
        return "push --mirror force-overwrites every remote ref, including main"
    hit = sorted(PROTECTED_BRANCHES.intersection(targets))
    if hit and (force or delete):
        what = "delete" if delete else "force-push"
        return f"{what} to protected branch {', '.join(hit)} rewrites shared history"
    return None


# --------------------------------------------------------------------------- hook entry


def log_decision(path: str | None, record: dict[str, object]) -> None:
    if not path:
        return
    try:
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        record["ts"] = dt.datetime.now(dt.UTC).isoformat(timespec="seconds")
        record["hook"] = "git_guard"
        with open(path, "a", encoding="utf-8") as fh:
            fh.write(json.dumps(record) + "\n")
    except OSError:
        pass


def deferred_to_repo(hook_path: Path) -> bool:
    """True when the session's project registers its own copy of this hook in
    .claude/settings.json, so the user-level copy stands down and exactly one copy runs.
    Any doubt (no project dir, unreadable settings, we ARE the repo copy) keeps this copy on."""
    project = os.environ.get("CLAUDE_PROJECT_DIR")
    if not project:
        return False
    repo_copy = Path(project) / ".claude" / "hooks" / hook_path.name
    try:
        if not repo_copy.is_file() or repo_copy.resolve() == hook_path.resolve():
            return False
        settings = json.loads((Path(project) / ".claude" / "settings.json").read_text())
    except (OSError, ValueError):
        return False
    hooks = settings.get("hooks") if isinstance(settings, dict) else None
    return f".claude/hooks/{hook_path.name}" in json.dumps(hooks)


def headless() -> bool:
    entry = os.environ.get("CLAUDE_CODE_ENTRYPOINT", "")
    return entry.startswith("sdk") and os.environ.get("CLAUDE_CODE_REMOTE") != "true"


def block(message: str, log: str | None, command: str) -> int:
    print(f"git-guard: {message}", file=sys.stderr)
    log_decision(log, {"decision": "block", "command": command[:300], "reason": message[:500]})
    return EXIT_BLOCK


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--skip-headless", action="store_true")
    parser.add_argument("--log")
    parser.add_argument("--defer-to-repo", action="store_true")
    opts, _ = parser.parse_known_args(argv)
    if opts.defer_to_repo and deferred_to_repo(Path(__file__)):
        log_decision(
            opts.log,
            {"decision": "defer", "repo": os.environ.get("CLAUDE_PROJECT_DIR", "")},
        )
        return EXIT_ALLOW
    if opts.skip_headless and headless():
        log_decision(
            opts.log,
            {"decision": "skip", "entrypoint": os.environ.get("CLAUDE_CODE_ENTRYPOINT", "")},
        )
        return EXIT_ALLOW
    raw = sys.stdin.read()
    try:
        payload = json.loads(raw)
        if not isinstance(payload, dict):
            raise ValueError("hook input is not a JSON object")
    except ValueError as exc:
        return block(f"could not parse hook input ({exc}); blocking to fail closed.", opts.log, "")
    if payload.get("tool_name") != "Bash":
        return EXIT_ALLOW
    tool_input = payload.get("tool_input")
    command = tool_input.get("command") if isinstance(tool_input, dict) else None
    if not isinstance(command, str):
        return block(
            "hook input has no Bash command string; blocking to fail closed.", opts.log, ""
        )
    if not re.search(r"\bgit\b", command):
        return EXIT_ALLOW
    cwd = Path(str(payload.get("cwd") or os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd()))
    try:
        calls = parse_git_calls(command, cwd)
        reasons = [(call, r) for call in calls if (r := check_call(call))]
    except GuardParseError as exc:
        return block(
            f"could not parse this command ({exc}). Rewrite it as simple commands "
            "(no unbalanced quotes) so it can be checked.",
            opts.log,
            command,
        )
    except Exception as exc:  # fail closed on any internal error
        return block(
            f"internal error ({type(exc).__name__}: {exc}); blocking to fail closed.",
            opts.log,
            command,
        )
    if not reasons:
        return EXIT_ALLOW
    lines = [f"`{call.text}`: {reason}" for call, reason in reasons]
    message = (
        "blocked: this would discard work or rewrite protected history.\n  "
        + "\n  ".join(lines)
        + '\nRecoverable alternatives: `git stash push -m "<why>" -- <paths>` (undo later with '
        "`git stash apply`); to prove a regression test, use mutation-check instead of reverting "
        "the fix by hand. If the user explicitly wants this discarded, ask them to run it "
        "themselves (`! <command>`)."
    )
    return block(message, opts.log, command)


if __name__ == "__main__":
    sys.exit(main())
