# security-reviewer — QG-09 review at 0eed7ad (membership-lock stale clock)

| Field | Value |
|---|---|
| Reviewer role | security-reviewer |
| Implementation SHA | `0eed7adb2737419243dce702babce0a6cb5d9f7b` (full 40-char; branch `feat/p06-06-membership-recheck`, base `1b944763d5569c1712787c89e388e81e79ea9cbb`) |
| Scope reviewed | Membership `FOR SHARE` lock before the clock (four-lock order, post-lock `v_now`); marker exemption narrowness; MWAIT1 discrimination; no new bypass. |
| Verdict | OK TO MERGE |

## Findings

- CRITICAL/HIGH/MEDIUM: none. Four-lock order confirmed; exemption narrow with reset on both paths; MWAIT1 kills the pre-lock-clock mutant (1 row vs 0); grants/INV-02/INV-12/INV-15 clean.
- LOW L1 (carried): global guard registration. LOW L2 (new): row-level MWAIT2 vs documented waiver (accepted).

## Dispositions

- Nothing blocks merge. Residuals → P06.07+ backlog.
