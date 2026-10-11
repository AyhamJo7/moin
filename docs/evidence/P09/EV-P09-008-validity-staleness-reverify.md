# EV-P09-008: Validity, staleness and re-verification: expiry enforced, overdue-sensitive suspension, flagged stale, idempotent sweep (ROUND-4 review fix)

| Field | Value |
|---|---|
| Evidence ID | EV-P09-008 |
| Item | P09.06.03 |
| Date (UTC) | 2026-10-11 20:35 UTC (ROUND-4 fix; ROUND-3 20:40 UTC note: this record rewritten after re-run; ROUND-2 20:15 UTC; ROUND-1 19:40 UTC; initial 17:29 UTC) |
| Commit | `216ee2e` (ROUND-4 fix incl. EV + ledger; prior pin `4c92a85` superseded) |
| Environment | local |
| Command / procedure | `gates.py full` 14/14 PASS (artifact `20261011T182850Z-full.json`): control-plane, control-plane-lint, conventions, docs-consistency, format, lint, boundaries, typecheck, unit, integration (28.0 s), migrations, build, licences, secret-scan. Test env vars exported from the example env file (no worktree secrets file; INV-15); pinned Node 24.21.0 / pnpm 10.34.5 on PATH. |
| Result | PASS |
| CI run / artifact | PR #101 (draft, this push): CI pending at push time |
| Reviewer | pending (re-review requested on PR #101 after ROUND-4 fix) |
| Mutation | `mutation_check.py` KILLED (staleness suite fails without fix, passes with it; fix restored byte-identical) |
| Design notes | ROUND-4 (codex BLOCK on 4c92a85, 1 P1 + evidence-cite): card sweep-vs-update race — sensitive-card deactivate is now anchor-guarded (id + updated_at epoch + active, 0 rows = update won → skip), mirroring the item version guard; both queue inserts are first-writer-wins (ON CONFLICT DO NOTHING + rowCount !== 1 check — node-pg reports null, never 0, documented) so a concurrent sweep skips task + audit instead of duplicating; convergence test extended to assert zero counts AND zero new faq audit rows on repeat. Evidence-cite fix: this record now cites the artifact recorded on the pushed HEAD (matches_tree true). Tests 12 green 3x (34/34 with knowledge + faq + approval). |

Sensitive material is stored by reference only (PLAN.md evidence rules).
