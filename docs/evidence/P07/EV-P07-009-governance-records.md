# EV-P07-009: governance-records-plus-10-tests

| Field | Value |
|---|---|
| Evidence ID | EV-P07-009 |
| Item | P07.10.01 |
| Date (UTC) | 2026-10-10 23:16 UTC, round-2 fix 2026-10-10 ~23:45 UTC, round-3 fix 2026-10-10 ~23:50 UTC |
| Commit | `bd56bc454beed953e17baf6252247d2235a92ca8` |
| Environment | local |
| Command / procedure | `.claude/bin/gates.py full` 14/14 PASS (evidence `20261010T214849Z-full.json`, on this head); governance integration suite 10/10 green standalone; mutation-check KILLED on governance integration suite (round 1) |
| Result | PASS |
| CI run / artifact | PR #88 at `bdf33c4`: 16/16 checks SUCCESS (verified); round-1 fix `0445ab0` and round-2 fixes `2cb4921`/`c1a0e4f`/`3bc1fcc` superseded; this round-3 fix head CI pending at push time |
| Reviewer | codex BLOCK round 1 on `bdf33c4` (4 findings, fixed in `0445ab0`); codex BLOCK round 2 on `0445ab0` (correlation chain unwired — fixed round 2: children store ambient withTenant correlation, audit rows thread via explicit override, run-ownership threading documented); codex BLOCK round 3 on `3bc1fcc` (3 residuals, all fixed: run.start/run.finish audits now pass the stored row correlation instead of ambient; `resolveCorrelation` validates ambient too, malformed degrades to NULL like the audit writer so no 22P02 aborts the business txn; run-audit-carry + malformed-ambient-NULL tests added) |

Sensitive material is stored by reference only (PLAN.md evidence rules).
