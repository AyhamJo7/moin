# Owner audit, 2026-11-14

Basis: `main` @ `0e020d2`. Five read-only sweeps; the detail is in the files next to this one.
Status comes from reading code, CI and GitHub, not from `PROGRESS.md`. No test suite was run
locally for this audit; CI results are quoted with their dates.

| File                 | Covers                                                                                |
| -------------------- | ------------------------------------------------------------------------------------- |
| `audit-A-p02-p08.md` | status per section, P02 and P05 to P08, checked against code                          |
| `audit-B-p09-p16.md` | status per section, P09 to P16; what runs end to end; shortest path to a working call |
| `audit-C-plan.md`    | external dependencies, decision gates, P00 to P04 and P17 to P33, plan problems       |
| `audit-D-process.md` | every hook, gate, rule, workflow and template with a vote                             |
| `audit-E-hygiene.md` | open PRs, branches, worktrees, stashes, CI health                                     |

## 1. Status

Section counts by status. "Candidate" means code and tests exist and are wired into a runtime or
CI path; it becomes DONE-VERIFIED when CI is green on the merge SHA. "Claimed only" means the
plan or its evidence says built, and the code is a helper nothing imports.

| Phase                 | Candidate | Claimed only | Partial | Not started | External |
| --------------------- | --------- | ------------ | ------- | ----------- | -------- |
| P02 foundation        | 2         | 0            | 6       | 0           | 0        |
| P05 cloud             | 0         | 0            | 0       | 10          | 2        |
| P06 tenancy, identity | 3         | 0            | 10      | 0           | 1        |
| P07 business model    | 2         | 0            | 12      | 0           | 0        |
| P08 async             | 1         | 0            | 10      | 0           | 0        |
| P09 knowledge         | 6         | 0            | 5       | 0           | 0        |
| P10 AI                | 0         | 14           | 0       | 0           | 1        |
| P11 telephony         | 0         | 8            | 9       | 0           | 1        |
| P12 conversation      | 0         | 6            | 3       | 5           | 1        |
| P13 owner app         | 1         | 5            | 6       | 1           | 0        |
| P14 notifications     | 0         | 1            | 3       | 2           | 2        |
| P15 operations        | 0         | 8            | 2       | 3           | 0        |
| P16 privacy           | 0         | 9            | 2       | 1           | 5        |

P00, P01, P03, P04: documents and founder work, partly ticked, none adopted. P17 to P33: not
started; the code filed under them is constant-shape helpers that implement no plan item
(OBSOLETE, queue item C6).

## 2. What is broken

- `container-scan`, a required check, has failed on `main` every day since 2026-11-05 (Trivy:
  `apt` 2.6.1, CVE-2026-109518). Every rebased PR inherits it.
- The server image cannot start the voice or worker role (two workspace packages missing from the
  runtime stage). PR #270 fixes it and is red on shellcheck SC2317.
- 13 draft PRs open since 2026-11-01 to 2026-11-03; 12 green; two stacks need retargeting; all 13
  append to the two ledger files and so conflict with each other.
- `db:seed` applies 0 rows. `pnpm doctor` passes with the stack down.
- 260 remote branches (247 merged), 25 local, 7 worktrees (one dirty), 26 stashes (four hold
  guardrail edits), one root-owned leftover directory under `.claude/worktrees/`.
- Docs drift: `PLAN.md` header says 1.0.0 after the 1.1.0 amendment; P06.03.03, P06.03.04 and
  P06.03.07 are described as blocked although the code exists; `PROGRESS.md` front matter stale
  since 2026-11-01; two control-plane patch notes say "not applied" for applied patches.
- No flaky workflow. One flaky test (invitation lock timing), fixed by #260.

## 3. Plan problems

- 34 horizontal layers; the pilot gate needs 214 sections verified before one real call. Work
  was steered by milestones (M0, M1, M2) the plan does not define.
- Phases P07 to P16 and six later phases were started against unmet dependencies: tested
  libraries without importers.
- Evidence registry: 410 records, about 127 are reruns or bookkeeping, 52 cited IDs have no
  record, 115 records are never cited, pre-assigned IDs collide with allocated ones.
