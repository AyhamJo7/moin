# EV-P06-070: QG-09 §5 RBAC review (security+architecture, static): BLOCK MERGE both; sec H1 + M1/M2/M3, arch H1/H2/H3/H4 + M1-M4; founder verdict PENDING

| Field | Value |
|---|---|
| Evidence ID | EV-P06-070 |
| Item | P06.07.05 |
| Date (UTC) | 2026-10-09 |
| Commit | `5e13939f8623fc56531a63deab45a2f7348c024f` (reviewed `origin/main`; this docs-only change implements nothing) |
| Environment | local (static reviewer read; no DB, no tests run) |
| Command / procedure | Static read by security-reviewer + architecture-reviewer of the §5 merge range (RBAC matrix #42, `af2a320`, plus real-route matrix #52, `80b8a00`). No code executed, no fix implemented — documentation of reviewer output only. |
| Result | BLOCK MERGE, both reviewers (static verdict — distinct from founder acceptance; founder verdict PENDING). Open findings below, all STATIC/UNVERIFIED (no runtime proof claimed). |
| CI run / artifact | not applicable (review record, no code change) |
| Reviewer | security-reviewer + architecture-reviewer (static); founder verdict PENDING |

## Reviewed SHAs

`af2a320` feat(auth): RBAC matrix, role guard, last-owner trigger (#42) and `80b8a00`
test(p06): real-route RBAC matrix (#52), as merged on `origin/main` (review read at
`5e13939`).

## Findings — security reviewer (severity-indexed; all STATIC)

- **H1 (HIGH, sec): concurrent last-owner removal race.** Two concurrent remove/demote
  transactions against the last two owners can both pass the application-level check
  before either commits; the DB trigger is the backstop, but the race window between the
  service check and commit leaves concurrent removals (RR isolation) able to empty the
  owner set at the application layer. STATIC. Proposed: serialise owner-set mutations
  per organisation (advisory lock) or re-check inside the write transaction.
- **M1 (MEDIUM, sec): owner-invitation revoke without `manage-owners`.** Revoking an
  invitation that names the owner role requires only the base manage capability in the
  revoke path, not the owner-management capability the invite path demands. STATIC.
  Proposed: require `manage-owners` for revoke when the invitation role is owner.
- **M2 (MEDIUM, sec): unknown-role additive permissions.** An unrecognised role value
  combined with additive permission flags is not rejected fail-closed in every path;
  unknown roles should hold nothing. STATIC. Proposed: deny-by-default on unknown role
  in the guard and the service checks.
- **M3 (MEDIUM, sec): staff-invite delegation.** A staff holder of a narrow invite
  permission can invite further accounts within that permission's scope, extending the
  membership set without an owner/admin act. STATIC. Proposed: bound delegation (inviter
  must hold the invited role's full capability) or owner/admin-only invite.

## Findings — architecture reviewer (severity-indexed; all STATIC)

- **H1 (HIGH, arch): trigger ignores user-active state.** The last-owner trigger counts
  owners by role without conjoining the user's active state, so a disabled-user's owner
  row can satisfy the backstop while no acting owner exists. STATIC. Proposed: conjoin
  `users.status = 'active'` (or the membership active-state equivalent) in the trigger
  predicate.
- **H2 (HIGH, arch): org-lock-after-row-lock deadlock.** The trigger path locks the
  membership row first and takes the organisation serialisation lock after; concurrent
  multi-row membership writes can AB-BA against each other. STATIC. Proposed: take the
  org lock before any row lock, in a single canonical order (cf. §2 FIX-1 pattern).
- **H3 (HIGH, arch): DELETE trigger blocks cascade tenant deletion.** The AFTER DELETE
  trigger fires on cascade deletes during tenant termination, refusing the very deletion
  the retention engine requires. STATIC. Proposed: exempt cascade/termination context
  (e.g. termination marker) or convert to a guarded check outside the cascade path.
- **H4 (HIGH, arch): unknown-role + `billing_admin`.** An unknown role carrying the
  billing permission flag is not denied in every check path; combined with M2/sec this is
  a privilege-confused state. STATIC. Proposed: same deny-by-default as M2/sec, with an
  explicit test for unknown-role-plus-permission combinations.
- **M1–M4 (MEDIUM, arch): service-layer / inventory / pin gaps.** M1: service-layer
  checks duplicate guard logic and can drift from it. M2: route inventory misses
  non-controller routes (mounted outside the inventoried controllers). M3: the EXPECTED
  capability pin covers decorated routes only — undecorated routes pass silently. M4:
  permission-flag combinations lack an exhaustive matrix test. STATIC. Proposed: single
  source of truth for the decision table with generated guard + service checks; inventory
  from the live router; pin fails on undecorated routes; exhaustive permission matrix.

## Disposition

None fixed in this change (documentation task only; §5 fixes ride later fix PRs). Founder
verdict PENDING for §5. BLOCK MERGE is the reviewers' static verdict, not founder
acceptance — P06 stays READY_FOR_REVIEW at most, nothing here marks any item VERIFIED.

Sensitive material is stored by reference only (PLAN.md evidence rules).
