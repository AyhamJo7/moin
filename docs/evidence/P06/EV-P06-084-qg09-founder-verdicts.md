# EV-P06-084: QG-09 founder-verdict recommendation pass over §§1–13 (docs-only, no code)

| Field | Value |
|---|---|
| Evidence ID | EV-P06-084 |
| Item | P06.06.04 |
| Date (UTC) | 2026-10-10 01:18 UTC |
| Commit | `4441f0cd12b110a55eb081e3c84bb427cf9d95c0` |
| Environment | local |
| Command / procedure | static read of EV-P06-066..078 plus fix EVs 079-083 at 4441f0c; no code executed |
| Result | PENDING founder record; no code changed — recommendations below, nothing marked VERIFIED |
| CI run / artifact | not applicable (verdict record, no code change) |
| Reviewer | founder verdict pass (docs-only) |

## Method and limits

Each section below states: reviewer verdict (from its EV record) + fix-landed status
(from the fix EVs and merge SHAs in this history) → a founder-verdict RECOMMENDATION.
Recommendations use three labels: ACCEPT (remediation landed, residuals LOW/MEDIUM and
tracked), CONDITIONAL (accept subject to a named follow-up), HOLD (findings still open).
No P06 item is marked VERIFIED here — that is the founder's call, recorded separately.
This pass reads only what the EVs record; it re-proves nothing at runtime.

Merge SHAs in this history: §2 fix `974ff76` (migration 0027), §9 fix `5b47189`
(migration 0028), §4 fix `750fe14` (test-only), §5 fix `21de574` (migrations
0029+0030), §6 fix `4db4eba` (migration 0031), §7 slices 1+2 `4441f0c` (migration
0032 + service + M2 tests, EV-P06-083 GREEN CI 16/16 triple-OK).

## §1 step-up MFA (EV-P06-066) — recommend ACCEPT with residuals

Reviewer verdict: OK TO MERGE both. Open: MEDIUMs FIX-3 (auth_time freshness binding),
FIX-4 (sensitive GETs from 30 s cache), FIX-5 (`step_up_at` chain coverage), FIX-6
(readiness DISTINCT), FIX-7 (step-up 302 surface) + LOWs — all unfixed, none HIGH.
No fix PR landed for §1 (nothing to land: OK TO MERGE as reviewed). The MEDIUMs are
real hardening items, batchable into one later PR; none blocks the reviewed behaviour.
Recommendation: ACCEPT with residuals FIX-3/4/5/6/7 tracked as follow-up work.

## §2 session revocation (EV-P06-067, fix EV-P06-079) — recommend ACCEPT with residuals

Reviewer verdict: BLOCK MERGE both; FIX-1 AB-BA deadlock REPRODUCED 40P01 (HIGH),
plus MEDIUMs FIX-2 (trigger per-row bulk/cascade) and shared FIX-4 + LOWs. Fix landed:
migration 0027 reorders revokers to advisory → families → sessions → users-last
(merge `974ff76`, EV-P06-079: regression green, AB-BA mutant KILLED, 156 + 131 + 232
green, 20/20 stress). FIX-1 closed at the reviewed paths; FIX-2 bulk/cascade and
shared FIX-4 remain as stated. Recommendation: ACCEPT with residuals FIX-2 and shared
FIX-4 tracked as follow-up work.

## §3 CSRF (EV-P06-068) — recommend ACCEPT with residuals

Reviewer verdict: OK TO MERGE both. Open: MEDIUMs FIX-7/8/9 (+ shared FIX-3), no HIGH.
No fix PR landed (nothing to land: OK TO MERGE as reviewed). Recommendation: ACCEPT
with residuals FIX-7/8/9 (+ shared FIX-3) tracked as follow-up work.

## §4 session lifecycle (EV-P06-069, fix EV-P06-081) — recommend ACCEPT with residuals

