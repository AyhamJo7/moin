# EV-P06-068: QG-09 §3 CSRF review (security+architecture, static): OK TO MERGE both; open MEDIUMs FIX-7/8/9 (+shared FIX-3); founder verdict PENDING

| Field | Value |
|---|---|
| Evidence ID | EV-P06-068 |
| Item | P06.06.06 |
| Date (UTC) | 2026-10-09 |
| Commit | `5e13939f8623fc56531a63deab45a2f7348c024f` (reviewed `origin/main`; this docs-only change implements nothing) |
| Environment | local (static reviewer read; no executable command) |
| Command / procedure | Static read by security-reviewer + architecture-reviewer of the §3 merge range (CSRF synchronizer #40, `c51404e`, plus CSRF consumers in scope). Working index: `/tmp/QG09-findings-s1-3.md`. No code executed, no fix implemented — documentation of reviewer output only. |
| Result | OK TO MERGE, both reviewers (static verdict — distinct from founder acceptance; founder verdict PENDING). Open findings below, all UNVERIFIED (static labels, not runtime-proven). |
| CI run / artifact | not applicable (review record, no code change) |
| Reviewer | security-reviewer + architecture-reviewer (static); founder verdict PENDING |

## Reviewed SHA

`c51404e` feat(auth): CSRF synchronizer token plus Origin check (#40), as merged on
`origin/main` (review read at `5e13939`).

## Findings (severity-indexed; all STATIC unless marked reproduced)

No HIGH. Verdict OK TO MERGE means: no finding in §3 blocks the merge on its own; the
MEDIUMs below are accepted here as follow-up hardening, founder to confirm.

- **FIX-3 shared with §1 (MEDIUM, s1+s3): step-up proof is auth_time freshness, not bound
  to the round-trip; no MFA assertion** — see EV-P06-066 FIX-3. STATIC.
- **FIX-7 (MEDIUM, s1 arch M1 + s3 arch M2 shared): POST `/api/auth/step-up` answers 302
  behind a custom-header CSRF check.** `auth.controller.ts:137-157/188-208`. Browser
  clients cannot follow. STATIC. Proposed: return 200 `{location}` no-store, keep
  `SIGN_IN` cookie.
- **FIX-8 (MEDIUM, s3 sec L1 + arch M1): CSRF verified AFTER session resolve (side
  effects: idle slide, row locks).** `session-membership.guard.ts:68` vs `:82-125`. STATIC.
  Proposed: run `verifyCsrf` before `contexts.resolve` (keep 401-before-403); test: a
  rejected POST does not move `idle_expires_at` and does not increment lookups. Also s3
  sec L2: `Sec-Fetch-Site` fallback when `Origin` absent.
- **FIX-9 (MEDIUM, s3 arch M3+M4): config + coverage.** STATIC. `APP_ORIGIN` must equal
  `OIDC_REDIRECT_URI` origin (`env.ts` superRefine + test). Route-metadata test: every
  non-GET/HEAD cookie route uses `SessionMembershipGuard` or is on an explicit allowlist.
  Dedupe C1/C2 mutants (EV-P06-051 says 5/5, really 4 distinct); add mutants for method
  set, origin-absent branch, guard order, cookie attributes.
- **LOWs (STATIC, batch into one hardening PR):** s3 L3 CSRF token session binding
  (optional); L2 CSRF re-issue GET endpoint; stale comments in `csrf.ts`; confirm
  single-origin deployment assumption (web + `/api` behind one origin).

## Disposition

None fixed in this change (documentation task only; §3 fixes ride a later hardening PR).
Founder verdict PENDING for §3. OK TO MERGE is the reviewers' static verdict, not founder
acceptance — P06 stays READY_FOR_REVIEW at most, nothing here marks any item VERIFIED.

Sensitive material is stored by reference only (PLAN.md evidence rules).
