---
mission: P02 closed; P04 engineering done bar external; P06 tenancy spine in progress
status: active
mode: autonomous
phase: P06
tier: PILOT
plan: docs/phases/P06-plan.md
next: founder runs QG-09 on the READY_FOR_REVIEW sections (P06.06.04–.07, .07, .08, .09, .10.03, .11, .12, .13, .03.02); engineering resumes at P06.03.03/.03.07 job half when P08 provides the job envelope, and P06.03.04 when resolve_route exists; EXT-09/P05 gate P06.05, P06.10.05, P06.11.01, WAF
updated: 2026-10-08
---

# PROGRESS — moin

Append-only execution ledger. One row per checklist item, carrying the commit that
implemented it and the evidence record that verifies it. Status vocabulary is PLAN.md's
(`NOT_STARTED`, `IN_PROGRESS`, `BLOCKED`, `WAITING_FOR_EXTERNAL`, `READY_FOR_REVIEW`,
`VERIFIED`, `COMPLETE`, `DEFERRED`). The Status Ledger in PLAN.md is the source of truth for
_phase_ status; this file records _item_ progress and the order it happened in.

Rules

- Append; never rewrite or delete a row. A correction is a new row that says what it corrects.
- An item reaches `VERIFIED` only with an `EV-Pxx-nnn` evidence record, never on a claim.
- Implementation and verification are separate rows, because they are separate checklist items.
- A `BLOCKER` entry names what was tried, why it is not progressing, and what would unblock it.
- `WAITING_FOR_EXTERNAL` rows carry counterparty, request date, expected date and fallback.

## Items

| Item      | Status               | Commit | Evidence               | Note                                                                                    |
| --------- | -------------------- | ------ | ---------------------- | --------------------------------------------------------------------------------------- |
| P02.01.02 | READY_FOR_REVIEW     | PR #3  | EV-P02-003             | CODEOWNERS, PR template, two issue templates, issue config                              |
| P02.01.03 | READY_FOR_REVIEW     | PR #3  | EV-P02-004             | `pr-title` workflow; both policy checks self-test against the founder-owned policy file |
| P02.01.04 | READY_FOR_REVIEW     | PR #3  | EV-P02-005             | This ledger, the evidence registry and the record template                              |
| P02.01.05 | READY_FOR_REVIEW     | PR #3  | EV-P02-006             | `README.md`, `CONTRIBUTING.md`                                                          |
| P02.01.06 | READY_FOR_REVIEW     | PR #3  | EV-P02-007             | `docs/development/release-tags.md`                                                      |
| P02.01.01 | WAITING_FOR_EXTERNAL | —      | —                      | Ruleset on `main` (EXT-24); apply only after the P02.06 workflows are on `main`         |
| P02.01.07 | BLOCKED              | —      | —                      | Verification of the ruleset; blocked by P02.01.01                                       |
| P02.02.01 | READY_FOR_REVIEW     | PR #4  | EV-P02-002             | Node 24.21.0 via nvm; pnpm 10.34.5 via corepack                                         |
| P02.02.02 | READY_FOR_REVIEW     | PR #4  | EV-P02-008             | Turborepo tasks; the gate-config replacement is patch 0003, founder-applied             |
| P02.02.03 | READY_FOR_REVIEW     | PR #4  | EV-P02-009, EV-P02-019 | TS 6.0.3 strict; validated against NestJS 12 and Next 16, fallback not taken            |
| P02.02.04 | READY_FOR_REVIEW     | PR #4  | EV-P02-001             | ESLint flat config; every ban proven by a violating fixture                             |
| P02.02.05 | READY_FOR_REVIEW     | PR #4  | EV-P02-001             | `moin/no-tenant-conditional` (INV-18), `moin/no-direct-db-access`; off until P06.03     |
| P02.02.06 | READY_FOR_REVIEW     | PR #4  | EV-P02-010             | Prettier, `.editorconfig`                                                               |
| P02.02.07 | READY_FOR_REVIEW     | PR #4  | EV-P02-011, EV-P02-020 | dependency-cruiser; boundary rules proven by violating trees                            |
| P02.02.08 | READY_FOR_REVIEW     | PR #4  | EV-P02-002             | Terraform 1.16.4, tflint 0.64.0, Trivy 0.74.0                                           |
| P02.02.09 | READY_FOR_REVIEW     | PR #4  | EV-P02-002             | ADR-0002, ADR-0034 accepted                                                             |
| P02.02.10 | READY_FOR_REVIEW     | PR #4  | EV-P02-001             | Mutation-proven non-vacuous                                                             |
| P02.03.01 | READY_FOR_REVIEW     | PR #5  | EV-P02-012             | Full tree; 12 workspaces; boundaries clean                                              |
| P02.03.02 | READY_FOR_REVIEW     | PR #5  | EV-P02-013             | Four roles from one image; mismatch guard exits 1                                       |
| P02.03.03 | READY_FOR_REVIEW     | PR #5  | EV-P02-014             | Zod loader; a rejected secret is never echoed (INV-15)                                  |
| P02.03.04 | READY_FOR_REVIEW     | PR #5  | EV-P02-015             | Pino allowlist; three leaks found by review, all closed, mutation-proven                |
| P02.03.05 | READY_FOR_REVIEW     | PR #5  | EV-P02-016             | `/healthz` 200, `/readyz` 503; single-flight; thin unauthenticated body                 |
| P02.03.06 | READY_FOR_REVIEW     | PR #5  | EV-P02-017             | arm64, non-root, read-only FS, no package manager; 379 MiB                              |
| P02.03.07 | READY_FOR_REVIEW     | PR #5  | EV-P02-018             | All four roles verified live in containers                                              |
| P02.03    | READY_FOR_REVIEW     | PR #5  | EV-P02-021             | QG-09 review: 1 Critical + 11 High, all reproduced then fixed                           |
| P02.04.01 | READY_FOR_REVIEW     | PR #6  | EV-P02-024             | Six services, digest-pinned, healthy in 26 s from empty volumes                         |
| P02.04.02 | READY_FOR_REVIEW     | PR #6  | EV-P02-025             | dev/db commands; demo tenants defined, rows land in P06.04                              |
| P02.04.03 | READY_FOR_REVIEW     | PR #6  | EV-P02-026             | Example environment file; gitleaks 0 findings                                           |
| P02.04.04 | READY_FOR_REVIEW     | PR #6  | EV-P02-027             | Twilio developer path documented                                                        |
| P02.04.05 | READY_FOR_REVIEW     | PR #6  | EV-P02-023             | `pnpm doctor`                                                                           |
| P02.04.06 | READY_FOR_REVIEW     | PR #6  | EV-P02-022             | 29 s warm; cold download volume recorded; one founder-only step                         |

| P02.05.01 | READY_FOR_REVIEW | PR #7 | EV-P02-028 | Vitest unit + integration projects |
| P02.05.02 | READY_FOR_REVIEW | PR #7 | EV-P02-029 | Template-database clone per file; found two real defects |
| P02.05.03 | READY_FOR_REVIEW | PR #7 | EV-P02-030 | German factories; folding bug on Turkish dotless i found and fixed |
| P02.05.04 | READY_FOR_REVIEW | PR #7 | EV-P02-032 | Playwright + axe; only Chromium installed locally, rest on CI |
| P02.05.05 | READY_FOR_REVIEW | PR #7 | EV-P02-031 | Fault injection + controllable clock |
| P02.05.06 | READY_FOR_REVIEW | PR #7 | EV-P02-033 | Every type passes in-suite and standalone on a fresh database |

| P02.06.04 | READY_FOR_REVIEW | PR #8 | EV-P02-034 | Migration safety check; 6 violating fixtures flagged, 3 safe ones not |
| P02.06.05 | READY_FOR_REVIEW | PR #8 | EV-P02-040 | Reserved slots that fail if their script appears unwired |
| P02.06.06 | READY_FOR_REVIEW | PR #8 | EV-P02-039 | 18 actions + 5 images pinned; actionlint clean |
| P02.08.01 | READY_FOR_REVIEW | PR #8 | EV-P02-037 | Renovate config; not exercised until the App is installed |
| P02.08.02 | READY_FOR_REVIEW | PR #8 | EV-P02-035 | Licence allowlist; LGPL decision flagged for EXT-02 |
| P02.08.03 | READY_FOR_REVIEW | PR #8 | EV-P02-038 | Install-script allowlist, enforced at two layers |
| P02.08.04 | READY_FOR_REVIEW | PR #8 | EV-P02-036 | Four executable negative controls |
| P02.07.01 | READY_FOR_REVIEW | PR #9 | EV-P02-041 | local-setup, testing, conventions |
| P02.07.02 | READY_FOR_REVIEW | PR #9 | EV-P02-042 | ARCHITECTURE.md, SECURITY.md |
| P02.06.01 | READY_FOR_REVIEW | PR #8 | EV-P02-043 | verify green: 8 jobs incl. integration on real PostgreSQL |
| P02.06.02 | READY_FOR_REVIEW | PR #8 | EV-P02-044 | security-scan green |
| P02.06.03 | READY_FOR_REVIEW | PR #8 | EV-P02-045 | container-scan green; image assertions hold |
| P02.06.07 | BLOCKED | — | — | Four negative-control PRs; needs the workflows on `main` and the ruleset (EXT-24) |
| P02.07.03 | BLOCKED | — | — | Fresh-session doc walkthrough; needs a session with no prior context |

| P02.07.01 | READY_FOR_REVIEW | PR #9 | EV-P02-041 | local-setup, testing, conventions |
| P02.07.02 | READY_FOR_REVIEW | PR #9 | EV-P02-042 | ARCHITECTURE.md, SECURITY.md |
| P02.07.03 | READY_FOR_REVIEW | PR #9 | EV-P02-046 | Fresh-session walkthrough; 9 real defects found and fixed |
| P03.01.01 | READY_FOR_REVIEW | PR #10 | EV-P03-001 | ADR process, template, index |
| P03.01.02 | READY_FOR_REVIEW | PR #10 | EV-P03-002 | Ten core ADRs accepted |
| P03.01.03 | READY_FOR_REVIEW | PR #10 | EV-P03-003 | ADR-0011/0018/0019 drafted, all PROPOSED |
| P03.01.04 | READY_FOR_REVIEW | PR #10 | EV-P03-004 | Every ADR names its enforcement; the check found 4 gaps |
| P03.01.05 | READY_FOR_REVIEW | PR #10 | EV-P03-005 | Every INV covered, or accounted for in the register |

| P03.02.01 | READY_FOR_REVIEW | PR #11 | EV-P03-006 | Glossary; Vorgang flagged as at risk, decided by P01 |
| P03.02.02 | READY_FOR_REVIEW | PR #11 | EV-P03-007 | Entity model per module |
| P03.02.03 | READY_FOR_REVIEW | PR #11 | EV-P03-008 | Eleven aggregates with the rule each holds |
| P03.02.04 | READY_FOR_REVIEW | PR #11 | EV-P03-009 | 16 intents, 11 outcomes, 10 task types, all closed |
| P03.02.05 | READY_FOR_REVIEW | PR #11 | EV-P03-010 | ~40 events, id-only payloads |
| P03.02.06 | READY_FOR_REVIEW | PR #11 | EV-P03-011 | 26 blueprint entities, 0 unmapped |
| P03.03.01 | READY_FOR_REVIEW | PR #11 | EV-P03-012 | Call session, with deadlines as numbers |
| P03.03.02 | READY_FOR_REVIEW | PR #11 | EV-P03-012 | Interaction finalisation + reconciler contract |
| P03.03.03 | READY_FOR_REVIEW | PR #11 | EV-P03-012 | Eight further machines |
| P03.03.04 | READY_FOR_REVIEW | PR #11 | EV-P03-012 | Six property tests generated from the tables |

| P03.06.01 | READY_FOR_REVIEW | PR #12 | EV-P03-013 | Field-level inventory; request_text flagged as riskiest |
| P03.06.02 | READY_FOR_REVIEW | PR #12 | EV-P03-014 | Retention matrix; 7 questions for EXT-02 |
| P03.06.03 | READY_FOR_REVIEW | PR #12 | EV-P03-015 | Classification check, proven on a fixture |
| P03.06.04 | READY_FOR_REVIEW | PR #12 | EV-P03-016 | 0 unclassified columns |

