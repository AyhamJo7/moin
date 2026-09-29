# EV-P02-011: dependency-cruiser rules encode PLAN.md Domain Boundaries

| Field | Value |
|---|---|
| Evidence ID | EV-P02-011 |
| Item | P02.02.07 |
| Date (UTC) | 2026-09-28 11:41 UTC |
| Commit | `766f53e2804a53cf0930e0047669c1cd8abb66e8` (working tree had uncommitted changes) |
| Environment | local (dependency-cruiser 18.4.0) |
| Command / procedure | Eight rules in .dependency-cruiser.cjs: no-circular; no-orphans (warn); no-cross-module-internals (a module may not import another module domain/ or infrastructure/); only-platform-opens-transactions (INV-01, INV-02); provider-sdks-stay-in-adapters (twilio, stripe, googleapis, @microsoft/microsoft-graph-client, @aws-sdk/*, openai only inside packages/integrations, telephony, ai, testing); no-app-imports-from-packages; web-does-not-import-server-internals; not-to-dev-dep; no-deprecated-core. moduleSystems includes cjs so a require() cannot step around a rule that only inspects ESM imports. Run: pnpm exec depcruise packages scripts --config .dependency-cruiser.cjs -> "no dependency violations found (35 modules, 36 dependencies cruised)", exit 0. Two exemptions were added after the first run reported real false positives: __fixtures__ for no-orphans, and packages/config plus *.config.ts for not-to-dev-dep, because @moin/config is build-time tooling that is never installed into a runtime image. |
| Result | PASS as configuration — exit 0, no violations. NOT YET PROVEN BY NEGATIVE FIXTURES: the five module-boundary rules address apps/server/src/modules/**, which does not exist until P02.03. Their violating fixtures are created and verified in P02.03, so this item is configuration-verified only and P02.03 carries the behavioural proof. |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).
