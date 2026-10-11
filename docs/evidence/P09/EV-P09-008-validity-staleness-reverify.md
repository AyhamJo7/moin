# EV-P09-008: Validity, staleness and re-verification: expiry enforced, overdue-sensitive suspension, flagged stale, idempotent sweep (ROUND-8 review fix)

| Field | Value |
|---|---|
| Evidence ID | EV-P09-008 |
| Item | P09.06.03 |
| Date (UTC) | 2026-10-11 21:25 UTC (ROUND-8 fix; ROUND-7 21:10 UTC; ROUND-6 21:00 UTC; ROUND-5 20:45 UTC; ROUND-4 20:35 UTC; ROUND-3 20:40 UTC; ROUND-2 20:15 UTC; ROUND-1 19:40 UTC; initial 17:29 UTC) |
| Commit | `ca4854a` (ROUND-8 fix incl. EV + ledger; prior pin `ab211e4` superseded) |
| Environment | local |
| Command / procedure | `gates.py full` 14/14 PASS (artifact `20261011T191708Z-full.json`): control-plane, control-plane-lint, conventions, docs-consistency, format, lint, boundaries, typecheck, unit, integration (32.2 s), migrations, build, licences, secret-scan. Test env vars exported from the example env file (no worktree secrets file; INV-15); pinned Node 24.21.0 / pnpm 10.34.5 on PATH. |
| Result | PASS |
| CI run / artifact | PR #101 (draft, this push): CI pending at push time |
| Reviewer | pending (re-review requested on PR #101 after ROUND-8 fix) |
| Mutation | `mutation_check.py` KILLED at this HEAD (staleness suite fails without fix, passes with it; fix restored byte-identical) |
| Design notes | ROUND-8 (codex BLOCK on ab211e4, 1 ARCH + evidence): locked re-read extracted to exported lockEligibleCards seam (SweepCandidate row type) — the sweep calls it immediately after the candidate select (same transaction, production shape unchanged); the regression test drives the two phases separately with an interleaved deactivate/refresh BETWEEN them and asserts the touched cards drop out while the twin survives. Removing any locked-query predicate (active / valid_until / overdue) fails the test — predicates proven load-bearing. Item path needs no seam: version-guarded UPDATE already re-checks at write time. Mutation re-run at this HEAD: KILLED (prior SURVIVED record was at 2b1bf7d, stale). This record cites the artifact recorded on the pushed HEAD (matches_tree true). Tests 16 green 3x (38/38 with knowledge + faq + approval). |

Sensitive material is stored by reference only (PLAN.md evidence rules).
