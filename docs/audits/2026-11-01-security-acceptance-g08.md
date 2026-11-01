# QG-09 security acceptance review: Group 8, P06.06.07 (session lifecycle acceptance), EV-P06-052

- Reviewed SHA: `3ac126e316c9ee1679bb6e637b2ab387443d0e38` (origin/main, detached worktree `/tmp/moin-review/wt-sec789`)
- Origin commit of the item: `858ab7c`. Judged on current main.
- Environment: private compose project `claudesec789` (postgres only, tmpfs, port 55789). The template DB is rebuilt from migrations on every run as `moin_migrator`, and tests run as `moin_app` / `moin_identity` (NOBYPASSRLS). The owner pool only seeds fixtures. Node v24.21.0.
- Main CI on 3ac126e: run 41299849665 `verify` success, including "integration tests (real postgres)" and "RLS catalog check".

## Verdict table

| Item                                                                                                                                                          | Verdict   | Proof command + exit code                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Notes                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| P06.06.07 Tests: expired/idle/revoked sessions rejected; removed member's next request fails (FS-16); CSRF-less POST rejected; fixation prevented by rotation | CONFIRMED | (1) `vitest run --project integration .../session-lifecycle.integration.test.ts .../session-membership.integration.test.ts .../members.integration.test.ts .../rbac-*.integration.test.ts` exit 0, 86/86 (lifecycle file 12/12), log `/tmp/moin-review/claude-sec00-integration.log`. (2) `vitest run --project integration packages/db/src/identity-store.integration.test.ts -t 'admits no membership-less session'` exit 0. (3) Adversarial probe over real HTTP `/tmp/moin-review/claude-sec02-session/zz-claude-sec02-session.integration.test.ts`: exit 0, 16/16 (log `/tmp/moin-review/claude-sec02-session/run3.log`; earlier runs 1-2 failed on probe fixtures that the DB's own immutability and idle-ceiling CHECKs refused, which is itself a positive finding). (4) Mutants L1-L4 re-applied on main via `/tmp/moin-review/claude-sec-shared/mutate.py`: 4/4 KILLED by assertion (L1 `expected 201 to be 403`, L2 `expected 200 to be 401`, L3 `expected 401 to be 200`, L4 store-level `expected {…} to be undefined`), logs `/tmp/moin-review/claude-sec02-session/mutants.log`, `mutants-L4.log` | Every named property holds on main, and the targeted break attempts below did not get through. |

### Break attempts (all held)

- **Revocation propagation:** membership disable over HTTP made the target's next write 401 at once, and the following read 401 too (a failed mutate drops the cache key). `/api/recovery/revoke-sessions` made the next write 401. The revoked token stays dead after the person signs in again, both for writes and for cold reads. Account disable (`users.status`) made the next write 401, and a fresh sign-in was refused (callback 403).
- **Sign-out-others:** it ends a parallel session family (`{revoked:1}`), and that token is then 401 for writes and cold reads while the caller survives. A body `userId` pointing at another user is ignored (`{revoked:0}`, the other user stays live).
- **Privilege change:** transfer-ownership revokes the pre-change sessions of both the demoted owner and the promoted admin, and the promoted user's fresh sign-in carries the new role. A role or permissions change made by direct SQL (the operator psql path) also revokes, via `memberships_revoke_sessions` (0016 §5, ENABLE ALWAYS).
- **Step-up:** rotation issues a new token and the predecessor is 401. A step-up callback completed by a different IdP subject is refused (400), so the victim's session is never rotated into a session for that other person.
- **Fixation:** a planted `__Host-moin_sid` is never adopted, and only the hash is stored (`sessions.token_hash`). Expiry columns are immutable even for the owner role (`a session's identity and absolute lifetime are fixed at creation`), and `sessions_idle_ceiling` is enforced.
- **Absolute expiry:** a session 3 s from its 7-day ceiling is admitted. Activity keeps `idle_expires_at <= absolute_expires_at` and does not extend it, and the session is 401 after the ceiling.
- **Ambiguous tenant:** a user with active memberships in two organisations gets 401 (no tenant is guessed, INV-02).

## Findings

### CRITICAL

None.

### HIGH

None.

### MEDIUM

None.

### LOW

- **L1 (FS-16 read half, accepted design, recorded for the record):** after removal or disable, a warm read-only GET with no intervening mutation is still served from the per-process cache for up to 30 s. The probe saw 200 straight after the disable, then 401 past 30 s. The cached context includes `role`, so a demoted holder's cached GET of a role-gated read (e.g. `GET /api/support/grants`) survives for the same window. This is the P06.06.03 contract (founder-verified at d92f82b) and is pinned honestly by `session-lifecycle.integration.test.ts:517-575`. No action unless the founder tightens P06.06.03.
- **L2 (test naming / evidence wording):** `session-lifecycle.integration.test.ts:432` is titled "a revoked session stays revoked: sign-out ends it", but no sign-out route exists (logout is P13.01.01). The test proves revocation by supersession. In-file, explicit revocation (sign-out-others killing a live other family) is only proven at DB level (comment at :397-412). The probe above closes that gap over real HTTP. EV-P06-052 also says "over HTTP", but the suite uses Fastify `inject`: the full request pipeline without a socket. Suggest renaming the test and adding the parallel-family sign-out-others HTTP case.
- **L3 (FS-16 completeness, outside this item's wording):** FS-16 also requires "open tasks unassigned". The P06.06.07 suite does not assert it, though the `memberships_unassign_tasks` trigger (0025) exists. Item text P06.06.07 only names "next request fails", so this does not change the verdict.

VERDICT: APPROVE
