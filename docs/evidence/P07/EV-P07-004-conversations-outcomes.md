# EV-P07-004: conversations-calls-events-outcomes-plus-11-tests

| Field | Value |
|---|---|
| Evidence ID | EV-P07-004 |
| Item | P07.05.01 |
| Date (UTC) | 2026-10-10 12:13 UTC |
| Commit | `19106e308144f576c2d05362592bddf4f2124ef5` (working tree had uncommitted changes) |
| Environment | local |
| Command / procedure | `.claude/bin/gates.py full` 14/14 PASS (evidence `20261010T124304Z-full.json`); mutation-check KILLED on conversations integration suite |
| Result | PASS |
| CI run / artifact | PR #83: `8d52ab7` CI integration FAILED only on the pre-existing support-suite flake (proven 3/3 green on clean tree); this round-2 fix head CI pending at push time |
| Reviewer | codex BLOCK round 1 on `128603c` (5 HIGH, fixed in `8d52ab7`); codex re-review BLOCK on `8d52ab7` (2 HIGH residuals, fixed in this round: terminal race retries once against the kept rung with Promise.all terminal-vs-forward test; contact legs reverted to composite RESTRICT with clear-first erasure test after the catalog rejected single-column FKs) |

Sensitive material is stored by reference only (PLAN.md evidence rules).
