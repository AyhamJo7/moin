# EV-P07-003: resolution-deterministic-rules-plus-11-tests

| Field | Value |
|---|---|
| Evidence ID | EV-P07-003 |
| Item | P07.03.01 |
| Date (UTC) | 2026-10-10 12:00 UTC |
| Commit | `62d8a097cdc6b390e31aa742d0d2a58159d158c8` (working tree had uncommitted changes) |
| Environment | local |
| Command / procedure | `.claude/bin/gates.py full` 14/14 PASS (evidence `20261010T115946Z-full.json`); mutation-check KILLED on resolution integration suite |
| Result | PASS |
| CI run / artifact | PR #82 at `9c93958`: 16/16 checks SUCCESS (verified); this round-3 fix head CI pending at push time |
| Reviewer | codex BLOCK round 1 on `c9fd3ba` (3 HIGH, all fixed in `cd58f19`); BLOCK round 2 on `cd58f19` (race + audit, fixed in `9c93958`); BLOCK round 3 on `9c93958` (1 test-only: race test reimplemented candidate SQL instead of calling the resolver — fixed in this round: Promise.all over two withTenant resolveCaller calls against legacy-duplicate rows) |

Sensitive material is stored by reference only (PLAN.md evidence rules).
