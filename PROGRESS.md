---
mission: P02 complete bar external gates; P03 in progress (tier PILOT)
status: active
mode: interactive
phase: P03
tier: PILOT
plan: docs/phases/P03-plan.md
next: P03.04 C4 and data-flow diagrams — PR docs/p03-04-diagrams
updated: 2026-09-28
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

## External waits

| ID     | Counterparty | Requested  | Expected | Fallback                                                                                  | Blocks               |
| ------ | ------------ | ---------- | -------- | ----------------------------------------------------------------------------------------- | -------------------- |
| EXT-24 | GitHub       | 2026-09-28 | —        | Pre-push hook + CI status discipline as an accepted risk; must be resolved before MT-LIVE | P02.01.01, P02.01.07 |

## Founder actions waiting

| #   | Action                                                                                                                                        | Blocks                                                                                        | How to confirm it worked                                                                   |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| F1  | Apply `docs/control-plane/patches/0003-p02-gates.patch` to the founder-only gate configuration                                                | Every `gates.py full` claim for P02                                                           | `control_plane_check.py` passes and `gates.py status` no longer shows the `workspace` stub |
| F2  | EXT-24: confirm the GitHub plan supports private-repo rulesets, then apply the P02.01.01 ruleset **after** the P02.06 workflows are on `main` | P02.01.01, P02.01.07                                                                          | A direct push to `main` is rejected; a PR with a red required check cannot merge           |
| F3  | Register `EV-P00-001` for the already-ticked P00.02.04, or untick it                                                                          | Repository-wide `evidence.py check` exits 1                                                   | `evidence.py check` exits 0                                                                |
| F4  | Review and squash-merge the P02 PRs in order: #3 → #4 → #5 → #6                                                                               | Later branches, and `main` reflecting P02                                                     | `git log --oneline main` shows them linearly                                               |
| F5  | Create the local environment file from the committed example (the control plane blocks any session command touching it, INV-15)               | `pnpm preflight` reporting six of six, and `pnpm test:integration` without exported variables | `pnpm preflight` exits 0                                                                   |
| F6  | Optional: confirm setup time on a machine with no Docker image cache (1.73 GiB to pull)                                                       | The 15-minute criterion measured cold rather than warm                                        | The timed log                                                                              |

## Deferred with a trigger (from the P02.03 QG-09 review)

| Item                                                                       | Why not now                                                                                                                                                             | Trigger                                                |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Fastify `helmet` + `rate-limit`, `trustProxy`, fixed-body exception filter | No POST route and no reachable sink yet; PLAN places API hardening in P06/P17. The `/readyz` amplification the review found is already closed by single-flight caching. | The first POST route (P06)                             |
| Per-role discriminated configuration schema                                | With 12 keys and none role-specific, every branch would be identical — structure with no differentiating content.                                                       | The first role-specific variable (P05)                 |
| Smaller runtime base image                                                 | 261 MiB of the 379 MiB image is Debian + Node; changing base has its own trade-offs (glibc, debugging tools).                                                           | P17 production baseline, or earlier if pull time hurts |

## Log

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
