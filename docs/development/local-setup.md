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
pnpm preflight                # checks Node, pnpm, Docker, dependencies, env, ports

pnpm dev:up                   # six services, waits until each is healthy
pnpm db:migrate
pnpm db:seed
```

The command is `pnpm preflight`, **not** `pnpm doctor`: `doctor` is a pnpm built-in, and it shadows
a script of that name, so `pnpm doctor` exits 0 having checked nothing. That is exactly why this
script is not called `doctor`.

It reports **every** problem it finds, not just the first, and names the fix for each. Run it
whenever something behaves oddly — it is faster than reading a stack trace.

## What is running

| Service  | Port        | What it is                                           |
| -------- | ----------- | ---------------------------------------------------- |
| postgres | 5432        | PostgreSQL 17 + pgvector                             |
| valkey   | 6379        | Cache and rate-limit state                           |
| sqs      | 9324 / 9325 | ElasticMQ, speaking the SQS API                      |
| s3       | 9090        | Adobe S3Mock (ADR-0044)                              |
| mail     | 1025 / 8025 | Mailpit — SMTP in, web UI at <http://127.0.0.1:8025> |
| oidc     | 8080        | Keycloak (ADR-0045), realm `moin-local`              |

Every port binds `127.0.0.1` explicitly. Plain `5432:5432` binds `0.0.0.0` and publishes a
development database to whatever network the laptop is on.

### Database roles

The application connects as **`moin_app`**: `NOBYPASSRLS`, owns no tables, cannot run DDL — the
same role split as production (ADR-0003). This matters more than it looks: running local work as
the owner means no row-level-security policy ever fails on a developer machine, and the first time
one mattered would be in staging with real data.

`moin_migrator` is the only role permitted to run DDL. `pnpm db:migrate` uses it.

The api also connects as **`moin_identity`** (`IDENTITY_DATABASE_URL`), the only role that may
execute the sign-in and session functions; voice and worker must never be given it (ADR-0003). It is
created by `docker/postgres/init/00-roles.sql`, which also moves `TEMPORARY` from `PUBLIC` to the
other roles. Init scripts run only on an empty volume, so a database volume created before this role
existed fails migration 0012 with "missing database role moin_identity". Either `pnpm dev:reset`, or
run the `moin_identity` and `TEMPORARY` statements from that script once as `moin_owner`.

## Running things

```bash
pnpm dev                 # web and api in watch mode
pnpm --filter @moin/web dev
pnpm --filter @moin/server dev
```

The API serves `/healthz` (liveness — deliberately checks nothing external) and `/readyz`
(readiness — checks its dependencies). Those two paths are the only ones that exist today.

The server needs `SERVER_ROLE` set to one of `api`, `voice`, `worker`, `migrate`, matching the
entrypoint. Starting the wrong pair exits 1 with a message naming both — one image is built per
release and the role is chosen by the start command (INV-17).

## Tests

```bash
pnpm test                # unit — no Docker needed
pnpm test:integration    # needs the stack up and the environment file copied
pnpm test:e2e            # needs a built web app, and a browser installed once:
                         #   pnpm exec playwright install chromium
```

`pnpm test:integration` reads the environment file for `TEST_DATABASE_ADMIN_URL` and
`TEST_DATABASE_APP_URL`; both are in the example. The app connection must be the **application**
role, not the admin role — an admin connection bypasses row-level security, which would make every
isolation test meaningless, so the harness refuses to fall back to it.

See [`testing.md`](testing.md).

## Resetting

```bash
pnpm dev:down            # stop, keep data
pnpm dev:reset           # destroy volumes and start clean
```

`dev:reset` is the right response to "the database is in a strange state". It is fast, and
re-running the init scripts is exactly what proves a fresh clone works.

**If you have two checkouts** — a worktree, or a clone for reviewing a branch — set
`COMPOSE_PROJECT_NAME` in each. The project name determines the Docker volume, so two checkouts on
the default silently share one database: a genuinely fresh clone reports "migrations already
applied", and `dev:reset` in one destroys the other's data.

## When it does not work

| Symptom                                  | Cause                                                          | Fix                                                                                                               |
| ---------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `docker: daemon unreachable`             | Docker Desktop off, or WSL integration disabled                | Start it; enable integration for this distro                                                                      |
| `port 5432 already in use`               | A system PostgreSQL                                            | Stop it. It will otherwise accept connections with the wrong schema rather than failing clearly                   |
| `DATABASE_URL is missing`                | The environment file has not been copied                       | `cp` the example to it — the scripts read it with `--env-file-if-exists`, so copying genuinely does fix this      |
| `TEST_DATABASE_APP_URL is not set`       | Same                                                           | Same. The harness refuses to fall back to the admin connection, because that silently bypasses row-level security |
| `pnpm doctor` prints nothing and exits 0 | `doctor` is a pnpm built-in that shadows a script of that name | Use `pnpm preflight`                                                                                              |
| `permission denied for schema public`    | Running as `moin_app`, which cannot run DDL                    | Correct — use `pnpm db:migrate`, which uses the migrator role                                                     |
| Keycloak unhealthy for ~20 s             | Realm import on first boot                                     | Expected; `dev:up` waits for it                                                                                   |
| `ERR_PNPM_OUTDATED_LOCKFILE`             | `package.json` changed without the lockfile                    | `pnpm install`, and commit the lockfile                                                                           |

## What never happens locally

- **No production data, ever** (INV-16). Seeds and factories are synthetic; phone numbers are in
  reserved test ranges and email domains are unroutable.
- **No real credentials.** Every value in `.env.example` is a fake. Real secrets live in AWS
  Secrets Manager and are referenced by ARN (INV-15).
- **No outbound mail.** Mailpit catches everything.
