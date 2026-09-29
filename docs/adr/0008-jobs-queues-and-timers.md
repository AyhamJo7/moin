# ADR-0008 — Jobs, queues and timers

- **Status:** ACCEPTED (P03.01.02, 2026-09-29) · **Deciders:** founder · **Phase:** P03
- **Related:** ADR-0007, INV-11, INV-19

## Context

Two different needs get conflated. **Work to do now**: dispatch an outbox row, send a
notification, sync a calendar. And **work to do later**: escalate if nobody responds in 15 minutes,
send a reminder the day before, expire a slot hold.

They have different failure modes. Work-now needs throughput and retries. Work-later needs to
survive a restart and to fire once at roughly the right time, days later.

## Decision

**Work now: SQS standard queues with dead-letter queues.** Managed, at-least-once, with visibility
timeouts and redrive. Standard rather than FIFO for the general case, because FIFO's ordering costs
throughput and the system's effects are idempotent anyway (ADR-0007). One FIFO queue exists where
order genuinely matters: per-conversation events.

**Every job carries an envelope**: job type, idempotency key, tenant, correlation id, attempt
count, and the schema version of its payload. Attempt count is what distinguishes "retrying" from
"stuck", and schema version is what lets a payload format change without a queue drain.

**`job_runs` records every execution** — started, finished, outcome, error class. Without it, "did
that job run?" is unanswerable during an incident, which is exactly when it is asked.

**Replay is a first-class operation.** A DLQ message can be re-driven after the bug is fixed, and
because effects are idempotent, replaying a job that partly succeeded is safe.

**Work later: timer rows in PostgreSQL**, not queue delay. Claimed with
`SELECT … FOR UPDATE SKIP LOCKED` leases, swept by a scheduled sweeper.

SQS message delays cap at 15 minutes, and the product needs day-scale reminders. More importantly a
timer in a queue is invisible: it cannot be listed, cancelled when the task is completed early, or
inspected when a customer asks why they were not reminded. A row can be queried, cancelled and
explained.

`SKIP LOCKED` is what makes several workers safe to run without them fighting over the same rows.

## Alternatives considered

| Option                              | Why not                                                                                                                                                        |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **BullMQ / Redis-backed queues**    | Another stateful system to operate, with persistence guarantees that depend on the Redis configuration. Valkey is a cache here; losing it must not lose work.  |
| **EventBridge Scheduler per timer** | An AWS resource per timer, with account limits and no way to list "every timer for this tenant". Used for the _sweeper's_ schedule, not for individual timers. |
| **SQS delay for timers**            | Capped at 15 minutes, and an in-flight delayed message cannot be listed or cancelled.                                                                          |
| **`pg_cron` / `pg_boss`**           | Puts scheduling inside the database, coupling it to the RDS instance and its extensions, and makes the work invisible to the application's own observability.  |
| **FIFO queues everywhere**          | Throughput cost for a guarantee that only the conversation stream needs.                                                                                       |
| **Polling without `SKIP LOCKED`**   | Workers block on each other's rows; throughput collapses as workers are added.                                                                                 |

## Consequences

- Two mechanisms to understand instead of one. The split is along a real seam, and conflating them
  is what makes systems unable to answer "why was this not sent".
- The timer table needs an index on the due, unclaimed set, and a sweeper whose failure is alarmed —
  a sweeper that silently stops is a product that silently stops reminding people.
- Lease expiry must be longer than the slowest job it covers, or two workers run the same timer.
  Tested explicitly rather than tuned by observation.
- Job replay needs an operator path, which means the ops console (ADR-0037), not a database console.
- **This is the wrong call if** timer volume ever outgrows a table scan of due rows. The seam is the
  claim query, and partitioning by due date is the next step.

## Verification

| Enforcement                                       | Where                                                              |
| ------------------------------------------------- | ------------------------------------------------------------------ |
| Two workers never run the same timer              | Concurrency test with parallel claims under `SKIP LOCKED` (P08.04) |
| A job retried after a timeout produces one effect | Idempotency test with an injected timeout (INV-11)                 |
| A failed job reaches the DLQ and can be replayed  | Failure-injection suite (P08.03)                                   |
| A cancelled timer does not fire                   | Test: complete the task, assert the escalation timer does not run  |
| The sweeper stopping is noticed                   | Alarm on sweeper heartbeat age (P15)                               |
| Every execution is recorded                       | `job_runs` row asserted per job type                               |
