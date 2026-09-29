# ADR-0007 — Events, outbox/inbox and ordering

- **Status:** ACCEPTED (P03.01.02, 2026-09-29) · **Deciders:** founder · **Phase:** P03
- **Related:** ADR-0008, INV-06, INV-10, INV-11

## Context

Almost everything the product does has an effect outside its own transaction: notify the owner,
book a slot, send an email, meter usage for billing. Each one raises the same question — what
happens when the database commit succeeds and the effect does not, or the effect succeeds and the
commit does not.

The failure that matters most is the quiet one: a caller was told "I have noted that" and no task
exists (INV-06).

## Decision

**Transactional outbox.** A business mutation and the event that announces it are written **in the
same transaction**. A separate dispatcher reads the outbox and performs the effect. If the
transaction rolls back, the event was never written; if the dispatcher crashes, the row is still
there.

This is the only arrangement where "the task exists" and "the owner will be told" cannot disagree.
Publishing to a queue inside the transaction can succeed while the transaction rolls back;
publishing after it can be lost if the process dies in between.

**Inbox deduplication on the provider's event id.** Twilio, Stripe and Google all redeliver. Every
inbound provider event is recorded by its own id before it is processed, and a repeat is ignored.
Without this, a redelivered webhook books a second appointment.

**Per-aggregate version checks.** Each aggregate carries a version; a write asserts the version it
read. Two concurrent edits to the same task do not silently overwrite each other — the second
fails and retries against fresh state.

**Effects are exactly-once through idempotency, not through delivery.** Delivery is at-least-once
and always will be. Every effect carries an idempotency key derived from the event, so a second
delivery of the same event produces no second effect (INV-11).

**Ordering is per aggregate, not global.** A global order is a single point of contention for a
guarantee almost nothing needs. Where order genuinely matters — the turns of one conversation — a
FIFO queue keyed by the conversation provides it.

**Event payloads carry identifiers, not data.** A consumer re-reads what it needs inside its own
tenant-scoped transaction. This keeps personal data out of queues and logs (INV-12), keeps events
small, and means a consumer cannot act on a stale copy.

## Alternatives considered

| Option                                          | Why not                                                                                                                            |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **Publish to the queue inside the transaction** | The publish can succeed and the transaction roll back, producing an event for something that never happened.                       |
| **Publish after commit, in process**            | Lost if the process dies between commit and publish — and that gap is exactly when a deploy restarts it.                           |
| **Change data capture (Debezium)**              | Gives the same guarantee and adds Kafka or equivalent, plus schema coupling to physical tables. The outbox gets it with one table. |
| **Two-phase commit**                            | Not available across PostgreSQL and an HTTP provider, and operationally miserable where it is.                                     |
| **A global event order**                        | A single point of contention for a guarantee only the conversation stream needs.                                                   |
| **Fat event payloads**                          | Personal data in queues and logs (INV-12), and consumers acting on stale copies.                                                   |

## Consequences

- Every effect needs an idempotency key and every consumer must tolerate redelivery. Uniform, so it
  is one pattern rather than a judgement per consumer.
- The outbox table is a hot path: written by every mutation, polled by the dispatcher. It needs an
  index on the undispatched set and a retention policy.
- Debugging spans two steps — the mutation and the dispatch. The correlation id ties them together,
  which is why it is populated from the first request rather than retrofitted.
- Eventual consistency between a mutation and its effect, bounded by dispatcher latency. The owner
  app shows the mutation immediately; the notification follows.
- **This is the wrong call if** an effect ever needs to be synchronous with its transaction from the
  caller's point of view. That effect belongs inside the request, not in the outbox.

## Verification

| Enforcement                                        | Where                                                                                   |
| -------------------------------------------------- | --------------------------------------------------------------------------------------- |
| The event is written in the mutation's transaction | Integration test: roll back the mutation, assert no outbox row (P08.01)                 |
| Redelivery produces one effect                     | Concurrency suite: dispatch the same event twice, assert one effect (INV-11)            |
| Provider redelivery is deduplicated                | Inbox test per provider with a replayed webhook id                                      |
| Concurrent writes do not silently overwrite        | Property test on aggregate version conflicts                                            |
| No personal data in an event payload               | Schema test: event payloads are id-only, asserted against the contract schemas (INV-12) |
| No interaction is lost                             | Reconciler: every conversation ends in an outcome or an open task (INV-06)              |
