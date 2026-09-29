# P06 — Tenancy, Identity, Authorization and Audit Foundation · session plan

**Phase:** P06 · **Tier:** PILOT · **Target:** 2026-10-05 → 2026-10-14 · **Effort:** 6 engineering-days
**Plan source:** PLAN.md L2536–L2683 · **Dependencies:** P02 (CI, harness), P03 (ADR-0003/0004/0005/0017), P05 (Cognito and Secrets Manager in staging)

Planned under the founder's standing program authorization. Nothing here changes product scope, an
invariant, a gate, a threshold, a legal or commercial commitment, or introduces an architecture
deviation PLAN does not already carry.

## The dependency situation, stated plainly

The phase dependency table (PLAN L1756) makes P06 depend on **P02 and P03 only**, and lists it as
parallel with P05. Both are substantively met: P02.03 and the four ADRs P06 needs exist and are
individually verified.

What is _not_ met is the label. A session may raise a phase to `READY_FOR_REVIEW` at most;
`VERIFIED` is the founder's call, and P02 and P03 are `READY_FOR_REVIEW` pending the merge queue.
So a strict tier-scoped dependency check fails on status, not on substance.

This plan therefore proceeds on the substance and says so, rather than either waiting on a label or
pretending the label is set. If the founder's review of the stack changes anything in P02.03 or in
ADR-0003/0004/0005, the affected P06 work is redone — which is a real cost and is the reason the
merge queue is the first founder action in `PROGRESS.md`, not the last.

## What P05 actually blocks, and what it does not

P06's own dependency line names P05, but only three sections need it:

| section                                       | needs P05 because                               | can be built now                                                                           |
| --------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------ |
| P06.01.03 role credentials in Secrets Manager | Secrets Manager does not exist                  | the roles, privileges and their tests do                                                   |
| P06.05 Cognito pool and MFA                   | it is Terraform against an AWS account (EXT-09) | the **local OIDC provider** with the same claim shape (P06.05.04), and the claims contract |
| P06.06 sessions                               | the Cognito callback needs a pool               | the session table, cookie, lifecycle, CSRF and revocation, against the local provider      |
| P06.11.01 operator pool + ALB OIDC            | same                                            | the grant model, the views and their tests                                                 |

Everything else — roles, RLS, the catalog check, tenant context, provisioning, RBAC, audit,
system-work, the cross-tenant suite — is PostgreSQL and application code, and runs against the
local stack that P02.04 already provides.

## Why this phase is the one to get right

It implements **INV-01, INV-02, INV-10 and INV-15**, and it is the precondition for any real
personal data entering the system. Everything after it assumes isolation rather than proving it.

The failure mode is specific and worth naming: isolation that is enforced in _one_ place — usually
the application query builder — and is therefore absent wherever someone writes a query by hand,
adds a job handler, or ships a webhook. PLAN's answer is that isolation is enforced in the
**database**, by FORCE RLS on a `NOBYPASSRLS` role that owns no tables, so that the application
being wrong is not sufficient to leak. Every item below serves that, or proves it.

## Execution order and why

1. **P06.01 roles and privileges first.** Every later test asserts what a role _cannot_ do. Without
   the roles, those assertions have nothing to run as, and a suite that runs as the owner proves
   nothing at all.
2. **P06.02 RLS framework and the catalog check second**, before any tenant table exists. A policy
   template applied to the first table is a convention; a catalog check that fails on a table
   without FORCE RLS is a rule. Writing it first means no tenant table can ever be added without it.
3. **P06.03 tenant context third.** `withTenant` is the only sanctioned path to a connection, and
   the boundary rule that enforces it is already in `.dependency-cruiser.cjs` (P02.02.07) awaiting
   activation.
4. **P06.14 `withSystemWork` immediately after**, because the background path is where tenant
   context is usually forgotten, and building it late means retrofitting every job handler.
5. **P06.04 provisioning**, which is the first thing to create a tenant, and therefore the first
   thing that can create two.
6. **P06.10 audit**, before RBAC, because RBAC decisions are among the things that must be audited.
7. **P06.07 RBAC**, then **P06.13 the cross-tenant suite**, which is the phase's actual deliverable:
   a route-inventory test that enumerates every route and asserts 100 % coverage.
8. **P06.05, P06.06, P06.11** against the local OIDC provider, with the AWS half recorded as
   `WAITING_FOR_EXTERNAL`.
9. **P06.08, P06.09, P06.12** last: invitations are `[G:LAUNCH]`, and recovery and abuse protection
   need the session layer beneath them.

## Scope for this session

| section                                     | tier   | internally executable now                                  |
| ------------------------------------------- | ------ | ---------------------------------------------------------- |
| P06.01 Database roles and privileges        | PILOT  | all but `.03` (Secrets Manager)                            |
| P06.02 RLS framework and catalog check      | PILOT  | **all**                                                    |
| P06.03 Tenant context propagation           | PILOT  | **all**                                                    |
| P06.04 Organisation, location, provisioning | PILOT  | **all**                                                    |
| P06.05 Cognito user pool and MFA            | PILOT  | `.04` only; the rest is P05 + EXT-09                       |
| P06.06 Server-side sessions                 | PILOT  | all against the local provider; staging verification waits |
| P06.07 RBAC and permission matrix           | PILOT  | **all**                                                    |
| P06.08 Invitations                          | LAUNCH | all; out of PILOT scope, done if time allows               |
| P06.09 Recovery and MFA reset               | PILOT  | the runbooks; the tabletop is a founder exercise           |
| P06.10 Audit event infrastructure           | PILOT  | **all**                                                    |
| P06.11 Operator identity and grants         | PILOT  | the grant model and views; the pool is P05                 |
| P06.12 Authentication abuse protection      | PILOT  | application throttles; WAF is P05/P17                      |
| P06.13 Cross-tenant security suite v1       | PILOT  | **all**                                                    |
| P06.14 System-work pattern                  | PILOT  | **all**                                                    |

## The three items that decide whether this phase worked

Everything else supports these.

**P06.02.07 — the catalog check fails on a fixture table without FORCE RLS.** A check that has
never failed is a check nobody has tested. The fixture is the evidence.

**P06.13.02 — route-inventory coverage is 100 %, computed rather than asserted.** A cross-tenant
suite that covers the routes someone remembered is worth little; the number that matters is the
one the suite derives from the route table itself, and it must equal the route count.

**P06.10.07 — tampering is detected.** A hash chain that is never verified against a tampered row
is a column of hashes.

## QG-09

This phase is almost entirely control paths: auth, sessions, RLS and roles, `SECURITY DEFINER`
functions, the tool-guard foundation, ownership and state transitions. `/gate-ready` runs the
`security-reviewer`, `architecture-reviewer` **and** `invariant-reviewer` on the diff, and
HIGH/CRITICAL findings are closed with a mutation-proven test or block the review.

## Open questions for the founder

**Q1 — Cognito feature tier (PLAN "Architecture decisions").** Threat protection and passkeys are
priced tiers. This is a cost decision, and it is yours. The engineering work is unaffected: the
local provider carries the same claim shape either way, and the tier changes what staging enables.

**Q2 — session timeouts (T-15).** PLAN sets idle 12 h and absolute 7 days, to be validated with
Gurlitt. Building to those numbers now; if Gurlitt's answer differs, it is configuration.

**Q3 — the Early Access cap (P06.04.03).** PLAN caps provisioning at five paid organisations until
the P30 pentest is complete, with an override needing a founder-signed flag change. Implementing it
as written. Confirm that five is still the number.
