# moin: session instructions

<!-- Maintainer notes are HTML comments (stripped before they reach the model). Keep this file under
200 lines; .claude/bin/control_plane_check.py enforces the limit, the INV index and no @-imports. -->

## 1. What this repository is

KlarDesk ("Digitales Front Office für kleine Betriebe"), codename `moin`. Application code exists from
P02 on; much of it is not wired into a running path. **`PLAN.md` is the authoritative execution plan** (phases P00–P33, Status Ledger,
gates, INV/EXT/DG/LG/QG IDs, evidence rules). `BLUEPRINT.md` is the founder's product spec: read-only
(a deny rule and a hook block writes). Where they differ, PLAN.md records the resolution.

## 2. Reading PLAN.md and BLUEPRINT.md (never whole)

PLAN.md has ~6,250 lines; a hook blocks Read without `limit` ≤ 400 and `cat` of either file. Use:

| Need                                             | Command                                                                                     |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| Status of every phase                            | `python3 .claude/bin/plan_section.py --ledger`                                              |
| Status model, gate tiers, IDs, evidence rules    | `python3 .claude/bin/plan_section.py --conventions`                                         |
| Principles and INV-01…INV-20                     | `python3 .claude/bin/plan_section.py --invariants`                                          |
| One phase (anchor `<a id="p02--…">` to the next) | `python3 .claude/bin/plan_section.py P02`                                                   |
| One checklist section / item                     | `python3 .claude/bin/plan_section.py P02.04` · `P02.04.03`                                  |
| The row defining an ID                           | `python3 .claude/bin/plan_section.py --id ADR-0003` (EXT-24, QG-09, FS-12, A-22, BR-048, …) |
| Any heading                                      | `python3 .claude/bin/plan_section.py --section "Testing Strategy"`                          |

Fallback without Python: `grep -n '<a id="p02--' PLAN.md`, then Read with offset/limit.
BLUEPRINT.md is read only by the line range a `BR-nnn` row cites (`--id BR-048` → `L432`), with
Read offset/limit. Agents read only what PLAN's "How to Use This Plan" lists: Conventions, Status
Ledger, Invariants, the target phase, and the IDs that phase references.

## 3. Starting a session

1. The founder names a phase and tier (`/phase P02`, `/phase P06 PILOT`). No phase named → take the
   next one from the Status Ledger: open `[G:PILOT]` work first, dependency order (P08 before P10).
2. `/phase` checks the tier-scoped dependencies (`P08@PILOT` = every `[G:PILOT]` section of P08
   VERIFIED) against the Status Ledger, writes `docs/phases/Pxx-plan.md`, and proceeds. It stops only
   for an unmet dependency, an ambiguity in PLAN.md, or a DG/EXT item without a usable default (§7).
3. Execute the plan. `PROGRESS.md` (from P02.01.04) and the SessionStart context show where the last
   session stopped; the founder reads the plan and `PROGRESS.md` as a digest, not as a gate.

## 4. Status and evidence (PLAN vocabulary)

- Status names are exactly: `NOT_STARTED`, `IN_PROGRESS`, `BLOCKED` (internal; name blocker and owner),
  `WAITING_FOR_EXTERNAL` (third party; counterparty, request date, expected date, fallback),
  `READY_FOR_REVIEW`, `VERIFIED`, `COMPLETE`, `DEFERRED`.
- Order of updates: **Status Ledger first**, phase header second, `PROGRESS.md` row third.
- Tick an item only with its evidence ID: `- [x] P02.05.06 … — EV-P02-012`. Implementation and
  verification are separate items. The "no fake completion" list is binding
  (`plan_section.py --section "Checklist rules — no fake completion"`).
- Evidence records: `python3 .claude/bin/evidence.py new --phase P02 --item P02.05.06 --slug … --summary …
--from-gates full` → `docs/evidence/P02/EV-P02-nnn-<slug>.md` + INDEX row. Audit: `evidence.py check`.
  Sensitive evidence is stored by reference only (location, SHA-256, date, counterparty).
- A session may raise a phase tier to `VERIFIED` when every item of the tier is ticked with its EV ID,
  `gates.py full` passes on the head SHA, `/gate-ready` leaves no HIGH/CRITICAL finding open, and the
  independent reviewer concurs on that same SHA (recorded in the gate-review evidence). `COMPLETE`
  (deployed to the target environment) stays the founder's call. Tightening a gate never needs
  approval; loosening always does.

## 5. Claims

- VERIFIED = command + exit code + HEAD SHA from this session. Otherwise say UNVERIFIED or BLOCKED.
- Before any "done/green/fixed" wording: `python3 .claude/bin/gates.py full` must pass on the current
  tree. The Stop hook blocks the claim otherwise. Until P02 wires real gates, `full` fails by design.
