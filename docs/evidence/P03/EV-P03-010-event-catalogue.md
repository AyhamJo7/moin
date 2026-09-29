# EV-P03-010: Domain event catalogue v1: names, id-only payloads, producers and consumers

| Field | Value |
|---|---|
| Evidence ID | EV-P03-010 |
| Item | P03.02.05 |
| Date (UTC) | 2026-09-28 23:09 UTC |
| Commit | `906b56850bb346db6642e094b217e86640696239` (working tree had uncommitted changes) |
| Environment | local |
| Command / procedure | Around 40 events across nine modules, named module.aggregate.past_tense — past tense because an event is a fact that has already happened, and a consumer that can refuse it is a bug. Every payload carries identifiers only, never data, so a consumer re-reads what it needs inside its own tenant-scoped transaction: this keeps personal data out of queues and logs (INV-12) and stops a consumer acting on a stale copy. Six rules are stated, including that adding a field is a minor version while removing or repurposing one is a new event type, with the old type kept until nothing consumes it — the same expand/contract rule as migrations. |
| Result | PASS. One event is explicitly documented as a notification rather than the mechanism: identity.membership.revoked tells other modules, but session revocation itself is synchronous, because revoking access eventually would defeat the purpose (ADR-0005). |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).
