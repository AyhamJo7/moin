# EV-P06-075: QG-09 §10 throttles+lockout review (gemini static): OK TO MERGE; M1 ALB-shared-bucket DoS, M2 in-txn sweep contention, L1/L2; founder verdict PENDING

| Field | Value |
|---|---|
| Evidence ID | EV-P06-075 |
| Item | P06.12.03 |
| Date (UTC) | 2026-10-09 |
| Commit | `fa28c27c287a69048cbf51dae0413bfb769c3f89` (review base `origin/main`; this docs-only change implements nothing) |
| Environment | local (static reviewer read; no DB, no tests run) |
| Command / procedure | Static read by gemini-3.8-flash (review pane) of the §10 merge range (`5635d44` throttles + `9044400` lockout docs), guard code `apps/server/src/modules/identity-access/http/auth-throttle.guard.ts` and migration `packages/db/migrations/0023_auth_throttle.sql`. Each cited line re-verified by orchestrator direct read below. No fix implemented. |
| Result | OK TO MERGE (reviewer verdict — distinct from founder acceptance; founder verdict PENDING). No HIGH. Open findings below, all STATIC/UNVERIFIED. |
| CI run / artifact | not applicable (review record, no code change) |
| Reviewer | gemini-3.8-flash static (security+architecture); founder verdict PENDING |

## Review target SHAs

`5635d44` feat(auth): throttle auth endpoints and record security events (#47) and
`9044400` docs(p06): cognito lockout behaviour documentation (#56), as merged on
`origin/main` (base EV-P06-058, EV-P06-064).

## Findings (severity-indexed; all STATIC)

- **M1 (MEDIUM, sec): socket-IP bucket shared behind ALB/proxy — global DoS.** `auth-throttle.guard.ts:81` uses `request.ip` with Fastify `trustProxy: false`, so behind a reverse proxy/ALB every client maps to the proxy IP and 200 requests from anywhere exhaust the shared IP bucket for all users. Verified: line 81 `const ip = request.ip;` with HMAC `ip:${shaped}` bucketing; no proxy config in guard. Fails closed locally (spoof-safe); topology-unsafe at P05. Proposed: `trustProxy` hop count/CIDR at the ALB edge, or per-account-dominant buckets on auth endpoints.
- **M2 (MEDIUM, arch): in-transaction sweep on every request — write contention/deadlock risk.** `0023_auth_throttle.sql:103-108` runs an unordered `DELETE ... WHERE ctid IN (SELECT ctid ... LIMIT 100)` inside every `take` call on the login path; concurrent txns can lock overlapping rows in differing orders (40P01). Verified: sweep block at lines 103-108 with no `FOR UPDATE SKIP LOCKED`, inside the request transaction. Proposed: `FOR UPDATE SKIP LOCKED` or probabilistic sweep (`random() < 0.01`).
- **L1 (LOW, arch): redundant second UPDATE per granted request.** `0023:114-127` does `INSERT ... ON CONFLICT DO UPDATE` (refill + timestamp) then a second `UPDATE ... SET tokens = v_tokens - p_cost` on the same row in the same txn — two tuple versions per granted request. Verified: upsert at ~114-123, second UPDATE at ~124-127. Proposed: fold the cost deduction into the upsert `CASE` expression.
- **L2 (LOW, sec/arch): 32-bit `hashtext` advisory-lock collision.** `0023:100` `pg_advisory_xact_lock(hashtext(...))` maps buckets into 31 bits; at tens of thousands of buckets unrelated clients contend briefly. Verified: line 100. Acceptable for pilot; proposed 64-bit key at scale.

Passes (sound, no finding): XFF-spoof safety local (trustProxy false), uniform 429 without enumeration, HMAC-SHA256 bucket keys with `(scope, key_digest)` PK, fail-closed on missing key/pool/DB error, lockout-docs accuracy vs Cognito behaviour, DEFINER/search_path and catalog pins.

## Disposition

None fixed in this change (documentation task only). Founder verdict PENDING for §10. OK TO MERGE is the reviewer's static verdict, not founder acceptance — P06 stays READY_FOR_REVIEW at most, nothing here marks any item VERIFIED.

Sensitive material is stored by reference only (PLAN.md evidence rules).
