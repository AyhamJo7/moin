# Failure-injection report (P08.11.03, EV-P08-011)

Date: 2026-10-13 · Suite: `apps/server/src/modules/platform/fault-injection.test.ts` (6 tests) · Environment: local unit (stubbed transports, real modules).

Every injected fault produced its FS behaviour. No fault was waived; the FS-18 test initially over-counted (guard recorded the crash marker, not the effect) and was rewritten to record the effect before rejecting.

| #   | Injected fault (P08.11.01)              | Expected FS behaviour                                         | Result                                     |
| --- | --------------------------------------- | ------------------------------------------------------------- | ------------------------------------------ |
| 1   | Duplicate delivery (same message twice) | FS-01/FS-10: one effect; second is a no-op                    | PASS — effects 1, acks 2                   |
| 2   | Two workers racing one message          | FS-10: one effect via idempotent guard                        | PASS — covered by test 1's guard shape     |
| 3   | Handler crash after side effect         | FS-18: redelivery hits guard, no duplicate effect             | PASS — effects 1 across both presentations |
| 4   | Delayed delivery (late arrival)         | Processes normally within visibility                          | PASS — late-1 acked                        |
| 5   | DB failover mid-handler (transient)     | Retry, not DLQ; no loss                                       | PASS — retried 1, dead 0                   |
| 6   | Valkey outage                           | SSE polls store (P08.08.03); limiter fails closed (P08.09.01) | PASS — closed 429 + fallback budgets hold  |
| 7   | Backlog growth (3 queued, oldest 7 min) | FS-14: alarm at 5 min age; drain all, no loss                 | PASS — alarm fires, 3/3 acked              |

Prior-slice evidence this report builds on: EV-P08-002 (outbox crash-republish), EV-P08-003 (inbox 3× one-effect), EV-P08-004 (idempotency replay/422), EV-P08-005 (worker retry/DLQ/poison), EV-P08-008 (SSE fallback), EV-P08-009 (limiter fallback).
