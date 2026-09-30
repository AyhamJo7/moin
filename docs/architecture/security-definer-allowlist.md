# `SECURITY DEFINER` function allowlist

- **Enforced by:** `scripts/check-rls-catalog.ts` (P06.02.04) · **Invariants:** INV-01, INV-02 · **Review:** QG-09

A `SECURITY DEFINER` function runs with its owner's privileges rather than its caller's. This
can grant a caller access to writes it cannot perform directly. The owner must still be
`NOBYPASSRLS`; each definer is a reviewed privilege boundary, not an RLS bypass.

There are legitimate reasons to need one — resolving a dialled number to a tenant cannot itself be
tenant-scoped without circularity — so the answer is not "never". It is: each one is named here,
each says what it returns and why it must be elevated, each pins `search_path`, and adding one is a
QG-09 review.

The catalog check fails on a `SECURITY DEFINER` function that is not in this table, and on any that
does not pin `search_path`. **A row with no reason does not count as registered.**

## Why `search_path` is not optional

An unpinned `search_path` on an elevated function lets its caller influence resolution of
unqualified names. The caller can also create temporary tables: unless `pg_temp` is explicitly
placed last, PostgreSQL may resolve an unqualified table to the caller's temporary copy before
the intended table. Every registered path is checked exactly against its reviewed value.

## Register

| Function                        | What it returns, and why it must be elevated                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Who may execute it                                             |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `app.provision_tenant`          | Returns the organisation UUID. Creates tenant state before an ordinary tenant session exists; transaction-local context still subjects every tenant row to FORCE RLS (P06.04.02, INV-01/02, QG-09). Exact signature: `(uuid, citext, text, text, text, text, text, boolean, text)`. Reviewed owners: `moin_migrator` in the test template and direct-migrator deployment, or `moin_owner` when a deployment uses `SET ROLE`. Fixed path: `pg_catalog, public, app, pg_temp` with caller-created temporary objects last. No dynamic SQL or caller-controlled identifiers.                                                                                                                                                                                                                                                                            | `moin_provisioner` only; the owner retains implicit execution. |
| `app.claim_audit_chains`        | Returns `(organisation_id, id)` identifier pairs — one key-paged set of tenants whose audit chain the daily verifier must walk (P06.10.05, INV-10, QG-09). It is the `withSystemWork` claim function this file's register below pre-authorises, and it is elevated because `moin_app` has no grant on `audit_chain_registry`: a paged list of identifiers is narrower than letting the runtime role select that table and join against it. Enumeration cannot be done unelevated at all — `organisations` is under FORCE RLS, so with no tenant set even `moin_migrator`, which owns it, counts zero rows. Exact signature: `(integer, uuid)`. Reviewed owner: `moin_migrator` (or `moin_owner` with `SET ROLE` deployment). Fixed path: `pg_catalog, public, app, pg_temp`. Returns no tenant data, performs no write and contains no dynamic SQL. | `moin_app` only; the owner retains implicit execution.         |
| `app.unregistered_audit_chains` | Returns `(organisation_id, id)` identifier pairs — provisioned tenants that have **no** row in `audit_chain_registry`, so the daily sweep would never walk their chain (P06.10.05, INV-10, QG-09). It exists because the register would otherwise be its own witness: a registration trigger disabled and re-enabled around one insert leaves nothing in the catalog to find, and that tenant would read as absent rather than unchecked forever. `provisioning_requests` is the independent global witness. Exact signature: `(integer)`. Reviewed owner: `moin_migrator` (or `moin_owner` with `SET ROLE` deployment). Fixed path: `pg_catalog, public, app, pg_temp`. Returns no tenant data, performs no write, no dynamic SQL.                                                                                                                 | `moin_app` only; the owner retains implicit execution.         |
| `app.append_audit_event`        | Returns a per-tenant sequence. Writes a tenant event and advances its chain head atomically after checking the tenant GUC and fixed per-operation argument key and value-kind allowlist (P06.10.01/02, INV-10, QG-09). Exact signature: `(uuid, uuid, text, text, text, uuid, jsonb, jsonb, jsonb, text, uuid, uuid, text)`. Reviewed owner: `moin_migrator` (or `moin_owner` with `SET ROLE` deployment). Fixed path: `pg_catalog, public, app, pg_temp`. No dynamic SQL or cross-tenant read.                                                                                                                                                                                                                                                                                                                                                     | `moin_app` only; the owner retains implicit execution.         |

## Functions PLAN expects here

Named now so that each arrives with its justification rather than acquiring one afterwards.

| Function                             | Phase     | Returns                            | Why elevated                                                                                                                                                            |
| ------------------------------------ | --------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `provision_tenant(…)`                | P06.04.02 | the new organisation id            | Creating a tenant is the one write that legitimately precedes the existence of the tenant it writes for                                                                 |
| `resolve_route(e164)`                | P06.03.04 | `(organisation_id, location_id)`   | Tenant resolution cannot be tenant-scoped without circularity                                                                                                           |
| `resolve_session(token_hash)`        | P06.06    | `(user_id, active_org, flags)`     | Identity spans organisations, so the session lookup precedes knowing which tenant applies                                                                               |
| claim functions for `withSystemWork` | P06.14.01 | `(organisation_id, item_id)` pairs | Sweeps and reconcilers run across tenants by definition; each claimed item is then processed inside `withTenant` — `app.claim_audit_chains` above is the first of these |

Each returns **identifiers only**. None returns a row of tenant data: the caller re-reads what it
needs inside `withTenant`, under the policy, as itself.
