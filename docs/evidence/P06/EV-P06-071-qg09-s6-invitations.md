# EV-P06-071: QG-09 §6 invitations review (security+architecture, static): BLOCK MERGE both; sec H1/H2 + M1, arch H1–H5 + M1–M5; founder verdict PENDING

| Field | Value |
|---|---|
| Evidence ID | EV-P06-071 |
| Item | P06.08.03 |
| Date (UTC) | 2026-10-09 |
| Commit | `5e13939f8623fc56531a63deab45a2f7348c024f` (reviewed `origin/main`; this docs-only change implements nothing) |
| Environment | local (static reviewer read; no DB, no tests run) |
| Command / procedure | Static read by security-reviewer + architecture-reviewer of the §6 merge range (invitations #43, `d09f040`, plus tasks table #54, `d4fe924`). No code executed, no fix implemented — documentation of reviewer output only. |
| Result | BLOCK MERGE, both reviewers (static verdict — distinct from founder acceptance; founder verdict PENDING). Open findings below, all STATIC/UNVERIFIED (no runtime proof claimed). |
| CI run / artifact | not applicable (review record, no code change) |
| Reviewer | security-reviewer + architecture-reviewer (static); founder verdict PENDING |

## Reviewed SHAs

`d09f040` feat(auth): invitations and membership lifecycle (#43) and `d4fe924` feat(p06):
tasks table with return-to-unassigned (#54), as merged on `origin/main` (review read at
`5e13939`).

## Findings — security reviewer (severity-indexed; all STATIC)

- **H1 (HIGH, sec): missing fresh step-up on invite/revoke/disable.** Invitation issue,
  invitation revoke and member disable paths do not demand a fresh step-up proof while
  sibling sensitive paths (remove, transfer) do; a stolen session within its step-up
  window can grow or shrink the membership set. STATIC. Proposed: require fresh step-up
  on all three paths, with tests asserting stale-proof refusal.
- **H2 (HIGH, sec): owner-invitation revoke without `manage-owners`.** As §5 M1/sec: the
  revoke path does not demand the owner-management capability when the invitation names
  the owner role. STATIC. Proposed: same fix — capability keyed off the invitation role.
- **M1 (MEDIUM, sec): additive-permission delegation.** As §5 M3/sec: narrow permission
  holders can extend the membership set within their permission scope. STATIC. Proposed:
  bound delegation or owner/admin-only invite.

## Findings — architecture reviewer (severity-indexed; all STATIC)

- **H1 (HIGH, arch): pending invite reactivates disabled/removed member.** Accepting a
  still-pending invitation for a person whose membership was since disabled or removed
  re-establishes access through the stale invite, bypassing the disable/remove decision.
  STATIC. Proposed: consume or invalidate pending invites on disable/remove, and check
  membership state inside the accept transaction.
- **H2 (HIGH, arch): no pre-session HTTP accept route.** Acceptance has no
  unauthenticated HTTP entry path (invitee has no session by design); the flow depends on
  out-of-band delivery plus a session the invitee may not be able to establish. STATIC
  (design gap, founder decision recorded in PLAN). Proposed: founder-decided accept
  entry path; until then the gap stays open and documented.
- **H3 (HIGH, arch): guard-time authority not rechecked in-transaction, incl. zero-row
  transfer.** The capability check runs at guard time against a cached membership read;
  the write transaction does not re-check authority — including the transfer path, where
  a zero-row write can report success without moving anything. STATIC. Proposed:
  re-check authority inside every membership write transaction; assert affected-row
  counts and fail on zero rows.
- **H4 (HIGH, arch): accept writes user-before-membership vs disable writes
  membership-then-user — deadlock pair.** Accept creates/links in user→membership order
  while disable mutates in membership→user order; concurrent accept + disable of the
  same person can AB-BA. STATIC (concurrency/deadlock detail preserved; cf. §2 FIX-1
  pattern). Proposed: single canonical lock order for user/membership pairs.
- **H5 (HIGH, arch): org-lock-after-row deadlock.** As §5 H2/arch: the organisation
  serialisation lock is taken after the membership row lock. STATIC. Proposed: org lock
  first, canonical order.
- **M1–M5 (MEDIUM, arch): tasks-repoint / audit / retry / layering gaps.** M1:
  tasks-repoint on disable/remove misses in-flight assignments created concurrently. M2:
  membership writes lack per-row audit coverage for some paths. M3: invitation retry
  semantics (re-issue vs re-send) are unspecified. M4: controller/service layering —
  membership logic lives partly in controllers. M5: unassign-trigger interaction with
  concurrent membership writes needs a serialisation test. STATIC. Proposed: address per
  item in fix PRs with regression tests.

## Disposition

None fixed in this change (documentation task only). Founder verdict PENDING for §6.
BLOCK MERGE is the reviewers' static verdict, not founder acceptance — P06 stays
READY_FOR_REVIEW at most, nothing here marks any item VERIFIED.

Sensitive material is stored by reference only (PLAN.md evidence rules).
