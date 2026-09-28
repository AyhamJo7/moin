# EV-P02-019: TypeScript 6.0.3 validated against NestJS 12 and Next.js 16; ADR-0002 fallback not taken

| Field | Value |
|---|---|
| Evidence ID | EV-P02-019 |
| Item | P02.02.03 |
| Date (UTC) | 2026-09-28 12:29 UTC |
| Commit | `f3065928572a2c60d699f2fb26e1e60dec550be3` (working tree had uncommitted changes) |
| Environment | local (typescript 6.0.3, Node 24.21.0) |
| Command / procedure | ADR-0002 recorded VALIDATION REQUIRED for TypeScript 6 against the two frameworks, which arrive in P02.03. NestJS 12.1.1: pnpm --filter @moin/server exec tsc --noEmit -p tsconfig.json -> exit 0 over four role entrypoints, decorated controllers and modules and symbol-token dependency injection; the emitted output runs and all four roles boot in a container. Next.js 16.3.6: pnpm --filter @moin/web build -> exit 0, "Compiled successfully", its own TypeScript pass "Finished TypeScript in 980ms", app-router routes prerendered. |
| Result | PASS — both frameworks work on TypeScript 6.0.3, so the TypeScript 5.9.3 fallback in ADR-0002 is not taken. NestJS requires three overrides of the shared base (erasableSyntaxOnly off, experimentalDecorators and emitDecoratorMetadata on) because Nest resolves providers from emitter-produced decorator metadata; they are confined to apps/server/tsconfig.json and every strictness option is still inherited. |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).
