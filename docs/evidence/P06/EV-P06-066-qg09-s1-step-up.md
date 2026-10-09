# EV-P06-066: QG-09 §1 step-up review (security+architecture, static): OK TO MERGE both; open MEDIUMs FIX-3/4/5/6/7 + LOWs; founder verdict PENDING

| Field | Value |
|---|---|
| Evidence ID | EV-P06-066 |
| Item | P06.06.04 |
| Date (UTC) | 2026-10-09 |
| Commit | `5e13939f8623fc56531a63deab45a2f7348c024f` (reviewed `origin/main`; this docs-only change implements nothing) |
| Environment | local (static reviewer read; no executable command) |
| Command / procedure | Static read by security-reviewer + architecture-reviewer of the §1 merge range (step-up MFA #38, `1012c27`, plus step-up consumers in scope). Working index: `/tmp/QG09-findings-s1-3.md`. No code executed, no fix implemented — documentation of reviewer output only. |
| Result | OK TO MERGE, both reviewers (static verdict — distinct from founder acceptance; founder verdict PENDING). Open findings below, all UNVERIFIED (static labels, not runtime-proven). |
| CI run / artifact | not applicable (review record, no code change) |
| Reviewer | security-reviewer + architecture-reviewer (static); founder verdict PENDING |

## Reviewed SHA

`1012c27` feat(auth): step-up MFA for sensitive actions (#38), as merged on `origin/main`
(review read at `5e13939`).

## Findings (severity-indexed; all STATIC unless marked reproduced)

No HIGH. Verdict OK TO MERGE means: no finding in §1 blocks the merge on its own; the
MEDIUMs below are accepted here as follow-up hardening, founder to confirm.

- **FIX-3 (MEDIUM, s1+s3 shared): step-up proof is auth_time freshness, not bound to the
  round-trip; no MFA assertion.** `oidc-provider.ts:277-290`,
  `sign-in.service.ts:288-296,352-358`. `auth_time` up to 300 s old accepted; nothing
  asserts `amr`/`acr` MFA where the provider emits it. STATIC. Proposed: return
  `created_at` from `consume_sign_in`, require `auth_time >= created_at − tolerance`;
  assert MFA `amr`/`acr` where emitted; `GREATEST()` on the step-up stamp (s1 arch L2);
  drop TS duplication of the freshness window (`STEP_UP_WINDOW_MS`, s1 arch M3);
  document MFA-by-pool-policy dependency (Cognito `MfaConfiguration=ON`, remembered
  devices).
- **FIX-4 (MEDIUM, s1 sec M2 + s2 L2 shared): sensitive GETs authorised from the 30 s read
  cache.** `session-membership.guard.ts:34-36`, `request-context.service.ts:131,142-160`.
  A revoked/downgraded session still passes for up to 30 s on that instance. STATIC.
  Proposed: `RequireStepUpGuard` forces mutate-mode re-resolve (or rejects safe methods);
  regression test revoke → immediate sensitive GET expects 401.
- **FIX-5 (MEDIUM, s1 sec M3 + arch L1 shared): `step_up_at` not covered by
  `reject_session_rewrite`.** `0012:212-250` / 0015 comment ~155. STATIC. Proposed: add
  `NEW.step_up_at IS DISTINCT FROM OLD.step_up_at`, re-pin digest, mutation test.
- **FIX-6 (MEDIUM, s1 arch M4 + sec L3 shared): readiness/catalog DISTINCT hides extra
  DEFINER overloads.** `readiness.ts:92-101`, `check-rls-catalog.ts` Set dedupe. STATIC.
  Proposed: restore exact-signature count over prosecdef EXECUTE (7 signatures), also
  `inspectIdentityRole`.
- **FIX-7 (MEDIUM, s1 arch M1 + s3 arch M2 shared): POST `/api/auth/step-up` answers 302
  behind a custom-header CSRF check.** `auth.controller.ts:137-157/188-208`. Browser
  clients cannot follow. STATIC. Proposed: return 200 `{location}` no-store, keep
  `SIGN_IN` cookie.
- **LOWs (STATIC, batch into one hardening PR):** s1 L1 step-up round-trip `created_at`
  (see FIX-3); L2 audit event for step-up grant/deny (INV-10/ASVS V7); L4 record advisory
  ID for source-map-js override; arch L3 pass guard `sessionId` into `startStepUp`; L4
  contraction item for INVOKER shims; L5 carry validated return path /
  `step_up_invalid` problem type; L6 `Clock.monotonicMs` required, `rotateSession`
  discriminated union, rename `SessionService.rotate`.

## Disposition

None fixed in this change (documentation task only; Oracle decides the §2 fix; s1 fixes
ride a later hardening PR). Founder verdict PENDING for §1. OK TO MERGE is the reviewers'
static verdict, not founder acceptance — P06 stays READY_FOR_REVIEW at most, nothing here
marks any item VERIFIED.

Sensitive material is stored by reference only (PLAN.md evidence rules).
