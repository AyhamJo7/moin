# P02 — Engineering Foundation: phase plan

- Phase: P02 — Engineering foundation
- Tier: PILOT (`[G:PILOT]` — the only tier P02 carries)
- Target window: 2026-09-28 → 2026-10-02 (3 engineering-days)
- Status Ledger (current): `NOT_STARTED` (PLAN.md L140) — see **Open questions** below on the
  contradiction between this and three already-ticked checklist items.
- Sections in scope for this tier: P02.01–P02.08, all tagged `[G:PILOT]` (every section in the phase).
- Objective: a reproducible, governed monorepo where every later phase lands with quality gates
  already enforced (PLAN.md L2058-2172).

## Dependencies (per Step 1)

`python3 .claude/bin/plan_section.py --section "Phase dependencies (tier-scoped)"` — P02 row: hard
dependencies **none**. P02 runs parallel with P01, P03, P04. P01 is founder discovery work and is
never planned for execution.

The phase's own "Dependencies" line (PLAN.md L2067) adds: branch-protection enforcement (P02.01.01)
depends on **EXT-24** (GitHub plan tier). Everything else in P02 is independent and can start
immediately.

Nothing blocks starting this phase. EXT-24 blocks only one leaf item (P02.01.01) and has an accepted-risk
fallback documented in the phase's Failure modes.

## Checklist

Kind: **I** = implementation, **V** = verification. EV numbering continues the registry from
`EV-P02-003` — **not** `001`/`002`, which are disputed; see Open questions.

