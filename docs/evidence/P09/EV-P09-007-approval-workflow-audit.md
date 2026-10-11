# EV-P09-007: P09.05 approval workflow: role gate, hash binding, bulk per-item, 6 tests (ROUND-1 identity fix)

| Field | Value |
|---|---|
| Evidence ID | EV-P09-007 |
| Item | P09.05.03 |
| Date (UTC) | 2026-10-11 18:35 UTC (ROUND-1 fix; initial 2026-10-11 16:02 UTC) |
| Commit | `2a6b424` (ROUND-1 fix `66cc775` + ledger; prior pin `35d9d7a` superseded) |
| Environment | local |
| Command / procedure | `gates.py full` 14/14 PASS (artifact `20261011T163445Z-full.json`): control-plane, control-plane-lint, conventions, docs-consistency, format, lint, boundaries, typecheck, unit, integration (21.9 s), migrations, build, licences, secret-scan. Test env vars exported from the example env file (no worktree secrets file; INV-15); pinned Node 24.21.0 / pnpm 10.34.5 on PATH. |
| Result | PASS |
| CI run / artifact | PR #100 (draft, this push): CI pending at push time |
| Reviewer | pending (re-review requested on PR #100 after ROUND-1 fix) |
| Mutation | `mutation_check.py` KILLED (approval suite fails without fix, passes with it; fix restored byte-identical; fix-paths approval.ts + 0056 + knowledge.ts + tenant.ts) |
| Design notes | ROUND-1 (codex BLOCK on 35d9d7a, 6 findings): CRITICAL identity — approvedBy param REMOVED everywhere; actor resolved server-side via app.current_user() (actor id SET by withTenant, INV-02) in service AND 2-arg DEFINER (3-arg dropped); staff ctx calling fn directly dies insufficient_privilege (42501). HIGH hash — length-prefixed len:field encoding; comment corrected (title+body+no). HIGH bulk — per-item SAVEPOINT / ROLLBACK TO / RELEASE; mid-bulk DB-error recovery proven. MEDIUM SQLSTATE — fn raises insufficient_privilege; service maps by code. MEDIUM decided_at — NOT NULL DEFAULT now(). MEDIUM bulk targetId — NULL (counts-only). Tests 6 (3x green 16/16 with knowledge suite): stamp+hash (asserted vs node sha256), staff-403 + direct-fn-403, stale-409, bulk per-item, savepoint-recovery + NULL-targetId, audit-markers + cross-tenant. Catalog digest 11d6a8d3 + allowlist signature (uuid, uuid) updated. |

Sensitive material is stored by reference only (PLAN.md evidence rules).
