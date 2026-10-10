# EV-P07-006: leads-machine-plus-9-tests

| Field | Value |
|---|---|
| Evidence ID | EV-P07-006 |
| Item | P07.07.01 |
| Date (UTC) | 2026-10-10 15:05 UTC |
| Commit | `c6bf04cae311c678be4dedd54350d75b6c1fd2df` (working tree had uncommitted changes) |
| Environment | local |
| Command / procedure | `.claude/bin/gates.py full` 14/14 PASS (evidence `20261010T150403Z-full.json`); mutation-check KILLED on leads integration suite |
| Result | PASS |
| CI run / artifact | PR #85 at `52b1543`: 16/16 checks SUCCESS (verified via `gh pr view 85 --json statusCheckRollup`); this round-2 fix head CI pending at push time |
| Reviewer | codex BLOCK round 1 on `b07a934` (fixed in `52b1543`); BLOCK round 2 on `52b1543` (concurrent-heal race, valid: randomUUID suffix + no lock duplicated tasks — fixed in this round: FOR UPDATE row lock + double-checked re-read, deterministic dead-link key, Promise.all same-taskId/single-task test) |

Sensitive material is stored by reference only (PLAN.md evidence rules).
