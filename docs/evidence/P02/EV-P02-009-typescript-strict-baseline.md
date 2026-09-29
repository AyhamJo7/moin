# EV-P02-009: TypeScript strict baseline with the four required options, ESM throughout

| Field | Value |
|---|---|
| Evidence ID | EV-P02-009 |
| Item | P02.02.03 |
| Date (UTC) | 2026-09-28 11:41 UTC |
| Commit | `766f53e2804a53cf0930e0047669c1cd8abb66e8` (working tree had uncommitted changes) |
| Environment | local (typescript 6.0.3) |
| Command / procedure | packages/config/tsconfig/base.json sets strict, noUncheckedIndexedAccess, exactOptionalPropertyTypes and noImplicitOverride (the four PLAN.md names) plus noImplicitReturns, noFallthroughCasesInSwitch, noPropertyAccessFromIndexSignature, useUnknownInCatchVariables, verbatimModuleSyntax and erasableSyntaxOnly; module and moduleResolution are NodeNext with moduleDetection force, so the repository is ESM throughout. erasableSyntaxOnly is required, not stylistic: it bans the syntax (enums, namespaces, parameter properties) that Node 24 native type stripping cannot execute, which is how scripts/*.ts run without a build step. allowImportingTsExtensions + rewriteRelativeImportExtensions let source import ./x.ts, which is what Node actually resolves. Verified: pnpm exec tsc --noEmit -p tsconfig.json (exit 0) and pnpm --filter @moin/config exec tsc --noEmit -p tsconfig.json (exit 0). The strictness is load-bearing rather than declared: it produced 23 real findings on first run across scripts/ and packages/config, every one of which was fixed in code (the policy file is now parsed through a hand-written type guard at the boundary instead of an any-cast) rather than by relaxing a rule. |
| Result | PASS — both typechecks exit 0 under the full option set. |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).
