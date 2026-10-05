# invariant-reviewer — QG-09 review at 316caa6 (repair round: lock-wait path exercise)

| Field | Value |
|---|---|
| Reviewer role | invariant-reviewer |
| Implementation SHA | `316caa67ead125c6b8d1b87dfe6f2a8868a5f869` (full 40-char as tasked; test+manifest only) |
| Scope reviewed | Entry points re-enumerated (callback → `SignInService.complete` → `consume_sign_in`; resolve/rotate/revoke via `SessionService`; startup/readiness/catalog; retry/duplicate paths). Repaired regressions verified to exercise lock-wait paths: blocked-PID assert, DB-clock outlast, post-lock recheck. |
| Verdict | OK TO MERGE — NO BYPASS FOUND |

## Findings

- HIGH/MEDIUM/LOW: none. INV-01/02/04/11/12/15/18 all PASS. CWAIT1 kills WAIT5/WAIT6; RWAIT1/2 assert 0 rows with unchanged/revoked-correct state; CWAIT4 duplicate, CWAIT1 retry-burn hold. Prior M1/G10/U2-U4/CLK4/RWAIT closures remain closed.

## Dispositions

- Nothing blocks on invariant grounds. Non-concerns noted only: `/readyz` ~1s cache TTL (availability, not bypass); DB-wide lock-wait counter (flake risk only, per-file DB isolation).
