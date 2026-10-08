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

| Document                                 | What it is                                                                            |
| ---------------------------------------- | ------------------------------------------------------------------------------------- |
| [`PLAN.md`](PLAN.md)                     | Execution plan: phases, checklists, gates, invariants, evidence rules. Authoritative. |
| [`PROGRESS.md`](PROGRESS.md)             | Append-only item-level execution ledger                                               |
| [`ARCHITECTURE.md`](ARCHITECTURE.md)     | Architecture overview and the ADR index                                               |
| [`SECURITY.md`](SECURITY.md)             | Security posture and vulnerability reporting                                          |
| [`CONTRIBUTING.md`](CONTRIBUTING.md)     | Branches, commits, PRs, gates                                                         |
| [`docs/adr/`](docs/adr/)                 | Architecture Decision Records                                                         |
| [`docs/development/`](docs/development/) | Local setup, testing, conventions                                                     |
| [`docs/evidence/`](docs/evidence/)       | Evidence records backing every verified checklist item                                |

`PRIVACY.md` and `OPERATIONS.md` arrive with P16 and P15 respectively.

## Quickstart

Requires Docker with a reachable daemon, and [nvm](https://github.com/nvm-sh/nvm).

```bash
nvm use                 # Node 24.21.0, pinned in .nvmrc
corepack enable         # pnpm 10, pinned by packageManager
pnpm install --frozen-lockfile
cp .env.example .env    # every value in it is a development-only fake
pnpm preflight          # checks Node, pnpm, Docker, dependencies, env, ports
pnpm dev:up             # Postgres 17 + pgvector, Valkey, ElasticMQ, S3Mock, Mailpit, Keycloak
pnpm db:migrate
pnpm dev                # web on :3000, api on :3001
```

The command is `pnpm preflight`, not `pnpm doctor` — `doctor` is a pnpm built-in and would shadow
the script, exiting 0 having checked nothing.

Target: clean clone to a running stack in **≤ 15 minutes** on a machine that already has the
container images; a first run also pulls about 1.7 GB of them. The full walkthrough, including what
to do when a step fails, is in
[`docs/development/local-setup.md`](docs/development/local-setup.md).

`pnpm db:seed` exists and currently applies **no rows**: the demo tenants "Musterrestaurant" and
"Musterbetrieb SHK" are defined, but the tenancy schema they belong to arrives in P06.

## Repository layout

```text
apps/web/         Next.js App Router — owner app + ops routes
apps/server/      NestJS (Fastify adapter) modular monolith
                  role entrypoints: main-api · main-voice · main-worker · main-migrate
packages/         contracts · db · kernel · ai · telephony · integrations
                  observability · ui · testing · config
templates/        vertical templates as versioned data          (empty until P10)
evals/            AI evaluation datasets and adversarial suites  (empty until P10)
infrastructure/   Terraform                                      (empty until P05)
scripts/          preflight, migration checks, licence checks, ADR coverage
```

Directories marked empty exist but contain only a placeholder. Most of this repository is not built
yet; `PLAN.md`'s Status Ledger is the current truth.

One server image is built per release and started with a different command per role (INV-17).
Module boundaries are described in PLAN.md _Domain Boundaries_ and enforced by `dependency-cruiser`.

## Verification

```bash
pnpm verify              # format, lint, typecheck, unit tests, build — what CI checks
pnpm test:integration    # needs the local stack up
pnpm test:e2e            # needs `pnpm exec playwright install chromium` once
```

Nothing is "done" without evidence: see [`CONTRIBUTING.md`](CONTRIBUTING.md#evidence) and
`PLAN.md` _Evidence rules_.

## Privacy

Only synthetic data ever enters development and test environments. Production data never leaves
production (INV-16). The demo tenants "Musterrestaurant" and "Musterbetrieb SHK" are defined in
`packages/db/src/seed.ts`; their rows arrive with the tenancy schema in P06.

## Licence

Proprietary. All rights reserved. This is **not** open source: no licence is granted to
use, copy, modify or distribute this software, and no reuse of any kind is permitted
(see `LICENSE`). The repository is public for operational reasons (public repos receive
free CI minutes), not as a grant of rights — the source is visible only, and visibility
is not permission.
