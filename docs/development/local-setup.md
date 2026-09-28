# Local setup

From a clean clone to a running stack. The target is **15 minutes**; on a machine that has the
container images and the pnpm store already, it takes well under a minute.

## Prerequisites

| Tool   | Version                                         | Why pinned                                                                       |
| ------ | ----------------------------------------------- | -------------------------------------------------------------------------------- |
| Node   | **24.21.0** (`.nvmrc`)                          | A different major changes type-stripping and ESM resolution behaviour (ADR-0002) |
| pnpm   | **10.34.5** (`packageManager`)                  | Resolved by corepack, so every machine and CI runner agrees                      |
| Docker | any recent version, with a **reachable daemon** | Every datastore is a container                                                   |

[nvm](https://github.com/nvm-sh/nvm) is the supported Node manager. On WSL2, Docker Desktop must
also have **WSL integration enabled for this distribution** — without it `docker` is present and
the daemon is not, which is the single most common setup failure.

## Steps

```bash
nvm use                       # reads .nvmrc → Node 24.21.0
corepack enable               # pnpm 10.34.5 from packageManager
pnpm install --frozen-lockfile

cp .env.example .env          # every value in it is a development-only fake
pnpm doctor                   # checks Node, pnpm, Docker, dependencies, env, ports

pnpm dev:up                   # six services, waits until each is healthy
pnpm db:migrate
pnpm db:seed
```

`pnpm doctor` reports **every** problem it finds, not just the first, and names the fix for each.
Run it whenever something behaves oddly — it is faster than reading a stack trace.

## What is running

| Service  | Port        | What it is                                           |
| -------- | ----------- | ---------------------------------------------------- |
| postgres | 5432        | PostgreSQL 17 + pgvector                             |
| valkey   | 6379        | Cache and rate-limit state                           |
| sqs      | 9324 / 9325 | ElasticMQ, speaking the SQS API                      |
| s3       | 9090        | Adobe S3Mock (ADR-0035)                              |
| mail     | 1025 / 8025 | Mailpit — SMTP in, web UI at <http://127.0.0.1:8025> |
| oidc     | 8080        | Keycloak (ADR-0036), realm `moin-local`              |

Every port binds `127.0.0.1` explicitly. Plain `5432:5432` binds `0.0.0.0` and publishes a
development database to whatever network the laptop is on.

### Database roles

The application connects as **`moin_app`**: `NOBYPASSRLS`, owns no tables, cannot run DDL — the
same role split as production (ADR-0003). This matters more than it looks: running local work as
the owner means no row-level-security policy ever fails on a developer machine, and the first time
one mattered would be in staging with real data.

`moin_migrator` is the only role permitted to run DDL. `pnpm db:migrate` uses it.

## Running things

```bash
pnpm dev                 # everything in watch mode
pnpm --filter @moin/web dev
pnpm --filter @moin/server build && node apps/server/dist/main-api.js
```

The server needs `SERVER_ROLE` set to one of `api`, `voice`, `worker`, `migrate`, matching the
entrypoint. Starting the wrong pair exits 1 with a message naming both — one image is built per
release and the role is chosen by the start command (INV-17).

## Tests

```bash
pnpm test                # unit — no Docker needed
pnpm test:integration    # needs the stack up
pnpm test:e2e            # needs a built web app
```

See [`testing.md`](testing.md).

## Resetting

```bash
pnpm dev:down            # stop, keep data
pnpm dev:reset           # destroy volumes and start clean
```

`dev:reset` is the right response to "the database is in a strange state". It is fast, and
re-running the init scripts is exactly what proves a fresh clone works.

## When it does not work

| Symptom                               | Cause                                           | Fix                                                                                             |
| ------------------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `docker: daemon unreachable`          | Docker Desktop off, or WSL integration disabled | Start it; enable integration for this distro                                                    |
| `port 5432 already in use`            | A system PostgreSQL                             | Stop it. It will otherwise accept connections with the wrong schema rather than failing clearly |
| `DATABASE_URL is missing`             | No `.env`                                       | `cp .env.example .env`                                                                          |
| `permission denied for schema public` | Running as `moin_app`, which cannot run DDL     | Correct — use `pnpm db:migrate`, which uses the migrator role                                   |
| Keycloak unhealthy for ~20 s          | Realm import on first boot                      | Expected; `dev:up` waits for it                                                                 |
| `ERR_PNPM_OUTDATED_LOCKFILE`          | `package.json` changed without the lockfile     | `pnpm install`, and commit the lockfile                                                         |

## What never happens locally

- **No production data, ever** (INV-16). Seeds and factories are synthetic; phone numbers are in
  reserved test ranges and email domains are unroutable.
- **No real credentials.** Every value in `.env.example` is a fake. Real secrets live in AWS
  Secrets Manager and are referenced by ARN (INV-15).
- **No outbound mail.** Mailpit catches everything.
