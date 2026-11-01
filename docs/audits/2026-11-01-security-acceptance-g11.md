# QG-09 security acceptance: Group 11, P06.12 throttles and security events (EV-P06-058)

Reviewer: independent security reviewer (adversarial probes run as the runtime role)
Reviewed SHA: `3ac126e316c9ee1679bb6e637b2ab387443d0e38` (origin/main, detached worktree `/tmp/moin-review/wt-sec1012`)
Origin commit: 5635d44, plus lockout docs 9044400 (EV-P06-064)
DB: private compose project `claudesec1012` on 127.0.0.1:55432 (repo image and init scripts, tmpfs). The API runs on `moin_app` (NOBYPASSRLS), in-process Nest/Fastify, over `inject` and over a real loopback HTTP listener for the X-Forwarded-For probe.
CI on main head 3ac126e: verify run 41299849665 succeeded (all 9 jobs). security-scan, codeql and container-scan succeeded on the same SHA.

Implementing code:

- `apps/server/src/modules/identity-access/http/auth-throttle.guard.ts`
- `apps/server/src/modules/platform/auth-throttle-store.ts`
- `packages/db/migrations/0023_auth_throttle.sql`
- `packages/db/migrations/0024_security_events.sql`
- `apps/server/src/modules/identity-access/http/auth.controller.ts:99-115,165,179`
- `docs/runbooks/authentication-lockout.md`

## Verdict table

| Item                                                                                                | Verdict | Proof command + exit code                                                                                                                                                                                                                                                                                                                                                                                                              | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --------------------------------------------------------------------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P06.12.01 WAF rate rules; app throttles per IP and account; Cognito lockout documented              | PARTIAL | `node vitest run --project integration apps/server/src/modules/identity-access/auth-abuse.integration.test.ts` exits 0 with 5/5 (`/tmp/moin-review/claude-sec11-run/auth-abuse.log`). `node vitest run --project unit …/http/account-throttle.guard.test.ts` exits 0 with 2/2 (`account-unit.log`). Probes `zz-claude-sec11-probe.integration.test.ts` exit 1 with 3 pass / 4 fail (`/tmp/moin-review/claude-sec11-probes/probe.log`). | **Holds:** the IP bucket answers 429 after 200 requests with `Retry-After`, `no-store` and a body that leaks no budget. Over real HTTP, rotating `X-Forwarded-For`, `X-Real-IP` and `Forwarded` does not escape the socket bucket (Q1). The account bucket answers 429 after 50 requests on a real route, even while the source IP rotates (Q7). Buckets are HMAC-keyed, `moin_app` has no table grant (42501), and the stale-row sweep works. **Breaks:** every IPv6 address is its own bucket, so a /64 neighbour gets a fresh one (Q2, M1). Behind the owner-app proxy or the ALB, every caller shares one bucket (M2, known residual). The table has no count bound under rotation (Q3, M3). WAF rules are WAITING_FOR_EXTERNAL (EXT-09). The Cognito advanced-security thresholds are UNVERIFIED (runbook line 49). |
| P06.12.02 Security events (failed logins, MFA changes, new device) audited; owner notified by email | PARTIAL | Q4, Q5, Q6 in `probe.log`                                                                                                                                                                                                                                                                                                                                                                                                              | **Holds:** failed and accepted sign-ins are written with coarse classes. Rows and refusal logs carry no IP, email or subject (Q5; the log grep for the probe IPs found 0 hits). **Missing:** nothing writes `mfa_change`, `password_change`, `step_up`, `revoke`, `throttle` or `new_device`; the only writer is `auth.controller.ts:165,179` (`sign_in`). The new-device flag is set on every non-step-up sign-in, so the same user signing in again from the same client is flagged new each time (Q6: `true,true,true`, M4). A throttle refusal writes no event (Q4: `[]`). Owner email is pending P14.                                                                                                                                                                                                               |
| P06.12.03 Tests: throttling engages; notifications sent                                             | PARTIAL | `auth-abuse` exits 0                                                                                                                                                                                                                                                                                                                                                                                                                   | The throttling half is proven. The test titled "throttle refusals are counted as security events (rate_limited)" (`auth-abuse.integration.test.ts:173-184`) asserts no event row, only a repeated 429 (L1). The suite overrides `AccountThrottleGuard` to always pass (`:84-87`); the account bucket is proven only by a unit test with a mocked store and by my probe Q7. Notifications are pending P14.                                                                                                                                                                                                                                                                                                                                                                                                                |

Counts: CONFIRMED 0 · PARTIAL 3 · NOT CONFIRMED 0. None of the three items is ticked in the ledger, and the ledger text matches these gaps except the new-device and MFA-event points.

## Findings

