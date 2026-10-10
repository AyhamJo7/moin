# EV-P07-006: leads-machine-plus-8-tests

| Field | Value |
|---|---|
| Evidence ID | EV-P07-006 |
| Item | P07.07.01 |
| Date (UTC) | 2026-10-10 14:52 UTC |
| Commit | `c6bf04cae311c678be4dedd54350d75b6c1fd2df` (working tree had uncommitted changes) |
| Environment | local |
| Command / procedure | `.claude/bin/gates.py full` 14/14 PASS (evidence `20261010T145121Z-full.json`); mutation-check KILLED on leads integration suite |
| Result | PASS |
| CI run / artifact | PR #85 at `b07a934`: 16/16 checks SUCCESS (verified); this round-1 fix head CI pending at push time |
| Reviewer | codex BLOCK round 1 on `b07a934` (invariant + architecture + evidence, all valid: one-way ensure decayed after entry — fixed in this round with repair-on-read getLead healing dead links at same lead version + history/audit rows, exported for all readers; raw listLeads documented unchecked) |

Sensitive material is stored by reference only (PLAN.md evidence rules).
