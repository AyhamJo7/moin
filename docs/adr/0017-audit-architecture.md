# ADR-0017 — Tenant audit architecture

- **Status:** PROPOSED (founder acceptance pending)
- **Deciders:** founder
- **Phase:** P06
- **Related:** ADR-0003, ADR-0018, INV-01, INV-10, INV-12, QG-09

## Context

Every business mutation must leave an ordered, tenant-scoped record that a later reviewer can inspect. Application code also needs to record rejected actions and security events without writing raw request bodies, credentials or contact details into a durable audit trail. Tenant isolation and FORCE RLS apply to audit records as they do to other tenant data.

## Decision (draft)

An audit append and the business mutation it describes run in one tenant transaction. Provisioning precedes an application tenant session, so its global request insert triggers the audit append after the provisioning function sets transaction-local tenant context. The runtime role has SELECT but no direct INSERT, UPDATE, DELETE or TRUNCATE grant on `audit_events` or `audit_heads`. A reviewed `SECURITY DEFINER` function checks a fixed operation and argument policy, locks the tenant head, allocates the next sequence, hashes the previous hash with a canonical payload, inserts the event and advances the head in that transaction. A trigger rejects UPDATE and DELETE even by the table owner. The function has an exact QG-09 allowlist entry, a pinned search path and no dynamic SQL.

The stored payload uses explicit typed fields and opaque identifiers. Operation-specific argument keys must be registered with a constrained value kind; an unknown key fails closed. Query and verification APIs always execute under tenant RLS. Until an external immutable anchor is implemented, a privileged actor able to rewrite both events and head can forge a consistent replacement chain; the current chain detects accidental corruption and unauthorised runtime mutation, not that attack.

### The daily verifier, and the register it needs

A daily sweep walks every tenant chain and alarms on a gap or mismatch. It connects as the
**application** role, because verifying through a privileged connection would prove the chain is
intact for a reader production does not have.

Enumerating the tenants cannot be done unelevated, and this was measured rather than assumed: with
no tenant context, FORCE RLS hides every row of `organisations` from `moin_migrator`, which owns the
table, and a `SECURITY DEFINER` function owned by it returns nothing for the same reason. There is
no role permitted to enumerate tenants, and creating one would mean `BYPASSRLS`, which INV-01
forbids. The tenant list is therefore a global register, `audit_chain_registry`, holding one opaque
identifier per chain and no customer data — a tenant-resolution mechanism, which by
`docs/architecture/global-tables.md` rule 3 cannot itself be tenant-scoped without circularity.

Three properties make the register load-bearing rather than incidental bookkeeping:

- **A trigger on `organisations` fills it**, not the provisioning function, because a migration or a
  repair script can also insert a tenant, and those are exactly the paths where a bookkeeping step
  is forgotten. A trigger on the table cannot be forgotten.
- **It is append-only**, enforced by a trigger for the table's owner as well. A register a
  privileged actor can delete from makes "remove the row" the cheapest way to hide a tampered chain:
  the sweep would skip that tenant and report a clean run.
- **It is enumerated instead of `audit_heads`**, which would be cheaper and would hide the most
  interesting failure — a deleted head with its events still present. Walking the register turns
  that into a `missing-head` finding rather than a tenant that quietly leaves the worklist.

`moin_app` has no grant on the register. It reads a key-paged, capped set of identifiers through
`app.claim_audit_chains`, the `withSystemWork` claim shape this repository already reviews
(P06.14.01), and re-reads each chain inside `withTenant` as itself.

### A break, a gap and an outage are three different incidents

The sweep distinguishes chains that are _sound_, _broken_ and _unchecked_, and refuses to collapse
the last two into the first: a tenant that could not be verified is a hole in the day's coverage,
not a pass. The process exit code carries the same split — `0` sound, `3` a broken chain, `1` a
sweep that could not complete — so that a database outage does not page somebody for suspected
tampering. `docs/runbooks/audit-chain-break.md` is named on every alarm line.

### Checking that the argument policy held

The writer refuses an unregistered key and a value of the wrong kind. That is the control, and
`scripts/check-audit-arguments.ts` is the separate check that it held: the registry can be widened
by a later migration, and rows can arrive by a path that is not the writer. Its strong rule is
structural rather than pattern-based — the only string-valued kind the registry permits is `uuid`,
so any stored argument string that is not a UUID is an unreviewed value, whatever it contains. It
never prints the value it finds, because printing it would be the leak.

