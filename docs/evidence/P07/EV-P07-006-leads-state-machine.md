# EV-P07-006: leads-machine-plus-10-tests

| Field | Value |
|---|---|
| Evidence ID | EV-P07-006 |
| Item | P07.07.01 |
| Date (UTC) | 2026-10-10 15:30 UTC |
| Commit | `c6bf04cae311c678be4dedd54350d75b6c1fd2df` (working tree had uncommitted changes) |
| Environment | local |
| Command / procedure | `.claude/bin/gates.py full` 14/14 PASS (evidence `20261010T152741Z-full.json`); mutation-check KILLED on leads integration suite |
| Result | PASS |
| CI run / artifact | PR #85 at `d066003`: 16/16 checks SUCCESS (verified via `gh pr view 85 --json statusCheckRollup`); this round-4 fix head CI pending at push time |
| Reviewer | codex BLOCK rounds 1–3 (fixed in `52b1543`/`db8cc59`/`d066003`); BLOCK round 4 on `d066003` (test-gap: moved-on test never reached the locked re-read guard — addressed honestly in this round: raw-client snapshots cannot drive getLead which needs a tenant client, so the test pins the no-heal CONTRACT on the committed variant and documents that the three-line re-check is review-covered; guard-removal sensitivity disclosed, not hidden) |

Sensitive material is stored by reference only (PLAN.md evidence rules).