| Item | Kind | EV ID | Verification command / procedure | Files / packages |
|---|---|---|---|---|
| P02.01.01 Ruleset on `main` (PR required, required checks, linear history, no force-push/delete) | I | EV-P02-003 | `gh api repos/:owner/:repo/rulesets` export saved as evidence; attempt a direct push to `main` on a throwaway branch protection test repo/fork | GitHub repo settings (no in-repo files) |
| P02.01.02 CODEOWNERS, PR template, issue templates | I | EV-P02-004 | `ls .github/CODEOWNERS .github/PULL_REQUEST_TEMPLATE.md .github/ISSUE_TEMPLATE/` | `.github/CODEOWNERS`, `.github/PULL_REQUEST_TEMPLATE.md`, `.github/ISSUE_TEMPLATE/*` |
| P02.01.03 Conventional Commit + AI-mention rejection check on PR titles/bodies | I | EV-P02-005 | Negative-control PR with a non-conventional title and one with an AI-tool mention both fail the check; positive control passes | `.github/workflows/pr-title-check.yml`, `.claude/policy/no-ai-mentions.json` (already present per control-plane), CI job |
| P02.01.04 `PROGRESS.md`, `docs/evidence/INDEX.md`, evidence record template | I | EV-P02-006 (supersedes disputed EV-P02-001) | `test -f PROGRESS.md && test -f docs/evidence/INDEX.md && test -f docs/evidence/_template.md` (or equivalent), `python3 .claude/bin/evidence.py check` exits 0 | `PROGRESS.md`, `docs/evidence/INDEX.md`, evidence template |
| P02.01.05 `README.md` + `CONTRIBUTING.md` | I | EV-P02-007 (supersedes disputed EV-P02-002) | `test -f README.md && test -f CONTRIBUTING.md`; manual check that README links PLAN/ARCHITECTURE/SECURITY/PRIVACY/OPERATIONS | `README.md`, `CONTRIBUTING.md` |
| P02.01.06 Annotated/signed release-tag policy documented | I | EV-P02-008 | `test -f docs/development/release-tags.md` (or the doc this phase creates); policy names the tag format and signing requirement | `docs/development/*.md` |
| P02.01.07 Verify: direct push to `main` rejected; PR with failing required checks cannot merge | V | EV-P02-009 | Two negative-control attempts, both rejected; capture command output/screenshots (no personal data) | none (process check against P02.01.01 config) |
| P02.02.01 Pin Node 24 LTS, `packageManager: pnpm@10.x`, no-sudo install | I | EV-P02-010 | `cat .nvmrc package.json \| grep -E "engines\|packageManager"`; fresh shell `nvm use && corepack enable` succeeds without sudo | `.nvmrc`, root `package.json` |
| P02.02.02 Turborepo tasks (`lint`,`typecheck`,`test`,`test:integration`,`build`) with caching/`dependsOn` | I | EV-P02-011 | `pnpm turbo run build --dry=json` shows correct task graph; second run hits cache | `turbo.json`, root `package.json` |
| P02.02.03 TypeScript strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` + `noImplicitOverride`, ESM | I | EV-P02-012 | `pnpm tsc --showConfig` reflects all four flags; a fixture violating each fails `tsc --noEmit` | `packages/config/tsconfig.base.json` |
| P02.02.04 ESLint flat config (strict-type-checked, no-explicit-any, named exports only, no `dangerouslySetInnerHTML`, no string-built SQL, no session `SET`, no `console.*`) | I | EV-P02-013 | Fixture file violating each rule fails `pnpm eslint`; clean fixture passes | `packages/config/eslint/*`, `eslint.config.js` |
| P02.02.05 Custom lint rule stubs: no tenant-specific conditionals (INV-18), DB only via tenant wrapper (inert until P06.03) | I | EV-P02-014 | Fixture with an `organisation_id ===`/tenant-name conditional fails the custom rule | `packages/config/eslint/rules/no-tenant-conditional.js` |
| P02.02.06 Prettier, `.editorconfig` | I | EV-P02-015 | `pnpm prettier --check .` on a clean tree | `.prettierrc`, `.editorconfig` |
| P02.02.07 `dependency-cruiser` module-boundary rules | I | EV-P02-016 | Fixture importing across a forbidden boundary (per Domain Boundaries) fails `depcruise` | `.dependency-cruiser.cjs` |
| P02.02.08 Terraform toolchain pinned (tfenv/pinned binary), tflint, Trivy | I | EV-P02-017 | `terraform version`, `tflint --version` match pins; `trivy fs .` runs | `.terraform-version` or pinned binary path, `.tflint.hcl` |
| P02.02.09 Accept ADR-0002, ADR-0034 | I | EV-P02-018 | ADR files marked `Accepted`; `python3 .claude/bin/plan_section.py --id ADR-0002` and `--id ADR-0034` cross-checked against implemented toolchain | `docs/adr/ADR-0002-*.md`, `docs/adr/ADR-0034-*.md` |
| P02.02.10 Verify: fixtures violating each lint/boundary rule fail | V | EV-P02-019 | CI run with the fixture suite from P02.02.03–07, all fail as designed, captured as one report | `packages/testing/fixtures/lint-violations/*` |
| P02.03.01 Create structure from Repository Structure | I | EV-P02-020 | `find . -maxdepth 2 -type d` matches the documented tree (`apps/`, `packages/{contracts,db,kernel,ai,telephony,integrations,observability,ui,testing,config}`, `templates/`, `evals/`, `infrastructure/terraform/`, `docs/`, `scripts/`) | repo root tree |
| P02.03.02 Server role entrypoints (`main-api`, `main-voice`, `main-worker`, `main-migrate`) + root modules | I | EV-P02-021 | Each entrypoint boots in isolation (`node dist/main-api.js --help` style smoke) | `apps/server/src/main-*.ts`, `apps/server/src/modules/*/http` |
| P02.03.03 Zod-validated config loader, fail fast, no secret logging | I | EV-P02-022 | Unit test: missing/invalid env var throws at boot; test asserts secret values never appear in logger output | `packages/config/src/env.ts` |
| P02.03.04 Pino logger, redaction allowlist, correlation IDs | I | EV-P02-023 | Unit test asserts denylisted fields (e.g. `password`, `token`) are redacted; correlation ID present on every log line in a request | `packages/observability/src/logger.ts` |
| P02.03.05 `/healthz` and `/readyz` per role | I | EV-P02-024 | Integration test: `/healthz` 200 always; `/readyz` 200 only when DB reachable, 503 otherwise (fault-injected) | `apps/server/src/modules/*/http/health.controller.ts` |
| P02.03.06 Multi-stage Dockerfiles (ARM64, non-root, read-only-FS compatible, no package manager in runtime layer) | I | EV-P02-025 | `docker build --platform linux/arm64`; `docker run --read-only --user non-root`; `dpkg -l` inside runtime layer shows no package manager | `apps/server/Dockerfile`, `apps/web/Dockerfile` |
| P02.03.07 Verify: images build, containers start, health endpoints 200, image size recorded | V | EV-P02-026 | CI job builds all images, starts each, curls `/healthz`/`/readyz`, records `docker image ls` sizes | CI workflow output |
| P02.04.01 Compose stack: Postgres 17 + pgvector (pinned digest), Valkey, ElasticMQ, licence-checked S3 emulator, Mailpit, local OIDC | I | EV-P02-027 | `docker compose up -d && docker compose ps` all healthy; digests pinned (no `:latest`) | `docker-compose.yml` |
| P02.04.02 `pnpm dev:up/down/reset`, `db:migrate`, `db:seed` (Musterrestaurant, Musterbetrieb SHK) | I | EV-P02-028 | Fresh run of each script exits 0; seeded rows visible for both synthetic tenants | root `package.json` scripts, `packages/db/seeds/*` |
| P02.04.03 `.env.example` (fake values), `.env*` gitignored except example | I | EV-P02-029 | `git check-ignore .env` succeeds; `git check-ignore .env.example` fails (tracked); `grep` confirms no real-looking secrets in example | `.env.example`, `.gitignore` |
| P02.04.04 Document Twilio dev-tunnel path (sandbox numbers only, never staging/prod) | I | EV-P02-030 | Doc review: explicit statement restricting tunnel use to local sandbox numbers | `docs/development/local-setup.md` |
| P02.04.05 `pnpm doctor` (Node/pnpm/Docker/ports/env checks) | I | EV-P02-031 | Run on a deliberately broken env (wrong Node version, missing env var) → doctor reports the specific failure | `scripts/doctor.ts` |
| P02.04.06 Verify: fresh clone → running stack with seed data ≤ 15 min | V | EV-P02-032 | Timed log of `git clone` → `pnpm install` → `pnpm dev:up` → `pnpm db:seed` on a clean machine/container | timed session log |
| P02.05.01 Vitest projects: `unit`, `integration` | I | EV-P02-033 | `pnpm vitest --project unit` and `--project integration` both discover and run tests | `vitest.workspace.ts` |
| P02.05.02 Real-Postgres harness: template DB cloning per test file, migrations applied, standalone-runnable | I | EV-P02-034 | A single integration test file run standalone (`pnpm vitest run path/to/one.test.ts`) against a freshly-seeded DB passes, matching the project rule against suite-only passes | `packages/testing/src/pg-harness.ts` |
| P02.05.03 `packages/testing` factories (German-realistic synthetic data: names, E.164 test-range numbers, PLZ) | I | EV-P02-035 | Factory output validated against `packages/kernel` value-object parsers (E.164, PLZ) | `packages/testing/src/factories/*` |
| P02.05.04 Playwright projects (Chromium/Firefox/WebKit/mobile) + axe | I | EV-P02-036 | `pnpm playwright test --list` shows all 4 projects; one smoke test run with an axe assertion | `playwright.config.ts` |
| P02.05.05 Fault-injection helpers, controllable clock | I | EV-P02-037 | Unit test using the fake clock advances time deterministically; fault-injection helper simulates a dropped dependency call | `packages/testing/src/fault-injection.ts`, `packages/kernel/src/clock.ts` |
| P02.05.06 Verify: one example test of every type passes in-suite **and** standalone | V | EV-P02-038 | Run full suite, then re-run each example test file individually against a freshly-seeded DB; both green | CI + local run log |
| P02.06.01 `verify` job: install, format, lint, typecheck, unit, integration (PG17+pgvector service), build | I | EV-P02-039 | CI run URL, all steps green | `.github/workflows/verify.yml` |
| P02.06.02 `security-scan`: audit/OSV, gitleaks full history, Semgrep, actionlint, shellcheck, Trivy fs, CycloneDX SBOM | I | EV-P02-040 | CI run URL; SBOM artifact attached | `.github/workflows/security-scan.yml` |
| P02.06.03 `container-scan`: hadolint, image build, Trivy image (fail high/critical) | I | EV-P02-041 | CI run URL; a deliberately vulnerable base image fixture fails the job | `.github/workflows/container-scan.yml` |
| P02.06.04 `scripts/check-migrations.ts` wired to CI | I | EV-P02-042 | A migration fixture with a destructive/lock-risk pattern fails the check | `scripts/check-migrations.ts` |
| P02.06.05 Job slots for RLS catalog check (P06.02) and OpenAPI drift (P06/P07) | I | EV-P02-043 | Workflow file has the job defined and disabled/no-op-passing until P06/P07 wire real logic (explicitly noted, not claimed as done) | `.github/workflows/verify.yml` |
| P02.06.06 Actions pinned by SHA; `permissions: contents: read` default; concurrency groups; caching | I | EV-P02-044 | `grep -rL "@v[0-9]" .github/workflows` (no floating tags); default `permissions` block present in every workflow | `.github/workflows/*.yml` |
| P02.06.07 Verify with 4 negative-control PRs (lint error, failing test, fake secret, vulnerable dependency) | V | EV-P02-045 | Four PR links, each failing exactly the job it should and no other | 4 PR links (CI evidence) |
| P02.07.01 `docs/development/{local-setup,testing,conventions}.md` | I | EV-P02-046 | Files exist and a fresh reader can follow them (see P02.07.03) | `docs/development/*.md` |
| P02.07.02 `ARCHITECTURE.md`, `SECURITY.md` skeletons linking ADRs | I | EV-P02-047 | Files exist, link to `docs/adr/` | `ARCHITECTURE.md`, `SECURITY.md` |
| P02.07.03 Verify: a fresh agent session follows the docs from a clean clone without help | V | EV-P02-048 | New session/agent given only the repo + docs completes `dev:up` + one test run unaided; transcript/log as evidence | session log |
| P02.08.01 Renovate: weekly grouped updates, immediate security updates, lockfile maintenance | I | EV-P02-049 | `renovate-config-validator`; a test PR opened by Renovate on a fork | `renovate.json` |
| P02.08.02 Licence allowlist check (fail on AGPL/SSPL/unknown in prod deps) | I | EV-P02-050 | Fixture dependency under AGPL fails the check | `scripts/check-licences.ts` or CI step |
| P02.08.03 pnpm `onlyBuiltDependencies` allowlist; no unreviewed install scripts | I | EV-P02-051 | `pnpm install` with an unlisted install-script dependency is blocked | root `package.json` (`pnpm.onlyBuiltDependencies`) |
| P02.08.04 Verify: licence check fails on a copyleft fixture | V | EV-P02-052 | CI run showing the fixture from P02.08.02 failing the licence job | CI run link |

## `[EXT]` / `[DG]` items

| ID | Counterparty | What the founder must do | Fallback |
|---|---|---|---|
| EXT-24 | GitHub | Confirm/upgrade the GitHub plan tier so private-repo rulesets (and optionally code scanning) are enforceable; without it, P02.01.01's ruleset cannot be created as a hard block | Pre-push hook + CI status discipline, recorded as an accepted risk until the plan is upgraded — must be resolved before MT-LIVE (PLAN.md failure-modes note) |

No other EXT/DG items apply to P02 (local/CI-only phase, no cloud resources per its own Deployment note).

## Invariants at risk

| INV | Risk in this phase | Proof |
|---|---|---|
| INV-18 (no tenant-specific code paths; `organisation_id`/tenant-name conditionals banned by lint) | P02.02.05 only stubs the custom lint rule — it stays inert until P06.03 wires the tenant wrapper. If left inert past P06, tenant-conditional code could land silently. | The fixture in P02.02.10 must include a tenant-conditional violation and fail; re-verify the same fixture still fails once P06.03 activates the rule. |

No other INV is enforced at runtime in P02 — this phase builds the machinery (CI, lint, container
scanning) that later phases' invariant proofs depend on; it does not itself hold tenant, billing, or
call data.

## Quality gates that apply

- **QG-01 (PR verify)** — this is what P02 *builds* (P02.06.01, exit gate note: "QG-01 operational for
  every subsequent PR"). Until P02.06 lands, PRs within P02 itself run on a partial pipeline; each
  negative control in P02.06.07 is what proves QG-01 is real once assembled.
- **QG-10 (Documentation)** — triggered by every deliverable with a behaviour change (README, CONTRIBUTING,
  local-setup, testing, conventions, ARCHITECTURE/SECURITY skeletons in P02.07). No separate reviewer
  agent run needed; the verification item P02.07.03 is the QG-10 evidence.
- **QG-11 (Dependency & licence)** — triggered by every new dependency P02 introduces (pnpm, Turborepo,
  ESLint/typescript-eslint, Vitest, Playwright, Renovate, etc.) and formalized by P02.08. Runs
  continuously via P02.06.02's audit/OSV step plus the P02.08.02 licence-allowlist check.
- **QG-09 (Sensitive-area review)** — **not triggered**. P02 touches no auth, sessions, RLS/roles,
  `SECURITY DEFINER`, tool guard, webhooks, integrations, billing, or privacy handlers, so the
  `/gate-ready` reviewer run (security-reviewer + architecture-reviewer + invariant-reviewer) is not
  required for this phase's own sections. It will be required starting P06.
- QG-02/03/04/05/06/07/08/12 do not apply (no UI routes, no release/prod pipeline, no AI/model change,
  no schema, no personal-data field yet).

## PR sequence

One PR per checklist section, squash-merged by the founder, on short-lived branches:

| Branch | Section | Commit-title pattern |
|---|---|---|
| `feat/p02-01-governance` | P02.01 (skip .04–.06, see Open questions) | `feat(governance): add CODEOWNERS, PR/issue templates, commit checks` |
| `feat/p02-02-toolchain` | P02.02 | `feat(toolchain): pin Node/pnpm, Turborepo tasks, strict TS/ESLint` |
| `feat/p02-03-skeleton` | P02.03 | `feat(server): monorepo skeleton, role entrypoints, health endpoints` |
| `feat/p02-04-devenv` | P02.04 | `feat(devenv): docker compose stack, dev scripts, doctor` |
| `feat/p02-05-testing` | P02.05 | `feat(testing): vitest/playwright harnesses, factories, fault injection` |
| `feat/p02-06-ci` | P02.06 | `feat(ci): verify/security-scan/container-scan pipelines` |
| `feat/p02-07-docs` | P02.07 | `docs(dev): local-setup, testing, conventions, architecture/security skeletons` |
| `feat/p02-08-supply-chain` | P02.08 | `feat(deps): renovate, licence allowlist, install-script policy` |
| `fix/p02-01-evidence-remediation` | P02.01.04–.06 rework (see Open questions) | `fix(governance): replace unsubstantiated evidence with verified records` |

Each PR's evidence records are created with `python3 .claude/bin/evidence.py new --phase P02 --item <id>
--slug <slug> --summary <summary> --from-gates full` before the item is ticked — never hand-numbered.

## Open questions (PLAN.md contradicts itself here — asking, not reinterpreting)

1. **P02.01.04–.06 are ticked in PLAN.md (L2085-2087) but the evidence does not hold up**, confirmed
   both by the existing `docs/phases/P02-evidence-check.md` and by re-running
   `python3 .claude/bin/evidence.py check` live in this session (exit 1, HEAD `605c5b818e38ac14620cb656b0b7ea168b42b05c`):
   - `EV-P02-001` and `EV-P02-002` are `INCOMPLETE` (CI run/artifact and Reviewer fields both still
     `pending`) and `EV-P02-002` is additionally `STALE` (cites commit
     `0123456789abcdef0123456789abcdef01234567`, which does not exist in this repository).
   - The claimed deliverables for both records (`PROGRESS.md`, `README.md`, `CONTRIBUTING.md`) do not
     exist anywhere in the working tree — this is exactly the "no fake completion" list (an item may
     not be ticked because "documentation claims it works").
   - `P02.01.06` is ticked with **no** EV citation at all, which section 4 of the project instructions
     and the Conventions ("Tick an item only with its evidence ID") both forbid outright.
   - `EV-P02-001`/`EV-P02-002` are also misassigned against the phase's own "Required evidence" list
     (PLAN.md L2172), which reserves those two IDs for "CI run URLs" and "negative-control PR links" —
     not for the progress-ledger/README items they're currently cited against.
   - The Status Ledger itself still reads P02 = `NOT_STARTED` while these items are ticked, which the
     project instructions ("Order of updates: Status Ledger first...") say should not happen.
   - **This plan treats P02.01.04–.06 as not actually done** and schedules real implementation +
     verification for them (`EV-P02-006/007/008` above, explicitly *not* reusing `001`/`002`). It does
     **not** un-tick PLAN.md or touch the Status Ledger — this skill only writes the phase plan file.
   - **Question for the founder:** should `EV-P02-001`/`002` be formally retracted/corrected in the
     evidence registry (and the PLAN.md ticks reverted) before P02 execution starts, or is
     superseding them with fresh `EV-P02-006/007/008` under the redo items above sufficient? Either way,
     nothing from P02.01.04–.06 should be treated as complete until one of these happens.
2. P02.06.05 reserves CI job slots for RLS-catalog and OpenAPI-drift checks that only become real in
   P06/P07. Confirm it's acceptable for this phase to ship those slots as intentional no-ops (documented
   as such) rather than deferring the whole sub-item to P06 — PLAN.md doesn't say explicitly.
3. P02.02.08 requires "an alternative S3-compatible emulator" because MinIO's OSS distribution is
   archived (PLAN.md L2065), but PLAN.md does not name the alternative. Needs a founder or ADR decision
   (candidates: SeaweedFS S3 gateway, Garage, LocalStack S3) before P02.04.01 can be implemented exactly.

## Blockers

None internal. EXT-24 blocks only P02.01.01's hard enforcement (fallback available, see EXT table).
Open question 1 blocks trusting P02.01.04–.06 as done; it does not block starting P02.01.01–.03 or any
other section.
