# EV-P06-069: QG-09 §4 lifecycle review (security+architecture, static): BLOCK MERGE both; H1 warm-cache clearCache vs FS-16, M1/M2/M3 + fixation + artifact gap; founder verdict PENDING

| Field | Value |
|---|---|
| Evidence ID | EV-P06-069 |
| Item | P06.06.07 |
| Date (UTC) | 2026-10-09 |
| Commit | `5e13939f8623fc56531a63deab45a2f7348c024f` (reviewed `origin/main`; this docs-only change implements nothing) |
| Environment | local (static reviewer read; no DB, no tests run) |
| Command / procedure | Static read by security-reviewer + architecture-reviewer of the §4 merge range (session lifecycle acceptance suite #41, `858ab7c`). No code executed, no fix implemented — documentation of reviewer output only. |
| Result | BLOCK MERGE, both reviewers (static verdict — distinct from founder acceptance; founder verdict PENDING). Open findings below, all STATIC/UNVERIFIED (no runtime proof claimed). |
| CI run / artifact | not applicable (review record, no code change) |
| Reviewer | security-reviewer + architecture-reviewer (static); founder verdict PENDING |

## Reviewed SHA

`858ab7c` test(auth): P06.06.07 session lifecycle acceptance suite (#41), as merged on
`origin/main` (review read at `5e13939`).

## Findings (severity-indexed; all STATIC)

BLOCK MERGE means: at least one finding (§4 H1) blocks the merge on its own in the
reviewers' static judgement; the rest are follow-up hardening, founder to confirm.

- **H1 (HIGH, both reviewers): warm-cache `clearCache` hides removed-member reads vs
  FS-16.** The acceptance suite clears the request-context cache to observe post-removal
  behaviour; production instances keep the warm cache, so a removed member's reads may
  still pass on a warm instance where the test (with a cleared cache) sees refusal. The
  suite therefore proves the re-check logic but not the FS-16 enforcement latency on a
  warm instance. STATIC. Proposed: a test that asserts refusal on a warm cache without
  clearing (or a bound on the staleness window the suite actually exercises).
- **M1 (MEDIUM): sign-out-others with no live other session.** The happy path (other live
  sessions exist and die) is covered; the degenerate case — no other live session, stale
  tokens, already-revoked family — has no asserted outcome. STATIC. Proposed: pin the
  response and the no-op audit shape for the empty set.
- **M2 (MEDIUM): rotation reads as re-login supersession.** Session rotation retires the
  predecessor and mints a successor with carried-over authority; the suite does not pin
  down which predecessor properties must NOT survive rotation (supersession vs
  continuation semantics). STATIC. Proposed: assert the non-carried set explicitly.
- **M3 (MEDIUM): absolute-expiry not pinned.** Idle expiry is exercised; the absolute
  ceiling has no test that fails if it slides or disappears. STATIC. Proposed: a test
  holding a session past its absolute expiry expecting refusal.
- **Security-only: fixation — no planted-cookie case.** No test plants a foreign session
  cookie pre-login and asserts it is not adopted after sign-in. STATIC. Proposed: add the
  planted-cookie rejection test.
- **EV-P06-052 L1–L4 artifact gap.** The §4 evidence record lists four lower-severity
  observations whose test artifacts are referenced but not pinned to files/commands that
  fail without the fix. STATIC (documentation gap, not a code claim). Proposed: link each
  L-item to its exact test command and mutant in a follow-up evidence amendment.

## Disposition

None fixed in this change (documentation task only; §4 fixes ride a later hardening PR).
Founder verdict PENDING for §4. BLOCK MERGE is the reviewers' static verdict, not founder
acceptance — P06 stays READY_FOR_REVIEW at most, nothing here marks any item VERIFIED.

Sensitive material is stored by reference only (PLAN.md evidence rules).
