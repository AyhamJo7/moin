# EV-P07-006: leads-machine-plus-10-tests

| Field | Value |
|---|---|
| Evidence ID | EV-P07-006 |
| Item | P07.07.01 |
| Date (UTC) | 2026-10-10 15:16 UTC |
| Commit | `c6bf04cae311c678be4dedd54350d75b6c1fd2df` (working tree had uncommitted changes) |
| Environment | local |
| Command / procedure | `.claude/bin/gates.py full` 14/14 PASS (evidence `20261010T151505Z-full.json`); mutation-check KILLED on leads integration suite |
| Result | PASS |
| CI run / artifact | PR #85 at `db8cc59`: 16/16 checks SUCCESS (verified via `gh pr view 85 --json statusCheckRollup`); this round-3 fix head CI pending at push time |
| Reviewer | codex BLOCK round 1 on `b07a934` (fixed in `52b1543`); BLOCK round 2 on `52b1543` (fixed in `db8cc59`); BLOCK round 3 on `db8cc59` (locked re-read heals without status re-check — fixed in this round: held.status must still be needs_action else return as-is, plus moved-on-lead no-heal test) |

Sensitive material is stored by reference only (PLAN.md evidence rules).
