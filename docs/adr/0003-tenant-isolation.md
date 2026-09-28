# ADR-0003 — Tenant isolation

- **Status:** ACCEPTED (P03.01.02, 2026-09-29) · **Deciders:** founder · **Phase:** P03
- **Related:** INV-01, INV-02, INV-16, INV-18, ADR-0004, QG-01, QG-08

## Context

One database holds every customer's data. A leak across that boundary is not a bug to fix next
sprint: it is a reportable personal-data breach involving a small business's customers, and it
ends the product's credibility with the market it is sold into.

The mechanism therefore has to fail **closed** and has to be hard to get wrong from application
code written months from now by someone moving quickly.

## Decision

Five layers, each of which would have to fail for a leak to happen.

**1. `organisation_id NOT NULL` on every tenant row.** No exceptions without a register entry.

**2. `ENABLE` _and_ `FORCE ROW LEVEL SECURITY` on every tenant table**, with policies covering
`SELECT`, `INSERT`, `UPDATE` and `DELETE`. `FORCE` matters: without it, the table owner bypasses
its own policies, and the owner is the role migrations run as.

**3. Transaction-local tenant context.** `set_config('app.organisation_id', $1, true)` — the
`true` makes it transaction-scoped. A session-level `SET` survives the transaction and leaks onto
the next checkout of a pooled connection, which is a cross-tenant read with no failing test in
sight. `app.current_org()` returns `NULL` when unset or empty, and policies compare against it, so
**no context means no rows** rather than all rows.

**4. Role separation.** The runtime role `moin_app` is `NOBYPASSRLS`, owns no tables and cannot run
DDL. `moin_migrator` runs DDL and nothing else. Application-level SQL injection therefore cannot
disable a policy, because the role it runs as cannot.

**5. Composite keys.** `UNIQUE (organisation_id, id)` and composite foreign keys, so a reference
cannot point across tenants even if a policy were somehow absent. A plain `FOREIGN KEY (contact_id)`
would happily reference another tenant's contact.

All access goes through `withTenant(organisationId, fn)` or `withSystemWork(claimFn)`. Nothing else
opens a transaction.

**Tenant context is derived server-side** from the authenticated session or the routing that
selected the tenant — never from a request parameter, a header or a body field (INV-02).

## Alternatives considered

| Option                                                             | Why not                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A database per tenant**                                          | The strongest isolation, and it makes every migration an N-times operation, every cross-tenant operational query impossible, and connection pooling unmanageable at a few hundred tenants. It also does nothing about the case that actually happens: application code querying with the wrong id. |
| **A schema per tenant**                                            | The same migration problem, plus `search_path` becomes load-bearing — and `search_path` is exactly the kind of connection-scoped state that leaks across a pooled checkout.                                                                                                                        |
| **Application-level filtering only (`WHERE organisation_id = ?`)** | One forgotten clause in one query is a leak, and the forgetting is invisible in review and in every single-tenant test. RLS makes the database refuse rather than trusting every author forever.                                                                                                   |
| **RLS without `FORCE`**                                            | The owner bypasses its own policies, so anything running as the owner — including a migration that backfills data — silently sees everything.                                                                                                                                                      |
| **Session-level `SET` instead of transaction-local**               | Leaks onto the next checkout of a pooled connection. The lint rule bans it.                                                                                                                                                                                                                        |

## Consequences

- Every query pays a policy evaluation. Measurable, and far cheaper than a breach.
- The tenant wrapper is mandatory, which makes `withTenant` the busiest function in the codebase
  and worth the scrutiny it will get.
- Cross-tenant operational work needs an explicit, audited path (`withSystemWork`), which is a
  feature: it is a small number of places to review rather than an ambient capability.
- Adding a tenant table means adding an RLS policy and a cross-tenant test. The catalog check makes
  forgetting fail CI rather than fail quietly.
- **This is the wrong call if** a tenant ever needs physical data separation for a contractual or
  regulatory reason. That is a per-tenant deployment, and this design does not prevent it later.

## Verification

| Enforcement                                                                                  | Where                                                                                                          |
| -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Every `organisation_id` table has RLS enabled **and** forced, with policies for all commands | `scripts/check-rls-catalog.ts` in CI (P06.02.04); the reserved job already fails if the script appears unwired |
| `moin_app` has no `BYPASSRLS` and owns no tables                                             | Catalog check; asserted by the test harness on every integration run                                           |
| Cross-tenant `SELECT`/`INSERT`/`UPDATE`/`DELETE` blocked per tenant table                    | Adversarial cross-tenant suite (P06.02.06), release-blocking                                                   |
| No context returns zero rows, not all rows                                                   | Same suite: the no-GUC case is an explicit test                                                                |
| No session-level `SET`, no string-built SQL                                                  | ESLint `no-restricted-syntax` (P02.02.04)                                                                      |
| Only the platform module opens transactions or holds a raw handle                            | `only-platform-opens-transactions` in `.dependency-cruiser.cjs`, with fixtures                                 |
| Real PostgreSQL for every isolation test                                                     | The harness refuses a superuser connection; embedded Postgres bypasses RLS silently                            |
