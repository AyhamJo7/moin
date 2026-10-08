# QG-09 work plan — sensitive-area review of the READY_FOR_REVIEW P06 sections

**Gate:** QG-09 (PLAN L5583) — changes to auth, sessions, RLS/roles, `SECURITY DEFINER`,
tool guard, webhooks, integrations, billing, privacy handlers get a second review by the
`security-reviewer` + `architecture-reviewer` agents, plus the founder; findings resolved.

**Trigger:** the P06 sections below are built and at READY_FOR_REVIEW (none VERIFIED); P05
would pour cloud concrete on top of them. Per the orchestrator decision attached at the end,
QG-09 runs before the P05 kickoff.

**How to run (do NOT run reviewers ad hoc — one orchestrated pass):** for each section, spawn
both agents against the section's merge range with the section's invariants as the contract;
collect severity-ranked findings; fix PRs go through the normal claude→codex→merge loop; the
founder records the verdict with residual dispositions per section
(precedent: P06.10.06 ADR-0017 acceptance at `468827a` with five residuals).

Agent invocation shape (each agent is read-only; tools per its frontmatter):

- `security-reviewer`: adversarial OWASP Top 10 + stated invariants — injection, authz,
  multi-tenant isolation, secrets, data leakage, deps. Findings severity-ranked with fixes.
- `architecture-reviewer`: layering/dependency direction, error-handling placement,
  framework misuse, concurrency, data-model integrity, schema/migration safety.

