# EV-P03-002: Ten core ADRs accepted

| Field | Value |
|---|---|
| Evidence ID | EV-P03-002 |
| Item | P03.01.02 |
| Date (UTC) | 2026-09-28 17:18 UTC |
| Commit | `90b3b4158bd11348b5048afff0034f0d290cebd5` (working tree had uncommitted changes) |
| Environment | local |
| Command / procedure | ADR-0001 (modular monolith and process roles), 0003 (tenant isolation), 0004 (data access and migrations), 0005 (identity, sessions and RBAC), 0006 (API contract and error model), 0007 (events, outbox/inbox, ordering), 0008 (jobs, queues and timers), 0009 (realtime), 0015 (business action model), 0020 (integration credential storage). Each states the failure it prevents rather than the pattern it follows, and each records the alternatives with the reason they were rejected — including the ones that are genuinely reasonable, such as KMS envelope encryption in Postgres for ADR-0020, which is kept with an explicit revisit trigger (roughly 2,000 secrets) instead of being dismissed. |
| Result | PASS — 10 accepted. PLAN L2180 also lists ADR-0036 for P03, but the ADR register assigns ADR-0036 to time, locale and calendars in P07. Proceeding on the register, which is the more specific statement; recorded as open question Q1 in the phase plan rather than resolved silently. |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).
