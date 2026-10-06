# invariant-reviewer — QG-09 review at b126af4 (Step-up MFA ≤ 15 min, final round)

| Field | Value |
|---|---|
| Reviewer role | invariant-reviewer |
| Implementation SHA | `b126af4e6fc97d5302d07570035ca0d36dca19da` (full 40-char as tasked; file-trace review — reviewer environment has no shell, so SHA is log-derived from the worktree HEAD record, content-verified against the 64/64 sweep report) |
| Scope reviewed | Entry points enumerated (step-up start with route guard, callback with subject check, `RequireStepUpGuard` on the DB-judged verdict, `rotate_session('step_up')`); choke-point chain; fourth-deadline cache bound + never-cache-null; overload window; cross-schema readiness. |
| Verdict | NO BYPASS FOUND (OK TO MERGE) |

## Findings

- Stale/NULL/foreign/wrong-subject/replayed/removed-member paths all traced to killing tests (SU1–SU9, S1–S3, M1, CWAIT).
- LC1 (cached freshness) closed by the fourth deadline + never-cache-null; LC3 (log allowlist) confirmed; LC2 (removed-member idle extension) accepted as non-bypass.
- Low-confidence notes only: app↔DB skew on the cache deadline (NTP-bounded, mutations unaffected), guard pairing by annotation (fails closed), `SESSIONS.rotate` future callers must route through `#completeStepUp`.

## Dispositions

- Nothing blocks on invariant grounds.
