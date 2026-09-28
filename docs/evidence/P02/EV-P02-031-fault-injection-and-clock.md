# EV-P02-031: Fault-injection helpers and a controllable clock

| Field | Value |
|---|---|
| Evidence ID | EV-P02-031 |
| Item | P02.05.05 |
| Date (UTC) | 2026-09-28 16:33 UTC |
| Commit | `6f79b0ec3c236853dc3021d5ad9a4eab7ae9612a` (working tree had uncommitted changes) |
| Environment | local |
| Command / procedure | packages/testing/src/fault/inject.ts provides withFault (a fault kind plus an optional failTimes, so a provider that fails twice and then succeeds can be modelled — a helper that always fails only proves the error branch exists, never that the retry path recovers or that recovering duplicates a side effect), neverSettles (for proving a caller applies its own deadline: code awaiting a provider without one holds a connection, a queue slot or a call open until something else gives up) and slow. Kinds cover timeout, rate-limited, server-error, malformed-response, connection-reset, expired-credentials, partial-success and unknown-outcome. The controllable clock is fixedClock in @moin/kernel, deliberately not in the test package, because production code depends on the Clock interface and a test package must never become a production dependency. 5 fault tests plus 4 clock tests. |
| Result | PASS — 9/9. |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).
