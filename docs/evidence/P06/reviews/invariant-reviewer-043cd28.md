# invariant-reviewer — QG-09 review at 043cd28 (final verdict: OK TO MERGE)

| Field | Value |
|---|---|
| Reviewer role | invariant-reviewer |
| Implementation SHA | `043cd28eaf745a6e2d7c54dea93beb5790e1e04e` (full 40-char as tasked; worktree content matches the scoped supersede) |
| Scope reviewed | `92cb7c2..043cd28` close-out: 4-file range verified (manifest trailing newline, report re-baseline, test-only cleanup, 3 digest lines); migration byte-identical; production diff empty; digests match `md5(prosrc)` measured post-regression with 43/43 catalog suite + firing negative control. Entry points re-enumerated: callback → `SignInService.complete` → `IdentityStore.beginSession` → `app.begin_session`; direct-SQL negative paths; concurrency interleavings. |
| Verdict | OK TO MERGE — no bypass remains on the supersede path; prior PASSes hold. |

## Findings

- CRITICAL/HIGH/MEDIUM: none. No BYPASS path traced.
- Supersede scoping: FIXED — `v_user` comes only from the active-user lookup (`users WHERE cognito_sub = p_subject AND status='active' FOR SHARE`); the update conjoins `family_id = v_family AND user_id = v_user`, so a cross-family planted cookie matches zero rows. Killing regression `identity-store.integration.test.ts:579-588` and variant `M1-cross-user-supersede-scoped` both point at the scoped line verbatim. Disposition: closed.
- Concurrency, lifetime finality, no-provisioning, ACLs, INV-01/02/04/10/11/12/15/19: all PASS, unchanged by this diff (lock order untouched; `consume` burn-on-presentation, `rotate` single-successor, trigger + CHECKs, `REVOKE ALL`/`GRANT` lines intact).
- Non-blocking observations (not bypasses): transient victim-family lock on foreign-hash login (lock wait only, single short transaction); `v_family` lookup unfiltered by `revoked_at` (intentional — stale cookie still supersedes live members). Disposition: noted, no action.

## Dispositions

- The re-review target is fixed with a mutation-proven regression; nothing blocks on invariant grounds. `SessionService.revoke/rotate` remain without HTTP callers (P06.06.03/.05 work) — wire with review when they land.
