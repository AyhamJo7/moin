# architecture-reviewer — QG-09 review at dfdece5 (MWAIT2 NOWAIT probe & row lock repair)

| Field | Value |
|---|---|
| Reviewer role | architecture-reviewer |
| Implementation SHA | `dfdece53e11fd6095daa9c44bab8dae3363d0b91` (full 40-char; branch `feat/p06-06-membership-recheck`, base `1b944763d5569c1712787c89e388e81e79ea9cbb`) |
| Scope reviewed | Delta `6e81c1e..dfdece5`: replacement of sleep with deterministic NOWAIT probe in MWAIT2; prod tree equality against sweep SHA `d56553c`; migration and policy architecture. |
| Verdict | OK TO MERGE |

## Findings

- M1 closed by construction: blind sleep removed and replaced by NOWAIT probe asserting `55P03`, proving open transaction holds membership tuple lock.
- Failure mode is fail-loud (test red), never fail-open in production.
- Production tree verified identical to sweep SHA `d56553c`.
- Low-severity hygiene items: L1 (NOWAIT retry loop recommended for scheduler robustness), L2 (mutation report measured stamp).

## Dispositions

- Nothing blocks merge.
