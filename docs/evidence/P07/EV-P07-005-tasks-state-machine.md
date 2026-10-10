# EV-P07-005: tasks-full-shape-plus-9-tests

| Field | Value |
|---|---|
| Evidence ID | EV-P07-005 |
| Item | P07.06.01 |
| Date (UTC) | 2026-10-10 16:20 UTC |
| Commit | `5df675816573ec89ea426f7c0529e2b3dd2dbfcd` (working tree had uncommitted changes) |
| Environment | local |
| Command / procedure | `.claude/bin/gates.py full` 14/14 PASS (evidence `20261010T141636Z-full.json` at `b549167`, clean tree); mutation-check KILLED on tasks integration suite |
| Result | PASS |
| CI run / artifact | PR #84 at `eb67ee3`: 16/16 checks SUCCESS (verified); this round-1 fix head CI pending at push time |
| Reviewer | codex BLOCK round 1 on `eb67ee3` (4 findings + evidence, all fixed: composite SET NULL column-list so conversation delete clears the link; completeTask entry version check + strict-chain walk; TRANSITIONS tightened to PLAN chain + doc/test updates; task.snooze audit + allowlist row + test) |

Sensitive material is stored by reference only (PLAN.md evidence rules).
