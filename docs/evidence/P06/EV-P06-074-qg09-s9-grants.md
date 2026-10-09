# EV-P06-074: QG-09 §9 support-grants review (gemini-3.8-flash static): BLOCK MERGE; H1/H2 + M1/M2 + L1/L2; founder verdict PENDING

| Field | Value |
|---|---|
| Evidence ID | EV-P06-074 |
| Item | P06.11.05 |
| Date (UTC) | 2026-10-09 |
| Commit | `fa28c27c287a69048cbf51dae0413bfb769c3f89` (review base `origin/main`; this docs-only change implements nothing) |
| Environment | local (static reviewer read; no DB, no tests run) |
| Command / procedure | Static read by gemini-3.8-flash (review pane) of the §9 merge range (support access grants #46, `cee45a5`). Base evidence on file: EV-P06-057. Each cited line below verified by direct read in this worktree before recording. No code executed, no fix implemented — documentation of reviewer output only. |
| Result | BLOCK MERGE (reviewer verdict — distinct from founder acceptance; founder verdict PENDING). Two HIGHs. All findings STATIC/UNVERIFIED (no runtime proof claimed). |
| CI run / artifact | not applicable (review record, no code change) |
| Reviewer | gemini-3.8-flash (static); founder verdict PENDING |

## Reviewed SHA

`cee45a5` feat(auth): support access grants with grant-gated reads (#46), as merged on
`origin/main`.

## Findings (severity-indexed; all STATIC)

- **H1 (HIGH): `live_support_grant` unordered `SELECT INTO` — expired grant shadows valid.**
  `packages/db/migrations/0022_support_grants.sql:93-98`: `SELECT g.id INTO v_grant ...
  WHERE organisation/operator/scope match AND revoked_at IS NULL FOR UPDATE` with no
  `ORDER BY`. Multiple live rows for one (org, operator, scope) → an arbitrary row wins
  the lock; if the winner is expired (checked after at :102-103), the function returns
  NULL even though a valid grant exists — or conversely an expired row's lock serialises
  a read that a valid row would have admitted. STATIC (verified: no ORDER BY in the
  query; expiry judged post-lock on the single picked row). Proposed: `ORDER BY
  expires_at DESC LIMIT 1` (or `FOR UPDATE SKIP LOCKED` semantics per the chosen
  contention model) so the freshest live grant always wins.
- **H2 (HIGH): emergency-read function has no operator identity — 4-char incident ref is
  the only gate.** `packages/db/migrations/0022_support_grants.sql:333-351`
  (`app.support_emergency_read_memberships`): NULL checks + `length(btrim(ref)) < 4`
  rejection, then full roster read. No authentication of the operator precedes it; the
  EXECUTE grant is correctly still withheld (PENDING P06.11.01, commented-out GRANTs at
  :239-241 etc.), but the function body itself would admit anyone who reaches it with a
  4-character string. STATIC (verified: only length check before the read path; PENDING
  comments confirm the gate is future work). Proposed: no change to the body until
  P06.11.01 lands trusted operator auth — keep EXECUTE withheld; record H2 as the reason
  the grant must stay withheld.
- **M1 (MEDIUM): no per-tenant concurrent-grant cap.**
  `apps/server/src/modules/identity-access/http/support.controller.ts:68` (grant-create
  route): no limit on simultaneously live grants per organisation — a compromised owner
  session (or a bug looping creation) can stockpile live grants, widening the window for
  any future read-path flaw. STATIC (verified: route validates shape, counts nothing).
  Proposed: cap live grants per org (e.g. small single-digit MAX with a clear error) and
  test the cap.
- **M2 (MEDIUM): `FOR UPDATE` on the grant row serialises reads.**
  `packages/db/migrations/0022_support_grants.sql:98`: every support read takes a
  write-grade row lock on the grant even though reads change nothing; concurrent reads
  queue behind each other (and behind revokes) where `FOR SHARE` would suffice for the
  existence check. STATIC (verified: `FOR UPDATE` in the gate query). Proposed: `FOR
  SHARE` for the read path, keeping `FOR UPDATE` only where the row is actually
  mutated — with a concurrency test proving reads don't serialise.
- **L1 (LOW): support-pool role name hardcoded.**
  `apps/server/src/modules/platform/support-pool.module.ts:40`
  (`url.username = 'moin_support_ro'`). STATIC (verified). Proposed: derive from config
  alongside the credential envelope (P05) rather than a literal.
- **L2 (LOW): no pagination on membership/invitation reads.**
  `packages/db/migrations/0022_support_grants.sql:231,275`
  (`support_read_memberships` / `support_read_invitations` full-table `RETURN QUERY`):
  unbounded row sets per read — a large tenant's roster materialises whole on every
  support read. STATIC (verified: no LIMIT/OFFSET or cursor). Proposed: paginate (or cap
  with an explicit total) before the read path is ever granted.

## Disposition

None fixed in this change (documentation task only; §9 fixes ride later fix PRs). Founder
verdict PENDING for §9. BLOCK MERGE is the reviewer's static verdict, not founder
acceptance — P06 stays READY_FOR_REVIEW at most, nothing here marks any item VERIFIED.

Sensitive material is stored by reference only (PLAN.md evidence rules).
