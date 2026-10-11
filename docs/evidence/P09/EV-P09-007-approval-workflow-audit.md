# EV-P09-007: P09.05 approval workflow: role gate, hash binding, bulk per-item, 7 tests (ROUND-2 re-review fix)

| Field | Value |
|---|---|
| Evidence ID | EV-P09-007 |
| Item | P09.05.03 |
| Date (UTC) | 2026-10-11 19:05 UTC (ROUND-2 fix; ROUND-1 18:35 UTC; initial 16:02 UTC) |
| Commit | `TBD (this push)` — prior pin `fff0fc7` (superseded by ROUND-2) |
| Environment | local |
| Command / procedure | `gates.py full` 14/14 PASS (artifact `20261011T170043Z-full.json`): control-plane, control-plane-lint, conventions, docs-consistency, format, lint, boundaries, typecheck, unit, integration (30.1 s), migrations, build, licences, secret-scan. One transient support-suite timing failure on the first full run (lock-wait + redirect assertions, unrelated files, green standalone + green on re-run). Test env vars exported from the example env file (no worktree secrets file; INV-15); pinned Node 24.21.0 / pnpm 10.34.5 on PATH. |
| Result | PASS |
| CI run / artifact | PR #100 (draft, this push): CI pending at push time |
| Reviewer | pending (re-review requested on PR #100 after ROUND-2 fix) |
| Mutation | `mutation_check.py` KILLED (approval suite fails without fix, passes with it; fix restored byte-identical; fix-paths approval.ts + 0056 + knowledge.ts) |
| Design notes | ROUND-2 (codex BLOCK on fff0fc7, 3 findings): HIGH-1 decided_at fabrication — 3-step ADD nullable / backfill decided_at = approved_at / SET NOT NULL + DEFAULT now(). The plain UPDATE touches zero rows under FORCE RLS (migrator sees no tenant rows — the 0010 silent-no-op trap), so 0056 lifts FORCE for the backfill with a zero-unfilled guard, then restores (catalog check enforces FORCEd). New test approval-backfill proves it on a staged pre-0056 DB: historical row keeps decided_at = approved_at (2026-01-15, not migration instant) + NOT NULL/DEFAULT contract asserted. HIGH-2 actor GUC — reverted to the house pattern (accept_invitation p_actor_id, 0018): service binds actor from session context (currentTenant().actorId, INV-02) into the fn's p_actor arg; no current_user()/app.actor_id GUC anywhere (tenant.ts plumbing + index export removed). Residual documented in 0056 header + allowlist row: direct moin_app SQL is privileged-role surface, same as every DEFINER — the guarantee sits at the service boundary. MEDIUM SQLSTATE — role failures alone raise 42501 (403); missing/retired/stale raise 22023 (409); service maps by code. Tests 7 (3x green 17/17 with knowledge suite): stamp+hash (asserted vs node sha256) + decided/approved proximity, staff-403 + direct-fn-42501, stale-409, bulk per-item, savepoint-recovery + NULL-targetId, backfill, audit-markers + cross-tenant. Catalog digest 5f23a9b9 + signature back to (uuid, uuid, uuid). |

Sensitive material is stored by reference only (PLAN.md evidence rules).
