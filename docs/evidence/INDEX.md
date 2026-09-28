# Evidence registry

Every `EV-Pxx-nnn` record produced for PLAN.md lives in `docs/evidence/<phase>/` and is
registered here. Records are created with:

```bash
python3 .claude/bin/evidence.py new --phase P02 --item P02.05.06 --slug standalone-tests \
    --summary "…" --from-gates full
```

and audited with `python3 .claude/bin/evidence.py check`.

**Sensitive evidence is never committed.** Pentest reports, legal opinions, signed contracts and
anything containing personal data are stored outside the repository; the record holds only the
storage location, a SHA-256 hash, the date and the counterparty (PLAN.md, *Evidence rules*).
Screenshots containing personal data are forbidden — use the demo tenant.

## ID allocation

`evidence.py` allocates IDs sequentially per phase (`max + 1`), in the order records are
genuinely earned. PLAN.md's per-phase *Required evidence* line names the artefacts it expects
but cannot bind them to a number before the work happens, so the mapping from a PLAN label to
the allocated ID is recorded in the phase's `Required-evidence mapping` section below rather
than assumed.

### P02 — required-evidence mapping (PLAN.md L2172)

PLAN.md L2172 names four artefacts with parenthetical IDs (`EV-P02-001` … `EV-P02-004`). Those
were assigned at planning time, before the order in which the work could be earned was known.
`evidence.py` allocates sequentially as records are written, and the ruleset export depends on
EXT-24, so holding slot 004 open would have blocked every record after it. The registry is
authoritative for the actual IDs; this table is the mapping.

| PLAN label | Allocated ID | State |
|---|---|---|
| CI run URLs | — | not yet earned (P02.06) |
| Negative-control PR links | — | not yet earned (P02.06.07) |
| Timed setup log | — | not yet earned (P02.04.06) |
| Ruleset export | — | not yet earned — EXT-24, founder |

## Records

