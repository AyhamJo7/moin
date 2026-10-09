# EV-P06-067: QG-09 §2 revocation review (security+architecture, HIGH reproduced): BLOCK MERGE both; FIX-1 AB-BA deadlock REPRODUCED 40P01; MEDIUMs FIX-2/4 + LOWs; founder verdict PENDING

| Field | Value |
|---|---|
| Evidence ID | EV-P06-067 |
| Item | P06.06.05 |
| Date (UTC) | 2026-10-09 |
| Commit | `5e13939f8623fc56531a63deab45a2f7348c024f` (reviewed `origin/main`; this docs-only change implements nothing) |
| Environment | local (static reads + one scratch-DB reproduction; no fix implemented) |
| Command / procedure | Static read by security-reviewer + architecture-reviewer of the §2 merge range (revoke sessions #39, `2476d16`, incl. migration 0016 and revocation callers), plus s2-security reproduction of H1 on a scratch database (see below). Working index: `/tmp/QG09-findings-s1-3.md`. |
| Result | BLOCK MERGE, both reviewers. HIGH reproduced (see FIX-1); all other findings recorded, none fixed in this docs-only change. Oracle decides the §2 fix. |
| CI run / artifact | not applicable (review record, no code change) |
| Reviewer | security-reviewer + architecture-reviewer (s2 security reproduced H1 on scratch DB; rest static); founder verdict PENDING |

## Reviewed SHA

`2476d16` feat(auth): revoke sessions on membership change, reset and demand (#39), as merged
on `origin/main` (review read at `5e13939`).

## Findings (severity-indexed)

- **FIX-1 (HIGH, s2) `revoke_user_sessions` AB-BA deadlock vs readers — REPRODUCED,
  sqlstate 40P01.** Migration `0016:111-120`: the revoker takes `users FOR UPDATE` first,
  then family, then sessions. `resolve_session` (0015) and `resolve_request_context`
  (`0016:303-316`) take family → session → `users FOR SHARE` and no advisory lock — so
  the header claim "one waits on the other, never both" / "readers take none" is false.
  Reproduced on a scratch DB: user-first revoker vs family/session-first reader deadlock,
  aborting with 40P01. Hit paths: sign-out-others, `revoke_session(uuid,text)`,
  `resolve_session` callers (`sign-in.service.ts:191,:314`), `set_account_status`
  (0019). Impact: a 40P01 aborts the revocation/membership change (rolls back); an
  attacker holding a stolen cookie can raise the abort rate. Proposed fix (NOT
  implemented here): new migration with canonical lock order advisory → families asc →
  sessions asc → users `FOR SHARE` last (or drop the users lock); reorder
  `set_account_status` likewise; fix the false header comments; re-pin body digests in
  `check-rls-catalog.ts`; regression test = gate transaction holds family+session
  `FOR UPDATE` (reader), revoker blocks, gate takes users `FOR SHARE`, assert no 40P01;
  mutation-check against the current body. Merged code is immutable — fixes ship as new
  migrations/PRs; applied migrations are never edited.
- **FIX-2 (MEDIUM, s2) membership trigger per-row locks; bulk/cascade AB-BA — STATIC
  (unverified).** `0016:229-263`. Proposed: convert `memberships_revoke_sessions` to a
  statement-level transition-table trigger, revoke distinct users in ascending id order;
  test two overlapping bulk/cascade statements. Also (M2, both reviewers): a membership
  change in org A revokes the user's sessions in every org — document in ADR-0005 /
  `docs/security/sessions.md`; consider revoking only on authority reduction and
  rate-limiting membership mutations.
- **FIX-4 shared with §1 (MEDIUM, s1 sec M2 + s2 L2): sensitive GETs authorised from the
  30 s read cache** — see EV-P06-066 FIX-4. STATIC. A revoked/downgraded session still
  passes for up to 30 s on that instance.
- **LOWs (STATIC, batch into one hardening PR):** s2 L1 provider-side refresh-token
  revocation in P06.09 reset flows; L3 `self` sign-out should revoke the whole live
  family under advisory lock; arch L2 sign-out-others retry/keep-family contract;
  `VALIDATE CONSTRAINT sessions_revocation_reason_check`; `hashtextextended` instead of
  `hashtext`; shim return-type note.

## Disposition

BLOCKED on the §2 fix (Oracle deciding). Nothing fixed in this change. Founder verdict
PENDING for §2. P06 stays READY_FOR_REVIEW at most; nothing here marks any item VERIFIED.
Static findings are labelled STATIC above and are not claimed as runtime-proven — only
FIX-1 carries the reproduced label.

Sensitive material is stored by reference only (PLAN.md evidence rules).