Evidence-record shape (one per section, or consolidated only if both reviewers agree
section-by-section): `docs/evidence/P06/EV-P06-0NN-qg09-<section>.md` via
`evidence.py new --phase P06 --item <section> --slug qg09-<section>`, carrying: reviewed
merge SHA, reviewer verdicts (verbatim or linked), findings with dispositions
(fixed-in-PR# / accepted-residual-with-reason / rejected-with-reason), residual list feeding
P05 security requirements, and the founder verdict. PLAN ledger + PROGRESS rows follow.

## Sections (merge SHAs are the reviewed targets on `origin/main`)

| #   | Section                       | Merge SHA (main)                                                                            | Scope for reviewers                                                   | Evidence on file                   |
| --- | ----------------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ---------------------------------- |
| 1   | P06.06.04 step-up             | `1012c27` feat(auth): step-up MFA (#38)                                                     | step-up stamp, 15-min window, RequireStepUpGuard ordering             | EV-P06-049                         |
| 2   | P06.06.05 revocation          | `2476d16` feat(auth): revoke sessions (#39)                                                 | 0016 trigger, revoke overloads, lock order                            | EV-P06-050                         |
| 3   | P06.06.06 CSRF                | `c51404e` feat(auth): CSRF synchronizer (#40)                                               | double-submit token, Origin check, guard order                        | EV-P06-051                         |
| 4   | P06.06.07 lifecycle           | `858ab7c` test(auth): lifecycle suite (#41)                                                 | acceptance suite, expiry/revocation paths                             | EV-P06-052                         |
| 5   | P06.07 RBAC + matrix          | `af2a320` feat(auth): RBAC matrix (#42) + `80b8a00` real-route matrix (#52, EV-P06-061/062) | decision table, RequireRoleGuard, last-owner trigger, EXPECTED pin    | EV-P06-053, EV-P06-061, EV-P06-062 |
| 6   | P06.08 invitations + unassign | `d09f040` invitations (#43) + `d4fe924` tasks table (#54, EV-P06-063)                       | token digests, accept flow, disable/remove/transfer, unassign trigger | EV-P06-054, EV-P06-063             |
| 7   | P06.09 recovery               | `ccb8e1f` feat(auth): recovery (#44)                                                        | disable/enable, revoke-sessions, containment honesty                  | EV-P06-055                         |
| 8   | P06.10.03 audit adoption      | `393089a` feat(audit): writer (#45)                                                         | correlation threading, allowlists, session deferral                   | EV-P06-056                         |
| 9   | P06.11 support grants         | `cee45a5` feat(auth): grants (#46)                                                          | grant lifecycle, DEFINER-gated reads, emergency access                | EV-P06-057                         |
| 10  | P06.12 throttles + lockout    | `5635d44` feat(auth): throttles (#47) + `9044400` lockout docs (#56, EV-P06-064)            | IP/account buckets, security events, runbook accuracy                 | EV-P06-058, EV-P06-064             |
| 11  | P06.13 xsuite + CI            | `d5815a3` xsuite v1 (#48) + `1e2224a` CI wiring (#50)                                       | route inventory 100%, cross-tenant probes, release-blocking           | EV-P06-059                         |
| 12  | P06.03.02 session tenant      | `70031d7` tenant-from-session (#49, EV-P06-060)                                             | INV-02 interceptor, forged org/header/query/body                      | EV-P06-060                         |
| 13  | P06.03.04 resolve_route       | `e73482d` number_routes (#57, EV-P06-065)                                                   | global-table exemption, DEFINER minimal return, release-is-DELETE     | EV-P06-065                         |

Out of scope (not READY_FOR_REVIEW, not reviewed here): P06.03.03 job envelope (BLOCKED on
P08), P06.05 Cognito pool (P05/EXT-09), P06.11.01 operator identity (P05/EXT-09), P06.10.05
sweeps (EXT-09), WAF rules (P05/EXT-09), P06.09.04 founder tabletop (founder-run).

## Residual routing to P05 (expected, from the ledger)

Confirmed residuals become P05 security requirements: operator identity (P06.11.01), WAF
rules (P06.12.01), Cognito threat-protection tier (P06.05.03), deny-new-access mechanism
(P06.09.02), owner notification email (P06.12.02/P14).

---

## Appendix — orchestrator decision rationale (attached verbatim)

The content below is the founder's orchestrator decision from
`/tmp/ORCH-DECISION-20261008.md`, attached here so the plan carries its authorization.

# Orchestrator decision — 2026-10-08: QG-09 before P05 kickoff

## Decision

Run the QG-09 sensitive-area review triad over the READY_FOR_REVIEW P06 sections
(.06.04–.13) before kicking off P05 (cloud foundation).

## Rationale

1. P05 provisions real cloud (Terraform bootstrap, Secrets Manager, Cognito pools,
   ALB OIDC, WAF, CloudWatch alarms — all EXT-09/founder). Pouring concrete on top
   of unreviewed auth/session/RLS/DEFINER code risks baking in flaws that are
   expensive to fix after infra exists. QG-09 exists precisely as the gate before
   that step (PLAN QG-09 row; P06 phase contract).
2. P05 is almost entirely WAITING_FOR_EXTERNAL: no AWS credentials exist in-session,
   `terraform plan` is founder-only, bootstrap is founder-applied. An orchestrated
   P05 "kickoff" now would produce scaffolding with no verifiable target and burn
   CI minutes. QG-09 is fully executable locally (read-only reviewer agents +
   founder verdict).
3. QG-09 output directly feeds P05: confirmed residual risks become P05 security
   requirements (e.g. operator identity P06.11.01, WAF rules P06.12.01, Cognito
   threat protection P06.05.03 tier decision).

## Scope of the QG-09 run

- Sections: P06.06.04 (step-up), .06.05 (revocation), .06.06 (CSRF), .06.07
  (lifecycle), P06.07 (RBAC + real-route matrix), P06.08 (invitations, incl.
  tasks unassign), P06.09 (recovery), P06.10.03 (audit adoption), P06.11
  (support grants), P06.12 (throttles + lockout docs), P06.13 (xsuite + CI wiring),
  P06.03.02/.03.04 (tenant resolution incl. resolve_route).
- Per QG-09: security-reviewer + architecture-reviewer agents, then founder
  verdict with recorded residual dispositions (precedent: P06.10.06 ADR-0017
  acceptance at 468827a with five residuals).
- Deliverable: one evidence record per section (or a consolidated record if the
  reviewers agree section-by-section), PLAN ledger row updated to show QG-09
  IN_PROGRESS → section verdicts, PROGRESS rows. No code changes expected; any
  reviewer finding becomes a fix PR through the normal claude→codex→merge loop.

## Sequencing with the LICENSE work

LICENSE + README clarification ships first (founder-directed, tiny, unblocks the
public-repo ambiguity immediately). QG-09 prep starts right after, on fresh main.