Pseudonymisation and retention are separate decisions under ADR-0018 and require a reviewed chain-preserving design before implementation. The current append-only trigger provides no erasure exception.

## Alternatives considered

| Option                                               | Why not                                                                                                                     |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Application-side sequence and hash                   | Concurrent writers can race, and the application role would need direct table writes.                                       |
| Unchained append-only rows                           | A missing or reordered historical row would not be apparent to a verifier.                                                  |
| Store the request body as an audit argument          | It would create a long-lived copy of personal data and secrets unrelated to the audit purpose.                              |
| Global runtime role with RLS bypass for verification | It would break the tenant boundary used throughout P06.                                                                     |
| Enumerate `audit_heads` for the daily sweep          | A deleted head row would remove that tenant from the worklist, so the sweep would skip a tampered chain and report success. |
| Let the verifier read `organisations` directly       | Measured as impossible without `BYPASSRLS`: FORCE RLS hides the table from its own owner when no tenant is set.             |
| Scan audit arguments for personal-data patterns only | Patterns find an email and miss a surname. The structural rule — no non-UUID strings — needs no prediction of shape.        |
| Fill the register from `provision_tenant`            | A migration or repair script can also create a tenant, and those are the paths that forget a bookkeeping step.              |

## Consequences

- Writes on one tenant are serialized at that tenant's chain head. The sequence is gap-free for committed events.
- Adding a new argument requires a reviewed schema row and a value-kind decision. Empty arguments work by default.
- The audit append must be called in the same transaction as each business mutation. Infrastructure alone cannot prove that every future caller does so; mutation-level tests and review remain necessary.
- Long chains require paged verification. Both the tenant sweep and each chain walk are paged, and the claim function caps a page at 1000 however much the caller asks for.
- A privileged database administrator remains in the trust boundary until external anchoring exists. A clean verifier run is therefore evidence, not proof, and the runbook says so.
- Every tenant that has ever existed keeps a register row, including a terminated one. Erasure that would remove it needs the chain-preserving design ADR-0018 owns; the append-only trigger has no erasure exception today.
- The daily _trigger_ and the CloudWatch alarms that match the emitted lines are Terraform-managed (P05/P15) and are not yet provisioned. Until they are, the sweep is run manually and P06.10.05 is not complete.
- Retention and erasure may require a future superseding ADR once counsel confirms the policy.

## Verification

| Enforcement                                                                 | Where                                                                                                                |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| FORCE RLS, runtime privileges, function owner/path/grants                   | `scripts/check-rls-catalog.ts`; real-PostgreSQL audit integration tests                                              |
| Writer remains SECURITY DEFINER; append-only trigger is present and enabled | `scripts/check-rls-catalog.ts`; defective-catalog fixtures                                                           |
| Concurrent sequence, provisioning audit and rollback                        | `packages/db/src/audit.integration.test.ts`, `packages/db/src/provisioning.integration.test.ts`                      |
| Restricted argument keys and values, sample personal-data scan              | `packages/db/src/audit.integration.test.ts`                                                                          |
| Chain gap, changed event and missing tail detection                         | `packages/db/src/audit.ts`; real-PostgreSQL tamper fixtures                                                          |
| Tenant register filled by trigger, append-only, not readable unelevated     | `packages/db/migrations/0010_audit_chain_verification.sql`; `packages/db/src/audit-verification.integration.test.ts` |
| Register guard, registration trigger and claim function in the catalog      | `scripts/check-rls-catalog.ts`; `scripts/check-rls-catalog.integration.test.ts`                                      |
| Daily sweep: every tenant walked, break and gap distinguished from sound    | `packages/db/src/audit-verification.ts`; `packages/db/src/audit-verification.integration.test.ts`                    |
| Alarm severity, runbook link, exit-code split, no personal data on the log  | `packages/db/src/cli.ts`; `packages/db/src/cli-verify-audit.integration.test.ts`                                     |
| Stored arguments carry no unreviewed or personal value                      | `scripts/check-audit-arguments.ts`; `scripts/check-audit-arguments.integration.test.ts`                              |
| Daily schedule and CloudWatch alarm provisioning                            | **Not done.** Terraform (P05/P15), founder-owned; P06.10.05 stays open on it                                         |
