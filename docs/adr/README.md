# Architecture Decision Records

A decision is recorded here when it is **expensive to reverse** and someone six months from now
would otherwise have to reconstruct the reasoning from the code. Not every choice needs one;
`.dependency-cruiser.cjs` and the lint rules already encode plenty. An ADR earns its place when the
alternatives were real and the reason for rejecting them is not obvious from the result.

`PLAN.md`'s [ADR register](../../PLAN.md) is authoritative for which decisions exist and which
phase accepts each. Numbers are never reused.

## Status

| Status                   | Meaning                                                                          |
| ------------------------ | -------------------------------------------------------------------------------- |
| `PROPOSED`               | Written, not yet binding. Code may not rely on it.                               |
| `ACCEPTED`               | Binding. Code is expected to follow it, and something automated enforces it.     |
| `SUPERSEDED by ADR-nnnn` | Replaced. Kept, never deleted — the reasoning is still why the successor exists. |
| `DEFERRED`               | Deliberately postponed, with the trigger that would revive it.                   |

An ADR is never edited to change its decision. It is superseded, because the record of what was
believed and why is the point.

## Every ADR names its enforcement

`docs/adr/TEMPLATE.md` has a **Verification** section, and it is not optional (P03.01.04). A
decision nobody checks is a decision that drifts: the lint rule, CI check, runtime assertion, test
or alarm that holds it true is named in the ADR itself, so a reviewer can tell whether a change
violates it without reading thirty phases of code.

`scripts/check-adr-coverage.ts` asserts that every invariant has at least one ADR and every ADR
names an enforcement.

## Index

| ADR                                                 | Title                               | Status                  | Phase     |
| --------------------------------------------------- | ----------------------------------- | ----------------------- | --------- |
| [0001](0001-modular-monolith-and-process-roles.md)  | Modular monolith and process roles  | ACCEPTED                | P03       |
| [0002](0002-toolchain-and-runtime-baseline.md)      | Toolchain and runtime baseline      | ACCEPTED                | P02       |
| [0003](0003-tenant-isolation.md)                    | Tenant isolation                    | ACCEPTED                | P03       |
| [0004](0004-data-access-and-migrations.md)          | Data access and migrations          | ACCEPTED                | P03       |
| [0005](0005-identity-sessions-and-rbac.md)          | Identity, sessions and RBAC         | ACCEPTED                | P03       |
| [0006](0006-api-contract-and-error-model.md)        | API contract and error model        | ACCEPTED                | P03       |
| [0007](0007-events-outbox-inbox-ordering.md)        | Events, outbox/inbox, ordering      | ACCEPTED                | P03       |
| [0008](0008-jobs-queues-and-timers.md)              | Jobs, queues and timers             | ACCEPTED                | P03       |
| [0009](0009-realtime.md)                            | Realtime                            | ACCEPTED                | P03       |
| [0010](0010-telephony-architecture.md)              | Telephony architecture              | PROPOSED (needs DG-01)  | P04 → P11 |
| [0011](0011-dialogue-manager-and-response-types.md) | Dialogue manager and response types | PROPOSED                | P03 → P12 |
| [0012](0012-ai-gateway-and-provider-strategy.md)    | AI gateway and provider strategy    | PROPOSED (needs DG-01)  | P04 → P10 |
| [0015](0015-business-action-model.md)               | Business action model               | ACCEPTED                | P03       |
| [0017](0017-audit-architecture.md)                  | Tenant audit architecture           | PROPOSED                | P06       |
| [0018](0018-retention-and-deletion.md)              | Retention and deletion              | PROPOSED                | P03 → P16 |
| [0019](0019-turn-logs-and-transcripts.md)           | Turn logs and transcripts           | PROPOSED (needs EXT-02) | P03 → P16 |
| [0020](0020-integration-credential-storage.md)      | Integration credential storage      | ACCEPTED                | P03       |
| [0034](0034-naming-and-brand-decoupling.md)         | Naming and brand decoupling         | ACCEPTED                | P02       |
| [0044](0044-local-s3-emulator.md)                   | Local S3 emulator                   | ACCEPTED                | P02       |
| [0045](0045-local-oidc-provider.md)                 | Local OIDC provider                 | ACCEPTED                | P02       |

The remaining numbers in the register belong to later phases and have no file yet.
