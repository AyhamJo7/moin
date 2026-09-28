# Domain event catalogue v1

Events are how modules learn what happened elsewhere without reading each other's tables.

**Every payload carries identifiers, never data** (ADR-0007). A consumer re-reads what it needs
inside its own tenant-scoped transaction. That keeps personal data out of queues and logs (INV-12),
keeps events small, and stops a consumer acting on a stale copy of something it could have read
fresh.

Naming is `module.aggregate.past_tense`. Past tense because an event is a fact that has already
happened — a name like `task.create` describes a command, and a consumer that can refuse it is
a bug.

## Fields every event carries

| Field                             | Why                                                   |
| --------------------------------- | ----------------------------------------------------- |
| `eventId`                         | Deduplication at the consumer                         |
| `eventType`                       | Routing                                               |
| `schemaVersion`                   | A payload shape can change without draining the queue |
| `organisationId`                  | The consumer's tenant scope; never inferred           |
| `aggregateId`, `aggregateVersion` | What it is about, and at which version                |
| `occurredAt`                      | When it happened, not when it was dispatched          |
| `correlationId`                   | Ties it to the request that caused it                 |

## Catalogue

### `tenancy`

| Event                                        | Consumers                     |
| -------------------------------------------- | ----------------------------- |
| `tenancy.organisation.provisioned`           | billing, knowledge, policy    |
| `tenancy.organisation.suspended`             | voice, notifications, billing |
| `tenancy.organisation.termination_requested` | privacy, billing              |
| `tenancy.location.added`                     | knowledge, scheduling         |

### `identity-access`

| Event                             | Consumers                                                              |
| --------------------------------- | ---------------------------------------------------------------------- |
| `identity.membership.granted`     | notifications, audit                                                   |
| `identity.membership.revoked`     | notifications, audit — sessions are killed synchronously, not by event |
| `identity.support_access.granted` | audit, notifications (the customer is told)                            |

`identity.membership.revoked` is a notification, not the revocation itself. Revoking access
eventually would defeat the purpose (ADR-0005).

### `conversations`

| Event                                  | Consumers                               |
| -------------------------------------- | --------------------------------------- |
| `conversations.call.received`          | work, assistant                         |
| `conversations.call.answered`          | — (metrics)                             |
| `conversations.call.ended`             | work, billing (usage)                   |
| `conversations.call.failed`            | work — **must produce a task** (INV-19) |
| `conversations.conversation.finalised` | work, knowledge                         |
| `conversations.message.received`       | assistant, work                         |

### `work`

| Event                              | Consumers                 |
| ---------------------------------- | ------------------------- |
| `work.task.created`                | notifications             |
| `work.task.assigned`               | notifications             |
| `work.task.completed`              | — (metrics)               |
| `work.task.escalated`              | notifications             |
| `work.lead.state_changed`          | — (metrics)               |
| `work.appointment_request.created` | notifications, scheduling |
| `work.appointment.confirmed`       | notifications, contacts   |
| `work.slot_hold.expired`           | notifications             |

### `knowledge`

| Event                         | Consumers                                 |
| ----------------------------- | ----------------------------------------- |
| `knowledge.item.approved`     | assistant (retrieval cache)               |
| `knowledge.item.retired`      | assistant                                 |
| `knowledge.item.expired`      | work — raises an `approve_knowledge` task |
| `knowledge.conflict.detected` | work                                      |

### `assistant`

| Event                                | Consumers                                                          |
| ------------------------------------ | ------------------------------------------------------------------ |
| `assistant.action.proposed`          | — (eval, metrics)                                                  |
| `assistant.action.rejected_by_guard` | work, audit — a rejected tool call is a signal, not a silent retry |
| `assistant.approval.requested`       | notifications                                                      |
| `assistant.uncertainty.escalated`    | work                                                               |

### `integrations`

| Event                                 | Consumers                                    |
| ------------------------------------- | -------------------------------------------- |
| `integrations.connection.established` | work                                         |
| `integrations.connection.failed`      | work — raises a `reconnect_integration` task |
| `integrations.credentials.expired`    | work, notifications                          |

### `billing`

| Event                          | Consumers                           |
| ------------------------------ | ----------------------------------- |
| `billing.usage.recorded`       | — (the ledger is the truth, INV-20) |
| `billing.subscription.changed` | tenancy (entitlements)              |
| `billing.payment.failed`       | notifications, tenancy              |

### `privacy`

| Event                       | Consumers                            |
| --------------------------- | ------------------------------------ |
| `privacy.dsar.requested`    | every module with an erasure handler |
| `privacy.erasure.completed` | audit                                |
| `privacy.retention.swept`   | — (metrics)                          |

## Rules

1. **Identifiers only.** No name, number, address, message content or transcript fragment in a
   payload. Asserted by a schema test (INV-12).
2. **Past tense.** An event is a fact. A consumer may not refuse it.
3. **Ordering is per aggregate.** Global ordering is not offered; where order matters, a FIFO queue
   keyed by the aggregate provides it.
4. **At-least-once delivery.** Every consumer is idempotent on `eventId` (INV-11).
5. **A new consumer needs no producer change.** If it does, the event is shaped wrong.
6. **Adding a field is a minor version; removing or repurposing one is a new event type.** The old
   type stays until nothing consumes it — the same expand/contract rule as migrations.

## Verification

| Enforcement                                         | Where                                                                                             |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Payloads are id-only                                | Schema test over every event definition in `packages/contracts` (INV-12)                          |
| Every event type is declared before it is published | The publisher takes a typed event; an undeclared type does not compile                            |
| Consumers are idempotent                            | Concurrency suite: deliver the same `eventId` twice, assert one effect (INV-11)                   |
| A failed call produces a task                       | Failure-injection test (INV-19)                                                                   |
| No orphan events                                    | A test asserts every declared type has at least one consumer or is explicitly marked metrics-only |
