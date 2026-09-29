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

## Correction (2026-09-28, after the QG-09 review)

The result above claimed that "no structured field can reach an appender unclassified". **That was
wrong**, and the reason it read as true is instructive: every test asserted on
`redactToAllowlist` in isolation, and all three leaks were on paths that never call it.

A security and an architecture review, run in parallel, found three:

| # | Leak | Proven by |
|---|---|---|
| 1 | `logger.error(err)` put `err.message` into `msg`. pino appends the message key *after* `formatters.log` runs, so the exact string the `err` branch replaced with `[redacted]` was re-emitted verbatim — including a DSN with its password. | Running the repository's own `createLogger` and capturing stdout |
| 2 | `logger.child({ … })` bindings bypassed the redactor entirely. pino serialises child bindings once, at `child()` time, into a cached string. | Same |
| 3 | `err.type` was always `"Object"`, losing the error class, because `formatters.log` runs before pino's serializers and the default `err` serializer then re-derived the type from the redacted plain object. | Same |

The two reviews disagreed on the fix for (2): one proposed `formatters.bindings`, the other stated
that would not work. **Measured: it does not.** Adding that formatter alone still wrote
`logger.child({ phone }).info(…)` verbatim. The fix is to override `child` itself so every child
and grandchild redacts its bindings, which makes the safe path the only path rather than one a
lint rule has to remember to enforce. The first version of that override had its own bug — it
resolved `child` up the prototype chain and hit an ancestor's wrapper, so grandchildren silently
lost their parent's bindings — caught by a test written for exactly that.

`from` and `to` were also removed from the allowlist. In a telephony product they are the literal
Twilio webhook parameter names for the caller's and the callee's numbers, so
`logger.info({ from: call.from, to: call.to })` would have passed lint, passed every test and
shipped two phone numbers to the log aggregator. `hostname` was removed for the same class of
reason. Routing labels are now `channel`, `direction` and `queueName`, which cannot be mistaken
for a person.

**Amended result:** PASS. `packages/observability/src/logger.test.ts` adds 8 tests that assert on
the **serialised line** rather than on the redactor in isolation, covering all three leaks, the
grandchild-binding regression and the error class. Proven non-vacuous:
`mutation_check.py --fix-paths packages/observability/src/logger.ts packages/observability/src/redaction.ts`
→ **KILLED** (fails without the fix, passes with it).

