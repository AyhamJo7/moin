# EV-P07-009: governance-records-plus-8-tests

| Field | Value |
|---|---|
| Evidence ID | EV-P07-009 |
| Item | P07.10.01 |
| Date (UTC) | 2026-10-10 23:16 UTC |
| Commit | `ca41611f1bcbcc1c6a63baa9e9738c10451b374b` (working tree had uncommitted changes) |
| Environment | local |
| Command / procedure | `.claude/bin/gates.py full` 14/14 PASS (evidence `20261010T211530Z-full.json`); mutation-check KILLED on governance integration suite |
| Result | PASS |
| CI run / artifact | PR #88 at `bdf33c4`: 16/16 checks SUCCESS (verified); this round-1 fix head CI pending at push time |
| Reviewer | codex BLOCK round 1 on `bdf33c4` (4 findings + tests, all fixed: invocation actor FK RESTRICT + leaf-first order documented + candidates-keep-listing with privileged-23503 test; generated run correlation returned; run.finish + approval.request audits + allowlist rows + event assertions; relationships comment corrected to real FKs; TTL multi-expired + cap + approvals coverage) |

Sensitive material is stored by reference only (PLAN.md evidence rules).
