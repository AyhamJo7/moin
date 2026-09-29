# moin

**KlarDesk — Digitales Front Office für kleine Betriebe.**
`moin` is the internal codename. Brand strings, domains and sender identities are configuration,
never hard-coded (ADR-0034).

A small business misses calls because the people who could answer them are working. moin answers
instead: it takes the call, understands what the caller needs in German, answers from knowledge the
owner has approved, and turns the rest into a task, a lead or an appointment request that never gets
lost.

## Status

Greenfield. Phase **P02 — Engineering Foundation** is the first phase that produces application
code. `PLAN.md` is the authoritative execution plan (phases P00–P33); `BLUEPRINT.md` is the
founder's product specification and is read-only.

| Document | What it is |
|---|---|
| [`PLAN.md`](PLAN.md) | Execution plan: phases, checklists, gates, invariants, evidence rules. Authoritative. |
| [`PROGRESS.md`](PROGRESS.md) | Append-only item-level execution ledger |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | Architecture overview and the ADR index |
| [`SECURITY.md`](SECURITY.md) | Security posture and vulnerability reporting |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | Branches, commits, PRs, gates |
| [`docs/adr/`](docs/adr/) | Architecture Decision Records |
| [`docs/development/`](docs/development/) | Local setup, testing, conventions |
| [`docs/evidence/`](docs/evidence/) | Evidence records backing every verified checklist item |

`PRIVACY.md` and `OPERATIONS.md` arrive with P16 and P15 respectively.

## Quickstart

Requires Docker with a reachable daemon, and [nvm](https://github.com/nvm-sh/nvm).

```bash
nvm use                 # Node 24.21.0, pinned in .nvmrc
corepack enable         # pnpm 10, pinned by packageManager
pnpm install --frozen-lockfile
pnpm doctor             # checks Node, pnpm, Docker, ports, env completeness
cp .env.example .env
pnpm dev:up             # Postgres 17 + pgvector, Valkey, ElasticMQ, S3Mock, Mailpit, Keycloak
pnpm db:migrate && pnpm db:seed
pnpm dev
```

Target: clean clone to a running stack with seed data in **≤ 15 minutes**. The full walkthrough,
including what to do when a step fails, is in
[`docs/development/local-setup.md`](docs/development/local-setup.md).

## Repository layout

```text
apps/web/         Next.js App Router — owner app + ops routes
apps/server/      NestJS (Fastify adapter) modular monolith
                  role entrypoints: main-api · main-voice · main-worker · main-migrate
packages/         contracts · db · kernel · ai · telephony · integrations
                  observability · ui · testing · config
templates/        vertical templates as versioned data
evals/            AI evaluation datasets, adversarial suites, runners
infrastructure/   Terraform
scripts/          doctor, migration checks, licence checks, SBOM
```

One server image is built per release and started with a different command per role (INV-17).
Module boundaries are described in PLAN.md *Domain Boundaries* and enforced by `dependency-cruiser`.

## Verification

```bash
pnpm turbo run lint typecheck test build   # what CI's `verify` job runs
pnpm test:integration                      # needs the local stack up
python3 .claude/bin/gates.py full          # the repository's own gate runner
```

Nothing is "done" without evidence: see [`CONTRIBUTING.md`](CONTRIBUTING.md#evidence) and
`PLAN.md` *Evidence rules*.

## Privacy

Only synthetic data ever enters development and test environments. Production data never leaves
production (INV-16). Seeded demo tenants are "Musterrestaurant" and "Musterbetrieb SHK".

## Licence

Proprietary. All rights reserved.
