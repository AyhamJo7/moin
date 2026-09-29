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
| EV-P02-043 | P02.06.01 | 2026-09-28 | `1867d75a2e18` | The verify workflow is green: eight jobs including integration tests on real PostgreSQL | [EV-P02-043-verify-workflow-green.md](P02/EV-P02-043-verify-workflow-green.md) |
| EV-P02-044 | P02.06.02 | 2026-09-28 | `1867d75a2e18` | The security-scan workflow is green: audit, licences, secrets, static analysis, Trivy, SBOM | [EV-P02-044-security-scan-green.md](P02/EV-P02-044-security-scan-green.md) |
| EV-P02-045 | P02.06.03 | 2026-09-28 | `aa643ef093e3` | The container-scan workflow is green: hadolint, arm64 build, image assertions, Trivy | [EV-P02-045-container-scan-green.md](P02/EV-P02-045-container-scan-green.md) |
| EV-P02-046 | P02.07.03 | 2026-09-28 | `c8564915fc12` | A fresh session followed the docs from a clean clone; it found nine real defects, all fixed | [EV-P02-046-fresh-session-doc-walkthrough.md](P02/EV-P02-046-fresh-session-doc-walkthrough.md) |
| EV-P03-001 | P03.01.01 | 2026-09-28 | `90b3b4158bd1` | ADR template and index, with the enforcement requirement built in | [EV-P03-001-adr-process.md](P03/EV-P03-001-adr-process.md) |
| EV-P03-002 | P03.01.02 | 2026-09-28 | `90b3b4158bd1` | Ten core ADRs accepted | [EV-P03-002-core-adrs-accepted.md](P03/EV-P03-002-core-adrs-accepted.md) |
| EV-P03-003 | P03.01.03 | 2026-09-28 | `90b3b4158bd1` | Three ADRs drafted and left PROPOSED | [EV-P03-003-adrs-drafted.md](P03/EV-P03-003-adrs-drafted.md) |
| EV-P03-004 | P03.01.04 | 2026-09-28 | `90b3b4158bd1` | Every ADR names the automated check that enforces it | [EV-P03-004-adr-enforcement-named.md](P03/EV-P03-004-adr-enforcement-named.md) |
| EV-P03-005 | P03.01.05 | 2026-09-28 | `90b3b4158bd1` | Every invariant is covered by an ADR, or the register says which phase writes one | [EV-P03-005-invariant-adr-coverage.md](P03/EV-P03-005-invariant-adr-coverage.md) |
| EV-P03-006 | P03.02.01 | 2026-09-28 | `906b56850bb3` | German/English glossary mapping UI terms to code terms | [EV-P03-006-glossary.md](P03/EV-P03-006-glossary.md) |
| EV-P03-007 | P03.02.02 | 2026-09-28 | `906b56850bb3` | Entity and relationship model per module, extending the blueprint | [EV-P03-007-entity-model.md](P03/EV-P03-007-entity-model.md) |
| EV-P03-008 | P03.02.03 | 2026-09-28 | `906b56850bb3` | Aggregate boundaries with the rule each holds at every commit | [EV-P03-008-aggregate-boundaries.md](P03/EV-P03-008-aggregate-boundaries.md) |
| EV-P03-009 | P03.02.04 | 2026-09-28 | `906b56850bb3` | Canonical intents, outcome codes and task types as closed vocabularies (T-01) | [EV-P03-009-intents-outcomes-tasks.md](P03/EV-P03-009-intents-outcomes-tasks.md) |
| EV-P03-010 | P03.02.05 | 2026-09-28 | `906b56850bb3` | Domain event catalogue v1: names, id-only payloads, producers and consumers | [EV-P03-010-event-catalogue.md](P03/EV-P03-010-event-catalogue.md) |
| EV-P03-011 | P03.02.06 | 2026-09-28 | `906b56850bb3` | Every blueprint entity maps to the model; no unmapped entity | [EV-P03-011-domain-coverage-verified.md](P03/EV-P03-011-domain-coverage-verified.md) |
| EV-P03-012 | P03.03.01 | 2026-09-28 | `906b56850bb3` | Ten state machines as transition tables with a property-test plan | [EV-P03-012-state-machines.md](P03/EV-P03-012-state-machines.md) |
| EV-P03-013 | P03.06.01 | 2026-09-28 | `66270cbaae43` | Field-level personal-data inventory with roles, retention, method and subprocessor | [EV-P03-013-data-inventory.md](P03/EV-P03-013-data-inventory.md) |
| EV-P03-014 | P03.06.02 | 2026-09-28 | `66270cbaae43` | Retention matrix aligned with the blueprint and PLAN privacy engineering | [EV-P03-014-retention-matrix.md](P03/EV-P03-014-retention-matrix.md) |
| EV-P03-015 | P03.06.03 | 2026-09-28 | `66270cbaae43` | Data-dictionary check: no column holding personal data is unclassified | [EV-P03-015-data-dictionary-generator.md](P03/EV-P03-015-data-dictionary-generator.md) |
| EV-P03-016 | P03.06.04 | 2026-09-28 | `66270cbaae43` | No unclassified column in the MVP tables | [EV-P03-016-classification-verified.md](P03/EV-P03-016-classification-verified.md) |
| EV-P03-017 | P03.04.01 | 2026-09-28 | `b9f29969dc70` | C4 context and container diagrams | [EV-P03-017-c4-diagrams.md](P03/EV-P03-017-c4-diagrams.md) |
| EV-P03-018 | P03.04.02 | 2026-09-28 | `b9f29969dc70` | Data-flow diagram with five trust boundaries and twelve classified flows | [EV-P03-018-data-flow-diagram.md](P03/EV-P03-018-data-flow-diagram.md) |
| EV-P03-019 | P03.04.03 | 2026-09-28 | `b9f29969dc70` | Every personal-data flow maps to an inventory category and a subprocessor entry | [EV-P03-019-dfd-coverage-verified.md](P03/EV-P03-019-dfd-coverage-verified.md) |
| EV-P03-020 | P03.07.01 | 2026-09-28 | `07ab552346a0` | Lawyer briefing pack: product description, data flows, questions and draft caller wording | [EV-P03-020-lawyer-briefing-pack.md](P03/EV-P03-020-lawyer-briefing-pack.md) |
| EV-P03-021 | P03.07.02 | 2026-09-28 | `07ab552346a0` | Question list with required decisions and deadlines, staged A and B | [EV-P03-021-legal-question-list.md](P03/EV-P03-021-legal-question-list.md) |
| EV-P03-022 | P03.08.01 | 2026-09-28 | `2f6106c4727c` | Every invariant mapped to its enforcement, phase and owner | [EV-P03-022-invariant-enforcement-register.md](P03/EV-P03-022-invariant-enforcement-register.md) |
| EV-P03-023 | P03.08.02 | 2026-09-28 | `2f6106c4727c` | Every invariant has an automated enforcement, or a documented manual control | [EV-P03-023-invariant-enforcement-verified.md](P03/EV-P03-023-invariant-enforcement-verified.md) |
| EV-P03-024 | P03.05.03 | 2026-09-28 | `be50961f50af` | Independent security review of the threat model: 2 Critical, 7 High, all resolved | [EV-P03-024-threat-model-independent-review.md](P03/EV-P03-024-threat-model-independent-review.md) |
| EV-P03-025 | P03.05.01 | 2026-09-28 | `be50961f50af` | STRIDE per component and flow, with every mitigation bound to a checklist item | [EV-P03-025-stride-threat-model.md](P03/EV-P03-025-stride-threat-model.md) |
| EV-P03-026 | P03.05.02 | 2026-09-28 | `be50961f50af` | Abuse cases: what will actually be tried, including the tenant as attacker | [EV-P03-026-abuse-cases.md](P03/EV-P03-026-abuse-cases.md) |
| EV-P04-001 | P04.04.01 | 2026-09-29 | `252be53a87ba` | ConversationRelay TwiML builder; the AI disclosure is non-interruptible by construction (INV-03) | [EV-P04-001-twiml-connect-relay-builder.md](P04/EV-P04-001-twiml-connect-relay-builder.md) |
| EV-P04-002 | P04.04.02 | 2026-09-29 | `252be53a87ba` | Zod codecs both directions; an unknown message type is logged and ignored rather than ending a call (INV-19) | [EV-P04-002-conversationrelay-codecs.md](P04/EV-P04-002-conversationrelay-codecs.md) |
| EV-P04-003 | P04.04.03 | 2026-09-29 | `252be53a87ba` | Signature validation matches Twilio's published vector; the media socket is bound by a single-use 60s hashed token | [EV-P04-003-twilio-signature-and-session-token.md](P04/EV-P04-003-twilio-signature-and-session-token.md) |
| EV-P04-004 | P04.04.04 | 2026-09-29 | `252be53a87ba` | The voice role answers a signed webhook with TwiML and serves the media socket; an unauthenticated socket is closed | [EV-P04-004-voice-role-and-relay-transport.md](P04/EV-P04-004-voice-role-and-relay-transport.md) |
| EV-P04-005 | P04.04.05 | 2026-09-29 | `252be53a87ba` | Codec round-trips, signature fixtures and the TwiML snapshot asserting the disclosure attributes | [EV-P04-005-telephony-fixture-suite.md](P04/EV-P04-005-telephony-fixture-suite.md) |
| EV-P04-006 | P04.06.01 | 2026-09-29 | `252be53a87ba` | The five DG-01 criteria and their thresholds recorded before any measurement exists; decision NOT TAKEN | [EV-P04-006-dg-01-criteria-recorded.md](P04/EV-P04-006-dg-01-criteria-recorded.md) |
| EV-P04-007 | P04.07.04 | 2026-09-29 | `252be53a87ba` | ADR-0034 enforced by a check rather than by review; it reads the brand name from the configuration it protects | [EV-P04-007-brand-string-check.md](P04/EV-P04-007-brand-string-check.md) |
| EV-P04-008 | P04.10.04 | 2026-09-29 | `252be53a87ba` | Every one of the 12 DFD flows resolves to a subprocessor row with a region, or to the explicit internal list. NO DPA IS SIGNED: every status is NOT_REQUESTED | [EV-P04-008-subprocessor-dfd-coverage.md](P04/EV-P04-008-subprocessor-dfd-coverage.md) |
| EV-P02-047 | P02.01.01 | 2026-09-29 | `1f22cd4bd309` | The main-protection ruleset is active: PR required, three required checks, linear history, force-push and deletion blocked, no bypass actors | [EV-P02-047-ext-24-main-protection-ruleset.md](P02/EV-P02-047-ext-24-main-protection-ruleset.md) |
| EV-P02-048 | P02.01.07 | 2026-09-29 | `1f22cd4bd309` | Four pull requests with a failing required check are all reported BLOCKED by GitHub; the no-push half is derived from the ruleset, not tested | [EV-P02-048-ruleset-blocks-red-pull-requests.md](P02/EV-P02-048-ruleset-blocks-red-pull-requests.md) |
| EV-P02-049 | P02.06.07 | 2026-09-29 | `1f22cd4bd309` | Four negative-control pull requests, each failing the job it was written for; one of them found a dead secret-scanning rule | [EV-P02-049-four-negative-control-pull-requests.md](P02/EV-P02-049-four-negative-control-pull-requests.md) |
| EV-P06-001 | P06.01.01 | 2026-09-29 | `21b5ad23486a` | The seven-role split exists and the migration asserts it, failing with the name of any missing role | [EV-P06-001-database-role-split.md](P06/EV-P06-001-database-role-split.md) |
| EV-P06-002 | P06.01.02 | 2026-09-29 | `21b5ad23486a` | PUBLIC is revoked from schemas and functions; default privileges grant the application role DML and nothing else | [EV-P06-002-public-privileges-revoked.md](P06/EV-P06-002-public-privileges-revoked.md) |
| EV-P06-003 | P06.01.05 | 2026-09-29 | `21b5ad23486a` | The application role cannot run DDL, TRUNCATE, disable a policy, become a privileged role, or own a table | [EV-P06-003-application-role-restrictions.md](P06/EV-P06-003-application-role-restrictions.md) |
| EV-P06-004 | P06.02.01 | 2026-09-29 | `21b5ad23486a` | app.current_org() returns NULL when unset or empty, so every policy matches no rows rather than all rows | [EV-P06-004-current-org-fails-closed.md](P06/EV-P06-004-current-org-fails-closed.md) |
| EV-P06-005 | P06.02.02 | 2026-09-29 | `21b5ad23486a` | One function applies ENABLE + FORCE and a USING/WITH CHECK policy, so no table gets its own copy to diverge | [EV-P06-005-one-policy-per-tenant-table.md](P06/EV-P06-005-one-policy-per-tenant-table.md) |
| EV-P06-006 | P06.02.03 | 2026-09-29 | `21b5ad23486a` | Composite unique keys and composite foreign keys are enforced against the live catalog, not by review | [EV-P06-006-composite-keys-enforced.md](P06/EV-P06-006-composite-keys-enforced.md) |
| EV-P06-007 | P06.02.04 | 2026-09-29 | `21b5ad23486a` | The catalog check reads pg_catalog: RLS forced, policies complete, no runtime role can bypass, every SECURITY DEFINER allowlisted and pinned | [EV-P06-007-rls-catalog-check.md](P06/EV-P06-007-rls-catalog-check.md) |
| EV-P06-008 | P06.02.05 | 2026-09-29 | `21b5ad23486a` | Tables with no tenant column are registered with a reason, so 'deliberately global' and 'forgot the column' cannot look the same | [EV-P06-008-global-table-register.md](P06/EV-P06-008-global-table-register.md) |
| EV-P06-009 | P06.02.06 | 2026-09-29 | `21b5ad23486a` | Cross-tenant SELECT, INSERT, UPDATE and DELETE are all blocked, as the application role against real policies | [EV-P06-009-cross-tenant-isolation-suite.md](P06/EV-P06-009-cross-tenant-isolation-suite.md) |
| EV-P06-010 | P06.02.07 | 2026-09-29 | `21b5ad23486a` | The catalog check fails on a fixture table with row-level security enabled but not forced, and on six other mistakes | [EV-P06-010-catalog-check-fires.md](P06/EV-P06-010-catalog-check-fires.md) |
