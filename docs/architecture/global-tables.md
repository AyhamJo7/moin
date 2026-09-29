# Global tables

- **Enforced by:** `scripts/check-rls-catalog.ts` (P06.02.05) · **Invariants:** INV-01, INV-02

A table without an `organisation_id` column carries no tenant policy, so nothing in the database
stops one tenant's data in it from reaching another. Most such tables are fine — reference data,
bookkeeping, rows that belong to us rather than to a customer — but "deliberately global" and
"somebody forgot the column" look identical in a schema.

So they are listed here, each with the reason it is global and how it is reached. A table with no
`organisation_id` that is not in this register fails the catalog check, and **a row with no reason
does not count as registered**: the reason is the point of the file.

## Register

| Table                   | Why it has no tenant column                                                                              | How tenant-relevant access is constrained                              |
| ----------------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `schema_migrations`     | Bookkeeping about the schema itself. Contains no customer data of any kind.                              | `SELECT` only for every runtime role; only the migrator writes it      |
| `provisioning_limits`   | One platform-wide Early Access cap, changed through a reviewed migration.                                | No runtime table grant; the provisioning function reads it.            |
| `provisioning_requests` | Request ID to tenant ID mapping must be checked before tenant context exists to make retries idempotent. | No runtime table grant; the provisioning function reads and writes it. |

## Tables PLAN expects to join this register

Listed now so that adding one is a conscious act rather than a discovery. Each still has to be
added above, with its reason, in the migration that creates it.

`templates` · `template_versions` · `plans` · `prices` · `public_holidays` · `subprocessors` ·
`feature_flag_definitions` · `number_routes` · `users` · `sessions` · `provider_inbox` · `outbox` ·
`job_runs` · `timers`

Three of those deserve their reason written before they exist, because each is a place where a
tenant boundary could be crossed by accident:

- **`users` and `sessions`** hold identity, which spans organisations: one person may belong to
  several. They are reached through `SECURITY DEFINER` functions that return the minimum — a
  session lookup returns the user, the active organisation and flags, not a row.
- **`number_routes`** maps a dialled number to an organisation. It _is_ the tenant-resolution
  step, so it cannot itself be tenant-scoped; `resolve_route(e164)` returns
  `(organisation_id, location_id)` and nothing else.
- **`outbox` and `provider_inbox`** carry identifiers rather than payloads, are `INSERT`-only for
  `moin_app`, and are read by `moin_dispatcher`, which can reach no tenant table at all.

## The rule

A table is global only if it is one of:

1. **Reference data** that is the same for every tenant and contains no customer data.
2. **Our own records** — ours as a controller, not a processor.
3. **A tenant-resolution mechanism**, which cannot be tenant-scoped without circularity.
4. **Cross-tenant bookkeeping** reached only by a role that can touch no tenant table.

Anything else with customer data in it has an `organisation_id` and a policy.
