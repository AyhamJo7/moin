# ADR-0002 — Toolchain and runtime baseline

- **Status:** Accepted (P02.02.09, 2026-09-28)
- **Deciders:** founder
- **Supersedes:** —
- **Related:** ADR-0034, INV-17, INV-18, QG-01, QG-11

## Context

A solo founder with agent assistance needs the toolchain to answer questions that a larger team
would answer in review: which Node runs this, is this type actually safe, does this module belong
where it is. That only works if every version is pinned and every rule is machine-enforced (R-31).

## Decision

| Component         | Pin                                                                                                 | Why this version                                                                                                                                                                                               |
| ----------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node              | **24.21.0** (`.nvmrc`, `engines.node >=24.21.0 <25`)                                                | Current LTS line (`lts/krypton`). Native TypeScript type stripping lets repository scripts be strict TypeScript without a build step.                                                                          |
| Package manager   | **pnpm 10.34.5** (`packageManager`, `engines.pnpm`)                                                 | Corepack resolves it from the manifest, so every machine and CI runner uses the same one. Strict, non-hoisted `node_modules` makes an undeclared dependency fail immediately rather than in the runtime image. |
| Monorepo tasks    | **Turborepo 2.11.5**                                                                                | `lint`, `typecheck`, `test`, `test:integration`, `build` with `dependsOn` and content-addressed caching.                                                                                                       |
| Language          | **TypeScript 6.0.3**                                                                                | See _TypeScript 6, not 7_ below.                                                                                                                                                                               |
| Lint              | **ESLint 10.11.0** + **typescript-eslint 8.70.1**, `strict-type-checked` + `stylistic-type-checked` | Type-aware rules are the only ones that catch a floating promise or a misused promise, which are the shape most silent data-loss bugs take here (INV-06).                                                      |
| Format            | **Prettier 3.9.9**                                                                                  | `eslint-config-prettier` last, so formatting is never also a lint error.                                                                                                                                       |
| Module boundaries | **dependency-cruiser 18.4.0**                                                                       | Enforces PLAN.md _Domain Boundaries_, including through `require()`.                                                                                                                                           |
| Tests             | **Vitest 5.0.2** on **Vite 8.3.1**                                                                  | Projects for `unit` and `integration` (P02.05.01).                                                                                                                                                             |
| Modules           | **ESM throughout**, `NodeNext` resolution, `verbatimModuleSyntax`                                   | One module system; no dual-package hazard.                                                                                                                                                                     |
| IaC               | **Terraform 1.16.4** (`.terraform-version`), **tflint 0.64.0**, **Trivy 0.74.0**                    | Pinned binary rather than a floating install, so a plan is reproducible.                                                                                                                                       |
| Secrets scanning  | **gitleaks 8.30.1**                                                                                 | Full history, every PR (P02.06.02).                                                                                                                                                                            |

### TypeScript compiler options

`strict`, plus the four PLAN.md names explicitly — `noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes`, `noImplicitOverride` — and `noPropertyAccessFromIndexSignature`,
`noImplicitReturns`, `noFallthroughCasesInSwitch`, `useUnknownInCatchVariables`,
`erasableSyntaxOnly`.

`erasableSyntaxOnly` is load-bearing rather than stylistic: it bans enums, namespaces and
parameter properties, which is exactly the syntax Node's native type stripping cannot run. Without
it, a repository script would typecheck and then fail at runtime.

`allowImportingTsExtensions` with `rewriteRelativeImportExtensions` lets source import `./x.ts`
directly — what Node executes — while emit still rewrites to `./x.js`.

### TypeScript 6, not 7

TypeScript 7.0.2 (the native port) was available at the time of this decision and was **not**
chosen: `typescript-eslint@8.70.1` declares `typescript >=4.8.4 <6.1.0`, so adopting 7 would mean
giving up every type-aware lint rule — the rules that do the most work in this repository.

TypeScript 6.0.3 is the last release inside that range and is the intended bridge to 7. Revisit
when typescript-eslint supports 7; that revisit is a follow-up ADR, not a silent bump.

~~**VALIDATION REQUIRED:** TypeScript 6 has not yet been exercised against Next.js 15 or NestJS,
which arrive in P02.03.~~

**Validated in P02.03 (2026-09-28); both frameworks work and the fallback is not taken**
— EV-P02-019:

- **NestJS 12.1.1** — `tsc --noEmit` over the server exits 0 across four role entrypoints,
  decorated controllers and modules and symbol-token dependency injection; the compiled output
  runs, and all four roles boot in a container and serve their endpoints.
- **Next.js 16.3.6** — `next build` succeeds, including its own TypeScript pass, and prerenders
  the app-router routes.

NestJS needs three overrides of the shared base, and they stop at `apps/server/tsconfig.json`:
`erasableSyntaxOnly: false`, `experimentalDecorators: true`, `emitDecoratorMetadata: true`. Nest
resolves providers from decorator metadata that only the TypeScript emitter produces, so the
server is compiled rather than type-stripped. Every strictness option is still inherited.

### Lint bans

Each ban prevents a specific failure, not a style preference: `no-explicit-any` (silently disables
the type-aware rules), named exports only (a default export can be imported under any name — Next.js
route, page, layout and config files are excepted because the framework requires them),
`dangerouslySetInnerHTML` (stored-XSS carrier), string-built SQL (injection), session-level `SET`
(leaks the tenant context onto the next checkout of a pooled connection — INV-01, INV-02),
`console.*` in production code (bypasses the Pino redaction allowlist — INV-12), and floating
promises (a business mutation that may never happen and never reports that it did not — INV-06).

Two repository-specific rules are authored and tested here and switched on in P06.03, when the code
they guard exists: `moin/no-tenant-conditional` (INV-18) and `moin/no-direct-db-access`
(INV-01, INV-02).

## Consequences

- Every version above is a single line to change and a CI run to prove; Renovate proposes bumps
  weekly and immediately for security (P02.08.01).
- `pnpm install --frozen-lockfile` is the only sanctioned install in CI.
- The TypeScript 7 migration is deferred and tracked, not forgotten.
- A rule can be tightened without approval; loosening one needs the founder's.

## Alternatives considered

- **npm or yarn** — neither gives pnpm's strict non-hoisted layout, so an undeclared dependency
  keeps working locally and fails in the runtime image.
- **Nx instead of Turborepo** — more capable, and more configuration than a two-app repository
  earns.
- **Biome instead of ESLint + Prettier** — faster, but has no type-aware rules and no plugin API
  for the two repository-specific rules above, which are the ones tied to invariants.
- **TypeScript 7 now** — see above.