Reviewer verdict: BLOCK MERGE both; H1 warm-cache vs FS-16, M1/M2/M3 + fixation +
L1–L4 artifact gap. Fix landed: test-only remediation (merge `750fe14`, EV-P06-081:
H1 write-fresh + 30 s ceiling pinned, M1/M2/M3 + fixation covered, 12/12 green,
L1–L4 KILLED, full gates 14/14). No app code changed — the reviewed behaviour was
proven, not altered. Recommendation: ACCEPT with no open HIGH/MEDIUM; any remaining
lifecycle hardening is new work, not a §4 residual.

## §5 RBAC and last-owner (EV-P06-070, fix EV-P06-082) — recommend ACCEPT with residuals

Reviewer verdict: BLOCK MERGE both; sec H1 + M1/M2/M3, arch H1/H2/H3/H4 + M1–M4. Fix
landed: batch merge `21de574` (migrations 0029 effective-owner count + cascade guard,
0030 users-status trigger; `may()` fail-closed; session metadata; matrix pins;
EV-P06-082 RED static-clean, CI green pending at record time — since merged). H1/H3
(trigger coverage) and M2/H4 (fail-closed) addressed; H2 lock-order documented as
AFTER-ROW-trigger inherent (advisory serialisation retained). Arch M1–M4 service/
inventory/pin gaps partially addressed. Recommendation: ACCEPT with residuals: any
unclosed M1–M4 tails as recorded in EV-P06-082 tracked as follow-up work.

## §6 invitations (EV-P06-071; fix merged, no fix EV) — recommend ACCEPT with residuals

Reviewer verdict: BLOCK MERGE both; sec H1/H2 + M1, arch H1–H5 + M1–M5. Fix landed:
merge `4db4eba` (step-up on invite/revoke, owner-aware revoke in-transaction,
transfer zero-row guard, migration 0031 accept-guard against disabled reactivation +
canonical user lock, digest re-pinned). No separate fix EV was recorded for §6 —
coverage is the merge diff itself plus its CI. Arch H2 (no pre-session accept route)
is a founder decision, documented, not built. Arch M1–M5 tasks/audit/retry/layering
tails as reviewed. Recommendation: ACCEPT with residuals: H2 decision standing,
M1–M5 tails tracked as follow-up work; consider a fix-EV amendment for §6 parity
with the other remediated sections.

## §7 account recovery (EV-P06-072, fix EV-P06-083 slices 1+2) — recommend CONDITIONAL

Reviewer verdict: BLOCK MERGE both; sec H1 + M1/M2 + L1–L3, arch H1/H2 + M1/M2/M3.
Fix landed (slices 1+2): merge `4441f0c` (migration 0032 GUC-bound tenant check in
`revoke_member_sessions` + correlation/session-count forwarding; `disableAccount`
service-layer move; M2 disabled-callback/race/owner-guard tests; EV-P06-083 GREEN
CI 16/16 triple-OK). Closed: H1/M1 containment at the DB layer, arch H1 (0027 order,
unchanged by 0032), M1 layering (disable path), M2 tests, L1 correlation on the
revoke path. Still open (slice 3): M2 strand-check/break-glass doc, arch M1
service-layer for the remaining recovery routes (enable/revoke-sessions controller
transactions), L2 404/403 matrix test, L3 runbook preconditions, M3 EV-P06-055
dirty-predecessor re-record. Recommendation: CONDITIONAL — accept slices 1+2 as
landed; HOLD full §7 ACCEPT until slice 3 (L-gaps + M3) lands.

## §8 audit adoption (EV-P06-073) — recommend ACCEPT with residuals

Reviewer verdict: OK TO MERGE (gemini static). Open: M1 (correlation-id spoofing),
M2 (unchecked correlationId 22P02), L1 (`withRequestTenant` correlation), L2
(CREATE OR REPLACE grant hygiene) — all unfixed, none HIGH. Recommendation: ACCEPT
with residuals M1/M2/L1/L2 tracked as follow-up work.

