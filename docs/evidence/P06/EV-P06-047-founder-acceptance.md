# EV-P06-047: Founder acceptance of P06.06.01/.02 at reviewed implementation 316caa6, candidate 195a6bd

| Field | Value |
|---|---|
| Evidence ID | EV-P06-047 |
| Item | P06.06.01, P06.06.02 |
| Date (UTC) | 2026-10-05 |
| Commit | `195a6bd69d1d75c76be8371220832e142e832450` (clean tree) |
| Environment | local |
| Command / procedure | Independent Codex re-review of PR #35 at candidate `195a6bd` (frozen implementation `316caa6`) against base `e1d787c`; verdict `READY FOR FOUNDER ACCEPTANCE`. Founder accepted P06.06.01/P06.06.02 on that verdict. No sign-in, session, or provider operation was executed. |
| Result | PASS — founder acceptance of OIDC callback (P06.06.01) and server sessions (P06.06.02) implementation only |
| CI run / artifact | PR #35: 16/16 checks green at `195a6bd`; the governance commit carrying this record is verified separately |
| Reviewer | founder; independent verdict `READY FOR FOUNDER ACCEPTANCE` |

Sensitive material is stored by reference only (PLAN.md evidence rules).

A governance record. It changes no implementation, test, workflow or dependency file. The
commit above is the **reviewed candidate HEAD** (`195a6bd`, frozen implementation `316caa6`);
the governance commit that carries this record follows it and touches documentation only.

## The verdict

- Independent verdict: **`READY FOR FOUNDER ACCEPTANCE`**
- Reviewed candidate HEAD: `195a6bd69d1d75c76be8371220832e142e832450`
- Reviewed implementation SHA: `316caa67ead125c6b8d1b87dfe6f2a8868a5f869`
- Base: `e1d787c1042cc3060c0fa2f1d3aba7e71b7a7628`
- Prior evidence: EV-P06-045 (lock-wait races closed, 54/54), EV-P06-046 (genuine stale-clock fixtures)
- Founder decision: P06.06.01 and P06.06.02 accepted, with the backlog items below.

## Independent re-review closure (all 3 prior blockers CLOSED)

| Blocker | Independent confirmation |
| --- | --- |
| CWAIT1 / WAIT5 vacuous | Pristine CWAIT1 passed; moving the clock read before the claim failed with `expected 1 to be 0` (exit 1) — genuine mutant kill confirmed |
| RWAIT2 validity | Session confirmed valid before the race; lapses during the wait, returns 0 rows |
| RWAIT1 flakiness | 20 standalone + 20 affected runs (3,960 executions), 0 failures, zero CHECK violations |

Scenarios A–O all PASS. Negative controls fired (extension-view detected on empty allowlist;
modified protected body raised `reviewed-function-body-changed`). Compiled voice and worker start
cleanly with `/healthz` 200 without the identity secret. Full gates 14/14 PASS at candidate HEAD
(evidence `.git/worktrees/moin-sessions/claude-evidence/20261005T051616Z-full.json`). GitHub CI
16/16 SUCCESS at `195a6bd`.

## Future backlog (non-blocking observations)

1. Identify lock waiters by backend PID in future temporal-test iterations (current
   `pg_stat_activity` poll counts DB-wide `Lock` waits).
2. Make simultaneous idle/absolute expiry behavior explicit in RWAIT2's coverage description
   (both deadlines currently lapse together at now+2s).

## Resulting status

P06.06.01 and P06.06.02 verify the **OIDC callback and server-session implementation**.
Per-request membership checks (P06.06.03), session listing/revocation UX (P06.06.05), remaining
session work (P06.06.04/.06/.07), Cognito (P06.05.05), KMS custody (P05.08.01) and production
vulnerability closure (LG-P06/P17) remain future work. No provider operation was performed or
verified by this acceptance.

| Item | Status |
| --- | --- |
| P06.06.01 | **VERIFIED** — founder-authorized on `READY FOR FOUNDER ACCEPTANCE`; EV-P06-045, EV-P06-046 and this record |
| P06.06.02 | **VERIFIED** — founder-authorized on `READY FOR FOUNDER ACCEPTANCE`; EV-P06-045, EV-P06-046 and this record |
| P06.06.03–.07 | **OPEN** |
| P06.01.06 | **OPEN** |
| LG-P06 | **OPEN** — raw unfixed upstream findings remain tracked, not closed by this acceptance |
| P06.06 | **IN_PROGRESS**, incomplete |
| P06 | **IN_PROGRESS**, incomplete |

PR #35 remains draft until the founder squash-merges it separately.
