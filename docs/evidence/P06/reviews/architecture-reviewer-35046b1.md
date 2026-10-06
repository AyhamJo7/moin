# architecture-reviewer — QG-09 review at 35046b1 (Step-up MFA ≤ 15 min for sensitive actions)

| Field | Value |
|---|---|
| Reviewer role | architecture-reviewer |
| Implementation SHA | `35046b1b87dda2c8af8ccf4fefbe8e29d86b48df` (full 40-char; branch `feat/p06-06-step-up-mfa`, base `48a551d846f9bf6ba5838abc6f0d321f6aefdd8a`) |
| Scope reviewed | Migration 0015 expand/contract compatibility (INV-17), NestJS guard architecture, `RequestContextService` cache bounds, RLS catalog definer allowlist, readiness health probes. |
| Verdict | OK TO MERGE |

## Findings

- H1 closed: 6-argument `app.begin_sign_in` overload retained in `0015_step_up_mfa.sql` alongside new 7-argument signature, delegating with default `NULL::uuid`. Eliminates rolling-deployment 500 errors during fleet upgrade. Contracted dropping scheduled for migration 0016.
- M1 closed: `RequestContextService` bounds cached read verdicts by `stepUpExpiresAtMs = stepUpAt + 15m`. Tested and mutation-proven (`SU9` killed assertion). Unstamped reads remain cacheable across the 30-second window.
- RLS catalog verification (`scripts/check-rls-catalog.ts`) and `/readyz` probe (`packages/db/src/readiness.ts`) updated with distinct function collapsing, verifying exactly the required session definers without false positive alerts.
- Modular integration in `IdentityAccessModule` maintains clean domain/application/http layering without leaking persistence details.

## Dispositions

- Nothing blocks merge.
