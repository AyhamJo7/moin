# architecture-reviewer — QG-09 review at b126af4 (Step-up MFA ≤ 15 min, final round)

| Field | Value |
|---|---|
| Reviewer role | architecture-reviewer |
| Implementation SHA | `b126af4e6fc97d5302d07570035ca0d36dca19da` (full 40-char; branch `feat/p06-06-step-up-mfa`, base `48a551d846f9bf6ba5838abc6f0d321f6aefdd8a`) |
| Scope reviewed | Final-round residuals M1/L1/L2: readiness cross-schema widening + foreign-definer regression test, `STEP_UP_WINDOW_MS` drift-pin test, migrate-first deploy-order header in 0015. Lock-order acyclicity, 42P13 ordering, single-`v_now` verdict preserved. |
| Verdict | OK TO MERGE |

## Findings

- M1 closed: readiness counts every executable DEFINER across schemas (DISTINCT collapse, `total = 7`); foreign-schema backdoor test proves the failure mode.
- L1 closed: drift-pin test ties the TS constant to the SQL `interval '15 minutes'`; authority documented as DB clock.
- L2 closed: migrate-first-then-roll order + expected old-host unready recorded in the 0015 header.
- No new layering or migration issue: single-resolve guard (no TOCTOU), expand-only columns, grants re-asserted, overload-aware catalog.

## Dispositions

- Nothing blocks merge.
