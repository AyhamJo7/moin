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

| Table                          | Why it has no tenant column                                                                                                                                                                                                                    | How tenant-relevant access is constrained                                                                                                                                                                                                                                       |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schema_migrations`            | Bookkeeping about the schema itself. Contains no customer data of any kind.                                                                                                                                                                    | `SELECT` only for every runtime role; only the migrator writes it                                                                                                                                                                                                               |
| `provisioning_limits`          | One platform-wide Early Access cap, changed through a reviewed migration.                                                                                                                                                                      | No runtime table grant; the provisioning function reads it.                                                                                                                                                                                                                     |
| `provisioning_requests`        | Request ID to tenant ID mapping must be checked before tenant context exists to make retries idempotent.                                                                                                                                       | No runtime table grant; the provisioning function reads and writes it.                                                                                                                                                                                                          |
| `audit_argument_allowlist`     | Platform-wide reviewed argument keys and constrained value kinds, shared by every tenant for each audit operation.                                                                                                                             | No runtime table grant; only the audit writer reads it.                                                                                                                                                                                                                         |
| `audit_chain_population_state` | The single authoritative allocator of audit-register epochs: one row, incremented inside each registering transaction so that epoch order is commit order. Holds one counter and no customer data.                                             | No runtime table grant at all; a role that could increment it could move a sweep's population bound out from under it. Read by `app.audit_chain_high_water`.                                                                                                                    |
| `audit_chain_registry`         | The list of audit chains the daily verifier walks. `organisations` is under FORCE RLS, so no role — not even the table's owner — may enumerate tenants; measured, not assumed. Holds one opaque tenant identifier and no customer data.        | No runtime table grant; append-only by trigger. `app.claim_audit_chains` returns one paged set of identifiers to `moin_app`.                                                                                                                                                    |
| `users`                        | Identity spans organisations: one person may belong to several, so the row that links a provider subject to a person cannot belong to one tenant (ADR-0005). Membership, role and permission are tenant rows (P06.07/.08), never columns here. | No runtime table grant. Read only inside `app.begin_session`, `app.rotate_session` and `app.resolve_session`, which return the user id and nothing else, executable by `moin_identity` alone. Created by invitation acceptance (P06.08.02); sign-in never creates one.          |
| `auth_transactions`            | A pending sign-in exists before anyone is identified, let alone any organisation. Holds SHA-256 digests of `state`, nonce and browser binding, a sealed PKCE verifier and an internal return path; no customer data.                           | No runtime table grant. `app.begin_sign_in` writes one row; `app.consume_sign_in` deletes it on any presentation of its `state` and returns it only to the browser that started it, unexpired.                                                                                  |
| `sessions`                     | A session is resolved before any tenant applies: it identifies a person, and which organisation they act for is checked separately against memberships (P06.06.03). Keyed by a token digest; provider tokens are ciphertext.                   | No runtime table grant. Reached only through `app.begin_session`, `app.rotate_session`, `app.resolve_session` and `app.revoke_session`; a guard trigger keeps identity and absolute expiry fixed and revocation final, even for the owner.                                      |
| `auth_throttle_buckets`        | Throttle state exists before any tenant applies: login and callback have no session, so per-IP buckets cannot name an organisation. Keyed by HMAC digest of IP/account, never the value (INV-12); counts and timestamps only.                  | No runtime table grant at all — reached only through `app.take_signin_bucket` (EXECUTE to `moin_app`), which also sweeps rows idle > 24 h (100/call cap), bounding the table at ~a day of distinct sources.                                                                     |
| `auth_security_events`         | Security outcomes exist before any tenant applies: failed logins happen with no session. Coarse outcome + reason class + HMAC digest only — no IPs, subjects, details (INV-12). Owner notification PENDING until P14.                          | `moin_app` SELECT/INSERT through `app.write_signin_event` only; no UPDATE/DELETE except migrator-owned retention (P16).                                                                                                                                                         |
| `number_routes`                | Tenant resolution precedes tenancy: a dialled E.164 maps to an organisation, so the mapping cannot itself be tenant-scoped (P06.03.04, P11.01.01). Ids only (e164, organisation, location, status) — no payload.                               | No runtime table grant at all. Reached only through `app.resolve_route(text)` (EXECUTE to `moin_app`), which returns exactly `(organisation_id, location_id)` for active rows and zero rows for quarantined/unknown numbers (released numbers have no row — release is DELETE). |

## Tables PLAN expects to join this register

Listed now so that adding one is a conscious act rather than a discovery. Each still has to be
added above, with its reason, in the migration that creates it.

`templates` · `template_versions` · `plans` · `prices` · `public_holidays` · `subprocessors` ·
`feature_flag_definitions` · `provider_inbox` · `outbox` ·
`job_runs` · `timers`

Three of those deserve their reason written before they exist, because each is a place where a
tenant boundary could be crossed by accident:

- **`users` and `sessions`** (registered above, P06.06) hold identity, which spans organisations:
  one person may belong to several. They are reached through `SECURITY DEFINER` functions that
  return the minimum — a session lookup returns the session and user identifiers and expiries, not
  a row. The active organisation joins that result with the membership check (P06.06.03).
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
