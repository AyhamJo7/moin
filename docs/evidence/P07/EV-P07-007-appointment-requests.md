# EV-P07-007: requests-machine-plus-7-tests

| Field | Value |
|---|---|
| Evidence ID | EV-P07-007 |
| Item | P07.08.01 |
| Date (UTC) | 2026-10-10 19:07 UTC |
| Commit | `c3793761154d2352e9eacaf04fe6663019765d10` (working tree had uncommitted changes) |
| Environment | local |
| Command / procedure | `.claude/bin/gates.py full` 14/14 PASS (evidence `20261010T190606Z-full.json`); mutation-check KILLED on appointment-requests integration suite |
| Result | PASS |
| CI run / artifact | PR #86 at `565ec6c`: 16/16 checks SUCCESS (verified); this round-1 fix head CI pending at push time |
| Reviewer | codex BLOCK round 1 on `565ec6c` (1 HIGH + evidence, valid: window CHECK admitted empty/unbounded ranges, service validation bound no direct writers — fixed in this round: CHECK tightened to NOT isempty + bounded + ordered, empty/unbounded hand-INSERT 23514 tests) |

Sensitive material is stored by reference only (PLAN.md evidence rules).