## §9 support grants (EV-P06-074, fix EV-P06-080) — recommend ACCEPT with residuals

Reviewer verdict: BLOCK MERGE; H1/H2 + M1/M2 + L1/L2. Fix landed: merge `5b47189`
(migration 0028: deterministic pick + supersede + cap + bound-ref + FOR SHARE;
gate regression; digest re-pins; EV-P06-080 RED static-clean, DB-green). H1/H2/M1/M2
addressed; L1/L2 (role-name hardcode, pagination) as stated. Recommendation: ACCEPT
with residuals L1/L2 tracked as follow-up work.

## §10 throttles and lockout (EV-P06-075) — recommend ACCEPT with residuals

Reviewer verdict: OK TO MERGE. Open: M1 (ALB-shared-bucket DoS, topology-unsafe at
P05), M2 (in-txn sweep contention), L1 (redundant UPDATE), L2 (hashtext collision) —
all unfixed, none HIGH. M1 matters at P05 deploy, not locally. Recommendation:
ACCEPT with residuals M1 (P05-gated) /M2/L1/L2 tracked as follow-up work.

## §11 xsuite and CI (EV-P06-076) — recommend ACCEPT with residuals

Reviewer verdict: OK TO MERGE. Open: M1 (tenant-list class exceeds probe coverage),
L1 (SSE tripwire substring), L2 (xsuite double-execution) — all unfixed, none HIGH.
Recommendation: ACCEPT with residuals M1/L1/L2 tracked as follow-up work.

## §12 session tenant (EV-P06-077) — recommend ACCEPT with residuals

Reviewer verdict: OK TO MERGE. Open: L1 (error-message attribution), L2 (decorator
convention) — LOWs only. Recommendation: ACCEPT with residuals L1/L2 tracked as
follow-up work.

## §13 resolve_route (EV-P06-078) — recommend ACCEPT with residuals

Reviewer verdict: OK TO MERGE. Open: L1 (missing FK index), L2 (non-E.164 probe) —
LOWs only. Recommendation: ACCEPT with residuals L1/L2 tracked as follow-up work.

## Summary table

| § | Reviewer | Fix landed | Recommendation |
|---|---|---|---|
| 1 | OK | — (none needed) | ACCEPT + residuals FIX-3/4/5/6/7 |
| 2 | BLOCK (FIX-1 repro) | `974ff76` / EV-079 | ACCEPT + residuals FIX-2, shared FIX-4 |
| 3 | OK | — (none needed) | ACCEPT + residuals FIX-7/8/9, shared FIX-3 |
| 4 | BLOCK | `750fe14` / EV-081 | ACCEPT, no open HIGH/MEDIUM |
| 5 | BLOCK | `21de574` / EV-082 | ACCEPT + M1–M4 tails as in EV-082 |
| 6 | BLOCK | `4db4eba` (no fix EV) | ACCEPT + residuals (H2 decision, M1–M5 tails) |
| 7 | BLOCK | `4441f0c` / EV-083 (slices 1+2) | CONDITIONAL (slice 3: L-gaps + M3 open) |
| 8 | OK | — | ACCEPT + residuals M1/M2/L1/L2 |
| 9 | BLOCK | `5b47189` / EV-080 | ACCEPT + residuals L1/L2 |
| 10 | OK | — | ACCEPT + residuals M1/M2/L1/L2 |
| 11 | OK | — | ACCEPT + residuals M1/L1/L2 |
| 12 | OK | — | ACCEPT + residuals L1/L2 |
| 13 | OK | — | ACCEPT + residuals L1/L2 |

Twelve sections recommend ACCEPT (eleven outright, §7 conditional on slice 3); no
section recommends HOLD for rework — every BLOCK has a landed remediation except the
documented §7 slice-3 tail.

Sensitive material is stored by reference only (PLAN.md evidence rules).
