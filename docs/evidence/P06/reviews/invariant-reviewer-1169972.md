# invariant-reviewer — QG-09 review at 1169972 (final: N1 closed, I2 follow-up)

| Field | Value |
|---|---|
| Reviewer role | invariant-reviewer |
| Implementation SHA | `1169972675554930bfc6aa5df7a6bcfc19dbd083` (full 40-char as tasked; test+manifest scope) |
| Scope reviewed | Entry points re-enumerated; slide-check behavior; bounded cache + mode union; 503/401 separation; M1 narrow check; H1 wiring for this PR scope. |
| Verdict | OK TO MERGE — NO BYPASS FOUND |

## Findings

- I1 (prior N1, slide ignored) CLOSED by behavior — refusal returns `invalid`, cache write strictly after, stubbed unit test genuinely covers the session-side race.
- I2 (membership predicate single-checked across two calls) LOW follow-up, NOT blocking — admitted org stays server-derived (never caller claim); cross-tenant barred by RLS + `withTenant`. Fix direction: fold the slide into `app.resolve_request_context` (single atomic call). Suggested P06.07-or-later hardening.

## Dispositions

- Nothing blocks on invariant grounds. Per-controller wiring noted as process follow-up (global guard with public allowlist).
