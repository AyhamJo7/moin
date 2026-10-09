# EV-P06-072: QG-09 §7 recovery review (security+architecture, static): BLOCK MERGE both; sec H1 + M1/M2 + L1–L3, arch H1/H2 + M1/M2/M3; founder verdict PENDING

| Field | Value |
|---|---|
| Evidence ID | EV-P06-072 |
| Item | P06.09.04 |
| Date (UTC) | 2026-10-09 |
| Commit | `5e13939f8623fc56531a63deab45a2f7348c024f` (reviewed `origin/main`; this docs-only change implements nothing) |
| Environment | local (static reviewer read; no DB, no tests run) |
| Command / procedure | Static read by security-reviewer + architecture-reviewer of the §7 merge range (account recovery #44, `ccb8e1f`). No code executed, no fix implemented — documentation of reviewer output only. |
| Result | BLOCK MERGE, both reviewers (static verdict — distinct from founder acceptance; founder verdict PENDING). Open findings below, all STATIC/UNVERIFIED (no runtime proof claimed). |
| CI run / artifact | not applicable (review record, no code change) |
| Reviewer | security-reviewer + architecture-reviewer (static); founder verdict PENDING |

## Reviewed SHA

`ccb8e1f` feat(auth): account recovery disable, revoke and tabletop (#44), as merged on
`origin/main` (review read at `5e13939`).

## Findings — security reviewer (severity-indexed; all STATIC)

- **H1 (HIGH, sec): cross-tenant disable/revoke via global user.** Disable and
  revoke-sessions resolve the target by global user id; a caller in org A naming a user
  known only in org B reaches a cross-tenant write path that the tenant guard must catch
  downstream rather than being unexpressible at the lookup. STATIC. Proposed: scope the
  target lookup by the caller's organisation first (membership-gated), so a foreign user
  id resolves to nothing before any write path.
- **M1 (MEDIUM, sec): DEFINER executes with no actor authentication.** The recovery
  DEFINER functions run with owner privilege and take the actor as a parameter rather
  than authenticating it; a caller that can reach the function can name any actor.
  STATIC. Proposed: bind the actor to the guarded session inside the function (or assert
  the caller's right to name the actor) rather than accepting it as input.
- **M2 (MEDIUM, sec): disabled-owner strands the tenant.** Disabling the last acting
  owner (short of the last-owner backstop) leaves a tenant with no one able to act while
  the organisation persists; no strand-detection or break-glass path is defined.
  STATIC. Proposed: strand check on disable (refuse or require transfer first) plus a
  documented break-glass procedure.
- **L1–L3 (LOW, sec): audit / 404 / runbook gaps.** L1: recovery writes lack uniform
  audit-field coverage. L2: 404-vs-403 behaviour across recovery paths is not pinned by
  a matrix test. L3: the runbook references recovery flows whose entry preconditions
  are not all built. STATIC. Proposed: per-item hardening with tests.

## Findings — architecture reviewer (severity-indexed; all STATIC)

- **H1 (HIGH, arch): user-first vs family-first 40P01 — overlaps §2.** Recovery writes
  take the user row before session families while readers take family-first (same §2
  FIX-1 AB-BA shape); concurrent recovery + session read can deadlock with 40P01.
  STATIC (concurrency/deadlock detail preserved; no separate reproduction claimed —
  the reproduced case is §2 FIX-1). Proposed: same canonical lock order as the §2 fix.
- **H2 (HIGH, arch): cross-tenant strand.** As sec H1 from the availability side: a
  cross-tenant disable that the guard catches late still strands audit/expectation —
  the caller believes an action was taken in their tenant. STATIC. Proposed: same
  membership-gated lookup as sec H1, plus explicit not-found semantics.
- **M1 (MEDIUM, arch): controller-owns-transaction layering.** Recovery transaction
  boundaries live in controllers rather than services; transaction scope and rollback
  semantics duplicate per route and can drift. STATIC. Proposed: move transaction
  ownership into the service layer with one boundary per use case.
- **M2 (MEDIUM, arch): disabled-callback + race/audit tests missing.** The
  disabled-account callback path and its race with concurrent sign-in lack regression
  tests, as does the audit row for the disabled path. STATIC. Proposed: add both tests.
- **M3 (MEDIUM, arch): EV-P06-055 dirty-predecessor evidence gap.** The §7 evidence
  record was written against a dirty predecessor commit, so its recorded HEAD does not
  reproduce the reviewed tree. STATIC (evidence-hygiene gap, not a code claim).
  Proposed: re-record EV-P06-055 commands at a clean HEAD in a follow-up amendment.

## Disposition

None fixed in this change (documentation task only). Founder verdict PENDING for §7.
BLOCK MERGE is the reviewers' static verdict, not founder acceptance — P06 stays
READY_FOR_REVIEW at most, nothing here marks any item VERIFIED.

Sensitive material is stored by reference only (PLAN.md evidence rules).