| P03.04.01 | READY_FOR_REVIEW | PR #13 | EV-P03-017 | C4 context and containers |
| P03.04.02 | READY_FOR_REVIEW | PR #13 | EV-P03-018 | DFD, five trust boundaries, twelve flows |
| P03.04.03 | READY_FOR_REVIEW | PR #13 | EV-P03-019 | Coverage check; found 3 gaps in the first draft |
| P03.05.01 | READY_FOR_REVIEW | PR #14 | EV-P03-025 | STRIDE, 63 mitigations, all references verified |
| P03.05.02 | READY_FOR_REVIEW | PR #14 | EV-P03-026 | Seven abuse cases; two corrected by the review |
| P03.05.03 | READY_FOR_REVIEW | PR #14 | EV-P03-024 | Independent review: 2 Critical, 7 High, all resolved |
| P03.07.01 | READY_FOR_REVIEW | PR #14 | EV-P03-020 | Lawyer pack prepared, not sent |
| P03.07.02 | READY_FOR_REVIEW | PR #14 | EV-P03-021 | 13 questions, each with a fallback |
| P03.08.01 | READY_FOR_REVIEW | PR #14 | EV-P03-022 | All 20 invariants mapped, with owner |
| P03.08.02 | READY_FOR_REVIEW | PR #14 | EV-P03-023 | 19 automated, 1 documented manual control |
| P04.04.01 | READY_FOR_REVIEW | PR #16 | EV-P04-001 | TwiML builder; the disclosure has no option to be interruptible (INV-03) |
| P04.04.02 | READY_FOR_REVIEW | PR #16 | EV-P04-002 | Codecs; an unknown message type cannot end a call (INV-19) |
| P04.04.03 | READY_FOR_REVIEW | PR #16 | EV-P04-003 | Signature matches Twilio's published vector; single-use 60 s hashed socket token |
| P04.04.04 | READY_FOR_REVIEW | PR #16 | EV-P04-004 | Voice role, media socket, scripted measurement call |
| P04.04.05 | READY_FOR_REVIEW | PR #16 | EV-P04-005 | 301 tests, two of them against a real listening server |
| P04.04.06 | BLOCKED | — | — | Needs a real call: EXT-10 and EXT-11 |
| P04.05.01–.04 | WAITING_FOR_EXTERNAL | PR #16 | — | Harness and scripted call built; the calls need a number, volunteers and eu-central-1 |
| P04.05.05 | IN_PROGRESS | PR #16 | — | Report written with its method, thresholds and empty tables; no result exists |
| P04.06.01 | READY_FOR_REVIEW | PR #16 | EV-P04-006 | DG-01 criteria recorded before any measurement existed |
| P04.06.02 | BLOCKED | — | — | The decision is the founder's, on evidence that does not exist |
| P04.07.04 | READY_FOR_REVIEW | PR #16 | EV-P04-007 | ADR-0034 enforced by a check instead of by review |
| P04.10.03 | IN_PROGRESS | PR #16 | — | Register written with every party and flow; every DPA status is `NOT_REQUESTED` |
| P04.10.04 | READY_FOR_REVIEW | PR #16 | EV-P04-008 | All 12 DFD flows resolve to a party with a region, or to the explicit internal list |
| P02.01.01 | READY_FOR_REVIEW | — | EV-P02-047 | EXT-24 ruleset active on `main`; export committed as an artefact |
| P02.01.07 | READY_FOR_REVIEW | — | EV-P02-048 | Four red pull requests all BLOCKED; the no-push half is derived, see F14 |
| P02.06.07 | READY_FOR_REVIEW | PR #20–#23 | EV-P02-049 | Four negative controls, each failing the job it was written for |
| P06.01.01 | READY_FOR_REVIEW | PR #27 | EV-P06-001 | Seven roles; the migration asserts them because the migrator has no CREATEROLE |
| P06.01.02 | READY_FOR_REVIEW | PR #27 | EV-P06-002 | PUBLIC revoked; default privileges are a safety net, explicit grants are the mechanism |
| P06.01.03 | WAITING_FOR_EXTERNAL | — | — | Role credentials in Secrets Manager: needs P05 and EXT-09 |
| P06.01.04 | WAITING_FOR_EXTERNAL | — | — | `pgaudit` is an RDS parameter group: needs P05 |
| P06.01.05 | READY_FOR_REVIEW | PR #27 | EV-P06-003 | No DDL, no TRUNCATE, no policy changes, no role escalation, owns nothing |
| P06.02.01 | READY_FOR_REVIEW | PR #27 | EV-P06-004 | NULL when unset, so a forgotten `withTenant` sees nothing rather than everything |
| P06.02.02 | READY_FOR_REVIEW | PR #27 | EV-P06-005 | One function applies every policy, so no table has its own copy to diverge |
| P06.02.03 | READY_FOR_REVIEW | PR #27 | EV-P06-006 | Composite keys checked against the live catalog rather than by review |
| P06.02.04 | READY_FOR_REVIEW | PR #27 | EV-P06-007 | Seven rules over `pg_catalog`; wired into the `rls-catalog` CI job |
| P06.02.05 | READY_FOR_REVIEW | PR #27 | EV-P06-008 | Global tables registered with a reason; a row without one does not count |
| P06.02.06 | READY_FOR_REVIEW | PR #27 | EV-P06-009 | 20 isolation assertions, all as the application role against real policies |
| P06.02.07 | READY_FOR_REVIEW | PR #27 | EV-P06-010 | Nine fixtures, including the enabled-but-not-forced case PLAN names |
| P06.03.01 | READY_FOR_REVIEW | PR #28 | EV-P06-011 | `withTenant`: transaction-local setting, ambient context, client released either way |
| P06.03.02 | BLOCKED | — | — | Needs sessions and memberships (P06.06, P06.07) |
| P06.03.03 | IN_PROGRESS | PR #28 | EV-P06-015 | The mechanism is proven; the job envelope itself arrives with the queue |
| P06.03.04 | BLOCKED | — | — | Needs `number_routes` and `resolve_route` |
| P06.03.05 | READY_FOR_REVIEW | PR #28 | EV-P06-012 | Rule already active from P02.02.07; `withTenant` is now the alternative it points to |
| P06.03.06 | READY_FOR_REVIEW | PR #28 | EV-P06-013 | Every line inside a tenant transaction names its organisation, still redacted |
| P06.03.07 | IN_PROGRESS | PR #28 | EV-P06-015 | The job half is done; the forged-header half needs the HTTP session layer |
| P06.14.01 | READY_FOR_REVIEW | PR #28 | EV-P06-014 | Claims identifiers only; each item processed in its own tenant transaction |
| P06.14.02 | READY_FOR_REVIEW | PR #28 | EV-P06-015 | A mismatched envelope updates zero rows rather than the wrong tenant's |
| P06.04.01 | READY_FOR_REVIEW | 127ba14 | EV-P06-016 | Organisation and location lifecycle tables; FORCE RLS retained |
| P06.04.02 | READY_FOR_REVIEW | 127ba14 | EV-P06-017 | Privileged function creates setup and pending owner invitation; P06.08 issues and delivers token |
| P06.04.03 | READY_FOR_REVIEW | 127ba14 | EV-P06-018 | Paid Early Access cap of five via one locked global counter; founder review pending |
| P06.04.04 | READY_FOR_REVIEW | 127ba14 | EV-P06-019 | Retry and racing request IDs return one tenant |
| P06.04.05 | READY_FOR_REVIEW | 127ba14 | EV-P06-020 | Real PostgreSQL attack suite, catalog defects and rollback tests |
| P06.10 | IN_PROGRESS | feat/p06-10-audit | — | Audit migration, writer/query APIs, chain verifier, proposed ADR and real-PostgreSQL negative controls are in progress. Daily scheduling/alarm, adoption by business mutations, founder ADR acceptance and erasure design remain open. |
| P06.10.03 | IN_PROGRESS | feat/p06-10-audit | — | Provisioning now triggers a tenant-scoped audit append in its authoritative transaction; failure rolls back tenant state and cap. Later tool, operator and security actions still need adoption. |
| P06.10.01 | READY_FOR_REVIEW | 8e5bf76 | EV-P06-021 | Append-only tenant audit table; the trigger refuses UPDATE and DELETE for the owner too, and the catalog check proves the guard from `pg_catalog` |
| P06.10.01 | READY_FOR_REVIEW | 8e5bf76 | EV-P06-021 | Deviation, flagged: the checklist's "except the pseudonymisation function" exception is **not** implemented. That function is P16.05.02 and does not exist, so the exception would be a hole with nothing legitimate behind it; ADR-0017/ADR-0018 own the chain-preserving design. Table, blocking trigger and revoked grants are delivered |
| P06.10.02 | READY_FOR_REVIEW | 8e5bf76 | EV-P06-022 | Per-tenant gap-free sequence and hash chain; concurrent appends serialise at the head rather than racing |
| P06.10.04 | READY_FOR_REVIEW | 8e5bf76 | EV-P06-023 | Tenant-scoped query by target, actor and correlation ID; malformed filters refused without echoing the input |
| P06.10.05 | WAITING_FOR_EXTERNAL | 8e5bf76 | EV-P06-024 | Daily cross-tenant sweep, SEV2 alarm, runbook and exit-code split built and verified. **Counterparty:** AWS (EXT-09), founder-owned. **Requested:** 2026-09-30. **Expected:** with P05 cloud foundation. **Fallback:** run `pnpm db:verify-audit` manually and record the result, which is what the runbook says today. The daily trigger and the CloudWatch alarms are Terraform and are not provisioned |
| P06.10.07 | READY_FOR_REVIEW | 8e5bf76 | EV-P06-025 | Tamper, privileged-mutation and argument-scanner suites; 25 injected defect variants all KILLED |
| P06.10.07 | READY_FOR_REVIEW | 23d70ae | EV-P06-026 | QG-09 review of the diff by three independent reviewers; every High/Critical reproduced against real PostgreSQL, fixed and mutation-proven; 42 defect variants all KILLED; five residuals recorded with owners |
| P06.10.07 | READY_FOR_REVIEW | c1bde7a | EV-P06-027 | Four HIGH defects from the independent post-fix QG-09 review, each reproduced against real PostgreSQL, fixed and mutation-proven; sweep now 54/54 KILLED with an inspectable manifest |
| P06.10.07 | READY_FOR_REVIEW | fcc4473 | EV-P06-028 | Population-snapshot design replacing UUID-cursor paging; mutation harness rewritten so its outcomes are evidence — 62 KILLED_ASSERTION, 2 documented INFRA_FAILURE |
| P06.10.07 | READY_FOR_REVIEW | f105882 | EV-P06-029 | Epoch allocation serialized by commit rather than by `nextval()`; assertion identity decided from typed error metadata rather than message text — 69 KILLED_ASSERTION, 2 documented INFRA_FAILURE |
| P06.10.07 | READY_FOR_REVIEW | 986ae8b | EV-P06-030 | `KILLED_ASSERTION` redefined so it can only mean one thing: two in-process signals a thrown object cannot set, an exact unique `{file, fullName}` identity, and a run with no other failure — 77 KILLED_ASSERTION, 2 documented INFRA_FAILURE over 79 variants, 12 of which attack the harness itself |
| P06.10.07 | READY_FOR_REVIEW | 96a5dad | EV-P06-031 | Assertion evidence moved from the serialized thrown value to the matcher boundary in-process: a plain object literal and a `toJSON` spoof both defeated the previous model. Anchor uniqueness enforced at application time. 90 KILLED_ASSERTION and 2 documented INFRA_FAILURE over 92 variants, 25 of which attack the harness |
| P06.10.07 | READY_FOR_REVIEW | 953c47c | EV-P06-032 | Assertion evidence moved from a transferable token to **object identity**: the terminal value of the test body must be, by `===`, the object a Vitest matcher threw in this invocation. 52 KILLED_ASSERTION and 42 NOT_EVIDENCE_ELIGIBLE over 94 variants |
| P06.10.07 | READY_FOR_REVIEW | bf02200 | EV-P06-033 | Eligibility gap closed: 30 killing tests under `packages/db/` moved to the trusted wrapper, registration only, and the wrapper moved into `@moin/testing` so no package reaches into `scripts/`. 92 KILLED_ASSERTION and 2 NOT_EVIDENCE_ELIGIBLE over 94 variants |
| P06.10.06 | VERIFIED | 468827a | EV-P06-036 | ADR-0017 accepted by the founder under QG-09, with five recorded residual dispositions; deferred and external items stay open |
| P06.10.07 | VERIFIED | 468827a | EV-P06-036 | Founder-authorized at QG-09 on the independent verdict `READY_FOR_FOUNDER_QG09` for reviewed HEAD `468827a`; evidence EV-P06-025 … EV-P06-035 |
| P06.10 | IN_PROGRESS | 8e5bf76 | EV-P06-021…025 | Table, chain, query API, daily verifier, argument scanner and runbook done. Open: .03 adoption by the tool guard, operator and security paths (needs P10.08, P06.11/.12), .05 scheduling (EXT-09) and .06 founder acceptance of ADR-0017 |
| P06.05.04 | IN_PROGRESS | feat/p06-05-local-oidc | — | Local Keycloak realm and fixture existed from P02; browser client now disallows direct grants, and OIDC settings validate the selected environment. Auth callback adoption and claim-contract verification remain open. |
| P06.05.04 | READY_FOR_REVIEW | 215e878 | EV-P06-037 | Identity-claims contract (subject, verified lower-cased email) proven on a real local Keycloak token and the documented Cognito shape; both local clients pinned to the `basic`+`email` scopes (`moin-web` lacked `sub`), realm roles removed; one OIDC provider per environment with an EU Cognito issuer check; 12/12 mutation variants KILLED_ASSERTION. Callback, state, nonce and sessions stay with P06.06.01 |
| P06.05.04 | VERIFIED | 1801feb | EV-P06-038 | Founder-authorized on the independent verdict `READY_FOR_FOUNDER_P06_05_04` for reviewed HEAD `1801feb`; evidence EV-P06-037. IdP roles removed, environment provider matrix and strict `email_verified` accepted; P06.05.01–.03 and .05 stay open, so P06.05 is not complete |
| P06.09.03 | READY_FOR_REVIEW | b4ac244 | EV-P06-039 | MFA-reset and compromised-account runbooks normalized from `74bc27f` (`feat/p06-05-oidc`, superseding its stale `IN_PROGRESS` row) onto current main: callback and billing data treated as compromised by default per the threat model, an additional factor pending in P06.09.02, every unbuilt control labelled with its item. Not executable; P06.09.01, .02 and .04 open |
| P06.09.03 | VERIFIED | 15433fb | EV-P06-040 | Founder-authorized on independent verdict `READY_FOR_FOUNDER_P06_09_03` for reviewed runbook HEAD `15433fb`; runbook evidence EV-P06-039. Existing sessions and fresh access both blocked for containment; verified replacement MFA and mandatory audit precede ordinary access. Documentation only; P06.09.01/.02/.04 open and P06.09 incomplete |
| P06.06.01 | VERIFIED | 1b94476 | EV-P06-047 | Authorization Code + PKCE S256 callback in `api`: single-use, browser-bound, 10-minute `state`; nonce-bound ID token verified with `jose`; code exchanged server-side; provider tokens AES-256-GCM sealed and wiped at revocation; internal return paths only. Real `moin-web` code flow proven against local Keycloak. Founder-accepted on independent verdict `READY FOR FOUNDER ACCEPTANCE` at candidate `195a6bd` (implementation `316caa6`); PR #35 squash-merged as `1b94476`. Not Cognito (P06.05.05); deployed environments refuse sign-in until the KMS key exists (P05.08.01) |
| P06.06.02 | VERIFIED | 1b94476 | EV-P06-047 | `users` and `sessions` (global, no runtime table grant, six pinned `SECURITY DEFINER` functions, dedicated `moin_identity` role closing QG-09 I1); SHA-256 of a 256-bit token in `__Host-moin_sid` (HttpOnly, Secure, SameSite=Lax, Path=/, no Domain); 12 h idle / 7 d absolute enforced by functions, CHECKs and a guard trigger; lock-wait expiry races closed (RWAIT/CWAIT, 54/54 sweep); rotation primitive (login wired; step-up and privilege-change callers are P06.06.04/P06.07). Founder-accepted on independent verdict `READY FOR FOUNDER ACCEPTANCE` at candidate `195a6bd` (implementation `316caa6`); PR #35 squash-merged as `1b94476`. P06.06.03–.07 open |
| P06.06.03 | VERIFIED | d92f82b | EV-P06-048 | Per-request session validity and membership status re-check via single atomic `resolve_request_context` DEFINER query. Scoped `moin_app` row lock via FOR UPDATE companion policy with tenant WITH CHECK under FORCE RLS; slide folded into single query with single database timestamp; read-only GET caching bounded by min(30 s, idle, absolute) with triple-deadline hit checks; mutating requests bypass cache; Cache-Control: private, no-store on authenticated 200 responses. Proven by 55/55 mutation sweep, deterministic MWAIT1/MWAIT2/MWAIT3 concurrency regressions, and 20/20 stress runs. Founder-accepted on independent verdict `READY FOR FOUNDER ACCEPTANCE` at candidate `ac2b3e2` (implementation `dfdece5`); PR #36 squash-merged as `d92f82b`. P06.06.04–.07 open |
| P06.03.02 | READY_FOR_REVIEW | 241e99a | EV-P06-060 | Tenant from session → active membership only: forged `x-organisation-id`/`x-organization-id`/`x-tenant-id`/`x-org-id` headers, query params and body fields on write, read and foreign-id routes all ignored; no session grants no tenant (401). 3/3 interceptor mutants (header, query, body) KILLED. Supersedes the BLOCKED row above. No app code changed |
| P06.03.07 | IN_PROGRESS | 241e99a | EV-P06-060 | Request half proven end to end (forged header/query/body). Job half stays BLOCKED on P06.03.03: no job envelope exists until P08 (DB-level mismatch proof is EV-P06-015). Corrects the row above |
| P06.06.04 | READY_FOR_REVIEW | 1012c27 | EV-P06-049 | Step-up MFA (≤ 15 min) merged as PR #38; founder full gate 14/14; QG-09 triad OK at a1236a2 |
| P06.06.05 | READY_FOR_REVIEW | 2476d16 | EV-P06-050 | Revocation on membership change, reset and demand, PR #39; QG-09 triad not re-run at final SHA |
| P06.06.06 | READY_FOR_REVIEW | c51404e | EV-P06-051 | CSRF synchronizer token plus Origin check, PR #40 |
| P06.06.07 | READY_FOR_REVIEW | 858ab7c | EV-P06-052 | Session lifecycle acceptance suite over HTTP, PR #41 |
| P06.07 | READY_FOR_REVIEW | af2a320 | EV-P06-053 | RBAC matrix, role guard, last-owner trigger, matrix tests generated from route metadata (.01–.05), PR #42 |
| P06.08 | READY_FOR_REVIEW | d09f040 | EV-P06-054 | Invitations and lifecycle, PR #43. PARTIAL: .01 and .04 ticked; .02 no HTTP accept route (founder decision), .03 task return-to-unassigned waits on a tasks table; email delivery P14/EXT-09 |
| P06.09 | READY_FOR_REVIEW | ccb8e1f | EV-P06-055 | Recovery disable/enable/revoke and tabletop (.04 ticked), PR #44. .01/.02 PARTIAL: Cognito reset call P05/EXT-09, no deny-new-access, no operator identity, no owner notification |
| P06.10.03 | READY_FOR_REVIEW | 393089a | EV-P06-056 | Audit writer adoption, PR #45. PARTIAL: tool guard (P10), operator and security-event paths do not exist; session DEFINERs unaudited by founder decision. Not ticked in PLAN |
| P06.11 | READY_FOR_REVIEW | cee45a5 | EV-P06-057 | Support access grants, PR #46: .02/.03/.05 ticked; .04 owner notification pending P06.12.02/P14; .01 WAITING_FOR_EXTERNAL P05/EXT-09 (counterparty AWS, founder-owned, expected with P05 cloud foundation, fallback none: operator identity is an opaque subject until then) |
| P06.12 | READY_FOR_REVIEW | 5635d44 | EV-P06-058 | Application throttles and security-event recording, PR #47: .03 throttling half ticked; .01 WAF rules WAITING_FOR_EXTERNAL P05/EXT-09; .02 owner email pending P14 |
| P06.13.05 | READY_FOR_REVIEW | 1e2224a | EV-P06-059 | CI wiring verified on main (PR #50, verify run 37795794912 success): `xsuite:report` script + `xsuite-coverage` artifact step in verify.yml, release-blocking via LG-P01 |
| P06.11.03 | READY_FOR_REVIEW | cee45a5 | EV-P06-057 | Corrects the PLAN tick (PR #49 review): all four support read functions have NO runtime EXECUTE grant (42501) until a trusted operator identity exists (P06.11.01), so a grant-gated read is not proven; only the grant lifecycle and the gate predicate are. PLAN item unticked |
| P06.11.05 | READY_FOR_REVIEW | cee45a5 | EV-P06-057 | Corrects the PLAN tick: no-grant, expired and revoked cases are proven at the gate predicate, grant create/revoke audit is proven, no read is executed; unticked. P06.11.04 also incomplete |
| P06.07.05 | READY_FOR_REVIEW | af2a320 | EV-P06-053 | Corrects the PLAN tick: the matrix is generated from a test probe controller, not the product routes; unticked |
| P06.08.01 | READY_FOR_REVIEW | d09f040 | EV-P06-054 | Corrects the PLAN tick: no email is sent (P14); unticked, tokens and template built |
| P06.09.04 | READY_FOR_REVIEW | ccb8e1f | EV-P06-055 | Corrects the PLAN tick: the tabletop was recorded by the implementing session; a founder-run tabletop is still required; unticked |

## External waits

| ID     | Counterparty                                 | Requested                              | Expected | Fallback                                                                                                                                                          | Blocks                                           |
| ------ | -------------------------------------------- | -------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| EXT-02 | German data-protection counsel               | **not yet sent — founder action**      | —        | Every question in `docs/legal-briefs/02-questions.md` carries a conservative fallback, except A6 (telecom law), which has none: without it the pilot does not run | P03.07.03, P03.07.04, ADR-0019, the pilot (PG-3) |
| EXT-10 | Twilio                                       | **not yet requested — founder action** | —        | None. There is no other way to make a German call on this stack; a NO-GO at DG-01 is the fallback, and that is a product decision rather than a workaround        | P04.01, P04.04.06, P04.05, P11                   |
| EXT-11 | German number regulatory bundle (via Twilio) | **not yet requested — founder action** | —        | Use the customer's own bundle, if the P04.02.01 end-user decision allows it                                                                                       | P04.02, P04.05, the pilot                        |
| EXT-12 | OpenAI (EU project, DPA, enhanced privacy)   | **not yet requested — founder action** | —        | DG-14: the pre-registered EU alternative becomes primary. The port exists so that costs an adapter, not a rewrite                                                 | P04.03, P10                                      |
| EXT-01 | Founder identity and address documents       | **not yet prepared — founder action**  | —        | None; EXT-11 cannot start without them                                                                                                                            | EXT-11                                           |
| EXT-07 | Trademark clearance (DPMA, EUIPO, WIPO)      | **not yet requested — founder action** | —        | Ship under a brand read from configuration and rename later; `check-brand-strings.ts` is what keeps that a configuration change                                   | DG-00, P04.07                                    |
| EXT-20 | Two volunteer test callers                   | **not yet asked — founder action**     | —        | Founder-only calls, which halves the sample and removes voice variety; the report would have to say so                                                            | P04.05.02                                        |

## Founder actions waiting

| #   | Action                                                                                                                                                                                                                                                                     | Blocks                                                                  | How to confirm it worked                                |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------- |
| F14 | Confirm empirically that a direct push to `main` is rejected: `git push origin HEAD:main` from a throwaway commit. A session may not do this (CLAUDE.md §8), so the half of P02.01.07 that says "a direct push is rejected" is derived from the ruleset export, not tested | Nothing — it converts a derived claim into a measured one               | The push is rejected by the ruleset, not by permissions |
| F3  | Bookkeeping correction: untick the unsupported P00.02.04 and its P00.02 parent — PR #17                                                                                                                                                                                    | A recorded P00 audit remains outstanding                                | `evidence.py check` exits 0 on `main`                   |
| F9  | Create the local environment file from the committed example in each worktree (the control plane blocks any session command touching it, INV-15)                                                                                                                           | `pnpm preflight`, and the `integration` gate without exported variables | `pnpm preflight` exits 0 in that worktree               |
| F6  | Optional: confirm setup time on a machine with no Docker image cache (1.73 GiB to pull)                                                                                                                                                                                    | The 15-minute criterion measured cold rather than warm                  | The timed log                                           |
| F10 | Start EXT-10, EXT-12 and EXT-07 **today**, and EXT-01 so EXT-11 can follow. Details per provider in `docs/operations/provider-accounts.md`                                                                                                                                 | All of P04's measurements, DG-01, and therefore P11 and P12             | Each row in that file has an account id and a date      |
| F11 | Send `docs/legal-briefs/` to counsel (EXT-02). The longest pole in the programme: A6 (telecom law) has no fallback, and without it the pilot does not run                                                                                                                  | P03.07.03, P03.07.04, ADR-0019, the disclosure wording, PG-3            | A reply, or an engagement confirmation with a date      |

### Completed

`F1` patch 0003 applied · `F2` EXT-24 ruleset applied and exported (EV-P02-047) · `F4` the
fifteen-deep stack merged, `main` at `4ac6ec48bc` · `F5` local environment file created ·
`F7` the abandoned `feat/p04-04-conversationrelay` branch deleted · `F8` patch 0004 applied ·
`F12` the four negative-control branches and the superseded fix branch deleted · `F13` the
secret-rule fix (#25) merged, with its full-history scan green.

## Deferred with a trigger (from the P02.03 QG-09 review)

| Item                                                                       | Why not now                                                                                                                                                             | Trigger                                                |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Fastify `helmet` + `rate-limit`, `trustProxy`, fixed-body exception filter | No POST route and no reachable sink yet; PLAN places API hardening in P06/P17. The `/readyz` amplification the review found is already closed by single-flight caching. | The first POST route (P06)                             |
| Per-role discriminated configuration schema                                | With 12 keys and none role-specific, every branch would be identical — structure with no differentiating content.                                                       | The first role-specific variable (P05)                 |
| Smaller runtime base image                                                 | 261 MiB of the 379 MiB image is Debian + Node; changing base has its own trade-offs (glibc, debugging tools).                                                           | P17 production baseline, or earlier if pull time hurts |

## Log

- 2026-09-30 — **PR #29 CI repair in progress.** The first `verify` run on `cd35ecd6c673e70d3c5ee433dbb4b3fbd391d5f6` failed only in real-PostgreSQL integration: the workflow supplied admin, migrator and app URLs but omitted `TEST_DATABASE_PROVISIONER_URL`, so all thirteen new provisioning tests failed at setup. The RLS catalog job and the other completed checks passed. The workflow now supplies the CI-only provisioner URL; this new tree is UNVERIFIED until committed and tested at its own HEAD. QG-09 founder review remains pending.
- 2026-09-29 — **P06.04 resumed from the 290ce67 checkpoint.** The old BLOCKER below was session exhaustion, not a technical impediment. The first real PostgreSQL run with a non-bypass function owner exposed that a FORCE RLS role cannot count all organisations for the Early Access cap; three cap tests failed. The corrected function updates a single global counter under a row lock in the same transaction. A security review also found that an implicit `pg_temp` search path could let a caller shadow unqualified tables; the final function pins it last, with a malicious TEMP-table fixture. `moin_app` cannot change plan/status or insert an organisation, and the provisioner has no direct DML. `gates full` passed 14/14 at clean implementation HEAD `127ba14acb4e4b594a7a6db32180bf30d582c98d`; evidence and ledger changes still require their own final-HEAD run. QG-09 founder review, PR CI and invitation delivery in P06.08 remain pending.
- 2026-09-29 — **BLOCKER: usage limit reached mid-P06.04.** Not a technical blocker and not an external wait — the session ran out of budget.
  - **What was tried:** `packages/db/migrations/0006_provisioning.sql` was written and applied to the local development database (`pnpm db:migrate` → `applied 1: 0006_provisioning`). It adds `provisioning_limits`, `provisioning_requests` and `app.provision_tenant(...)`.
  - **Why it is not progressing:** nothing after that ran. No tests, no `gates full`, no commit until this entry. **Nothing about P06.04 is verified**, and the migration has been applied to one developer database only.
  - **What is needed next, in order:** (1) register `app.provision_tenant` in `docs/architecture/security-definer-allowlist.md` with its justification — **the catalog check fails until this exists**, by design; (2) add `provisioning_limits` and `provisioning_requests` to `docs/architecture/global-tables.md`; (3) classify the new columns in `docs/privacy/data-inventory.md`, or `check-data-classification` fails; (4) write the P06.04.05 tests — one consistent tenant, `moin_app` cannot call the function, the cap holds under concurrency, a failure leaves nothing, and a negative control proving `moin_provisioner` cannot INSERT directly; (5) `gates full` **at the final committed HEAD**, then the PR.
  - **Design intent, so it is not re-derived:** the function does not bypass row-level security, it satisfies it — it sets the tenant context to the organisation it is about to create, and `organisations.organisation_id` is generated from `id`, so the ordinary policy passes by construction. FORCE RLS stays on and no role gains `BYPASSRLS`. `moin_provisioner` has `EXECUTE` and no DML on what the function writes, so the only way that role can create a tenant is the way that enforces the cap and the idempotency. The cap lives in a single-row table changed only by a reviewed migration, which is what makes an override signed and audited here. `pg_advisory_xact_lock` before the count is what makes it hold under concurrency rather than merely be checked.
- 2026-09-29 — **P06.03 and P06.14: the tenant wrapper.** `withTenant` is the only place the tenant setting is written, and it writes it **transaction-locally**: a session-level `SET` would survive the transaction and ride the pooled connection into the next request — one caller's tenant applied to another caller's query, which is the single worst bug this codebase could have. `withSystemWork` is the other half: sweeps and reconcilers run across tenants by definition, and the tempting shortcut is a role that can see all of them at once. There is no such role — the claim returns identifiers only, and each is processed inside `withTenant` as the ordinary application role. A job envelope that names the wrong organisation therefore updates **zero rows**: an empty path rather than an error path, which is what makes a mismatch harmless rather than merely detected.
- 2026-09-29 — Nesting a _different_ tenant now throws. Nesting the same one is ordinary — a service calls a service — but nesting a different one means code is about to act for organisation B inside a transaction opened for organisation A, and whichever the database ends up applying, something is wrong. Also: a malformed organisation id is rejected at the boundary rather than by the policy's cast, so the caller gets a clear failure instead of something that reads like a database fault, and the rejected value is never echoed into the error.
- 2026-09-29 — Two lint findings worth recording rather than suppressing quietly. Thirteen `async` arrows in the new tests had no `await`; they were rewritten rather than suppressed. One suppression was kept, in `TenantClient.query<R>`: the rule is right that `R` appears only in the return type and is therefore an assertion rather than an inference — but the shape of a result set is decided by the database, and the alternatives are worse. The comment says so rather than naming the rule and moving on.
- 2026-09-29 — #25 merged; the negative-control branches and the superseded fix branch are gone from the remote. `gates full` is **PASS 14/14** on this branch at `8a1478d169`, which is the first fully green full-gate run on a P02 branch. One thing worth recording about the local runs that preceded it: they kept failing `secret-scan` after the remote branches were deleted, because `gitleaks` scans **every ref** and the deleted branches still existed as _local_ branches in this clone. The repository was clean; the working copy was not. Deleting the local branches was the fix, and CI never saw the problem because it clones fresh.
- 2026-09-29 — **P06.01 and P06.02: the security spine.** Tenant isolation is enforced by the database rather than by the application, because the application will be wrong occasionally and the property that matters is that being wrong is not _sufficient_ to leak. `app.current_org()` returns NULL when unset, so a policy comparing against it matches no rows and code that forgets `withTenant` sees an empty table rather than every tenant's — the obvious alternative, `current_setting` without `missing_ok`, _raises_, which sounds stricter and is worse, because an exception becomes a 500 while an empty result is a correct answer to a question asked without a tenant. One function applies every policy, so no table carries its own copy to diverge into `USING` without `WITH CHECK`. The catalog check reads `pg_catalog` rather than the migrations, because a later migration can undo an earlier one and `DISABLE ROW LEVEL SECURITY` is one line; it has seven rules and nine fixtures, including the enabled-but-not-forced case PLAN names.
- 2026-09-29 — Deviation, flagged rather than done quietly: P06.01.01 asks for "a migration creating" the seven roles, and a migration cannot create a role, because `moin_migrator` has no `CREATEROLE` — which is the point of the split, since a role that can create roles can create a superuser. Roles are provisioned by whoever owns the cluster; the migration **asserts** them and fails with the name of any missing one, so the grants below it can never be silent no-ops.
- 2026-09-29 — Three defects in P06, none found by reading. **Default privileges are recorded per grantor**: naming only the migrator left every table unreadable in the integration template, which builds its schema through the admin connection — eleven isolation tests failed with `permission denied`, far from the cause. Explicit grants per table are now the mechanism and the defaults are only a safety net. **The classification check had a phantom column named `REFERENCES`**, because its parser read the continuation line of a multi-line constraint as a column definition. And the first `locations` foreign key named `organisation_id` twice: harmless, reads as a typo, and the right answer is that a direct child of `organisations` needs only the tenant column because the parent _is_ the tenant — the catalog rule knows that now too.
- 2026-09-29 — A lint rule fired on a test's own **title**: the ban on session-level `SET` matches string literals, and the test was called "cannot SET ROLE to %s". Renamed to "cannot become %s", which reads better anyway. Recorded because the tempting fix — loosening a rule that exists to stop a setting leaking onto the next checkout of a pooled connection — would have been much worse than renaming a test.
- 2026-09-29 — The secret-rule fix had to be recreated on a clean branch (#24 closed, **#25** opened). Its first version wrote realistic-looking tokens into the self-test's examples and the stock `generic-api-key` rule flagged two of them — correctly. Writing a credential-shaped literal into the repository is exactly what the rule under test exists to prevent, so doing it inside that rule's own test was the wrong way round. The values are built from a low-entropy placeholder now; the rule checks the variable name and the length, not the entropy. The branch had to be recreated rather than fixed forward because **removing a literal in a later commit does not remove it from history, and history is what the secret scan reads** — the same lesson as the abandoned P04 branch earlier today, learned twice. Worth stating as a rule: a credential-shaped literal must never be committed at all, not even transiently, because a session cannot rewrite pushed history.
- 2026-09-29 — **P02 is closed.** EXT-24 is satisfied: the `main-protection` ruleset is active with a pull request required, three required checks, linear history, force-push and deletion blocked, and **no bypass actors**. The export is committed as an artefact so a later export diffs against it. P02.01.01, P02.01.07 and P02.06.07 are the last three items and they are now ticked. One qualification, recorded rather than smoothed over: the half of P02.01.07 that says _a direct push to `main` is rejected_ is **derived from the ruleset, not tested**, because a session may not push to `main`. It is F14, one command.
- 2026-09-29 — The four negative controls ran, and each failed the job it was written for: #20 lint → the static job; #21 a failing test → the unit job; #22 a vulnerable production dependency → the audit job; #23 a planted fake credential → the secret scan. **All four were reported BLOCKED by GitHub**, which is the empirical half of P02.01.07. Two results were better than predicted. #22 failed three jobs, not one: `pnpm audit`, Trivy against the lockfile and Trivy inside the built image caught it independently, in two different workflows — so a single misconfigured gate would not open the door. And `verify` passed on it, correctly: a vulnerable dependency is not a correctness failure, which is exactly the class of problem only a supply-chain check finds.
- 2026-09-29 — **The fake-secret control found a dead rule.** `.gitleaks.toml` carries one custom rule, written for the realistic way a real key reaches this repository — someone pastes a working value into the example environment file while debugging. It has never fired. Its pattern was anchored `(?i)^…`, and gitleaks applies a rule's regex to the whole file rather than line by line, so `^` anchored to the start of the _file_ while the variables it names sit near the bottom of a ninety-line example. It matched only a credential on line 1. Proven three ways: by elimination with a config containing only that rule (zero findings on a planted secret); against the real binary after the fix (both the stock rule and ours report line 77); and by reverting the flag, which makes the new self-test fail with the defect named. The fix is one character. What stops it recurring is `scripts/check-gitleaks-rules.ts` — ten executable examples, each **below the first line of a file**, read out of the configuration rather than restated. Its own parser had the same class of defect at smaller scale: it bounded the allowlist array at the first `]`, which is inside the character class of one of the permitted placeholders, silently dropping it. That one was caught by its tests before it mattered. PR #24.
- 2026-09-29 — That is the argument for negative controls in one line: the gate was green, the rule read correctly, and nothing distinguished working from dead except a value it was supposed to catch.
- 2026-09-29 — P04 at its strongest truthful engineering state. The phase exists to answer one question — does German voice over ConversationRelay work well enough to build on — and that question cannot be answered by engineering. It needs an account, a German number, an EU model project and fifty real calls, none of which exist. What was built is everything that must exist before the first real call is worth making: the protocol code the call runs through, the apparatus that turns a call into a number, and the decision record with its criteria written down **in advance**, so the go/no-go is read off evidence rather than argued after it. Three things are structural rather than configurable and each has a test saying why: the disclosure has no option to be interruptible (INV-03), decoding never throws so an unknown provider message cannot end a call (INV-19), and a decode failure reports schema paths only, because what fails validation is what the caller said (INV-12). The signature implementation is checked against the vector Twilio publishes, not only against its own fixtures — a base string that sorts or concatenates wrongly validates perfectly against itself. The media socket is bound by a single-use 60-second hashed token rather than the `CallSid`, which is not a secret.
- 2026-09-29 — Four defects found by writing the tests rather than by reading the code. The Fastify adapter registers its own body parsers during `init`, so the voice module's second registration threw and the role did not start at all; the parsers turned out to be unnecessary, because the signature for these webhooks is computed over the parsed parameters. The TwiML response was a 201, because that is what the framework answers a POST with. The secret scanner flagged three 32-hex literals in test files and was right to — a fake Twilio auth token is indistinguishable from a real one — so they are generated per run now. And a brand check that looked only inside string literals passed a template whose body read "Ihr Team von Moin", which is the exact case the rule exists for.
- 2026-09-29 — Two gate gaps closed, both found while wiring new checks in. `turbo run lint` and `turbo run typecheck` run only per-package tasks, and `scripts/` is not a package — so the seven consistency checks and the doctor were the only code in the repository that neither the gate nor CI linted or typechecked. And the consistency checks ran **only** in the local gate: a pull request could break the ADR index, the data-flow-to-subprocessor mapping or a threat-model reference and CI would stay green, on the checks that are meant to be what protects `main`. Both proven with deliberate errors before and after, rather than assumed. The gate configuration is protected, so the same three changes are founder patch 0004.
- 2026-09-29 — The merge queue was reconciled before any new code was written. `main` is still at the pre-P02 control-plane commit and the whole of P02 and P03 is a thirteen-deep pull-request stack. All three merge methods were simulated against the real branches: **merge commits land all thirteen cleanly and leave `main`'s tree byte-identical to the verified state**; squash conflicts at step 2 and at every step after it, because a squash commit is not an ancestor of the next branch and the merge base falls back to before either side existed; rebase conflicts at #9. Four pull requests also had a failing conventions check — three over-length titles, and #3's workflow reading a `.nvmrc` that its own branch did not have until now. All four are green. `docs/development/merge-queue.md` carries the order, the method and how to verify the result.
- 2026-09-29 — `gates full` at 252be53a87ba: **13 of 14 pass**. `secret-scan` fails, for one reason and only one: the abandoned branch `feat/p04-04-conversationrelay` still exists on the remote and carries the three fake tokens described above. Scanning this branch's own history alone (`--log-opts=HEAD`) reports no leaks across 33 commits. Deleting a remote branch is founder-only, so this is F7. The `docs-consistency` gate also still runs the pre-0004 command, so the two new checks were verified by running them directly rather than through the gate.
- 2026-09-29 — CORRECTION forced by the claim-check hook. A progress report said P02 and P03 were "complete"; `gates.py full` is **FAIL** at HEAD 273714ed68 (2 of 3 gates pass; the stub `workspace` gate fails). That is the designed behaviour until founder patch 0003 is applied — but running it surfaced a real defect: **patch 0003 was stale.** It was written before P02.07 moved the test runner off turbo, so its `unit` gate still said `pnpm turbo run test`, a task that no longer exists. Applying it would have produced a gate configuration that could not run. Regenerated with every command executed individually against the current tree first, re-verified against an isolated copy (applies cleanly, byte-identical to the intended file), and extended with `docs-consistency`, `migrations` and `licences` gates for the checks added since. The correct status is: every P02 and P03 item is implemented and individually verified, and `gates full` is BLOCKED on founder action F1, not green.
- 2026-09-29 — P03 complete except the founder-owned items. The independent threat-model review (P03.05.03) returned BLOCK MERGE with 2 Critical and 7 High, and both Criticals were defects in my own reasoning rather than gaps in coverage. The first: the document asserted that a caller's number is never an authentication factor, which our own intent catalogue and PLAN's identity rules contradict — spoofing a caller ID is nearly free in Germany, and `booking_cancel` was an unauthenticated destructive write against a real customer relationship. The second: the mitigation-to-item mapping was wrong in 18 of 33 rows, and two of those described a _weaker_ control than PLAN actually commits to. Each id looked plausible and none had been resolved; that is worse than no mapping, because it reads as rigour. `scripts/check-threat-model-refs.ts` now resolves all 63 and checks each relates to its mitigation. The review also caught the document claiming, in the past tense, that its own review had already happened — written before it had.
- 2026-09-29 — P03.06 complete. Field-level rather than category-level, because category level is where erasure requests die: "conversation data" cannot be erased, but a named column can. Four things are stated rather than smoothed over: `conversations.request_text` is the riskiest field in the product and whether it is defensible at all is an open EXT-02 question; contacts are anonymised rather than deleted so tasks are not orphaned; knowledge is flagged as _possibly_ personal because an owner can write a staff member's mobile number into it; and German tax law overrides erasure for billing records for eight years. The classification check is proven on a fixture, which mattered — the real schema is five columns today, so a bare pass would have shown nothing.
- 2026-09-29 — P03.02 and P03.03 complete. Glossary, entity model, aggregate boundaries, the three closed vocabularies and ten state machines as transition tables. Coverage against the blueprint is mechanical (26 entities, 0 unmapped, 5 explicitly deferred), and the check found a false positive in itself before it found anything else — naive pluralisation flagged `retention_policy` when the table is `retention_policies`. A false positive in a coverage check is worse than none, so it was fixed rather than allowlisted.
- 2026-09-29 — P03.01 complete: ADR process, ten core ADRs accepted, three drafted and left PROPOSED, plus the invariant enforcement register. The coverage check is mechanical and found two things reading would not have: four P02 ADRs with no Verification section at all, and three invariants with no ADR. Those three are accounted for explicitly rather than excused — INV-14 has none by design, because no linter can tell whether a feature is an excluded sensitive use. Open question recorded rather than resolved: PLAN L2180 lists ADR-0036 for P03 while the register assigns it to P07.
- 2026-09-29 — P02.07 complete, and the walkthrough was worth more than the documents it checked. A fresh session with no context found nine real defects, the worst two being that the environment checker silently did nothing (its name was shadowed by a pnpm built-in) and that nothing in the repository loaded the local environment file at all — so the first setup step was inert and the checker reported green on a configuration that could not run. Also fixed: `pnpm dev` did not exist, the integration harness silently fell back to an admin connection and failed with what looked like an RLS security defect, and two checkouts silently shared one database, which destroyed this machine's dev volume during the run. P02 PILOT is complete except EXT-24 and the founder items.
- 2026-09-29 — All three CI workflows green. P02 is now complete except for the items that need the founder or a third party: the ruleset (EXT-24) and, behind it, the four negative-control PRs. Follow-up recorded rather than left to be rediscovered: the arm64 container build runs under emulation on an x86 runner at ~4.5 minutes per run, which will not stay tolerable as the image grows — a native arm64 runner is the remedy.
- 2026-09-29 — CORRECTION: P02 wrote its two local-emulator decisions as ADR-0035 and ADR-0036, which PLAN's register reserves for Search (P09) and time/locale (P07). Renumbered to ADR-0044 and ADR-0045 and added to the register, with every reference updated. Found while reading the register at the start of P03 — which is the argument for reading the register before writing an ADR, not after.
- 2026-09-29 — P03 started. Its only dependency, P02.03, is complete. Plan at docs/phases/P03-plan.md; ADR index, template and the first eight core ADRs written on docs/p03-01-adrs.
- 2026-09-28 — P02.06 and P02.08. The first CI run failed on all three new workflows and every failure was a real defect local runs could not have caught: turbo ran each package's own test script and the web package's picked up the Playwright spec; `next-env.d.ts` is regenerated by the build so formatting it reverts; hadolint was right that setting the platform on each FROM is redundant; the gitleaks action now needs a repository token a contributor-code workflow should not hold; and semgrep flagged the founder-owned control plane and the deliberately-violating lint fixtures. Second run: security-scan green, integration tests green against real PostgreSQL. The licence check found a genuine violation — libvips is LGPL via sharp via Next.js image optimisation — resolved by a written decision (LGPL attaches on distribution, AGPL's network clause reaches a hosted service) and flagged for EXT-02 rather than treated as settled.
- 2026-09-28 — SCOPE NOTE: `docs/development/{local-setup,testing,conventions}.md` were swept into the P02.06 fix commit by a broad `git add` while they sat untracked during a branch switch. They belong to P02.07. Not corrected by rewriting a pushed commit; the branches are stacked and merged in order, so `main` ends up identical either way.
- 2026-09-28 — P02.05 complete. 108 unit tests, 5 integration tests against real PostgreSQL, 4 end-to-end tests with an axe scan; every type verified both in-suite and standalone against a database destroyed and rebuilt first. The harness found three real defects the moment it was pointed at itself: the test template was created bare and had no pgvector; migration 0001 described a SELECT grant in a comment and never issued it (fixed as 0002, because the checksum rule correctly forbids editing an applied migration); and the German character folding dropped Turkish dotless i entirely, turning "Yılmaz" into "ylmaz" — plausible-looking and matching nothing. Only Chromium is installed locally, because `playwright install --with-deps` needs sudo; Firefox and WebKit are left to CI and are not claimed as passing.
- 2026-09-28 — CORRECTION (process): several earlier ledger rows were never actually written. Prettier reformats this file's tables into aligned pipes, and later Python `str.replace()` calls used the unaligned source text, so they matched nothing and failed silently. The Items table has been rebuilt from the evidence registry, which is the authoritative record. Lesson applied: every scripted edit to a tracked file now asserts its match count, as the PLAN.md edits already did.
- 2026-09-28 — P02.04 complete. Six-service stack, all digest-pinned, healthy in 26 s from empty volumes; fresh clone to a running stack with migrations in 29 s warm (cold adds ~1.73 GiB of image downloads, measured rather than estimated away). Two honest gaps: the local environment file must be created by the founder because the control plane blocks it, and the demo-tenant rows wait for P06's schema rather than creating a tenant table here without FORCE RLS. The health checks initially reported three working services as unhealthy — the probes used a bash builtin none of those images ship.
- 2026-09-28 — P02.03 QG-09 review and remediation. The security and architecture reviewers returned BLOCK MERGE with 1 Critical and 11 High between them. Every one was reproduced before being fixed. Three findings were defects in work this session had already recorded as passing, and two evidence records (EV-P02-015, EV-P02-017) carried claims that were simply false — both now carry a correction section rather than being quietly rewritten. The most useful lesson: `redaction.test.ts` passed while three separate paths carried personal data to stdout, because it tested the redactor instead of the serialised line. Where the two reviewers disagreed on a fix, the measurement decided it. Tests 65 → 90.
- 2026-09-28 — P02.03 complete. Workspace: lint exit 0, typecheck 16/16, 65 tests across 5 packages, build 12/12, dependency-cruiser clean. arm64 image built and all four roles verified live under `--read-only --tmpfs /tmp --security-opt no-new-privileges`. Two defects were found and fixed by the work's own tests rather than in review: the log redactor allowlisted `name` and leaked the error message back through `err.stack`; and the readiness probe's two deadlines were equal, which made every specific failure reason unreachable. One was found by inspection: the runtime image carried the whole dev toolchain (589 MB → 84.9 MB).
- 2026-09-28 — P02.02 complete and locally verified under Node 24.21.0 / pnpm 10.34.5: prettier --check, eslint, depcruise, turbo typecheck/test/build all exit 0; 33 tests pass. TypeScript 6.0.3 chosen over 7.0.2 because typescript-eslint 8.70.1 declares `typescript >=4.8.4 <6.1.0`; marked VALIDATION REQUIRED against Next.js/NestJS in P02.03. `.claude/gates.json` is founder-only, so its P02.02.02 replacement is `docs/control-plane/patches/0003-p02-gates.patch`, verified by applying it to an isolated copy (patch exit 0, result byte-identical to the intended file).
- 2026-09-28 — CORRECTION to the log entry below and to the P02 plan: `evidence.py check` requires an EV ID on _every_ ticked item outside P00, not only on verification items. P00 is explicitly exempt in the checker, which is what made the P00 checklist look like a counter-example. All 15 ticked P02 items now cite evidence; audit is 11 OK, 0 problems.
- 2026-09-28 — FINDING (not P02): `evidence.py check` reports `MISSING EV-P00-001`. PLAN.md L1889 ticks P02.02.04's counterpart P00.02.04 citing `EV-P00-001`, but no record exists — the registry it belongs in is only created now, by P02.01.04. The audit result is recorded inline in PLAN.md (HEAD `fb7185e`, remote private, `main` unprotected, Node v22.20.0, pnpm 10.12.1, Terraform absent). Not registered by this session: transcribing another phase's result into an evidence record is not the same as having run it, and P00 is the founder's phase. Founder action, see the P02 action bundle.
- 2026-09-28 — P02.01 governance scaffolding implemented. `check-no-ai-mentions.ts --self-test` passes (9 patterns, 11 blocked and 7 allowed examples); `check-conventional-commit.ts --self-test` passes (13 cases). Both run clean over `HEAD~2..HEAD`. Node 24.21.0.
- 2026-09-28 — P02 execution started from `docs/phases/P02-plan.md` (approved). Docker Desktop reachable (server 29.8.0), Node 24.21.0 available via nvm. Branch `chore/p02-01-governance`.
- 2026-09-29 — F3 bookkeeping correction: no EV-P00-001 record exists in the registry, evidence directory or Git history. Unticked P00.02.04 and its P00.02 parent instead of reconstructing evidence from the historical inline note. The recorded P00 audit remains outstanding; this correction does not claim it was performed. The dedicated correction branch is based on PR #16 and must land after the bootstrap stack.

- 2026-09-30 — **P06.10 audit infrastructure: the daily verifier, and the wall it ran into.** The
  chain verifier existed for one tenant inside a caller's transaction, which is the wrong shape for
  an alarm — the break that matters is in the tenant no request touched today. Walking every tenant
  needs the tenant list, and there is no role permitted to read it: FORCE ROW LEVEL SECURITY applies
  to the table owner, so with no tenant context `moin_migrator` counts **zero** organisations, and a
  `SECURITY DEFINER` function owned by it returns nothing for the same reason. That was measured
  against real PostgreSQL before anything was designed on top of it, and the assertion now lives in
  the suite so the premise cannot rot silently. The only way round would have been `BYPASSRLS`,
  which INV-01 forbids outright, so the tenant list became a global register of opaque identifiers —
  filled by a trigger on `organisations` rather than by the provisioning function (a migration or
  repair script can also create a tenant, and those are the paths that forget a bookkeeping step),
  append-only for the owner too (a deletable registration makes "remove the row" the cheapest way to
  hide a tampered chain), and enumerated instead of `audit_heads` (a deleted head must become a
  `missing-head` finding, not a tenant that quietly leaves the worklist).
  The sweep keeps `sound`, `broken` and `unchecked` disjoint and refuses to return an empty clean
  report when it could not enumerate anything, because "verified nothing" must never read as
  "nothing wrong". Exit codes split a break (3) from a sweep that could not finish (1), so a
  database outage does not page anyone for suspected tampering.
  The argument scanner is the check that the writer's policy held, which the writer cannot do for
  itself. Its useful rule turned out to be structural, not pattern-based: the only string-valued
  argument kind the registry permits is `uuid`, so any stored argument string that is not a UUID is
  unreviewed — which catches a business name that no pattern list would have predicted.
  Twenty-five defect variants were injected and all 25 were KILLED. Two initially SURVIVED, and both
  were weak tests rather than weak code: the page-cap assertion could not tell a missing cap from a
  working one with only three tenants, and the INV-12 field assertion ran only over a sound sweep, so
  it never exercised the failure path where a driver message would leak. Both were fixed and
  re-proven. `gates full` 14/14 at clean `8e5bf76f5ac9`; the final-HEAD run follows this entry.
  Not done, and not claimed: P06.10.03 adoption by the tool guard, operator and security paths waits
  on P10.08 and P06.11/.12; P06.10.05 scheduling and the CloudWatch alarms are Terraform and wait on
  EXT-09; P06.10.06 acceptance of ADR-0017 is the founder's, so the ADR stays `PROPOSED`.

- 2026-09-30 — **QG-09 review of P06.10, and what it found.** Three reviewers ran independently on
  the diff and all three returned BLOCK MERGE. Two findings are worth recording beyond their fix,
  because both were failures of _verification_ rather than of design, and both had passing tests
  over them.
  The argument scanner could not see a single row under any production role. As the runtime role it
  died on a missing grant; as the role that owns the tables in production, FORCE RLS returned zero
  rows, so it printed "every stored argument is a registered key with a reviewed value kind" and
  exited 0 with a planted leak sitting in the table. It passed its own test only because the test
  handed it the local bootstrap superuser — which is the exact trap this branch documents for
  `organisations`, in a test two files away, not carried across. A check that fails open is worse
  than no check, because it reports green and means nothing.
  The verifier could be silenced without touching a committed event. Its upper bound is the chain
  head, and the head had no guard: `last_seq = 0` left a full trail in place and returned
  `valid: true, checked: 0`, while an insert past the head was neither an UPDATE nor a DELETE and so
  never met the append-only trigger, leaving a forged row that the query API serves as genuine. Both
  were reproduced before being fixed, and both measurements are now assertions.
  The pattern in both: the code was checked against the threat it was designed for, and not against
  the privilege level it would actually run at. Everything here now runs as `moin_app`, and where a
  measured database fact underpins a design decision — FORCE RLS hiding a table from its own owner —
  that fact is asserted in the suite rather than recorded in a comment.
  42 defect variants were injected and all 42 KILLED. Ten initially SURVIVED and every one was a weak
  test, not weak code; the two most instructive were an INV-12 assertion that only ever ran over a
  sound sweep, so it never exercised the failure path where a driver message would leak, and a
  vacuous-pass guard that no test reached because nothing ran the check as a process.
  `gates full` 14/14 at clean `23d70ae293e4`. Five findings are open with named owners in ADR-0017's
  "Known residuals" table rather than quietly closed: the verifier still runs as the request-serving
  role until Terraform can provision a dedicated one (EXT-09); an `(operation, target_kind)` registry
  needs a writer-contract change (P07/P16); `locations` still carries unaudited DML (P07); routing
  the alarm lines through the redacting logger would edit the INV-12 allowlist, which is the
  founder's call; and `pg_temp` in definer search paths is a repository-wide convention.

- 2026-10-01 — **Second independent QG-09 review of P06.10: four HIGH defects, all fail-open.** The
  pattern is the one worth recording, because three of the four were introduced _by_ the previous
  round's fixes rather than surviving from the original design. Each was a control that reported
  success while proving less than it claimed:
  the deadline counted its shortfall from the tenants it had claimed, and since every claimed tenant
  is also processed, that arithmetic yields zero whether or not any remain — "one claimed, one sound"
  read exactly like a complete estate; the argument scanner reconciled against nothing, so a tenant
  provisioned but absent from the register sat outside everything it inspected, with a planted leak
  under it, and it exited 0; a registered argument key was treated as a validated value, so a `uuid`
  argument holding `true` produced no finding at all; and verification asked "is there a head?" and
  "is there an event?" as two statements, which at READ COMMITTED are two snapshots, so a tenant's
  legitimate first append landing in between produced `missing-head` for a sound chain.
  The lesson generalises past this phase: **a fix is a new control, and a new control needs the same
  adversarial treatment as the thing it replaced.** Coverage checks are the ones to distrust most,
  because their failure mode is silence. Every one of these was measured before it was fixed, and
  each measurement is now an assertion.
  The mutation set grew 42 → 54 and moved out of a scratch script into
  `docs/verification/audit-mutation-manifest.json` with a committed runner, because a total count
  says nothing about which properties are proven. Four new variants initially survived — every one
  because it removed a _redundant_ guard the named test could not isolate. They were kept and the
  tests sharpened instead of dropped; one of those sharpenings required the deadline check to move
  after the first page, which also fixed a real behaviour (a sweep whose deadline had already expired
  used to exit having verified nothing).
  `gates full` 14/14 at clean `c1bde7a98672`. ADR-0017 stays **PROPOSED**. The five residuals are
  unchanged and now carry explicit classifications: `moin_app` enumeration is
  `EXTERNAL_DEPENDENCY` (EXT-09); caller-supplied operation/target-kind/versions, the `locations`
  DML capability and the alarm lines bypassing the redacting logger are each
  `FOUNDER_DECISION_REQUIRED`; `pg_temp` last in a definer search path is acceptable for this PR
  only and must not be read as a general conclusion. P06.10.03 and P06.10.05 remain open as
  recorded. P06.10 as a whole is not complete.

- 2026-10-01 — **Third QG-09 review of P06.10: a paging model that could not see its own gap, and a
  harness whose numbers were not evidence.** Both worth recording for the general lesson.
  The register was paged by `tenant_id`. With one tenant registered, a sweep that had claimed it,
  and a second tenant registered concurrently: the next page returned 0 rows, the shortfall count
  returned 0, and the unregistered-tenant witness returned 0 — the last because the new tenant _was_
  registered. A complete-coverage verdict over half the estate, and none of the three checks could
  see it. UUID order does not encode registration order, so no cursor over it can distinguish
  "nothing left" from "something arrived behind me"; and counting cannot either, because a late
  tenant ahead of the cursor is processed and pushes the total up while an original member is still
  unvisited. The previous round's count-after-cursor fix was a patch on the wrong axis.
  The fix records registration order — a monotonic sequence, immutable once assigned — and bounds
  each sweep by a high-water mark read once. The guarantee is now stated rather than implied:
  **sound for the register population captured at sweep start**, with the mark on the alarm line,
  because "sound" is not interpretable without the population it is sound for. Continuous-current
  soundness would need one snapshot held across every tenant's chain, and that is not worth pinning
  `xmin` on the fastest-growing table in the schema.
  The mutation harness counted any non-zero exit as a kill. Pointed at a closed database port it
  reported every variant killed; given a nonexistent test name it reported survived. So "54/54" was
  a count of failures of any kind. Rewritten, the first honest run said **47 killed, 4 unusable
  baselines, 6 infra failures, 5 no-match, 2 survived** — seventeen of the previous kills were not
  evidence, and every one was a defect in the _tests or the variants_, not the code: three tests
  passed only in file order, five variants broke a migration instead of the behaviour, two mutated
  code a later migration had replaced, one changed `const` to `let`, and two classifier bugs came
  from matching on what the runner seems to print rather than what it does.
  The generalisable lesson, and it is the third time this phase has taught it: **a verification
  tool is a control, and an unverified control tends to be generous.** The way to find out is to
  make it fail on purpose. Final distribution at `fcc44730ace5`: `KILLED_ASSERTION: 62`,
  `INFRA_FAILURE: 2` — the two documented in the manifest as rejected by an assertion inside a
  migration during global setup, where no test can claim the kill. Not rounded up to 64.
  Incidental, and closed: the personal-data gate parsed only `CREATE TABLE`, so a column added by
  `ALTER TABLE` never reached the inventory and an erasure request would have missed it silently.
  Found by adding one and noticing the checked-column count had not moved. Coverage went 73 → 76.
  `gates full` at the final HEAD follows this entry. ADR-0017 stays **PROPOSED** and its five
  residuals are unchanged: `moin_app` enumeration `EXTERNAL_DEPENDENCY` (EXT-09); caller-supplied
  operation/target-kind/versions, the `locations` DML capability and the alarm lines bypassing the
  redacting logger each `FOUNDER_DECISION_REQUIRED`; `pg_temp` last acceptable for this PR only.
  P06.10.03 remains open; P06.10.05 remains `WAITING_FOR_EXTERNAL` on EXT-09; P06.10 is not
  complete.

- 2026-10-01 — **Fourth QG-09 review of P06.10: a sequence that is not transactional, and an
  assertion decided by reading words.** Both reproduced before being fixed, and both are the same
  failure of imagination: trusting a mechanism to mean what its name suggests.
  `nextval()` is not transactional. It does not lock and does not roll back, so allocation order is
  not commit order — which makes it useless as a population authority however monotonic it looks.
  Measured: Tx A takes epoch 1 and stays open, Tx B takes 2 and commits, a sweep reads
  `max(registration_seq)` = 2 and sees one of that population's two members, then A commits and the
  same population has two. A complete-coverage report over a half-covered population: the previous
  round's defect reintroduced one layer down by the fix for it.
  Epochs are now allocated by incrementing one authoritative row inside the registering
  transaction, so PostgreSQL's row lock does the serialization and epoch order is commit order.
  While epoch N is in flight, no epoch above N can be committed, because nobody else can allocate
  one. There is no sequence and no column default — a dormant allocator is a second allocator. The
  guarantee is a counter serialized by a row lock, and it is no longer described as a snapshot,
  which it never was.
  The mutation classifier decided "was this an assertion?" from the words in the failure message.
  `database connection refused while executing toThrow assertion` contains `toThrow`, so an
  unreachable database counted as proof an invariant was enforced — three of four crafted messages
  were misclassified. A custom reporter now reads the live error objects and records what they are:
  the name, plus whether Chai's `expected`/`actual`/`showDiff`/`ok` are present. Both halves are
  required, because a name can be reassigned in one line. Message text survives for exactly one job
  — telling a hung test from other non-assertion failures — where it cannot promote anything.
  And a third defect found while regenerating, which is the one worth remembering: the sweep applied
  mutations with `String.prototype.replace` and a **string** replacement, so `$$` in any SQL
  function body became `$` and the migration failed with a syntax error. The variant looked
  detected; nothing had been tested. It resisted diagnosis because the mutated migration applied
  cleanly by hand and failed only through the harness.
  Three rounds running, the thing that was wrong was the _verification_, not the subject. A tool
  that reports on correctness is itself a control, and this one has now been wrong in four distinct
  ways — exit codes, message text, string escaping, and variants that broke rather than mutated.
  Final distribution at `f10588228b2a`: `KILLED_ASSERTION: 69`, `INFRA_FAILURE: 2`, over 71
  variants. One variant was deleted rather than left looking proven: with allocation serialized,
  `max(registration_seq)` and the state row cannot diverge, so the high-water source and the
  allocator are one invariant and not two.
  ADR-0017 stays **PROPOSED**; the five residuals are unchanged. P06.10.03 remains open; P06.10.05
  remains `WAITING_FOR_EXTERNAL` on EXT-09; P06.10 is not complete.

- 2026-10-01 — **Fifth QG-09 review of P06.10: the audit architecture was accepted; the evidence
  harness was not.** No new database or security blocker. The three blockers were all one thing —
  `KILLED_ASSERTION` meant less than it claimed — and all three were reproduced before being fixed.
  **Assertion identity cannot come from the error object.** Vitest serializes errors before a
  reporter sees them, so there is no live `Error` and no prototype left to test — `instanceof` is
  unavailable even inside `onTestFailed`. Everything that survives is a mutable own property, which
  is why decorating an ordinary `Error` with `name = 'AssertionError'` and the four matcher fields
  was accepted as proof an invariant was enforced. Identity now needs two signals the thrown object
  cannot touch, both required: `expect.getState().assertionCalls` read in `beforeEach`/`afterEach`
  by a setup-file probe inside the test process, and the `constructor`/`toString` markers Vitest's
  own serializer adds to every error it does **not** own. Measured, not assumed: a genuine
  `AssertionError` serializes with exactly `actual, diff, expected, message, name, ok, operator,
showDiff, stack, stacks` and neither marker; a plain `Error`, a decorated `Error` and Node's own
  `assert.AssertionError` all gain both.
  The second signal is undocumented behaviour, so it is pinned by a test that spawns a real Vitest
  run over real fixture suites rather than by fixture JSON that re-encodes the assumption. That run
  is what settled the hardest case: passing expectations followed by a decorated throw gives
  `expectCalls: 2`, so the probe alone would have accepted it and only the foreign markers reject
  it. The two signals are not redundant.
  **A killing test is a module and a name, both exact.** `fullName.includes(expectedTest)` was
  unsound three ways at once: a same-named test in another file could claim the kill, two tests
  could match and the first was taken, and `"rejects invalid chain"` matched `"rejects invalid chain
after retry"`. Zero matches is `NO_TEST_MATCH`, two is `AMBIGUOUS_TEST_IDENTITY`, and `--validate`
  now refuses the manifest before any test runs.
  **A kill must be attributable.** The previous classifier returned `KILLED_ASSERTION` while
  recording `unrelatedFailures > 0` in the same object. An unrelated failure may be the reason the
  intended test failed, so the run is `UNRELATED_FAILURE` and not evidence.
  Tightening `--validate` immediately found a latent defect of its own: one existing anchor resolved
  to **two** places in `cli.ts`, and `String.prototype.replace` rewrites the first — so which guard
  that variant had been attacking was down to file order. It happened to be the intended one. The
  anchor is now unique and the check refuses a non-unique one.
  Twelve new `H*` variants attack the harness: each removes one conjunct of the trust rule and names
  the adversarial test that must catch it. All twelve are killed, which is what makes the other 65
  mean anything.
  Final distribution at `986ae8b9dd4b`: `KILLED_ASSERTION: 77`, `INFRA_FAILURE: 2`, over 79 variants.
  The two are **not** rounded up, and their recorded reason was corrected after measurement: they
  are not global-setup rejections as previously claimed but the migration's own guard firing inside
  the test that applies it — `0010` raising "backfill covered 0 of 3 organisation(s)" and `0011`
  failing `NOT NULL` — so the test fails on a thrown database error after real `expect` calls. A
  guard inside a migration is stronger than a test; it is not assertion evidence, and saying so is
  the point of the taxonomy.
  ADR-0017 stays **PROPOSED**; the five residuals are unchanged. P06.10.03 remains open; P06.10.05
  remains `WAITING_FOR_EXTERNAL` on EXT-09; P06.10 is not complete.

- 2026-10-01 — **Fifth QG-09 review of P06.10, second harness round: the thrown value was never a
  trust boundary.** The audit architecture was accepted; the evidence harness was not, and the one
  remaining blocker was the important one. Both exploits were reproduced before anything was fixed.
  A **plain object literal** — `throw { name: 'AssertionError', expected: 1, actual: 2, showDiff:
true, ok: false }` — is serialized by Vitest with none of the `constructor`/`toString` markers the
  previous model treated as proof of foreignness, because it is not an `Error` at all. Measured: the
  reporter returned `ASSERTION`. An ordinary `Error` whose `toJSON()` returns that shape did the
  same. Four generations of this decision had now been spoofed — exit code, message text, name plus
  matcher fields, serializer markers — and the pattern is not that each list of fields was too
  short. A thrown value is **data authored by the code under test**. No property of it can be
  authority for what the test framework did, so there is no tighter heuristic to reach for.
  Evidence now comes from provenance. Every function on Vitest's `Assertion.prototype` is wrapped in
  the setup file, and only that wrapper can append a `MATCHER_FAILURE` record; `throw` does not call
  a matcher, so no throw of any shape can create one. The `rejects`/`resolves` getters are wrapped
  too, because Vitest raises "promise resolved instead of rejecting" from inside its own async chain
  without running a matcher — still its assertion machinery, and a shape several real kills depend
  on. `assertionCalls` is now diagnostic only: a successful `expect` followed by any throw reports
  two calls and zero failures, which is exactly why the counter could never be the signal.
  Two things about the design are worth keeping. Identity is read from `context.task`, never from
  `expect.getState()` — measured: under `it.concurrent` the module-level state reports _another_
  test's name — and overlapping invocation windows are detected and refused rather than attributed.
  And the probe is the **last** writer of its own key: a fixture writes a complete, self-consistent,
  token-stamped record naming itself into `task.meta`, and a setup file's `afterEach` overwrites it.
  The forgery is not hidden from; it is overwritten.
  One narrow use of the error survives and is stated as such: the wrapper stamps an invocation-scoped
  token on the value it rethrows, and the reporter requires the failing test to carry it. That
  answers only "did the earned failure actually propagate" — a test that catches `expect(1).toBe(2)`
  and then throws something else has the event but not the token — and it can only ever _remove_
  evidence, because without the event nothing reads a token.
  Anchor uniqueness moved into `applyMutation`, which both the sweep and `--validate` now use, so an
  operator who skips validation gets the same guarantee: zero, several, empty or no-op anchors are
  all `INVALID_MUTANT`. The splice is positional, which retires the `$$`-interpretation bug by
  construction rather than by remembering to pass a function.
  Two limits are recorded rather than hidden. The sweep hands the mutated reporter to the mutated
  run, which is sound only because every `H*` reporter variant is a relaxation; and a probe mutation
  broad enough to stop _any_ test producing `ASSERTION` cannot be killed by an assertion, because the
  harness could not then report its own kill. Three variants were narrowed for exactly that reason,
  and the properties they would have covered are proven by the real-Vitest suite instead.
  Final distribution at `96a5dadcfe30`: `KILLED_ASSERTION: 90`, `INFRA_FAILURE: 2`, over 92
  variants. `77/2 over 79` is superseded.
  ADR-0017 stays **PROPOSED**; the five residuals are unchanged. P06.10.03 remains open; P06.10.05
  remains `WAITING_FOR_EXTERNAL` on EXT-09; P06.10 is not complete.

- 2026-10-01 — **Sixth QG-09 review of P06.10: a token is a credential, and credentials copy.** The
  previous round stamped an invocation-scoped token on the object a matcher threw and required the
  failing test to carry it. Reproduced in one line:

      try { expect(1).toBe(2) } catch (e) { caught = e }
      const terminal = new Error('ordinary'); Object.assign(terminal, caught); throw terminal

  `Object.assign` copies the token, and the run was reported `ASSERTION`. Making the token
  non-enumerable, a symbol, random, hashed or signed would have changed nothing: whatever a test can
  read off one object it can write onto another. That is five generations of this decision defeated
  — exit code, message text, name plus matcher fields, serializer markers, and now a credential —
  and the thing they have in common is that each read _the thrown value_, which is data authored by
  the code under test.
  Evidence is now **object identity**, which is the one property of a value that cannot be
  transferred: `Object.assign(terminal, caught)` gives `terminal !== caught`. A module-private
  `WeakMap` maps each object a matcher threw to its invocation; the trusted `evidenceTest` wrapper
  catches the value that terminated the test body and asks the map about that exact object. Nothing
  is written onto the thrown value at all, and no field of it is read anywhere in the verdict.
  The wrapper is necessary, not stylistic, and measurement is what settled it: by the time any
  Vitest hook runs the live object is gone — in both `afterEach` and `onTestFailed`,
  `task.result.errors[0]` is already a serialized plain object with `instanceof Error` false.
  `task.fn` is not exposed to hooks, and Vitest 5 exports no base runner class to extend. Inside the
  test callback is the only place the terminal value still exists.
  That has a cost, and it is the honest one: **a test registered with plain `it` cannot bear
  evidence.** The harness's own tests and the `scripts/check-*` suites were migrated to
  `evidenceTest`; the 42 variants whose killing tests live under `packages/db/` were not, because
  this round was told not to modify that directory. They are reported `NOT_EVIDENCE_ELIGIBLE` rather
  than quietly counted. Forty of them would become evidence with a one-line change per test; `N8`
  and `P8` would not, because nothing in them fails a matcher at all — their control is an assertion
  inside the migration.
  Two candidate self-mutants were **removed** rather than kept: deleting `confirmTerminal` or
  `beginEvidence` stops _any_ test producing `ASSERTION`, so the harness cannot report its own kill
  and the row would have been permanent fake non-evidence. The real-Vitest suite asserts both
  invariants directly instead. The old `H12` was also removed on the review's finding that its
  stated replay defect was false — dropping the invocation id from the token left the sequence
  component unique — and replaced with a mutant that ignores the invocation binding in the WeakMap,
  killed by an actual cross-test replay.
  Final distribution at `953c47c73bf4`: `KILLED_ASSERTION: 52`, `NOT_EVIDENCE_ELIGIBLE: 42`, over 94
  variants. `90/2 over 92` is superseded. The number went down because the standard went up.
  ADR-0017 stays **PROPOSED**; the five residuals are unchanged. P06.10.03 remains open; P06.10.05
  remains `WAITING_FOR_EXTERNAL` on EXT-09; P06.10 is not complete.

- 2026-10-01 — **Closing the eligibility gap, with the scope the founder opened.** The previous round
  left 42 variants `NOT_EVIDENCE_ELIGIBLE` because their killing tests live under `packages/db/`,
  which that round was told not to touch. Test files there are now in scope, product code still is
  not, so the migration is **registration only**: `it(` → `evidenceTest(` on exactly the 30 distinct
  tests the 40 eligible variants name. No test name, body, assertion, setup, database work or timeout
  changed, and every suite's count is identical (`audit-verification` 24, `cli-verify-audit` 8,
  `audit-chain-population` 10, `audit-chain-epoch` 8, `audit-chain-backfill` 2, `audit` 11).
  One structural change was needed and is worth recording. The wrapper lived in `scripts/`, and a
  relative import from `packages/db/src/` into `scripts/` is exactly the six-level path this
  repository's own boundary test calls unacceptable. So the contract, the private state and the
  wrapper moved to `packages/testing/src/mutation/` and are re-exported from `@moin/testing` — the
  same door `createTestDatabase` already comes through. The mechanism is byte-for-byte the same; only
  its address changed. `depcruise` is clean over 197 modules.
  `N8-backfill-removed` and `P8-sequence-backfill-removed` were **deliberately not migrated**. Their
  defects are caught by a guard inside the migration — `0010` refusing an incomplete register
  backfill, `0011` failing `NOT NULL` — so the test fails on a thrown database error and no matcher
  ever throws. Wrapping them would not change that, and rewriting them to catch the error and
  `expect()` it would be manufacturing evidence rather than finding it. They stay
  `NOT_EVIDENCE_ELIGIBLE`, outside the numerator, with the reason in the manifest.
  The result was not forced: every one of the 40 migrated variants came back `KILLED_ASSERTION` on
  its own, because each of those tests already terminated on a genuine matcher failure. Final
  distribution at `bf022008a1d2`: `KILLED_ASSERTION: 92`, `NOT_EVIDENCE_ELIGIBLE: 2`, over 94
  variants. `52/42` is superseded.
  Object-identity provenance is unchanged: the private `WeakMap`, the terminal `T === M` check, and
  every attack case — copied properties, copied symbols, cloned Error, async copy, swallowed matcher,
  cross-test replay, retry replay, parameterized replay, two matcher failures, concurrency. No token
  returned.
  ADR-0017 stays **PROPOSED**; the five residuals are unchanged. P06.10.03 remains open; P06.10.05
  remains `WAITING_FOR_EXTERNAL` on EXT-09; P06.10 is not complete.

- 2026-10-02 — **The two remaining QG-09 blockers, harness only (EV-P06-034).** (1) A plain `it`
  test could import `beginEvidence` and `confirmTerminal` from `@moin/testing`, confirm a matcher
  object it had caught, throw an unrelated error and come out `ASSERTION`. This was reproduced in a
  child Vitest before the fix. Removing the re-exports would not have been enough, because any
  `export` is one relative import away. So both functions, and the `intercept` wrapper that calls
  them, are now module-scoped in `evidence-state.ts` and exported from no module. The only path to
  them is `evidenceTest` registration, and Vitest refuses that inside a running test. The probe takes
  its recorder and window controls once, via `installProbe`. The root exports an allow-list, and the
  `exports` map stays root-only. A surface test pins both, plus every occurrence of the names.
  (2) A sweep killed mid-mutant left the mutant on disk, and the next sweep read it as "original". Now
  every manifest target is hashed as Git would store it (`hash-object --path`) and compared with its
  HEAD blob before anything runs and after every variant. The restore writes back the proved bytes
  and verifies them. Any mismatch aborts with exit 3 and changes nothing. The baseline cache comes
  after the checks. SIGINT and SIGTERM restore; SIGKILL is covered by the next run refusing to start.
  Nine new `H*` self-mutations all kill, and both fixes are mutation-checked KILLED. The sweep was
  regenerated at `52cc10f`: `KILLED_ASSERTION: 101`, `NOT_EVIDENCE_ELIGIBLE: 2` (N8, P8, unchanged)
  over 103 variants. `92/2 over 94` is superseded. No product, migration or app change. ADR-0017
  stays **PROPOSED**; P06.10 is not complete.

- 2026-10-02 — **One mutation sweep per worktree (EV-P06-035).** The last QG-09 blocker: two
  sweeps in one worktree both passed the pristine check and then took turns writing one file. The
  overlap was reproduced before the fix with the review's M1/M5 shape (same file, same killing test)
  as real processes. A's mutant run observed M5's bytes, B's baseline observed A's M1, both reported
  `KILLED_ASSERTION`, and every restore check passed. A sweep now takes an exclusive lock first —
  `mkdir` of `$(git rev-parse --absolute-git-dir)/moin-mutation-sweep.lock`, atomic, per worktree —
  before HEAD, the source or the baseline cache is read. It holds the lock until the last restore is
  verified and the report is written, then releases it in one `finally`. A failed restore keeps the
  lock for a human. SIGINT and SIGTERM release only after the verified restore. SIGKILL leaves the
  lock; the next sweep and `--validate` refuse with exit 4, recovery is manual and documented, and
  the HEAD-pristine check remains behind it. 13 process-level and lifecycle tests; four new `H*`
  variants all kill; the fix is mutation-checked KILLED; a 20× stress run passed with zero double
  owners. Regenerated at `1a924a0`: `KILLED_ASSERTION: 105`, `NOT_EVIDENCE_ELIGIBLE: 2` (N8, P8)
  over 107 variants. `101/2 over 103` is superseded. No product, migration or app change. ADR-0017
  stays **PROPOSED**; P06.10 is not complete.

- 2026-10-02 — **QG-09 accepted for PR #31 (EV-P06-036).** Independent verdict
  `READY_FOR_FOUNDER_QG09` on reviewed implementation HEAD `468827a`. Before the two conditional
  dispositions were recorded, both conditions were checked against the source.
  (a) `operation`/`target_kind`/`versions`: `appendAuditEvent` has no production caller, the
  provisioning trigger writes fixed literals, `EXECUTE` is `moin_app`-only, and no HTTP route
  reaches the writer.
  (b) `verify-audit` output: fixed literals, counts, sequence numbers, opaque organisation UUIDs,
  six fixed break reasons, and a SQLSTATE or error class name — never a message.
  Dispositions:
  - verifier role deferred, not waived (EXT-09);
  - caller-supplied fields accepted for trusted internal writers only;
  - `locations` DML deferred coverage under P06.10.03;
  - alarm output accepted for this PR only, with future dynamic payloads through the redacting logger;
  - `pg_temp` last acceptable for this PR only, not a precedent.

  ADR-0017 is **ACCEPTED** (P06.10.06); P06.10.07 is **VERIFIED**. Still open: P06.10.03 (including
  `locations`) and P06.10.05 (`WAITING_FOR_EXTERNAL`, EXT-09). P06.10 and P06 remain `IN_PROGRESS`.
  Governance-only commit; no implementation change.

- 2026-10-04 — **P06.06.01/.02 updated with dedicated moin_identity role (EV-P06-042).** Closed QG-09
  invariant I1 by introducing dedicated `moin_identity` database role for the api's session pool.
  `moin_app` retains zero EXECUTE on session functions. `moin_identity` holds NOBYPASSRLS, executes
  exactly the six session functions, holds zero table/column privileges, owns nothing, creates
  nothing, and has CONNECT on `moin` alone (CONNECT revoked on `postgres` and `template1`). Startup
  assertion in api verifies role, attributes and function set before exposing store. Family-root row
  lock serialises concurrent sign-in and rotation. 43/43 session mutations killed (KILLED_ASSERTION: 43).
  14/14 full gates and 20x stress pass. EV-P06-042 recorded at candidate HEAD `74a579d`, superseding
  EV-P06-041. P06.01.06 unticked; P06.06.01/.02 remain READY_FOR_REVIEW; P06 remains IN_PROGRESS.

- 2026-10-04 — **BLOCKER: waiting on two QG-09 reviewer verdicts before fixing Reviewer A HIGHs.** Reconciliation adopted f286c18 as base (legitimate B1+B2+B3 work, no reset); strengthened G21/CLK4 controls; full session sweep 47/47 KILLED_ASSERTION; gates full 14/14 PASS; Trivy HIGH 0 / CRITICAL 0; branch pushed to 878a7cf (no force). Reviewer A (security) returned BLOCK MERGE: H1 stale p_now overloads need DROP FUNCTION on upgraded DBs, H2 extension-view dependency check needs transitive schema-qualified resolution, plus M1/M2/M3/L1. Reviewers B (architecture) and C (invariant) still running. Fixing H1/H2 now would move FINAL_IMPLEMENTATION_SHA out from under the pending reviews and invalidate them; waiting for B+C verdicts first, then fix everything in one pass, re-sweep, re-gate, re-review.

- 2026-10-04 — **Reviewer B (architecture) verdict: BLOCK MERGE.** Agrees with Reviewer A on DROP FUNCTION for stale p_now overloads (M1 here) and transitive schema-qualified dependency closure (M2/M3). Adds H1: begin_session/rotate_session must lock the user row (FOR SHARE) so a concurrent disable cannot mint/extend a session (TOCTOU on users.status). Adds H2 (disputed): catalog check fires on PUBLIC-inherited extension-view SELECT (e.g. pg_stat_statements on RDS) — proposes firing only on direct role grants. Still waiting on Reviewer C (invariant). Fix-everything pass stays queued behind C.

- 2026-10-04 — **Reviewer C (invariant) verdict: INCOMPLETE-but-no-bypass (tree-only).** Could not retrieve the diff (no execution); judged the worktree. All traced invariants PASS (DB-clock authority, post-lock recheck, six-function confinement, no blanket exemption, INV-01/02/04/11/12/15/18). INV-10 audit scope for session events UNCLEAR (spec question). No concrete bypass path. Low-confidence notes: OIDC jose currentDate uses app clock (scope question), supersede-by-presented-token stolen-cookie DoS inherent to design, readiness asserts only one function negatively, and the diff hunks themselves untraced — re-run with hunk list before VERIFIED. All three verdicts in; fix-everything pass starts.

- 2026-10-04 — **Reviewer HIGHs fixed; re-review requested at b05e8bd.** Convergent DROP block for stale p_now overloads/session_clock/policy; FOR SHARE user-row locks in begin_session + rotate_session with U2/U3 racing-disable tests; WITH RECURSIVE transitive view-dependency closure with qualified SENSITIVE_RELATIONS plus D2 two-hop control; readiness asserts all six moin_app shutouts; sequence has_write unified; stale comment fixed; Clock documented as identifier-only; dead v_now init dropped; body digests refreshed. Sweep 50/50 KILLED_ASSERTION (D1 convergent cleanup review-proven, outside the count); gates full 14/14 PASS; Trivy HIGH 0 / CRITICAL 0. Re-reviewers A/B/C launched against FINAL_IMPLEMENTATION_SHA b05e8bd. H2 PUBLIC-grant noise: decision is keep firing (pre-populating RDS views would bless unreviewed reads); founder to confirm.

- 2026-10-04 — **Reviewer C (invariant) re-review: no bypass proven (tree-only, no Bash).** PASS on: six-function confinement + readiness 6-shutout, transitive view closure + qualified relations, sequence unification, convergent DROPs on fresh tree, FOR SHARE race locks. INV-10 settled as spec-scope: session functions emit no audit_events (failing-test sketch provided; fix direction is app-layer P06.10 writer, never inside DEFINER). OIDC jose currentDate explicitly scoped out of DB-clock rule (judges provider-token age only). Supersede stolen-cookie DoS design-intended (needs live hash + victim OIDC login). Still waiting on re-reviewers A (security) and B (architecture).

- 2026-10-04 — **Reviewer A (security) re-review: OK TO MERGE.** H1 (stale overloads) CLOSED — all six DROPs signature-verified against 58cfef5; H2 (transitive qualified closure) CLOSED — UNION recursion terminates on cycles, bare-name alias has no callers. New: L1 qualify DROP TABLE (already done in 36bef54 as public.session_clock_policy); L2 optional resolve_session FOR SHARE hardening (accepted — check-use race bounded to one stale resolution, cheap to close; queued). Still waiting on nothing: A done, B done (BLOCK with H1/M1/L1/L2 now addressed in 36bef54), C done (no bypass). L2 + full sweep + gates next.

- 2026-10-04 — **Reviewer B re-review: BLOCK MERGE with new H1 (fixed).** Prior items closed; H2 decision (keep firing on PUBLIC) endorsed as sound. New H1: begin_session took user-then-family vs rotation's family-then-user (AB-BA deadlock) — fixed in 36bef54 (family-then-user both, racing deadlock regression test). M1 comment corrected (resolve-blocks, not revokes), L1 dead alias deleted, L2 DROP qualified. Reviewer A re-review: OK TO MERGE (H1/H2 closed; L1 already done; L2 resolve FOR SHARE accepted). L2 implemented in 2e8f535 with U4 test. Sweep 51/51 at 945d9e2; digests refreshed twice more (lock-reorder, resolve lock); gates 14/14 PASS at bfac30d; Trivy HIGH 0 / CRITICAL 0; pushed. FINAL_IMPLEMENTATION_SHA bfac30d. Sweep report + evidence refresh + third review round next.

- 2026-10-05 — **Reviewer B re-review at bfac30d: OK TO MERGE, no findings.** All 11 directed items confirmed (AB-BA fix, single global lock order, deadlock + interleave tests, leaking-view + two-hop controls, no blanket exemption, PUBLIC behavior correct, identity capabilities exact, no sensitive/transitive paths, G-series drift coverage). Three-green set complete at identical SHA bfac30d: A OK (2 optional LOWs), B OK (clean), C OK (2 LOWs). Fresh 51/51 sweep measured at exact bfac30d. Evidence-only commit next.

- 2026-10-05 — **BLOCKER: loop stalled awaiting security re-review at 92cb7c2.** Tried: two status turns with no tree change (HEAD 92cb7c2dda, clean) while awaiting the third re-review verdict. Not progressing because: the mission forbids substantive edits after the three reviews except fixes a reviewer requires, and gates/evidence/push must wait for all three greens at one SHA. Have: architecture re-review OK TO MERGE (M1 fixed, M2 documented intent), invariant re-review OK TO MERGE (no bypass), 54/54 sweep measured at 92cb7c2 (report stashed to keep tree frozen). Need: security-reviewer re-review verdict at exact SHA 92cb7c2dda98a9333f18fe2a291112ef5e3b28e2; then evidence (EV-P06-045 incl. founder container-policy disposition + three artifacts + raw Trivy 52 HIGH/4 CRITICAL unfixed + CVE-2026-103111 absent), gates full + stress + Keycloak E2E, push, CI checks, final report. Unblock: security verdict arrival resumes the loop.

- 2026-10-05 — **BLOCKER resolved: security re-review at 92cb7c2 is OK TO MERGE (L1 optional only).** Three-green set now complete at identical SHA 92cb7c2dda: security OK (cross-user path closed, HIGHs remain closed, L1 lock-contention note non-blocking), architecture OK (M1 fixed + mutation-proven, M2 documented intent), invariant OK (no bypass). Prior BLOCKER row above is superseded by this row; resuming evidence -> gates -> push -> CI -> report.

- 2026-10-05 — **BLOCKER: loop stalled awaiting invariant re-review at 043cd28.** Tried: two status turns with no tree change (HEAD 043cd28eaf7, evidence-only files uncommitted) while awaiting the third re-review verdict. Not progressing because: the evidence-only commit, founder-env gates, push and CI must wait for all three greens at one SHA. Have: security re-review OK TO MERGE (no open findings), architecture re-review OK TO MERGE (M1/M2 closed, L1 test-only optional), 54/54 sweep measured at 1404f91 and recommitted at 043cd28 with identical coverage. Need: invariant-reviewer verdict at exact SHA 043cd28eaf745a6e2d7c54dea93beb5790e1e04e. Unblock: invariant verdict arrival resumes the loop.

- 2026-10-05 — **BLOCKER: loop stalled awaiting invariant final verdict at 043cd28.** Tried: two status turns with no tree change (HEAD 043cd28eaf7, evidence-only files uncommitted) while awaiting the close-out verdict. Not progressing because: the evidence-only commit, founder-env gates, push and CI must wait for all three greens at one SHA, and the invariant reviewer returned INCOMPLETE twice on tool-constraint grounds (no bypass traced in either). Have: security OK TO MERGE, architecture OK TO MERGE (both at 043cd28); fresh 54/54 sweep re-measured at 043cd28 with header naming that SHA (report stashed to preserve exact SHA); all seven measured closures quoted as verdict inputs with an explicit OK-or-BLOCK rule (no third INCOMPLETE available). Need: invariant final verdict at 043cd28eaf745a6e2d7c54dea93beb5790e1e04e. Unblock: verdict arrival resumes the loop.

- 2026-10-05 — **BLOCKER resolved: invariant final verdict at 043cd28 is OK TO MERGE.** Three-green set now complete at identical SHA 043cd28eaf7: security OK (no open findings), architecture OK (L1 test-only optional), invariant OK (no bypass; closures (a)-(g) consistent with tree read). Prior BLOCKER rows above are superseded by this row; resuming evidence -> founder-env gates -> push -> CI -> report.

- 2026-10-05 — **PR #35 CI green at d22344f; ready for independent Codex re-review.** Founder-run gates 14/14 PASS (20261005T014318Z-full.json); stress 20/20 PASS (20261005T014544Z-stress.json); Keycloak moin-web code+PKCE E2E PASS with replay rejected (400). GitHub: 16/16 checks pass incl. verify, security-scan, container-scan (required filtered policy), pr-title at headRefOid d22344f; PR stays DRAFT, unmerged, mergeStateStatus CLEAN. Raw Trivy 52 HIGH + 4 CRITICAL unfixed (no supported fix), CVE-2026-103111 absent; LG-P06 OPEN. P06.06.01/.02 READY_FOR_REVIEW; P06.06.03-.07 OPEN; P06.01.06 OPEN; P06.06/P06 IN_PROGRESS. Independent Codex re-review is the next step (founder-driven).

- 2026-10-05 — **BLOCKER: loop stalled awaiting architecture re-review at 316caa6.** Tried: two status turns with no tree change (HEAD 316caa67ea, clean) while awaiting the third verdict. Not progressing because: evidence commit, founder-env gates, push and CI must wait for all three greens at one SHA. Have: security OK TO MERGE (genuine CWAIT1 kill verified, 2 optional LOWs), invariant OK TO MERGE (no bypass, no findings), identity suite 20/20 x 58/58, 54/54 sweep at a102b16/report at 316caa6. Need: architecture-reviewer verdict at 316caa67ead125c6b8d1b87dfe6f2a8868a5f869. Unblock: verdict arrival resumes the loop.

- 2026-10-05 — **BLOCKER resolved: architecture re-review at 316caa6 is OK TO MERGE.** Three-green set now complete at identical SHA 316caa67ea: security OK (genuine CWAIT1 kill, 2 optional LOWs), invariant OK (no bypass, no findings), architecture OK (no findings; RWAIT2 idle/absolute conflation data-model-faithful per sessions_idle_within_absolute). Prior BLOCKER row above superseded; resuming evidence -> founder-env gates -> push -> CI -> report.

- 2026-10-05 — **Founder full gate 14/14 PASS at 9de6eb3 (evidence 20261005T041813Z-full.json).** Post-gate verification: Keycloak moin-web code+PKCE E2E PASS (1/1, incl. replay 400); identity+readiness+catalog focused suites 104/104 PASS; temporal CWAIT1/RWAIT1-3 PASS; mutation manifest 54 variants / report 54/54 at a102b16; container policy intact (pinned digest runtime, ignore-unfixed inherited); evidence 129 OK / 0 problems; control-plane PASS; diff-check clean; tree clean. Range 316caa6..HEAD evidence/governance-only, QG-09 set intact.

- 2026-10-05 — **PR #35 fresh CI 16/16 PASS at 394c85e; READY_FOR_FOUNDER_REVIEW.** Founder gate 14/14 at 9de6eb3; Keycloak E2E + 104 focused + temporal regressions + 54/54 sweep + evidence/control-plane/diff checks green; local/origin/PR head agree (394c85e); base origin/main unmoved (e1d787c); mergeStateStatus CLEAN; PR DRAFT + unmerged. Only founder acceptance/readiness/merge remain.

- 2026-10-05 — **BLOCKER: loop stalled awaiting founder instruction on Codex re-review task.** Tried: two turns with no tree change (HEAD 195a6bd69d) — summarized the pasted re-review task, asked for explicit authorization, and flagged that recording founder acceptance (EV-P06-047) needs founder sign-off. Not progressing because: the pasted task is a report, not an instruction, and asserting founder acceptance without confirmation would exceed scope. Have: clean tree at 195a6bd, PR #35 DRAFT/unmerged (per prior session). Need: founder to authorize executing the pasted task and confirm whether EV-P06-047 should be drafted as proposed vs accepted. Unblock: founder reply resumes the loop.

- 2026-10-05 — **Independent Codex re-review: READY FOR FOUNDER ACCEPTANCE at 195a6bd (implementation 316caa6).** All 3 prior BLOCK_MERGE blockers closed (CWAIT1/WAIT5 genuine kill `expected 1 to be 0`; RWAIT2 valid-before-race 0 rows; RWAIT1 20 standalone + 20 affected runs, 3,960 executions, 0 failures, zero CHECK violations). Scenarios A–O all PASS; negative controls fired (extension-view detected, digest guard fired); voice/worker start clean with /healthz 200 sans identity secret; gates 14/14 PASS (evidence 20261005T051616Z-full.json); GitHub CI 16/16 SUCCESS at 195a6bd. Residuals (non-blocking): pid-scoped lock-waiter identification; explicit simultaneous idle/absolute expiry description in RWAIT2. PR #35 stays DRAFT/UNMERGED pending founder merge.

- 2026-10-05 — **P06.06.03 second fix pass committed at 1169972.** Security/architecture re-reviews of 63748f0 found: discarded slide result (admit-after-refusal TOCTOU, now checked with unit regression), null-pool 401 (now 503), single-entry eviction (now looped), stale interceptor comment (ALS design). Evidence: unit request-context.service.test.ts 3/3, affected integration 114/114, fast gates 7/7. Next: re-run all three QG-09 reviewers at 1169972, then EV-P06-048 finalization, founder full gate, push, CI, report. P06.06.03 stays READY_FOR_REVIEW.

- 2026-10-05 — **Three-green final set at 1169972 (P06.06.03).** Security OK TO MERGE (slide-check verified, 1 carried LOW: guarded-200 Cache-Control); architecture OK TO MERGE (H1 closed, H2 accepted per PLAN 30 s ceiling, H3 closed, M1 accepted with P06.07 global-guard follow-up, M2 closed); invariant OK TO MERGE (N1 closed by behavior, I2 membership-side TOCTOU documented as LOW P06.07+ follow-up: fold slide into the DEFINER call). Residuals for backlog: 200 Cache-Control header, global guard/route-inventory test, atomic slide+membership call. Next: EV-P06-048 finalization, founder full gate, push, CI, report. P06.06.03 stays READY_FOR_REVIEW.

- 2026-10-05 — **Three-green set at 83e7e42 (boundary fix).** Security OK (no new trust, probe coverage preserved, depcruise verified); architecture OK (layering holds, 2 LOWs: platform table-SQL accretion + parallel scoped paths, both at production wiring); invariant OK (no bypass, zero-arg wrapper, choke chain traced). Residuals: guarded-200 Cache-Control; global guard/route-inventory; atomic slide call; wrapper generalization. Next: EV-P06-048 finalization, founder full gate, push, CI, report. P06.06.03 stays READY_FOR_REVIEW.

- 2026-10-05 — **Founder full gate 14/14 PASS at 6d6bc6a (evidence 20261005T071118Z-full.json).** Run by the founder with ephemeral local-development fixture env. Implementation frozen at 83e7e42 (three-green QG-09 set); delta to gate HEAD is evidence/governance only.

- 2026-10-05 — **PR #36 fresh CI 16/16 PASS at b51f547; READY_FOR_FOUNDER_REVIEW.** Founder gate 14/14 at 6d6bc6a; implementation frozen at 83e7e42 (three-green QG-09); local/origin/PR head agree (b51f547, ledger-only delta); mergeStateStatus CLEAN; PR DRAFT + unmerged. Only founder review/acceptance/merge remain. P06.06.03 stays READY_FOR_REVIEW.

- 2026-10-05 — **Codex BLOCK_MERGE repair committed (cdb677e + 015de88).** HIGH-1: 0012 restored byte-for-byte from origin/main; seventh-function note lives in 0014/allowlist; byte-identity upgrade regression added (mutation-proven vs injected drift). HIGH-2: slide folded into resolve_request_context (single call, one v_now); service single-call with min(30s, idle, absolute) caching and triple-deadline hit checks; unit tests pin single-call/expiry/bounding/mutation-bypass. Next: full sweep re-check, three QG-09 re-reviews at 015de88, EV-P06-048 update, founder full gate, push, CI, report. P06.06.03 stays READY_FOR_REVIEW.

- 2026-10-05 — **BLOCKER: loop stalled awaiting architecture re-review at 736bfdd.** Tried: two status turns with no tree change (HEAD 736bfdd, only PROGRESS.md uncommitted) while awaiting the third verdict. Not progressing because: the M1 Cache-Control fix (security MEDIUM) is deliberately held until architecture lands so all findings fix in one commit + one re-review round. Have: security OK TO MERGE (M1 MEDIUM open), invariant OK TO MERGE (no findings). Need: architecture-reviewer verdict at 736bfdd. Unblock: verdict arrival resumes the loop (fix M1 + any arch findings together, re-review all three).

- 2026-10-05 — **BLOCKER resolved: architecture re-review at 736bfdd is OK TO MERGE.** Three-green set now complete at identical SHA 736bfdd: security OK (M1 MEDIUM open: guarded-200 Cache-Control), architecture OK (M1/M2 MEDIUMs + L1/L2 LOWs open), invariant OK (no findings). Prior BLOCKER row above superseded; fixing M1(sec)+M1/M2/L1/L2(arch) in one commit, then re-running all three reviewers.

- 2026-10-05 — **BLOCKER: loop stalled awaiting security review at 9f5da5e.** Tried: two status turns with no tree change (HEAD 9f5da5e, clean) while awaiting the third verdict. Not progressing because: evidence commit, founder gate, push and CI must wait for all three greens at one SHA. Have: architecture OK TO MERGE (no findings), invariant OK TO MERGE (no bypass), 54/54 sweep at 9f5da5e, fast gates 7/7. Need: security-reviewer verdict at 9f5da5ee58bab4bafcc0274223ad46c7aef23009. Unblock: verdict arrival resumes the loop.

- 2026-10-05 — **Three-green final set at 9f5da5e (P06.06.03 repair).** Security OK TO MERGE (M1 Cache-Control closed sync pre-delegation, both paths asserted; 1 LOW: global guard registration); architecture OK TO MERGE (upgrade fail-closed + fetch-depth, owner comment, invalidation; H2/M1 accepted); invariant OK TO MERGE (no bypass, entry points re-enumerated). Codex HIGH-1 (0012 immutability + upgrade regression) and HIGH-2 (single-query fold + expiry-bounded cache) both verified closed by all three. Residuals → P06.07+ backlog: global guard/route-inventory, atomicity already achieved by fold, Cache-Control done. Next: EV-P06-048 finalization, founder full gate, push, CI, report. P06.06.03 stays READY_FOR_REVIEW.

- 2026-10-05 — **Founder full gate 14/14 PASS at 83e7697 (evidence 20261005T081515Z-full.json).** Run by the founder with ephemeral local-development fixture env. Implementation frozen at 9f5da5e (three-green QG-09 set); delta to gate HEAD is the Prettier report reflow only.

- 2026-10-05 — **PR #36 fresh CI 16/16 PASS at 88daf11; READY_FOR_FOUNDER_REVIEW.** Founder gate 14/14 at 83e7697; implementation frozen at 9f5da5e (three-green QG-09: security/architecture/invariant OK, Codex HIGH-1+HIGH-2 verified closed); local/origin/PR head agree (88daf11, ledger-only delta); base origin/main unmoved (1b94476); mergeStateStatus CLEAN; PR DRAFT + unmerged. Only founder review/acceptance/merge remain. P06.06.03 stays READY_FOR_REVIEW.

- 2026-10-05 — **BLOCKER: loop stalled awaiting invariant review at 0eed7ad.** Tried: two status turns with no tree change (HEAD 0eed7ad, clean) while awaiting the third verdict. Not progressing because: evidence commit, founder gate, push and CI must wait for all three greens at one SHA. Have: security OK TO MERGE (2 LOWs: global guard, row-level MWAIT2 waiver), architecture OK TO MERGE (M1/M2 accepted, L1/L2 informational), 55/55 sweep at 0eed7ad. Need: invariant-reviewer verdict at 0eed7adb2737419243dce702babce0a6cb5d9f7b. Unblock: verdict arrival resumes the loop.

- 2026-10-05 — **Three-green repair set at 0eed7ad (membership-lock stale clock).** Security OK TO MERGE (four-lock order, narrow marker, MWAIT1 discriminates, 2 LOWs); architecture OK TO MERGE (acyclic, privilege-neutral slide, deterministic gate); invariant OK TO MERGE (close-out: entry points enumerated, no bypass; sweep mismatch explained as one-line test fix + report regen). 55/55 sweep incl. WAIT9. Next: EV-P06-048 repair rows, evidence commit, founder full gate, push, CI, report. P06.06.03 stays READY_FOR_REVIEW.

- 2026-10-05 — **Founder full gate 14/14 PASS at 3f25957 (evidence 20261005T131811Z-full.json).** Run by the founder with ephemeral local-development fixture env. Implementation frozen at 0eed7ad (three-green QG-09 set); delta to gate HEAD is evidence/format only.

- 2026-10-05 — **PR #36 fresh CI 16/16 PASS at 1dfa61a; READY_FOR_FOUNDER_REVIEW.** Founder gate 14/14 at 3f25957; implementation frozen at 0eed7ad (three-green QG-09: security/architecture/invariant OK, Codex membership-lock defect verified closed); local/origin/PR head agree (1dfa61a, ledger-only delta); base origin/main unmoved (1b94476); mergeStateStatus CLEAN; PR DRAFT + unmerged. Only founder review/acceptance/merge remain. P06.06.03 stays READY_FOR_REVIEW.

- 2026-10-05 — **Container-scan regression fixed (perl-base bookworm-security).** CI reported 7 newly-fixable HIGH/CRITICAL (perl-base CVEs, fixed 5.36.0-7+deb12u4 available); pinned-apt bump in Dockerfile (same pattern as libpcre2 fix); local filtered scan 0 fixable, raw unfixed still tracked. PR #36 fresh CI 16/16 PASS at 1c2f73f; READY_FOR_FOUNDER_REVIEW. P06.06.03 stays READY_FOR_REVIEW.

- 2026-10-05 — **Codex FOR-SHARE/RLS repair committed at d56553c.** FOR UPDATE companion policy with tenant WITH CHECK; MWAIT1 row-level gate restored; MWAIT2 (open lookup blocks disable) + MWAIT3 (mid-wait disable observed) added. Evidence: EV-P06-048 repair rows. Next: full sweep re-check (55 + new MWAIT coverage), three QG-09 re-reviews at new SHA, EV update, founder full gate, push, CI, report. P06.06.03 stays READY_FOR_REVIEW.

- 2026-10-05 — **Three-green triad reviews on RLS FOR UPDATE repair at dfdece5.** Security OK TO MERGE (NOWAIT proof sound and fail-closed), architecture OK TO MERGE (lock semantics verified), invariant OK TO MERGE (full path matrix pass, no bypass). Tree frozen for evidence.

- 2026-10-05 — **MWAIT2 NOWAIT probe hardened with retry loop and pool cleanup at 91488cc.** Probe client rolls back cleanly and is destroyed on error so test pool cannot be contaminated by aborted transaction; full identity suite 64/64 PASS; fast gates 7/7 PASS.

- 2026-10-05 — **Founder full gate 14/14 PASS at dfdece5 (evidence 20261005T142032Z-full.json).** Run by the founder with ephemeral local-development fixture env. Implementation frozen at dfdece5; test hardening at 91488cc. All 14 gates pass cleanly. Ready for push and PR #36 CI verification. P06.06.03 stays READY_FOR_REVIEW.

- 2026-10-05 — **Codex re-review at ac2b3e2: READY FOR FOUNDER ACCEPTANCE.** Independent verification confirmed membership row-lock retention under FORCE RLS (55P03 on concurrent writer, wait until context commit), tenant WITH CHECK preservation, 156 focused tests PASS, and 20/20 affected stress runs PASS. All scenarios A through I PASS; 14/14 full gates PASS. P06.06.03 cleared for founder acceptance and merge.

- 2026-10-05 — **PR #36 squash-merged as d92f82b; P06.06.03 VERIFIED on main.** Migrations 0013 and 0014 applied on main; RLS catalog check passes with all 21 pinned DEFINER digests matching freshly migrated md5(prosrc); full test suite green. P06.06.01/.02/.03 VERIFIED; P06.06.04-.07 open.

- 2026-10-06 — **P06.06.04 step-up MFA implemented on branch feat/p06-06-step-up-mfa (EV-P06-049).** Migration 0015 (step_up_at + step_up_session_id, drop-then-create for changed OUT-record shapes); stamp flows through identity-store → RequestContextService → SessionContext; RequireStepUpGuard (403 step-up-required, Date.now comparison, always mutate-mode); POST /api/auth/step-up + callback rotation with max_age=0 and auth_time freshness. Commits 3fa4c99–7806a27. Next: full session sweep (61 variants incl. SU1–SU6), QG-09 triad reviews, founder full gate, draft PR. P06.06.04 stays IN_PROGRESS (never VERIFIED by implementor).

- 2026-10-06 — **BLOCKER: full session sweep 45/61 — 16 pre-existing mutants SURVIVE on this branch.** SU1–SU6 all KILLED_ASSERTION individually (SU2 after strict-> assertion, SU4 retargeted to HTTP probe, SU5 after evidenceTest wrap). But the full sweep shows 16 SURVIVED incl. R1, S1–S3, WAIT5/6/9, M1, U1–U3, CLK2–4, F1, G10 — all KILLED at 55/55 on the P06.06.03 branch. Cause: migration 0015 redefines rotate_session/begin_sign_in/consume_sign_in/resolve_request_context, so old mutants targeting 0012/0014 bodies mutate a shadowed definition the live database never executes. Per stop-on-stall protocol: ending turn for founder direction on whether to (a) retarget old mutants to 0015, (b) accept branch-local sweep of SU1–SU6 only, or (c) other. P06.06.04 stays IN_PROGRESS.

- 2026-10-06 — **Sweep BLOCKER cleared: 61/61 KILLED_ASSERTION at 5fc9764 (report committed at b4a6d37).** Sixteen stale mutants retargeted from shadowed 0012/0014 definitions to live 0015 bodies (commit 4d4a5af); WAIT5 reshaped for the binding-first consume (5fc9764); SU1–SU6 new. Nine dead-function mutants (revoke_session/resolve_session/grants) correctly left on 0012 — those bodies still execute. Next: QG-09 triad reviews, founder full gate, draft PR. P06.06.04 stays IN_PROGRESS.

- 2026-10-06 — **BLOCKER: QG-09 architecture BLOCK_MERGE (H1/H2/H3 + M1/M2/M3); repair proposed, awaiting founder go-ahead.** Invariant review INCOMPLETE (reviewer pathed to parent repo, never saw moin-stepup — no verdict, will re-dispatch). Security review still pending at stall time. Stall hook fired after 2 no-change iterations (both turns were review-waiting + repair proposal, HEAD 41223ae, tree clean). Repair plan posted to founder: H1 subject binding + test, H2 DB freshness boolean, H3 shims, M1 single-resolve, M2 route guard, M3 mutants + re-sweep. Needed: founder authorization to execute repair on feat/p06-06-step-up-mfa. P06.06.04 stays IN_PROGRESS.

- 2026-10-06 — **Repair committed through 702782d: H1/H2/M1/M2 fixed, 63/63 sweep, fast gates 7/7.** Subject binding enforced (wrong-subject test), DB-clock freshness verdict + single-resolve guard, POST step-up membership-gated, migrate-first deploy order documented (shims impossible: same IN-args forbid coexisting OUT-records), SU7/SU8 added, 20 mutants retargeted total. 159/159 affected integration green. Next: QG-09 triad re-reviews at repair HEAD, EV-P06-049, founder full gate, draft PR. P06.06.04 stays IN_PROGRESS.

- 2026-10-06 — **BLOCKER: awaiting architecture re-review; stall hook fired.** Security re-review OK TO MERGE at 779f146 (H1/H2/M2 closed, residuals M+L only); invariant NO BYPASS FOUND (SHA binding INCOMPLETE — read-only reviewer, content-verified vs 63/63 report). Architecture re-review still outstanding at stall time; 2 no-change iterations (both review-waiting turns, HEAD 779f146, tree clean). Needed: architecture verdict, then write 3 review artifacts + EV-P06-049, push, founder full gate. P06.06.04 stays IN_PROGRESS.

- 2026-10-06 — **Second repair round complete at 10cd519: fast 7/7, 162/162 affected integration, 64/64 sweep.** Architecture H1 (6-arg overload + overload-aware catalog/readiness/grant-matrix) and M1 (stamp-expiry cache bound + no-cache-unstyled + SU9) fixed; grant-matrix and catalog drift tests updated for the overload. Next: QG-09 triad re-reviews at fix HEAD, EV-P06-049, push, founder full gate, draft PR. P06.06.04 stays IN_PROGRESS.

- 2026-10-06 — **BLOCKER: awaiting architecture re-review; stall hook fired.** Security re-review OK TO MERGE at d1d5c5f (overload introduces no forge path; residuals M1/L1/L2 hardening-only). Invariant re-review NO BYPASS FOUND at d1d5c5f (LC1/LC3 closed, LC2 accepted). Architecture re-review still outstanding; 2 no-change iterations (review-waiting turns, HEAD d1d5c5f, tree clean). Needed: architecture verdict, then 3 review artifacts + EV-P06-049, push, founder full gate. P06.06.04 stays IN_PROGRESS.

- 2026-10-06 — **BLOCKER: awaiting invariant final review; stall hook fired.** Security final OK TO MERGE at 8ae542f (no findings in delta). Architecture final OK TO MERGE at 8ae542f (M1/L1/L2 closed). Invariant final still outstanding; 2 no-change iterations (review-waiting turns, HEAD 8ae542f, tree clean). Needed: invariant verdict, then 3 review artifacts + EV-P06-049, push, founder full gate. P06.06.04 stays IN_PROGRESS.

- 2026-10-06 — **QG-09 triad complete at a1236a2: three OK TO MERGE + EV-P06-049.** Security/architecture/invariant finals all green (residuals hardening-only → wiring backlog). 64/64 sweep, fast 7/7, 163/163 affected integration. Next: push branch, draft PR, founder full gate. P06.06.04 stays READY_FOR_REVIEW (never VERIFIED by implementor).

- 2026-10-06 — **Founder full gate 14/14 PASS at 3f68fc5 (evidence 20261006T014632Z-full.json).** Run by the founder with ephemeral fixture env. P06.06.04 ready for founder acceptance; PR #38 draft awaiting CI. P06.06.04 stays READY_FOR_REVIEW.

- 2026-10-06 — **Dep override at 81da2e4: source-map-js 1.2.2 via pnpm.overrides.** Pre-existing HIGH (postcss chain, advisory published after main green); `pnpm audit --prod` clean, web typecheck green. EV-P06-049 candidate SHA updated. Next: push, CI 16/16 watch, final report. P06.06.04 stays READY_FOR_REVIEW.

- 2026-10-06 — **PR #38 CI 16/16 PASS at 8816c79 (dep override included).** Founder full gate 14/14 recorded (EV-P06-049). P06.06.04 READY_FOR_REVIEW — founder merge/acceptance only; PR stays DRAFT and unmerged.
- 2026-10-08 — **P06.08 invitations + lifecycle implemented at 08f8046 (EV-P06-054).** Migration 0018 (invitations table, token-bound accept_invitation DEFINER, digest e-pinned), MembersController (invite/revoke/disable/remove/transfer, step-up on remove+transfer), platform MemberQueries, German template, 18 tests green; full gates 14/14; mutation-check KILLED. No HTTP accept route: invitee has no users row and sign-in refuses unknown subjects, so no session can authenticate the call — the accept entry path is an open design decision. Real email delivery rides P14 (EXT-09). P06.08 stays READY_FOR_REVIEW (QG-09 triad not re-run; founder review only).
- 2026-10-08 — **P06.09 recovery implemented at EV-P06-055 (P06.09.01/.02/.04; .03 already VERIFIED EV-P06-040).** Migration 0019 (set_user_status DEFINER with in-commit revocation, no trigger — AB-BA deadlock proven), RecoveryController (disable/enable/revoke-sessions, step-up, 404 owner-existence, atomic audit), 9 tests green; full gates 14/14; mutation-check KILLED. Containment PARTIAL (no deny-new-access, no operator identity, no provider calls). P06.09 stays READY_FOR_REVIEW (QG-09 triad not re-run; founder review only).
- 2026-10-08 — **P06.10.03 audit writer adoption at EV-P06-056.** Migration 0020 (correlation forwarding in 3 in-DB writers, session_count allowlist seeds), MemberQueries/withTenant correlation threading, wrapper + recovery tests; full gates 14/14; mutation-check KILLED on the threading path. Session lifecycle audit deferred by founder decision (no tenant in session DEFINERs); operator/security/tool paths do not exist yet. P06.10.03 stays READY_FOR_REVIEW (QG-09 triad not re-run; founder review only).
- 2026-10-08 — **P06.10.03 review fix at c3ddbed (PR45 MEDIUM).** Migration 0021 replaces accept_invitation body whole (CREATE OR REPLACE, same signature): acceptance audit forwards app.correlation_id like the 0020 recovery writers; digest re-pinned (a1d0a2c5); correlation test on the invitation.accept row. 0018 untouched (base-applied immutability). Next: EV-P06-056 scope-note update, full gates on tip, push.
- 2026-10-08 — **P06.11 support grants implemented at EV-P06-057 (P06.11.02/.03/.04/.05; .01 WAITING_FOR_EXTERNAL P05/EXT-09).** Migration 0022 (grants table, gate + lifecycle + 3 gated reads + emergency read, all digest-pinned), SupportController (create/list/revoke, step-up, support:grant), SupportPoolModule (role-swapped pool, no new secret), 13 tests green; full gates 14/14; mutation-check KILLED. Owner notification PENDING (P06.12.02/P14). P06.11 stays READY_FOR_REVIEW (QG-09 triad not re-run; founder review only).
- 2026-10-08 — **P06.11 review fix at eefae29.** Read functions ungated-until-identity (HIGH): EXECUTE revoked on all 4 reads, refusal proven 42501 with no rows/audit; gate keeps lock-first expiry (MEDIUM) with lock-wait test; grant listing step-up-gated (MEDIUM). Next: EV-P06-057 scope-note update, full gates on tip, push.
- 2026-10-08 — **P06.12 review fix (PR47 1 HIGH + 2 MEDIUM).** Take function sweeps rows idle > 24 h (100/call cap, sweep index) bounding the table at ~a day of distinct sources; REVOKE ALL on the bucket table for every runtime role incl. moin_app (DEFINER-only, 42501 proven); AuthThrottleGuard split into IP-first + AccountThrottleGuard-after-session (fail-closed without a subject), controllers reordered, ordering proven by guard unit tests. Digest re-pinned (c4f2a268); events register row restored. Next: EV-P06-058 scope-note update, full gates on tip, push.
- 2026-10-08 — **P06.13 cross-tenant suite v1 at b11341f (EV-P06-059).** xsuite module: two seeded tenants (every tenant table), 19-route inventory with live-router 100%-or-block coverage, A-with-B-ids probes, per-table DB isolation, SSE/cache/S3 negative registry; 10 integration + 1 unit green, mutation-check KILLED. Job-envelope half of .03 BLOCKED on P06.03.03 (no envelope exists); .05 CI wiring as founder patch (control plane). P06.13 stays READY_FOR_REVIEW (QG-09 triad not re-run; founder review only).
- 2026-10-08 — **P06.03.02 + P06.03.07 request half proven; P06 ledger reconciled at EV-P06-060.** Branch test/p06-03-tenant-from-session on d5815a3 (PR #48 merged). Four tests added to the xsuite integration file: forged org header, query and body ignored on writes (tenant read back from the DB), on reads (symmetric A/B), on a foreign-id revoke (404, B's grant untouched), and without a session (401). No app code changed; no real gap found. Mutation: interceptor reading header, query or body each KILLED (3/3). Reconciliation against `evidence.py check` (141 OK; the sole STALE is EV-P06-054's pre-squash commit `0748a86`, an evidence-record defect left for the founder): PLAN ticks only items with an EV id (.03.02, .06.04–.07, .07.01–.05, .08.01/.04, .09.04, .11.02/.03/.05, .13.01/.02); partials annotated, not ticked (.03.07, .08.02/.03, .09.01/.02, .10.03, .11.04, .12.01–.03, .13.03–.05). Status Ledger P06 row rewritten; P06 stays IN_PROGRESS, merged sections READY_FOR_REVIEW, none VERIFIED. The new worktree needed no founder-created environment file: the integration gate ran with the TEST_* names from the example file exported into the shell.
- 2026-10-08 — **PR #49 ledger-honesty fix (Codex HIGH).** Unticked P06.11.03, .05 (support reads have no runtime EXECUTE, 42501), P06.07.05 (probe-controller matrix), P06.08.01 (no email sent), P06.09.04 (implementer-run tabletop); P06.11.04 annotated, P06 ledger row now states reads disabled. Re-audited every other tick against its EV scope note: .03.02, .06.04–.07, .07.01–.04, .08.04, .11.02, .13.01/.02 kept (each backed by tests of the claimed behaviour). EV-P06-060 now records the three mutation commands and per-mutant outcomes.
- 2026-10-08 — **PR #49 second ledger-honesty fix (Codex BLOCK).** Rewrote the P06 Status Ledger row: it now lists as READY_FOR_REVIEW only ticked items, and labels every partial with its remaining work: .12.01 (WAF rate rules EXT-09, lockout docs), .12.02 (owner email P14), .12.03 (notification half), plus .03.07, .07.05, .08.01–.03, .09.01/.02/.04, .10.03, .11.03–.05, .13.03–.05. Re-audited the row: .01.06 is no longer lumped under P05/EXT-09 (local role built, Terraform is P05). No checklist ticks changed.
| P06.07.05 | READY_FOR_REVIEW | 80b8a00 | EV-P06-061, EV-P06-062 | Real-route RBAC matrix (PR #52): 11 product routes (members 5, recovery 3, support 3) x owner/admin/staff through IdentityAccessModule; EXPECTED route-to-capability table pinned against live @Require metadata; 3 mutants KILLED (guard always-allow 2 fail, weakened manage-owners->manage 2 fail, removed Require 3 fail); CI 16/16 green on head 33c4202. Ticked in PLAN |
