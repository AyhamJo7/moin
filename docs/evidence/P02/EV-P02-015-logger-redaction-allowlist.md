# EV-P02-015: Pino logger with an allowlist redactor and correlation IDs (INV-12)

| Field | Value |
|---|---|
| Evidence ID | EV-P02-015 |
| Item | P02.03.04 |
| Date (UTC) | 2026-09-28 12:29 UTC |
| Commit | `f3065928572a2c60d699f2fb26e1e60dec550be3` (working tree had uncommitted changes) |
| Environment | local (vitest 5.0.2) + arm64 container |
| Command / procedure | packages/observability: createLogger() routes every line through redactToAllowlist() in pino formatters.log, so no structured field can reach an appender unclassified. Correlation travels in AsyncLocalStorage (withRequestContext). 8 tests pass: allowlisted operational fields pass through; phone, email, callerName, address and transcript are redacted; an unclassified field is redacted (the failure mode of forgetting is a redaction, not a leak); nested objects and arrays are redacted; an error keeps type and stack but never its message; deep nesting terminates; and no field naming a person, number or message content is allowlisted. Container log line observed: {"level":30,"time":...,"service":"moin","role":"api","env":"production","route":"/healthz","statusCode":200,"msg":"server listening"} — only allowlisted fields. |
| Result | PASS — 8/8. The tests found two real leaks in the first implementation: "name" was allowlisted (pinos logger name, which collides with a persons name), and a V8 stack trace begins with "<Name>: <message>", so logging err.stack reintroduced exactly the message that is withheld. Both were fixed; the stack is now filtered to call frames only. |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).
