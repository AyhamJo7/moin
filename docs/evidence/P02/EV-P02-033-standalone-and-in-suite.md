# EV-P02-033: One example of every test type passes in-suite and standalone on a freshly seeded database

| Field | Value |
|---|---|
| Evidence ID | EV-P02-033 |
| Item | P02.05.06 |
| Date (UTC) | 2026-09-28 16:36 UTC |
| Commit | `6f79b0ec3c236853dc3021d5ad9a4eab7ae9612a` (working tree had uncommitted changes) |
| Environment | local (PostgreSQL 17 + pgvector, Node 24.21.0) |
| Command / procedure | The database was destroyed and rebuilt first — docker compose down --volumes, then up --wait, then db:migrate, which applied 0001 and 0002 to an empty database — so "standalone" means against a genuinely fresh, freshly migrated database rather than one left over from an earlier run. UNIT in-suite: vitest run --project unit -> 13 files, 108 tests passed. UNIT standalone: vitest run --project unit packages/kernel/src/clock.test.ts -> 1 file, 4 tests passed. INTEGRATION in-suite: vitest run --project integration -> 1 file, 5 tests passed. INTEGRATION standalone: vitest run --project integration packages/testing/src/pg/harness.integration.test.ts -> 1 file, 5 tests passed. E2E in-suite: playwright test --project chromium -> 4 passed. E2E standalone: playwright test apps/web/e2e/smoke.spec.ts --project=chromium -> 4 passed. |
| Result | PASS — every type passes both ways. The property that makes this hold rather than being luck is structural: each integration file clones its own database from the template, so no file can leave state another file depends on. That is what stops a suite from passing while each file fails alone. |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).
