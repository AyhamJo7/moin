# Failure-injection report (P08.11.03, EV-P08-011)

Updated 2026-11-22 (ROADMAP A1). The worker-side faults now run against the production job consumer, real PostgreSQL as `moin_app` and a real SQS-compatible emulator, in `apps/server/src/modules/platform/job-consumer.integration.test.ts`. The first version of this report (2026-10-13) ran them against the superseded `platform/worker.ts` loop with stubbed transports and an in-test idempotency guard. That loop is deleted, and so are those cases. The limiter and SSE outage case stays a unit test in `fault-injection.test.ts`.

| #   | Injected fault (P08.11.01)                    | Expected FS behaviour                                             | Test                                                                                        |
| --- | --------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| 1   | Duplicate delivery (same message three times) | FS-01: one effect, one attempt, queue empty                       | `duplicate deliveries of one message do not repeat the effect`                              |
| 2   | Two workers racing one job                    | FS-10: the handler runs once, one effect                          | `two workers racing on one logical job create one effect`                                   |
| 3   | Crash after the commit, before the delete     | FS-18: the redelivery finds the job done, no second effect        | `a crash after the commit and before the delete does not repeat the effect`                 |
| 4   | Crash before the commit (backend killed)      | FS-18: no effect behind, the redelivery completes it once         | `a crash before the commit leaves the message for redelivery and no effect behind`          |
| 5   | Transient failure mid-handler                 | Retried under the policy, hidden for the backoff, not the DLQ     | `a transient failure is retried under the policy and the message is hidden for the backoff` |
| 6   | Backlog larger than the consumer's slots      | FS-14: drains completely, one effect per job, nothing lost        | `a backlog drains without loss, one effect per job`                                         |
| 7   | Valkey outage                                 | SSE polls the store (P08.08.03); limiter fails closed (P08.09.01) | `fault-injection.test.ts`                                                                   |

FS-14's alarm on the age of the oldest message is an alarm definition, not consumer behaviour. It belongs to T1 (alarm definitions as code) and is not claimed here. A late delivery is not a separate case: the consumer reads no expiry from the envelope except `notBefore`, so any delivery processes as in case 1.

Prior-slice evidence this report builds on: EV-P08-002 (outbox crash-republish), EV-P08-003 (inbox 3× one-effect), EV-P08-004 (idempotency replay/422), EV-P08-005 (worker retry/DLQ/poison), EV-P08-008 (SSE fallback), EV-P08-009 (limiter fallback), EV-P08-012 (job consumer).