No CRITICAL or HIGH finding. No deployed environment exists (P05 is open), so the topology-dependent issues are rated for the first deploy.

### MEDIUM

- **M1. Per-address IPv6 buckets: one host with a /64 gets about 2^64 fresh 200-token budgets. Tag: P06.12.01.**
  - Where: `auth-throttle.guard.ts:81-83` keys the bucket on the full `request.ip`.
  - Proof (Q2): after `2001:db8:1:2::1` is exhausted (429), `2001:db8:1:2::2` gets 302. The same happens for `2001:DB8:1:2::1` (case variant) and `::ffff:192.0.2.1`. Real sockets canonicalise case, so only the /64 rotation is attacker-reachable.
  - Exploit: any client reaching the API over IPv6 sends unlimited `/api/auth/login` and `/callback` requests, and each one costs an `auth_transactions` row, a bucket row and, on refusal, an event row.
  - Fix: normalise to a prefix before hashing (/64 for IPv6; map `::ffff:a.b.c.d` to IPv4), canonicalise the textual form, and add a probe-style regression test.
- **M2 (known residual, EV-P06-075 M1, re-confirmed). The per-IP bucket is global in the only supported topologies.**
  - Where: `trustProxy` is unset (`bootstrap.ts:98`). The owner app proxies `/api/*` server-side (`apps/web/next.config.ts:41-43`), and the code says so itself (`today.controller.ts:10-13`: "every caller shares one socket address").
  - Exploit at first deploy: one unauthenticated client sending about 1 req/s past the 200 burst keeps sign-in, step-up, support, members and recovery returning 429 for every tenant.
  - Fix before P05: trust exactly the ALB hop (`trustProxy` set to the ALB CIDR or hop count) and bucket on the derived client prefix; alternatively, make the account bucket the primary control post-auth. Gate P05.
- **M3. Throttle and event tables are not count-bounded under source rotation, and `auth_security_events` has no retention at all. Tag: availability, P06.12.01 "bounded".**
  - Where: `0023:101-108` sweeps only rows idle for more than 24 h, at most 100 per call. `0024` has no sweep, and the retention job is P16.
  - Proof (Q3): 300 rotating sources produce 300 bucket rows. Every refused `/api/auth/callback` inserts an event row (`auth.controller.ts:179`), with no authentication needed.
  - Combined with M1, the growth rate is set by the attacker.
  - Fix: a global ceiling (refuse new buckets above N rows, or a coarse global bucket), and a retention sweep for `auth_security_events` (or a time-partitioned table) before exposure.
- **M4. Security events do not cover the claimed classes, and the new-device signal is wrong. Tag: P06.12.02, INV-10.**
  - Where: `auth.controller.ts:165` passes `completed.steppedUp !== true` as `is_new_family`, which is true for every ordinary sign-in (Q6). No code writes `mfa_change`, `password_change`, `step_up`, `revoke` or `throttle`, although `0024:14-22` documents them as recorded.
  - Fix: derive new-family from the session service (no superseded predecessor family for this user and client), write events from the step-up, revocation and throttle paths, and add one test per class.

### LOW

- **L1.** The test title claims something the test never checks: `auth-abuse.integration.test.ts:173` is named "throttle refusals are counted as security events" but asserts no event row. Rename it, or (better) write a `throttle` event and assert it.
- **L2.** `source_digest` is HMAC(`AUTH_LOCAL_TOKEN_KEY`, `ip:<addr>`). The key holder can reverse it by enumerating the IPv4 space, so it is pseudonymous personal data in a table with no retention. INV-12 covers logs and telemetry, not this table; record it in the data classification and the retention plan (P16).
- **L3.** The account throttle is disabled throughout the integration suite (`auth-abuse.integration.test.ts:84-87`). Add an integration test that runs the real guard against a real route.

## Remediation checklist

- [ ] M1: hash IPv6 sources by /64 (and IPv4-mapped as IPv4) in `auth-throttle.guard.ts`. Test: after `::1` in a /64 is exhausted, `::2` is refused.
- [ ] M2: configure trusted-proxy client-IP derivation for the ALB hop before P05, with a test that one client's exhaustion does not refuse another client behind the same proxy.
- [ ] M3: add a global bucket-row ceiling and a retention sweep for `auth_security_events`. Test: rotating sources cannot push either table above the cap.
- [ ] M4: fix the new-device derivation and write `step_up`, `revoke`, `throttle` and `mfa_change` events. Test: one event per class, and a repeat sign-in is not flagged new.
- [ ] L1: make the "throttle refusals are counted" test assert a `throttle` event row.
- [ ] L3: run the account guard for real in an integration test.

VERDICT: REQUEST_CHANGES
