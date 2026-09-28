# EV-P02-001: Every lint and custom-rule ban is reported by a fixture that violates it

| Field | Value |
|---|---|
| Evidence ID | EV-P02-001 |
| Item | P02.02.10 |
| Date (UTC) | 2026-09-28 11:39 UTC |
| Commit | `766f53e2804a53cf0930e0047669c1cd8abb66e8` (working tree had uncommitted changes) |
| Environment | local (WSL2 Ubuntu, Node 24.21.0, pnpm 10.34.5) |
| Command / procedure | pnpm --filter @moin/config test (vitest 5.0.2) — 3 files, 33 tests: 22 RuleTester cases for moin/no-tenant-conditional and moin/no-direct-db-access, plus bans.test.ts linting 10 on-disk fixtures, one per ban (@typescript-eslint/no-explicit-any, no-restricted-syntax x4 = default export / dangerouslySetInnerHTML / SQL template / SQL concat / session-level SET, no-console, @typescript-eslint/no-floating-promises, moin/no-tenant-conditional, moin/no-direct-db-access). Mutation check: setting no-console to off made exactly `console-log.ts is reported by no-console` fail (1 failed \| 32 passed); restoring it returned 33 passed. Boundary rules: pnpm exec depcruise packages scripts --config .dependency-cruiser.cjs -> exit 0, no violations, 35 modules cruised. |
| Result | PASS (33/33 tests; mutation-proven non-vacuous). PARTIAL SCOPE: the dependency-cruiser boundary rules are validated as configuration only — their negative fixtures need apps/server/src/modules, which P02.03 creates; those fixtures are verified there. |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).
