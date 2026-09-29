# ADR-0004 — Data access and migrations

- **Status:** ACCEPTED (P03.01.02, 2026-09-29) · **Deciders:** founder · **Phase:** P03
- **Related:** ADR-0003, INV-17, QG-08

## Context

Two questions that are usually answered by picking a tool and accepting its opinions: how does
application code reach the database, and how does the schema change while the previous release is
still running.

The second is the one that causes outages, and it is not a tool question.

## Decision

**Drizzle as a query builder, not as an ORM and not as a migration tool.** Table definitions in
TypeScript give typed queries and a single source for column names. Nothing else is adopted: no
lazy-loading relations, no entity lifecycle, no `drizzle-kit push`, no generated migrations.

**Migrations are reviewed plain SQL**, numbered and ordered, applied by our own runner. Generated
migrations are a diff of two schemas and know nothing about locks, backfills or the release still
running — which is precisely the knowledge a migration needs.

**Expand/contract, always.** A migration must be compatible with the release before it, because a
rolling deploy runs both at once (INV-17):

1. **Expand** — add the new column nullable, add the new table, add the constraint `NOT VALID`.
2. **Backfill** — as a job, not in the migration, so it does not hold a lock for the length of a
   table scan.
3. **Migrate readers and writers** — a later release.
4. **Contract** — drop the old column, validate the constraint. A release after nothing reads it.

**No RDS Proxy.** It adds a hop and a failure mode, and its pinning behaviour interacts badly with
transaction-scoped `set_config` — the mechanism tenant isolation depends on (ADR-0003). The
application pools its own connections.

## Alternatives considered

| Option                                         | Why not                                                                                                                                                                                                   |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Prisma**                                     | Its own migration engine and a query model further from SQL. For a system whose hardest requirement is row-level security and transaction-scoped context, distance from SQL is a cost, not a convenience. |
| **A full ORM (TypeORM, MikroORM)**             | Entity lifecycles and lazy loading generate queries nobody wrote, which is exactly what must not happen inside a tenant-scoped transaction.                                                               |
| **`drizzle-kit push` or generated migrations** | Convenient in development, and a diff of two schemas cannot know that `ALTER COLUMN TYPE` rewrites a table under an exclusive lock, or that the previous release still reads the column being dropped.    |
| **Raw `pg` everywhere**                        | No typed column names, so a rename becomes a runtime error found by a customer.                                                                                                                           |
| **RDS Proxy**                                  | A hop, a failure mode, and connection pinning that interacts badly with the `set_config` tenant context.                                                                                                  |

## Consequences

- Migrations are written by hand, which is slower and is the point: each one is read with locks and
  the previous release in mind.
- A schema change usually spans two or three releases. That is the honest cost of not taking the
  site down.
- Drizzle's table definitions and the SQL migrations can drift. A CI check compares them (P06).
- **This is the wrong call if** the schema ever changes fast enough that hand-writing migrations is
  the bottleneck. At that point the answer is a generator whose output is still reviewed — not
  applying a diff unread.

## Verification

| Enforcement                      | Where                                                                                                                  |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Expand/contract and lock safety  | `scripts/check-migrations.ts` in CI; nine rules with fixtures, and an exception must state its reason on the same line |
| Applied migrations are immutable | The runner compares checksums and refuses a changed file                                                               |
| One runner at a time             | PostgreSQL advisory lock in `packages/db/src/migrate.ts`                                                               |
| Each migration atomic            | Applied in its own transaction with its bookkeeping row written inside it                                              |
| No `drizzle-kit push`            | Not installed; migrations run only through `pnpm db:migrate`                                                           |
| Ordering is unambiguous          | Filenames must be `NNNN_lower_snake_case.sql`; duplicate versions are rejected                                         |