| ID | Item | Date | Commit | Summary | Record |
|---|---|---|---|---|---|
| EV-P02-001 | P02.02.10 | 2026-09-28 | `766f53e2804a` | Every lint and custom-rule ban is reported by a fixture that violates it | [EV-P02-001-lint-ban-fixtures.md](P02/EV-P02-001-lint-ban-fixtures.md) |
| EV-P02-002 | P02.02.09 | 2026-09-28 | `766f53e2804a` | ADR-0002 (toolchain and runtime baseline) and ADR-0034 (naming and brand decoupling) accepted | [EV-P02-002-adr-0002-0034-accepted.md](P02/EV-P02-002-adr-0002-0034-accepted.md) |
| EV-P02-003 | P02.01.02 | 2026-09-28 | `766f53e2804a` | CODEOWNERS, PR template and issue templates in place | [EV-P02-003-review-surfaces.md](P02/EV-P02-003-review-surfaces.md) |
| EV-P02-004 | P02.01.03 | 2026-09-28 | `766f53e2804a` | Conventional Commit titles and the no-attribution policy are enforced by self-testing checks | [EV-P02-004-commit-and-pr-conventions.md](P02/EV-P02-004-commit-and-pr-conventions.md) |
| EV-P02-005 | P02.01.04 | 2026-09-28 | `766f53e2804a` | PROGRESS.md ledger, evidence registry and record template initialised | [EV-P02-005-ledger-and-evidence-registry.md](P02/EV-P02-005-ledger-and-evidence-registry.md) |
| EV-P02-006 | P02.01.05 | 2026-09-28 | `766f53e2804a` | README and CONTRIBUTING written | [EV-P02-006-readme-and-contributing.md](P02/EV-P02-006-readme-and-contributing.md) |
| EV-P02-007 | P02.01.06 | 2026-09-28 | `766f53e2804a` | Annotated and signed release-tag policy documented | [EV-P02-007-release-tag-policy.md](P02/EV-P02-007-release-tag-policy.md) |
| EV-P02-008 | P02.02.02 | 2026-09-28 | `766f53e2804a` | Turborepo tasks lint, typecheck, test, test:integration and build run with caching and dependsOn | [EV-P02-008-turborepo-tasks.md](P02/EV-P02-008-turborepo-tasks.md) |
| EV-P02-009 | P02.02.03 | 2026-09-28 | `766f53e2804a` | TypeScript strict baseline with the four required options, ESM throughout | [EV-P02-009-typescript-strict-baseline.md](P02/EV-P02-009-typescript-strict-baseline.md) |
| EV-P02-010 | P02.02.06 | 2026-09-28 | `766f53e2804a` | Prettier and .editorconfig applied repository-wide | [EV-P02-010-formatting-baseline.md](P02/EV-P02-010-formatting-baseline.md) |
| EV-P02-011 | P02.02.07 | 2026-09-28 | `766f53e2804a` | dependency-cruiser rules encode PLAN.md Domain Boundaries | [EV-P02-011-module-boundary-rules.md](P02/EV-P02-011-module-boundary-rules.md) |
| EV-P02-012 | P02.03.01 | 2026-09-28 | `f3065928572a` | Repository structure created; workspace graph resolves and boundary rules run clean | [EV-P02-012-monorepo-structure.md](P02/EV-P02-012-monorepo-structure.md) |
| EV-P02-013 | P02.03.02 | 2026-09-28 | `f3065928572a` | Four role entrypoints with per-role root modules, from one image (INV-17) | [EV-P02-013-role-entrypoints.md](P02/EV-P02-013-role-entrypoints.md) |
| EV-P02-014 | P02.03.03 | 2026-09-28 | `f3065928572a` | Zod configuration loader fails fast and never echoes a secret (INV-15) | [EV-P02-014-config-loader.md](P02/EV-P02-014-config-loader.md) |
| EV-P02-015 | P02.03.04 | 2026-09-28 | `f3065928572a` | Pino logger with an allowlist redactor and correlation IDs (INV-12) | [EV-P02-015-logger-redaction-allowlist.md](P02/EV-P02-015-logger-redaction-allowlist.md) |
| EV-P02-016 | P02.03.05 | 2026-09-28 | `f3065928572a` | /healthz and /readyz per role, with a leak-proof readiness probe | [EV-P02-016-health-endpoints.md](P02/EV-P02-016-health-endpoints.md) |
| EV-P02-017 | P02.03.06 | 2026-09-28 | `f3065928572a` | Multi-stage ARM64 image: non-root, read-only-FS compatible, no package manager at runtime | [EV-P02-017-server-image.md](P02/EV-P02-017-server-image.md) |
| EV-P02-018 | P02.03.07 | 2026-09-28 | `f3065928572a` | Images build, containers start, health endpoints return 200, image size recorded | [EV-P02-018-images-build-and-serve.md](P02/EV-P02-018-images-build-and-serve.md) |
| EV-P02-019 | P02.02.03 | 2026-09-28 | `f3065928572a` | TypeScript 6.0.3 validated against NestJS 12 and Next.js 16; ADR-0002 fallback not taken | [EV-P02-019-typescript-6-framework-validation.md](P02/EV-P02-019-typescript-6-framework-validation.md) |
| EV-P02-020 | P02.02.07 | 2026-09-28 | `f3065928572a` | Module-boundary rules proven by trees that violate them | [EV-P02-020-boundary-rule-fixtures.md](P02/EV-P02-020-boundary-rule-fixtures.md) |
| EV-P02-021 | P02.03 | 2026-09-28 | `2808106e7157` | QG-09 review of P02.03: 1 Critical, 11 High, 18 Medium/Low findings; all Critical and High fixed | [EV-P02-021-qg09-review-remediation.md](P02/EV-P02-021-qg09-review-remediation.md) |
| EV-P02-022 | P02.04.06 | 2026-09-28 | `adbe336fea37` | Fresh clone to a running stack with migrations applied, timed | [EV-P02-022-fresh-clone-timed.md](P02/EV-P02-022-fresh-clone-timed.md) |
| EV-P02-023 | P02.04.05 | 2026-09-28 | `adbe336fea37` | pnpm doctor checks Node, pnpm, Docker, dependencies, env completeness and ports | [EV-P02-023-doctor.md](P02/EV-P02-023-doctor.md) |
| EV-P02-024 | P02.04.01 | 2026-09-28 | `adbe336fea37` | Six-service local stack, every image pinned by digest, all healthy | [EV-P02-024-local-stack.md](P02/EV-P02-024-local-stack.md) |
| EV-P02-025 | P02.04.02 | 2026-09-28 | `adbe336fea37` | dev:up, dev:down, dev:reset, db:migrate and db:seed work end to end | [EV-P02-025-dev-commands.md](P02/EV-P02-025-dev-commands.md) |
| EV-P02-026 | P02.04.03 | 2026-09-28 | `adbe336fea37` | Example environment file with fake values only; every .env ignored | [EV-P02-026-env-example.md](P02/EV-P02-026-env-example.md) |
| EV-P02-027 | P02.04.04 | 2026-09-28 | `adbe336fea37` | Twilio development path documented as developer-only | [EV-P02-027-twilio-local-path.md](P02/EV-P02-027-twilio-local-path.md) |
| EV-P02-028 | P02.05.01 | 2026-09-28 | `6f79b0ec3c23` | Vitest unit and integration projects | [EV-P02-028-vitest-projects.md](P02/EV-P02-028-vitest-projects.md) |
| EV-P02-029 | P02.05.02 | 2026-09-28 | `6f79b0ec3c23` | Real-Postgres harness: a database cloned from a migrated template per test file | [EV-P02-029-postgres-template-harness.md](P02/EV-P02-029-postgres-template-harness.md) |
| EV-P02-030 | P02.05.03 | 2026-09-28 | `6f79b0ec3c23` | German-realistic synthetic factories, seeded and reserved-range only (INV-16) | [EV-P02-030-german-factories.md](P02/EV-P02-030-german-factories.md) |
| EV-P02-031 | P02.05.05 | 2026-09-28 | `6f79b0ec3c23` | Fault-injection helpers and a controllable clock | [EV-P02-031-fault-injection-and-clock.md](P02/EV-P02-031-fault-injection-and-clock.md) |
| EV-P02-032 | P02.05.04 | 2026-09-28 | `6f79b0ec3c23` | Playwright projects for Chromium, Firefox, WebKit and phone viewports, with axe | [EV-P02-032-playwright-and-axe.md](P02/EV-P02-032-playwright-and-axe.md) |
| EV-P02-033 | P02.05.06 | 2026-09-28 | `6f79b0ec3c23` | One example of every test type passes in-suite and standalone on a freshly seeded database | [EV-P02-033-standalone-and-in-suite.md](P02/EV-P02-033-standalone-and-in-suite.md) |
| EV-P02-034 | P02.06.04 | 2026-09-28 | `4e723368a815` | Migration safety check with proven negative controls (QG-08, INV-17) | [EV-P02-034-migration-safety-check.md](P02/EV-P02-034-migration-safety-check.md) |
| EV-P02-035 | P02.08.02 | 2026-09-28 | `4e723368a815` | Licence allowlist for production dependencies, with a real finding resolved | [EV-P02-035-licence-allowlist.md](P02/EV-P02-035-licence-allowlist.md) |
| EV-P02-036 | P02.08.04 | 2026-09-28 | `4e723368a815` | The licence check is proven to reject what it claims to reject | [EV-P02-036-licence-negative-controls.md](P02/EV-P02-036-licence-negative-controls.md) |
| EV-P02-037 | P02.08.01 | 2026-09-28 | `4e723368a815` | Renovate: weekly grouped updates, immediate security updates, lockfile maintenance | [EV-P02-037-renovate.md](P02/EV-P02-037-renovate.md) |
| EV-P02-038 | P02.08.03 | 2026-09-28 | `4e723368a815` | pnpm onlyBuiltDependencies allowlist; no unreviewed install scripts | [EV-P02-038-install-script-allowlist.md](P02/EV-P02-038-install-script-allowlist.md) |
| EV-P02-039 | P02.06.06 | 2026-09-28 | `4e723368a815` | Every action and container image pinned by SHA; minimal permissions; concurrency; caching | [EV-P02-039-ci-hardening.md](P02/EV-P02-039-ci-hardening.md) |
| EV-P02-040 | P02.06.05 | 2026-09-28 | `4e723368a815` | Reserved CI jobs for the RLS catalog check and OpenAPI drift | [EV-P02-040-reserved-ci-slots.md](P02/EV-P02-040-reserved-ci-slots.md) |
| EV-P02-041 | P02.07.01 | 2026-09-28 | `1867d75a2e18` | local-setup, testing and conventions guides | [EV-P02-041-developer-docs.md](P02/EV-P02-041-developer-docs.md) |
| EV-P02-042 | P02.07.02 | 2026-09-28 | `1867d75a2e18` | ARCHITECTURE.md linking the ADRs, and SECURITY.md | [EV-P02-042-architecture-and-security-skeletons.md](P02/EV-P02-042-architecture-and-security-skeletons.md) |
