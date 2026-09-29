# EV-P02-028: Vitest unit and integration projects

| Field | Value |
|---|---|
| Evidence ID | EV-P02-028 |
| Item | P02.05.01 |
| Date (UTC) | 2026-09-28 16:33 UTC |
| Commit | `6f79b0ec3c236853dc3021d5ad9a4eab7ae9612a` (working tree had uncommitted changes) |
| Environment | local (vitest 5.0.2, Node 24.21.0) |
| Command / procedure | vitest.config.ts declares two projects via test.projects (vitest.workspace.ts is removed in Vitest 5). `unit` includes {apps,packages,scripts}/**/*.test.ts and excludes *.integration.test.ts and e2e; `integration` includes only *.integration.test.ts, runs with fileParallelism, a 30 s test timeout, a 60 s hook timeout and the globalSetup that builds the template database. They are separate projects rather than a naming convention because their requirements genuinely differ: one project for both would either slow every unit test to integration settings or run integration tests under settings that make them flaky, and a flaky integration test gets quarantined and then deleted. pnpm test -> vitest run --project unit (no Docker needed); pnpm test:integration -> vitest run --project integration. |
| Result | PASS — unit: 13 files, 108 tests. integration: 1 file, 5 tests. Both selectable independently. |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).
