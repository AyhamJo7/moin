# EV-P02-016: /healthz and /readyz per role, with a leak-proof readiness probe

| Field | Value |
|---|---|
| Evidence ID | EV-P02-016 |
| Item | P02.03.05 |
| Date (UTC) | 2026-09-28 12:29 UTC |
| Commit | `f3065928572a2c60d699f2fb26e1e60dec550be3` (working tree had uncommitted changes) |
| Environment | local + arm64 container |
| Command / procedure | Liveness and readiness are deliberately separate: /healthz checks nothing external, because a liveness probe that queried the database would restart every container during a database blip; /readyz checks dependencies so an instance leaves the load balancer without being killed. Verified in the arm64 container with no database reachable: GET /healthz -> {"status":"ok","role":"api"} HTTP 200; GET /readyz -> {"status":"not_ready","role":"api","checks":[{"name":"postgres","ready":false,"durationMs":11,"reason":"connection refused"}]} HTTP 503. 4 packages/db tests pass: not ready when unreachable; the reason never contains the connection string, host, user or password; the reason comes from a fixed vocabulary rather than the driver message; the probe returns within its deadline. |
| Result | PASS. /readyz is unauthenticated, so the reason vocabulary is fixed and nothing from the driver error text is passed through (INV-12, INV-15). An early version made the probe timeout and the driver timeout equal, which meant every specific reason was unreachable and the probe always said "timed out"; the deadlines are now staggered and "connection refused" is observed in the container. |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).
