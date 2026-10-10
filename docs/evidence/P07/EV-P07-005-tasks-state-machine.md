# EV-P07-005: tasks-full-shape-plus-10-tests

| Field | Value |
|---|---|
| Evidence ID | EV-P07-005 |
| Item | P07.06.01 |
| Date (UTC) | 2026-10-10 16:20 UTC |
| Commit | `5df675816573ec89ea426f7c0529e2b3dd2dbfcd` (working tree had uncommitted changes) |
| Environment | local |
| Command / procedure | `.claude/bin/gates.py full` 14/14 PASS (evidence `20261010T142714Z-full.json` at `5f10f82`, clean tree); mutation-check KILLED on tasks integration suite |
| Result | PASS |
| CI run / artifact | PR #84 at `eb67ee3`: 16/16 checks SUCCESS (verified); this round-1 fix head CI pending at push time |
| Reviewer | codex BLOCK round 1 on `eb67ee3` (4 findings + evidence, fixed in `b549167`/`41f7402`); BLOCK round 2 on `41f7402` (1 missing test, valid — the column-list SET NULL claim was untested: fixed in this round with delete-conversation-nulls-task-link via privileged delete, asserting row survives + link NULL + org kept) |

Sensitive material is stored by reference only (PLAN.md evidence rules).
