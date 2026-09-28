#!/usr/bin/env python3
"""Summarize a headless guard run (stream-json transcripts) into SUMMARY.md."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

MAX_FIRST_LINE = 160
MAX_HOOK_TEXT = 300
MAX_RESULT = 1500


def events(path: Path) -> list[dict[str, Any]]:
    found: list[dict[str, Any]] = []
    for raw in path.read_text(encoding="utf-8").splitlines():
        try:
            data = json.loads(raw)
        except ValueError:
            continue
        if isinstance(data, dict):
            found.append(data)
    return found


def summarize(out: Path, mode: str, work: str) -> str:
    lines = [f"# Headless guard run: mode={mode}", f"clone: {work}/moin", ""]
    order = ["guards", "selfprotect", "table", "tools", "claim", "claim-forced"]
    names = [n for n in order if (out / f"{n}.jsonl").exists()]
    names += sorted(p.stem for p in out.glob("stall-*.jsonl"))
    for name in names:
        uses: dict[str, tuple[str, dict[str, Any]]] = {}
        results: dict[str, tuple[bool, str]] = {}
        hooks: list[tuple[str, Any, str]] = []
        final = ""
        for d in events(out / f"{name}.jsonl"):
            if d.get("type") == "system" and d.get("subtype") == "hook_response":
                text = f"{d.get('stdout') or ''}{d.get('stderr') or ''}"
                hooks.append((str(d.get("hook_name")), d.get("exit_code"), text))
            if d.get("type") == "result":
                final = str(d.get("result"))
            message = d.get("message")
            content = message.get("content") if isinstance(message, dict) else None
            if not isinstance(content, list):
                continue
            for c in content:
                if c.get("type") == "tool_use":
                    uses[c["id"]] = (c["name"], c.get("input", {}))
                elif c.get("type") == "tool_result":
                    body = c.get("content")
                    if isinstance(body, list):
                        body = " ".join(
                            x.get("text", "") for x in body if isinstance(x, dict)
                        )
                    results[c["tool_use_id"]] = (bool(c.get("is_error")), str(body))
        lines += [
            f"## {name}: tool calls",
            "",
            "| # | tool | input | error | first line |",
            "|---|---|---|---|---|",
        ]
        for i, (uid, (tool, inp)) in enumerate(uses.items(), 1):
            err, text = results.get(uid, (False, ""))
            shown = inp.get("command") or inp.get("file_path") or json.dumps(inp)
            first = (
                text.strip().splitlines()[0][:MAX_FIRST_LINE] if text.strip() else ""
            )
            lines.append(
                f"| {i} | {tool} | `{str(shown)[:90]}` | {err} | {first.replace('|', '/')} |"
            )
        lines += ["", f"## {name}: hook responses with output or a non-zero exit", ""]
        for hname, code, text in hooks:
            if code not in (0, None) or text.strip():
                lines.append(f"- {hname} exit={code}: {text.strip()[:MAX_HOOK_TEXT]}")
        lines += [
            "",
            f"## {name}: final result",
            "",
            "```",
            final[:MAX_RESULT],
            "```",
            "",
        ]
    return "\n".join(lines)


def main() -> int:
    out, mode, work = Path(sys.argv[1]), sys.argv[2], sys.argv[3]
    (out / "SUMMARY.md").write_text(summarize(out, mode, work), encoding="utf-8")
    print(out / "SUMMARY.md")
    return 0


if __name__ == "__main__":
    sys.exit(main())
