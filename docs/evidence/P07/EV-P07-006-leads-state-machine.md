# EV-P07-006: leads-machine-plus-10-tests

| Field | Value |
|---|---|
| Evidence ID | EV-P07-006 |
| Item | P07.07.01 |
| Date (UTC) | 2026-10-10 15:30 UTC |
| Commit | `c6bf04cae311c678be4dedd54350d75b6c1fd2df` (working tree had uncommitted changes) |
| Environment | local |
| Command / procedure | `.claude/bin/gates.py full` 14/14 PASS (evidence `20261010T153917Z-full.json`); mutation-check KILLED on leads integration suite |
| Result | PASS |
| CI run / artifact | PR #85 at `d066003`: 16/16 checks SUCCESS (verified via `gh pr view 85 --json statusCheckRollup`); this round-4 fix head CI pending at push time |
| Reviewer | codex BLOCK rounds 1–4 (fixed in `52b1543`/`db8cc59`/`d066003`/`61290c2`); BLOCK round 5 on `61290c2` with seam directive (delegating FOR UPDATE gate — implemented in this round exactly as directed: pause-before-lock, concurrent contacted move, resume; guard-removal FAILS with a healed task id vs null, proving branch coverage; 10/10 green) |

Sensitive material is stored by reference only (PLAN.md evidence rules).
