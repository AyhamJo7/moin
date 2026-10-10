# EV-P07-004: conversations-calls-events-outcomes-plus-13-tests

| Field | Value |
|---|---|
| Evidence ID | EV-P07-004 |
| Item | P07.05.01 |
| Date (UTC) | 2026-10-10 12:13 UTC |
| Commit | `19106e308144f576c2d05362592bddf4f2124ef5` (working tree had uncommitted changes) |
| Environment | local |
| Command / procedure | `.claude/bin/gates.py full` 14/14 PASS (evidence `20261010T132439Z-full.json`); mutation-check KILLED on conversations integration suite |
| Result | PASS |
| CI run / artifact | PR #83: `8d52ab7` CI integration FAILED only on the pre-existing support-suite flake (proven 3/3 green on clean tree); this round-2 fix head CI pending at push time |
| Reviewer | codex BLOCK rounds 1–5 (fixed in `8d52ab7`/`4747b5f`/`473dde3`/`483b1ab`/`71db8c4`); BLOCK round 6 on `71db8c4` (1 HIGH: orphan guard killed message threads + verdicts via CASCADE — fixed in this round: four-way guard call-channel + call-less + message-less + outcome-less, digest re-pinned, allowlist reason updated; thread + decided-verdict keep tests) |

Sensitive material is stored by reference only (PLAN.md evidence rules).
