# EV-P02-008: Turborepo tasks lint, typecheck, test, test:integration and build run with caching and dependsOn

| Field | Value |
|---|---|
| Evidence ID | EV-P02-008 |
| Item | P02.02.02 |
| Date (UTC) | 2026-09-28 11:41 UTC |
| Commit | `766f53e2804a53cf0930e0047669c1cd8abb66e8` (working tree had uncommitted changes) |
| Environment | local (Node 24.21.0, pnpm 10.34.5, turbo 2.11.5) |
| Command / procedure | turbo.json declares lint, typecheck, test, test:integration, build and dev. build/typecheck/lint/test each dependsOn ^build so a package is built before its dependents are checked; test:integration is cache:false and declares its env (DATABASE_URL, REDIS_URL, S3_ENDPOINT, SQS_ENDPOINT, OIDC_ISSUER_URL) because a cached integration result would be a lie about a stateful dependency. Runs: pnpm turbo run typecheck -> Tasks: 1 successful, 1 total (exit 0); pnpm turbo run test -> 33 tests passed, Tasks: 1 successful (exit 0); pnpm turbo run build -> Tasks: 1 successful (exit 0). Turbo initially warned that typecheck declared outputs it never writes (tsc --noEmit); outputs were emptied and the warning is gone. |
| Result | PASS — all five tasks defined and three of them exercised end to end. test:integration has no workspace producing it until P02.05, and build currently has one real target (@moin/config); both widen in P02.03 and P02.05. |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).
