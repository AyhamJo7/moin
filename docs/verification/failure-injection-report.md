# Failure-injection report (P08.11.03, EV-P08-011)

Updated 2026-11-22 (ROADMAP A1). The worker-side faults now run against the production job consumer, real PostgreSQL as `moin_app` and a real SQS-compatible emulator, in `apps/server/src/modules/platform/job-consumer.integration.test.ts`. The first version of this report (2026-10-13) ran them against the superseded `platform/worker.ts` loop with stubbed transports and an in-test idempotency guard. That loop is deleted, and so are those cases. The limiter case stays a unit test in `fault-injection.test.ts`.

Each row says what its test proves. Where the FS scenario asks for more, the row says **partial**, and the rest is listed under "Still open".

| #   | Injected fault (P08.11.01)                       | What the test proves                                                                                                                                                | Coverage | Test                                                                                               |
| --- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------- |
| 1   | Duplicate delivery (one message three times)     | Worker side of FS-01: one effect, one attempt, queue empty                                                                                                          | partial  | `duplicate deliveries of one message do not repeat the effect`                                     |
| 2   | Delayed delivery (a copy held back at the queue) | A copy that surfaces after the job finished is acknowledged and deleted; one effect, one attempt, nothing dead-lettered                                             | partial  | `a copy delivered late is acknowledged without a second effect`                                    |
| 3   | Two workers racing one job                       | FS-10: each worker has one slot; while the first holds the job inside its handler, the second receives copies and does not run it; one run, one effect, queue empty | full     | `two workers racing on one logical job create one effect`                                          |
| 4   | Delete rejected after the commit                 | Worker side of FS-18: the queue refuses the delete, the copy is redelivered, finds the job done, and adds no second effect                                          | partial  | `a crash after the commit and before the delete does not repeat the effect`                        |
| 5   | Database connection lost before the commit       | Database side of FS-18: the backend is terminated mid-job; no effect behind; the message returns after its visibility timeout and completes once                    | partial  | `a crash before the commit leaves the message for redelivery and no effect behind`                 |
| 6   | Handler failure mid-job (a thrown error)         | The failure is recorded (`handler-error`, attempt 1), the effect rolls back, and the message is hidden for the backoff; redelivery is not asserted                  | partial  | `a handler failure is recorded and the message is hidden for the backoff`                          |
| 7   | Backlog larger than the consumer's slots         | Worker side of FS-14: at most two jobs run at once, a third starts only when a slot frees, and all jobs drain with one effect each and nothing lost                 | partial  | `a backlog runs within the concurrency limit`, `a backlog drains without loss, one effect per job` |
| 8   | Valkey outage                                    | The limiter fails closed when its `RateStore` fails (P08.09.01)                                                                                                     | partial  | `fault-injection.test.ts`                                                                          |

## Still open

These stay open in P08.11 until a test proves them. None is claimed by this report.

- **FS-01, callback path:** out-of-order Twilio callbacks produce one call, one outcome, one usage record and one notification set, with no state regression (S4 for calls, N1 for notifications).
- **Delayed delivery, scheduled jobs:** the first delivery of a job after its scheduled time in the ledger (`job_runs.not_before`).
- **Database failover:** a primary failover, as opposed to one killed backend, and a database error retried to completion under the retry policy.
- **FS-18, process death:** a worker process killed mid-job, and the replay of a side effect committed outside the job's own transaction (the chaos test, A1d). In rows 4 and 5 the worker stays alive and the fixture effect commits with the job ledger.
- **FS-14, beyond the worker:** the oldest-message alarm fires at five minutes (T1), workers autoscale (infrastructure), voice capture continues during the backlog, and notifications arrive in priority order without loss (N1).
- **Valkey outage, SSE:** a connected SSE client switches to polling (A2).

Prior-slice evidence this report builds on: EV-P08-002 (outbox crash-republish), EV-P08-003 (inbox 3× one-effect), EV-P08-004 (idempotency replay/422), EV-P08-005 (worker retry/DLQ/poison), EV-P08-008 (SSE fallback), EV-P08-009 (limiter fallback), EV-P08-012 (job consumer).
