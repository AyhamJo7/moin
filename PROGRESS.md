---
mission: P02 — Engineering Foundation (tier PILOT)
status: active
mode: interactive
phase: P02
tier: PILOT
plan: docs/phases/P02-plan.md
next: P02.04 local development environment — PR chore/p02-04-local-stack
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

| Item      | Status               | Commit        | Evidence | Note                                                                                                                                          |
| --------- | -------------------- | ------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| P02.01.02 | READY_FOR_REVIEW     | (this commit) | —        | CODEOWNERS, PR template, two issue templates, issue config                                                                                    |
| P02.01.03 | READY_FOR_REVIEW     | (this commit) | —        | `pr-title` workflow + `check-conventional-commit.ts` + `check-no-ai-mentions.ts`; both self-test against `.claude/policy/no-ai-mentions.json` |
| P02.01.04 | READY_FOR_REVIEW     | (this commit) | —        | `PROGRESS.md`, `docs/evidence/INDEX.md`, `docs/evidence/TEMPLATE.md`                                                                          |
| P02.01.05 | READY_FOR_REVIEW     | (this commit) | —        | `README.md`, `CONTRIBUTING.md`                                                                                                                |
| P02.01.06 | READY_FOR_REVIEW     | (this commit) | —        | `docs/development/release-tags.md`                                                                                                            |
| P02.01.01 | WAITING_FOR_EXTERNAL | —             | —        | Ruleset on `main` — EXT-24; must be applied only after the P02.06 workflows are on `main`                                                     |
| P02.01.07 | BLOCKED              | —             | —        | Verification of the ruleset; blocked by P02.01.01                                                                                             |

## External waits

| ID     | Counterparty | Requested  | Expected | Fallback                                                                                            | Blocks               |
| ------ | ------------ | ---------- | -------- | --------------------------------------------------------------------------------------------------- | -------------------- |
| EXT-24 | GitHub       | 2026-09-28 | —        | Pre-push hook + CI status discipline, recorded as an accepted risk; must be resolved before MT-LIVE | P02.01.01, P02.01.07 |

## Log

- 2026-09-28 — P02.03 QG-09 review and remediation. The security and architecture reviewers returned BLOCK MERGE with 1 Critical and 11 High between them. Every one was reproduced before being fixed. Three findings were defects in work this session had already recorded as passing, and two evidence records (EV-P02-015, EV-P02-017) carried claims that were simply false — both now carry a correction section rather than being quietly rewritten. The most useful lesson: `redaction.test.ts` passed while three separate paths carried personal data to stdout, because it tested the redactor instead of the serialised line. Where the two reviewers disagreed on a fix, the measurement decided it. Tests 65 → 90.
- 2026-09-28 — P02.03 complete. Workspace: lint exit 0, typecheck 16/16, 65 tests across 5 packages, build 12/12, dependency-cruiser clean. arm64 image built and all four roles verified live under `--read-only --tmpfs /tmp --security-opt no-new-privileges`. Two defects were found and fixed by the work's own tests rather than in review: the log redactor allowlisted `name` and leaked the error message back through `err.stack`; and the readiness probe's two deadlines were equal, which made every specific failure reason unreachable. One was found by inspection: the runtime image carried the whole dev toolchain (589 MB → 84.9 MB).
- 2026-09-28 — P02.02 complete and locally verified under Node 24.21.0 / pnpm 10.34.5: prettier --check, eslint, depcruise, turbo typecheck/test/build all exit 0; 33 tests pass. TypeScript 6.0.3 chosen over 7.0.2 because typescript-eslint 8.70.1 declares `typescript >=4.8.4 <6.1.0`; marked VALIDATION REQUIRED against Next.js/NestJS in P02.03. `.claude/gates.json` is founder-only, so its P02.02.02 replacement is `docs/control-plane/patches/0003-p02-gates.patch`, verified by applying it to an isolated copy (patch exit 0, result byte-identical to the intended file).
- 2026-09-28 — CORRECTION to the log entry below and to the P02 plan: `evidence.py check` requires an EV ID on _every_ ticked item outside P00, not only on verification items. P00 is explicitly exempt in the checker, which is what made the P00 checklist look like a counter-example. All 15 ticked P02 items now cite evidence; audit is 11 OK, 0 problems.
- 2026-09-28 — FINDING (not P02): `evidence.py check` reports `MISSING EV-P00-001`. PLAN.md L1889 ticks P02.02.04's counterpart P00.02.04 citing `EV-P00-001`, but no record exists — the registry it belongs in is only created now, by P02.01.04. The audit result is recorded inline in PLAN.md (HEAD `fb7185e`, remote private, `main` unprotected, Node v22.20.0, pnpm 10.12.1, Terraform absent). Not registered by this session: transcribing another phase's result into an evidence record is not the same as having run it, and P00 is the founder's phase. Founder action, see the P02 action bundle.
- 2026-09-28 — P02.01 governance scaffolding implemented. `check-no-ai-mentions.ts --self-test` passes (9 patterns, 11 blocked and 7 allowed examples); `check-conventional-commit.ts --self-test` passes (13 cases). Both run clean over `HEAD~2..HEAD`. Node 24.21.0.
- 2026-09-28 — P02 execution started from `docs/phases/P02-plan.md` (approved). Docker Desktop reachable (server 29.8.0), Node 24.21.0 available via nvm. Branch `chore/p02-01-governance`.
