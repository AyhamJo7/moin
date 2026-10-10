# EV-P07-008: notes-plus-facts-registry-6-tests

| Field | Value |
|---|---|
| Evidence ID | EV-P07-008 |
| Item | P07.09.01 |
| Date (UTC) | 2026-10-10 22:41 UTC |
| Commit | `1051d9c190332fe3e09b4477cdacac116ad92a3c` (working tree had uncommitted changes) |
| Environment | local |
| Command / procedure | `.claude/bin/gates.py full` 14/14 PASS (evidence `20261010T203950Z-full.json`); mutation-check KILLED on notes-facts integration suite |
| Result | PASS |
| CI run / artifact | PR #87 at `89f4533`: 16/16 checks SUCCESS (verified); this round-2 fix head CI pending at push time |
| Reviewer | codex BLOCK round 1 on `278e810` (3 findings, fixed in `89f4533`); BLOCK round 2 on `89f4533` (unenforceable keywords accepted but never checked — fixed in this round: ROOT_KEYS/PROP_KEYS allowlists, registered schemas exactly the enforceable subset; enum/minimum/pattern/format/const tests) |

Sensitive material is stored by reference only (PLAN.md evidence rules).
