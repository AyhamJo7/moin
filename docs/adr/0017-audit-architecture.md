# ADR-0017 — Tenant audit architecture

- **Status:** PROPOSED (founder acceptance pending)
- **Deciders:** founder
- **Phase:** P06
- **Related:** ADR-0003, ADR-0018, INV-01, INV-10, INV-12, QG-09

## Context

Every business mutation must leave an ordered, tenant-scoped record that a later reviewer can inspect. Application code also needs to record rejected actions and security events without writing raw request bodies, credentials or contact details into a durable audit trail. Tenant isolation and FORCE RLS apply to audit records as they do to other tenant data.

## Decision (draft)

An audit append and the business mutation it describes run in one tenant transaction. Provisioning precedes an application tenant session, so its global request insert triggers the audit append after the provisioning function sets transaction-local tenant context. The runtime role has SELECT but no direct INSERT, UPDATE, DELETE or TRUNCATE grant on `audit_events` or `audit_heads`. A reviewed `SECURITY DEFINER` function checks a fixed operation and argument policy, locks the tenant head, allocates the next sequence, hashes the previous hash with a canonical payload, inserts the event and advances the head in that transaction. A trigger rejects UPDATE and DELETE even by the table owner. The function has an exact QG-09 allowlist entry, a pinned search path and no dynamic SQL.

The stored payload uses explicit typed fields and opaque identifiers. Operation-specific argument keys must be registered with a constrained value kind; an unknown key fails closed. Query and verification APIs always execute under tenant RLS. A daily verifier should traverse each tenant chain and alarm on a gap or mismatch. Until an external immutable anchor is implemented, a privileged actor able to rewrite both events and head can forge a consistent replacement chain; the current chain detects accidental corruption and unauthorised runtime mutation, not that attack.

Pseudonymisation and retention are separate decisions under ADR-0018 and require a reviewed chain-preserving design before implementation. The current append-only trigger provides no erasure exception.

## Alternatives considered

| Option                                               | Why not                                                                                        |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Application-side sequence and hash                   | Concurrent writers can race, and the application role would need direct table writes.          |
| Unchained append-only rows                           | A missing or reordered historical row would not be apparent to a verifier.                     |
| Store the request body as an audit argument          | It would create a long-lived copy of personal data and secrets unrelated to the audit purpose. |
| Global runtime role with RLS bypass for verification | It would break the tenant boundary used throughout P06.                                        |

## Consequences

- Writes on one tenant are serialized at that tenant's chain head. The sequence is gap-free for committed events.
- Adding a new argument requires a reviewed schema row and a value-kind decision. Empty arguments work by default.
- The audit append must be called in the same transaction as each business mutation. Infrastructure alone cannot prove that every future caller does so; mutation-level tests and review remain necessary.
- Long chains require paged verification and an eventual scheduled alarm. A privileged database administrator remains in the trust boundary until external anchoring exists.
- Retention and erasure may require a future superseding ADR once counsel confirms the policy.

## Verification

| Enforcement                                                    | Where                                                                                           |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| FORCE RLS, runtime privileges, function owner/path/grants      | `scripts/check-rls-catalog.ts`; real-PostgreSQL audit integration tests                         |
| Concurrent sequence, provisioning audit and rollback           | `packages/db/src/audit.integration.test.ts`, `packages/db/src/provisioning.integration.test.ts` |
| Restricted argument keys and values, sample personal-data scan | `packages/db/src/audit.integration.test.ts`                                                     |
| Chain gap, changed event and missing tail detection            | `packages/db/src/audit.ts`; real-PostgreSQL tamper fixtures                                     |
| Daily verifier and alarm                                       | P06.10.05 pending scheduling and alert integration                                              |
