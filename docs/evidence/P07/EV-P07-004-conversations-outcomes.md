# EV-P07-004: conversations-calls-events-outcomes-plus-13-tests

| Field | Value |
|---|---|
| Evidence ID | EV-P07-004 |
| Item | P07.05.01 |
| Date (UTC) | 2026-10-10 12:13 UTC |
| Commit | `19106e308144f576c2d05362592bddf4f2124ef5` (working tree had uncommitted changes) |
| Environment | local |
| Command / procedure | `.claude/bin/gates.py full` 14/14 PASS (evidence `20261010T131554Z-full.json`); mutation-check KILLED on conversations integration suite |
| Result | PASS |
| CI run / artifact | PR #83: `8d52ab7` CI integration FAILED only on the pre-existing support-suite flake (proven 3/3 green on clean tree); this round-2 fix head CI pending at push time |
| Reviewer | codex BLOCK rounds 1–4 (fixed in `8d52ab7`/`4747b5f`/`473dde3`/`483b1ab`); BLOCK round 5 on `483b1ab` (1 residual: lock-bypass fallback left the orphan without cleanup — fixed in this round: 0040 `app.delete_orphan_conversation` DEFINER with NOT EXISTS guard + tenant scope, digest-pinned + allowlisted + approval entry; fallback calls it; orphan/live guard test) |

Sensitive material is stored by reference only (PLAN.md evidence rules).