- A bug fix counts only with a regression test that fails without the fix. On control paths (auth,
  sessions, RLS/roles, `SECURITY DEFINER`, tool guard, idempotency, usage ledger, billing, state
  machines) `python3 .claude/bin/mutation_check.py --test "<cmd>"` must report KILLED; elsewhere (UI,
  copy, docs tooling) a normal regression test is enough. `gates.py stress` runs for concurrency,
  queue and flaky-prone suites, not for every fix. Never revert a fix by hand with
  `git checkout`/`git restore` (the git guard blocks it).
- After green gates the wording is "ready for review", never "complete".

## 6. Invariants (full text: `plan_section.py --invariants`)

- INV-01 FORCE RLS on every tenant row; runtime role NOBYPASSRLS
- INV-02 tenant context derived server-side only
- INV-03 full German AI disclosure before any AI voice session
- INV-04 models hold no credentials and execute nothing; tool guard validates
- INV-05 no commitment without verified tool success
- INV-06 no lost interaction (outcome or open task)
- INV-07 no raw call audio persisted
- INV-08 answers only from approved, valid knowledge
- INV-09 identity merges deterministic or human-approved
- INV-10 every business mutation writes an append-only audit event
- INV-11 every external or retried side effect is idempotent
- INV-12 no personal data in logs, metrics, traces, analytics, push
- INV-13 life-safety cases get the reviewed deterministic script
- INV-14 excluded sensitive uses do not exist
- INV-15 secrets only in AWS Secrets Manager by ARN
- INV-16 production data never leaves production
- INV-17 one image digest per release; expand/contract migrations
- INV-18 no tenant-specific code paths
- INV-19 a call is never dropped silently
- INV-20 billing derives from our own immutable usage ledger

## 7. Stop and ask

- An item needs an account, credential, contract, provider console, DNS, production change or a
  lawyer (EXT-nn / DG-nn): record `WAITING_FOR_EXTERNAL` with the four fields, continue with independent
  items, and tell the founder exactly what is needed. Never stub or simulate it as done.
  The AI prepares everything around them (drafts, briefs, checklists, emails, meeting agendas) so the
  founder only signs, sends or attends.
- A founder decision gate whose PLAN row has a recommended default and is engineering-shaped (DG-04,
  DG-12, DG-13, DG-14 shortlist): when it blocks work, adopt the default in an ADR headed "Default
  adopted; founder may override" and continue. Money, brand, legal and strategy gates (DG-00, DG-03,
  DG-05, DG-09, DG-11) are never adopted by a session.
- PLAN.md is ambiguous or contradicts itself or BLUEPRINT.md → ask; don't reinterpret.
- A change would weaken an INV or loosen a gate or threshold → stop.
- A failure gets up to three attempts, each testing a different hypothesis. The same failure after
  that, or the same provider 429/quota twice → write a BLOCKER entry and stop that item (other
  independent items may continue). Several blockers per session are fine; commit after each one.

## 8. Git and pull requests

- Trunk-based: `main` is protected; work on short-lived branches `<type>/pNN-<section>-<slug>`
  (e.g. `feat/p02-03-skeleton`), one checklist section or smaller. PRs are squash-merged.
- Conventional Commits; the message says why. PR body fields (P02.01.02): what/why, risk, tests,
  EV IDs, docs, migration/rollback, privacy impact.
- A-22: no AI-tool mentions or attribution in commits, tags, PR titles or bodies (no tool names,
  session links, `Co-Authored-By` lines). The policy hook enforces `.claude/policy/no-ai-mentions.json`;
  domain terms like "AI disclosure" and `feat(ai)` are fine.
- Push freely to your own branch with the plain form `git push -u origin <branch>`. Blocked: pushes to
  `main`/`master`, force pushes, branch deletion, and hidden forms (`git -C`, `-c`, `sh -c`).
