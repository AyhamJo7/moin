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
disable a policy, because the role it runs as cannot. Sign-in and sessions sit behind a further,
api-only role, `moin_identity` (amendment below).

**5. Composite keys.** `UNIQUE (organisation_id, id)` and composite foreign keys, so a reference
cannot point across tenants even if a policy were somehow absent. A plain `FOREIGN KEY (contact_id)`
would happily reference another tenant's contact.

All access goes through `withTenant(organisationId, fn)` or `withSystemWork(claimFn)`. Nothing else
opens a transaction.

**Tenant context is derived server-side** from the authenticated session or the routing that
selected the tenant — never from a request parameter, a header or a body field (INV-02).

## Amendment — 2026-10-02: `moin_identity`, the api-only session role

- **Status:** ACCEPTED by founder decision (2026-10-02), closing QG-09 invariant finding I1 on the
  P06.06 sign-in and session change · **Related:** ADR-0005, P06.06.01, P06.06.02

**Context.** The session functions (`app.begin_sign_in`, `app.consume_sign_in`, `app.begin_session`,
`app.rotate_session`, `app.resolve_session`, `app.revoke_session`) were first granted to `moin_app`.
`moin_app` is also the voice and worker role, so a compromised voice or worker process could call
`begin_session` for any active subject and obtain a valid 7-day session — a capability only the api,
which holds the OIDC client secret, should have. The time bound added in the same change stopped
revival and stretching, not minting.

**Decision.** A dedicated login role, **`moin_identity`**, is the only role that may execute those
six functions.

- `NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB NOREPLICATION`; a member of no role. Members
  are forbidden except a trusted `CREATEROLE` provisioning role with `ADMIN` only (neither
  `INHERIT` nor `SET`), no `moin_` prefix, and no runtime membership path to it. PostgreSQL 16+
  records that grant for a non-superuser creator such as the RDS master user. ADMIN can self-grant
  SET or INHERIT, so the exception trusts the provisioning administrator, not an inert grant; owns
  nothing; `USAGE` on `public` and `app`, `CREATE` nowhere and no `TEMPORARY` (moved off `PUBLIC`
  where roles are provisioned); **no** privilege on any table — session or tenant — and no other
  `SECURITY DEFINER` function.
- `moin_app` has **zero** `EXECUTE` on the six.
- Only the `api` task holds its credential (`IDENTITY_DATABASE_URL`, which must name
  `moin_identity`), in a pool of its own beside its `moin_app` pool; `/readyz` fails unless that pool
  connects as `moin_identity` and `moin_app` cannot execute the session functions. The configuration loader refuses the credential for `voice`, `worker` and
  `migrate`; `identity-is-api-only` in `.dependency-cruiser.cjs` keeps the identity module and its
  pool out of those graphs.
- Provisioning follows the other login roles: `docker/postgres/init/00-roles.sql` locally, the CI
  role step, Terraform and a Secrets Manager entry injected into the `api` task definition only in
  P05 (P05.08.02/.03; no Terraform exists yet), which must also move `TEMPORARY` off `PUBLIC`. Migration 0012 asserts the role's attributes and
  membership and fails the apply otherwise.

| Role            | Holds it                 | May execute                             | Table privileges                    |
| --------------- | ------------------------ | --------------------------------------- | ----------------------------------- |
| `moin_identity` | `api` only               | the six session functions, nothing else | none                                |
| `moin_app`      | `api`, `voice`, `worker` | none of the six                         | unchanged (tenant tables under RLS) |

**Consequences.** One more credential to provision and rotate, and a second pool in `api`. In
exchange, a compromise of voice or worker — the most exposed process, answering Twilio — cannot
create, extend, rotate or revoke a session.

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

| Enforcement                                                                                                                                  | Where                                                                                                                      |
| -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Every `organisation_id` table has RLS enabled **and** forced, with policies for all commands                                                 | `scripts/check-rls-catalog.ts` in CI (P06.02.04); the reserved job already fails if the script appears unwired             |
| `moin_app` has no `BYPASSRLS` and owns no tables                                                                                             | Catalog check; asserted by the test harness on every integration run                                                       |
| `moin_identity` executes exactly the six session functions, holds no table privilege, membership or object; `moin_app` executes none of them | Catalog check (`identity-role-*`, exact `executeGrantees`); `identity-store.integration.test.ts`; migration 0012 assertion |
| The identity credential reaches only `api`                                                                                                   | Configuration loader (`IDENTITY_DATABASE_URL` refused for other roles); `identity-is-api-only` boundary rule               |
| Cross-tenant `SELECT`/`INSERT`/`UPDATE`/`DELETE` blocked per tenant table                                                                    | Adversarial cross-tenant suite (P06.02.06), release-blocking                                                               |
| No context returns zero rows, not all rows                                                                                                   | Same suite: the no-GUC case is an explicit test                                                                            |
| No session-level `SET`, no string-built SQL                                                                                                  | ESLint `no-restricted-syntax` (P02.02.04)                                                                                  |
| Only the platform module opens transactions or holds a raw handle                                                                            | `only-platform-opens-transactions` in `.dependency-cruiser.cjs`, with fixtures                                             |
| Real PostgreSQL for every isolation test                                                                                                     | The harness refuses a superuser connection; embedded Postgres bypasses RLS silently                                        |
