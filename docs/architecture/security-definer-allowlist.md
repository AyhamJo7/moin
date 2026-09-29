# `SECURITY DEFINER` function allowlist

- **Enforced by:** `scripts/check-rls-catalog.ts` (P06.02.04) · **Invariants:** INV-01, INV-02 · **Review:** QG-09

A `SECURITY DEFINER` function runs with its owner's privileges rather than its caller's. In this
database that means it runs as a role that can see every tenant, which makes each one a deliberate
hole in the isolation everything else is built on.

There are legitimate reasons to need one — resolving a dialled number to a tenant cannot itself be
tenant-scoped without circularity — so the answer is not "never". It is: each one is named here,
each says what it returns and why it must be elevated, each pins `search_path`, and adding one is a
QG-09 review.

The catalog check fails on a `SECURITY DEFINER` function that is not in this table, and on any that
does not pin `search_path`. **A row with no reason does not count as registered.**

## Why `search_path` is not optional

An unpinned `search_path` on an elevated function lets its caller decide which `public.foo()` it
resolves to. The caller creates a schema, puts a function called `foo` in it, puts that schema
first on the search path, and the elevated function calls the attacker's code with the owner's
privileges. It is the standard PostgreSQL privilege-escalation primitive, and it is one line to
prevent.

## Register

| Function               | What it returns, and why it must be elevated                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Who may execute it                                             |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| `app.provision_tenant` | Returns the organisation UUID. Creates tenant state before an ordinary tenant session exists; transaction-local context still subjects every tenant row to FORCE RLS (P06.04.02, INV-01/02, QG-09). Exact signature: `(uuid, citext, text, text, text, text, text, boolean, text)`. Reviewed owners: `moin_migrator` in the test template and direct-migrator deployment, or `moin_owner` when a deployment uses `SET ROLE`. Fixed path: `pg_catalog, public, app, pg_temp` with caller-created temporary objects last. No dynamic SQL or caller-controlled identifiers. | `moin_provisioner` only; the owner retains implicit execution. |

## Functions PLAN expects here

Named now so that each arrives with its justification rather than acquiring one afterwards.

| Function                             | Phase     | Returns                            | Why elevated                                                                                                     |
| ------------------------------------ | --------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `provision_tenant(…)`                | P06.04.02 | the new organisation id            | Creating a tenant is the one write that legitimately precedes the existence of the tenant it writes for          |
| `resolve_route(e164)`                | P06.03.04 | `(organisation_id, location_id)`   | Tenant resolution cannot be tenant-scoped without circularity                                                    |
| `resolve_session(token_hash)`        | P06.06    | `(user_id, active_org, flags)`     | Identity spans organisations, so the session lookup precedes knowing which tenant applies                        |
| claim functions for `withSystemWork` | P06.14.01 | `(organisation_id, item_id)` pairs | Sweeps and reconcilers run across tenants by definition; each claimed item is then processed inside `withTenant` |

Each returns **identifiers only**. None returns a row of tenant data: the caller re-reads what it
needs inside `withTenant`, under the policy, as itself.