- PRs are opened as drafts (`gh pr create --draft`). The review loop runs on the PR: Codex reviews,
  the implementer fixes, until no HIGH/CRITICAL is open. Session merging activates once PR #247 is
  merged, and only through `python3 .claude/bin/merge_gate.py <pr>`. The gate checks `verify-head` on
  the exact head SHA, derives files and diff from immutable git objects, runs Codex on an isolated
  snapshot of that SHA, refuses on any CRITICAL/HIGH line or a missing or contradictory verdict,
  re-checks state, base and head, and squash-merges pinned to that SHA. It is a procedural control
  against mistakes and drift, not a security boundary. Raw `gh pr ready`/`gh pr merge` and merging
  through `gh api` stay blocked.
  Always founder-merged: `.claude/`, `.github/`, `scripts/`, `infrastructure/`, `deploy/`, `docker/`,
  Dockerfiles and compose files, `lefthook.yml`, `packages/config/`, every `package.json`,
  `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `turbo.json`, the vitest/eslint/playwright configs,
  `tsconfig*.json`, `next.config.*`, `.nvmrc`, `renovate.json`, `.gitattributes`,
  `.dependency-cruiser.cjs`, the prettier, editorconfig, tflint and terraform-version files,
  `.env.example`, every ignore file (`*ignore`), anything named for semgrep, trivy, gitleaks, hadolint,
  codeql or osv-scanner, `.npmrc`, `.yarnrc*`, every `CLAUDE.md` and `AGENTS*.md`, `BLUEPRINT.md`.
  Founder-merged during the trial (until 2026-11-29): migrations, and identity, auth, session, RLS,
  definer, tool-guard, webhook, integrations, billing, usage, privacy, erasure, retention and deletion
  code. The globs in `.claude/policy/merge-gate.json` are authoritative.
- `gh workflow run` and `gh run rerun` are allowed for CI workflows (once PR #247 is merged). A future
  deploy workflow must use a GitHub environment that requires founder approval for production.

## 9. Commands

pnpm/turbo/docker commands: README.md Quickstart and `docs/development/`.

| Purpose                                     | Command                                                                                         |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Gates (evidence in `.git/claude-evidence/`) | `python3 .claude/bin/gates.py fast` · `full` · `status` · `stress --targets "<tests>"` · `refs` |
| Prove a regression test                     | `python3 .claude/bin/mutation_check.py --test "<test command>"`                                 |
| Watch a long run                            | `python3 .claude/bin/progress_probe.py <name> --repo .`                                         |
| Control-plane self-check                    | `python3 .claude/bin/control_plane_check.py`                                                    |
| Toolchain                                   | Node 24 (`.nvmrc`, `nvm use`), pnpm 10 (`packageManager`), Terraform pinned binary              |

## 10. Reviews (QG-09)

Changes to auth, sessions, RLS/roles, `SECURITY DEFINER`, the tool guard, webhooks, integrations,
billing or privacy handlers need `/gate-ready`: it runs the `security-reviewer` and
`architecture-reviewer` agents on the diff, plus `invariant-reviewer` when a control path changed
(auth, RLS, tool guard, idempotency, usage ledger, state machines). HIGH/CRITICAL findings are fixed
with a mutation-proven test or stay open and block review. QG-09 founder concurrence (amended with
founder approval on 2026-11-01): until 2026-11-29 these PRs are founder-merged; afterwards the three
agent reviews plus the independent Codex review replace it. The independent reviewer re-verifies each
fix; the founder breaks a tie when implementer and reviewer still disagree after two rounds.

## 11. Parallel phases

P01–P05 overlap in time, but P01 is the founder's discovery work (sessions never execute it), P03 needs
P02.03, and P05 needs P02 + EXT-09. Rules: one session per phase, at most two engineering sessions at
once, never two on the same checklist section. A session edits only its own phase's Status Ledger row;
`PROGRESS.md` and `docs/evidence/INDEX.md` are append-only. A conflict in another phase's row → stop
and ask.

## 12. Local and cloud sessions

- **Cloud sessions attach only the moin repository.** With several repositories attached, the session
  starts above the clones and does not load `.claude/settings.json`: no hooks, no deny rules.
- The cloud VM clones the pushed branch: push before `claude --cloud`; bring work back with
  `claude --teleport`. Cloud sessions get no provider credentials; anything needing them is local
  and founder-driven.
- Founder-only, in every environment: accounts, credentials, provider consoles, production
  `terraform apply` and promotion, rulesets, DNS, contracts, the first real caller (PG-3), and merges
  that `merge_gate.py` refuses. Once a dev/staging environment exists, merges to `main` deploy there
  through CI without founder action.
- **Unattended runs** use `--dangerously-skip-permissions`: nothing prompts, so every rule is allow or
  deny. Network: `curl`/`wget` GET only, to `.claude/policy/network.json` hosts, never piped into a
  shell. No `terraform plan`, `aws`, `npx`/`pnpm dlx`, `ssh`, or nested `claude` sessions. A long run
  keeps `PROGRESS.md` at `mode: autonomous`, `status: active`. Two no-change iterations make the
  stall hook stop the loop: write a BLOCKER row and end the turn. Retry rules: §7.

## 13. Control plane

Map: `.claude/README.md`. **Guardrail files are founder-only** (`.claude/policy/protected-paths.json`):
settings, hooks, agents, policy, gates, bin, manifest, and the user-level settings. Read them; never edit,
move, delete, chmod or git-restore them, not even through scripts. The hook blocks every such attempt.
If one needs a change, write the patch under `docs/control-plane/patches/` and ask the founder
to apply it. `python3 .claude/bin/control_plane_check.py` must pass. Background: `docs/control-plane/`.