- Six writes per checklist item (ledger, phase header, `PROGRESS.md`, index row, record, phase
  plan).
- External status in three tables that disagree; no decision gate has a status; every dated
  target has passed.
- Missing: API routes for the P07 model, a login page, tenant onboarding through the product,
  call persistence on the real voice path, a table for the usage ledger, a role-boot test for the
  image.

Resolution: `ROADMAP.md` replaces the ledger with vertical queue items and a two-step finish line.

## 4. Votes on the process

| Thing                                                                                         | Vote              | Reason                                                                                                         |
| --------------------------------------------------------------------------------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------- |
| CI `verify` and `security-scan` as required checks                                            | KEEP              | the exact-SHA proof                                                                                            |
| CI `container-scan` required on every PR                                                      | SIMPLIFY          | required only when image inputs change; nightly run alerts                                                     |
| CI `review-annotations`, `openapi-drift` placeholder                                          | DELETE            | second semgrep run of the same rules; an empty slot                                                            |
| Up-to-date rule on `main`, auto-merge off                                                     | DELETE / AUTOMATE | the mechanical cause of one-at-a-time merges                                                                   |
| `merge_gate.py` (CI on SHA plus independent review, pinned squash)                            | KEEP              | holds both things that caught bugs                                                                             |
| Founder-path globs in the merge policy (56 patterns)                                          | DELETE            | matched almost every product PR; only `BLUEPRINT.md` stays                                                     |
| `mutation_check.py`                                                                           | KEEP              | on control paths only                                                                                          |
| `policy_guard.py`, 1,843 lines                                                                | SIMPLIFY          | 269 blocks in 47 days, half of them greps near an env file; now a denylist of about 150 lines with a self-test |
| Guardrail self-protection, kit manifest, `control_plane_check.py`, 2,472 lines of guard tests | DELETE            | protected the process from the owner; prevented none of the real failures                                      |
| `git_guard.py`                                                                                | KEEP              | only fires when uncommitted work would be lost                                                                 |
| `commit_guard.py`                                                                             | DELETE            | fifth typecheck; pre-push and CI already stop it                                                               |
| `format_on_edit.py`, lefthook prettier pre-commit and pre-push                                | KEEP              | closes the push-after-failed-prettier failure                                                                  |
| `ts_edit_check.py`, `stop_guard.py`, `stopfailure_checkpoint.py`, session hooks               | KEEP              | cheap; unchanged                                                                                               |
| `claim_check.py` Stop hook                                                                    | KEEP              | unchanged, but local `full` no longer needs Docker                                                             |
| Local `gates full`, 14 gates including integration                                            | SIMPLIFY          | six gates, no services; CI proves the rest                                                                     |
| Network host allowlist, draft-only rule, whole-file read block, tool-name scan in the hook    | DELETE            | no failure behind them; lefthook and CI check commit text                                                      |
| Status Ledger, `PROGRESS.md`, evidence records, phase plan files                              | DELETE (freeze)   | replaced by `ROADMAP.md`, git and CI; history stays in the tree                                                |
| `check-ledger-ids` in pre-push and CI                                                         | KEEP              | guards the frozen registry at no cost                                                                          |
| Skills `phase`, `handoff`, `gate-ready`, `verify-evidence`, `closure`                         | DELETE            | replaced by `/next`, `/preflight`, `/ship`                                                                     |
| Reviewer agents (security, architecture, invariant)                                           | SIMPLIFY          | keep `invariant-reviewer` for control paths; the others exist at user level                                    |
| PR template with seven sections and six checkboxes                                            | SIMPLIFY          | what and why, risk, tests                                                                                      |
| Root `.gitignore` without bytecode rules                                                      | AUTOMATE          | three lines added                                                                                              |
| `CLAUDE.md`, 199 lines                                                                        | SIMPLIFY          | under 80 lines; procedure moved to skills and `OPERATING.md`                                                   |
| One-command-per-call rule                                                                     | not a repo rule   | it lives in the user-level instructions; the repo guard never enforced it                                      |
