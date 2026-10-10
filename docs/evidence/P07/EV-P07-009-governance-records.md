# EV-P07-009: governance-records-plus-8-tests

| Field | Value |
|---|---|
| Evidence ID | EV-P07-009 |
| Item | P07.10.01 |
| Date (UTC) | 2026-10-10 23:16 UTC, round-2 fix 2026-10-10 ~23:45 UTC |
| Commit | round-2 fix head (this push) |
| Environment | local |
| Command / procedure | `.claude/bin/gates.py full` 14/14 PASS (evidence `20261010T213558Z-full.json`); governance integration suite 9/9 green standalone; mutation-check KILLED on governance integration suite (round 1) |
| Result | PASS |
| CI run / artifact | PR #88 at `bdf33c4`: 16/16 checks SUCCESS (verified); round-1 fix head `0445ab0` CI state at push time (see push report); this round-2 fix head CI pending at push time |
| Reviewer | codex BLOCK round 1 on `bdf33c4` (4 findings + tests, all fixed in `0445ab0`); codex BLOCK round 2 on `0445ab0` (correlation chain unwired — fixed: children store ambient withTenant correlation via explicit-or-ambient `resolveCorrelation`, audit rows thread via explicit `correlationId` override defaulting to ambient with malformed-to-NULL guard, run-ownership documented on `WorkflowRun.correlationId` as `withTenant(..., { correlationId: run.correlationId })` threading since ALS frames are fixed at entry; inheritance + audit-carry + explicit-wins + malformed-RangeError tests added) |

Sensitive material is stored by reference only (PLAN.md evidence rules).
