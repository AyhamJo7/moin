# moin: session instructions

<!-- Maintainer notes are HTML comments (stripped before they reach the model). Keep this file under
200 lines; .claude/bin/control_plane_check.py enforces the limit, the INV index and no @-imports. -->

## 1. What this repository is

KlarDesk ("Digitales Front Office für kleine Betriebe"), codename `moin`. Greenfield: no application
code exists until P02. **`PLAN.md` is the authoritative execution plan** (phases P00–P33, Status Ledger,
gates, INV/EXT/DG/LG/QG IDs, evidence rules). `BLUEPRINT.md` is the founder's product spec: read-only
(a deny rule and a hook block writes). Where they differ, PLAN.md records the resolution.

## 2. Reading PLAN.md and BLUEPRINT.md (never whole)

PLAN.md has ~6,250 lines; a hook blocks Read without `limit` ≤ 400 and `cat` of either file. Use:

| Need | Command |
|---|---|
| Status of every phase | `python3 .claude/bin/plan_section.py --ledger` |
| Status model, gate tiers, IDs, evidence rules | `python3 .claude/bin/plan_section.py --conventions` |
| Principles and INV-01…INV-20 | `python3 .claude/bin/plan_section.py --invariants` |
| One phase (anchor `<a id="p02--…">` to the next) | `python3 .claude/bin/plan_section.py P02` |
| One checklist section / item | `python3 .claude/bin/plan_section.py P02.04` · `P02.04.03` |
| The row defining an ID | `python3 .claude/bin/plan_section.py --id ADR-0003` (EXT-24, QG-09, FS-12, A-22, BR-048, …) |
| Any heading | `python3 .claude/bin/plan_section.py --section "Testing Strategy"` |

Fallback without Python: `grep -n '<a id="p02--' PLAN.md`, then Read with offset/limit.
BLUEPRINT.md is read only by the line range a `BR-nnn` row cites (`--id BR-048` → `L432`), with
Read offset/limit. Agents read only what PLAN's "How to Use This Plan" lists: Conventions, Status
Ledger, Invariants, the target phase, and the IDs that phase references.

## 3. Starting a session

1. The founder names one phase and tier: `/phase P02` (or `/phase P06 PILOT`). No phase named → ask.
2. `/phase` checks the tier-scoped dependencies (`P08@PILOT` = every `[G:PILOT]` section of P08
   VERIFIED) against the Status Ledger, writes `docs/phases/Pxx-plan.md`, and stops for approval.
3. Execute only the approved plan. `PROGRESS.md` (from P02.01.04) and the SessionStart context show
   where the last session stopped.

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
- A session raises a phase tier to at most `READY_FOR_REVIEW`. `VERIFIED`/`COMPLETE` of a tier are the
  founder's call. Tightening a gate never needs approval; loosening always does.

## 5. Claims

- VERIFIED = command + exit code + HEAD SHA from this session. Otherwise say UNVERIFIED or BLOCKED.
- Before any "done/green/fixed" wording: `python3 .claude/bin/gates.py full` must pass on the current
  tree. The Stop hook blocks the claim otherwise. Until P02 wires real gates, `full` fails by design.
- A bug fix counts only with a regression test that `python3 .claude/bin/mutation_check.py --test "<cmd>"`
  reports KILLED. Never revert a fix by hand with `git checkout`/`git restore` (the git guard blocks it).
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
- PLAN.md is ambiguous or contradicts itself or BLUEPRINT.md → ask; don't reinterpret.
- A change would weaken an INV or loosen a gate or threshold → stop.
- The same failure twice (including provider 429/quota) → write a BLOCKER entry and stop the loop.

## 8. Git and pull requests

- Trunk-based: `main` is protected; work on short-lived branches `<type>/pNN-<section>-<slug>`
  (e.g. `feat/p02-03-skeleton`), one checklist section or smaller. PRs are squash-merged **by the founder**.
- Conventional Commits; the message says why. PR body fields (P02.01.02): what/why, risk, tests,
  EV IDs, docs, migration/rollback, privacy impact.
- A-22: no AI-tool mentions or attribution in commits, tags, PR titles or bodies (no tool names,
  session links, `Co-Authored-By` lines). The policy hook enforces `.claude/policy/no-ai-mentions.json`;
  domain terms like "AI disclosure" and `feat(ai)` are fine.
- `git push` and `gh pr create` ask the founder. Push only with the plain form
  `git push -u origin <branch>`; `git -C`, `-c`, `sh -c` and pushes to `main` are blocked. Never merge.

## 9. Commands

Greenfield until P02.02; P02.07.01 adds the pnpm/turbo/docker commands here.

| Purpose | Command |
|---|---|
| Gates (evidence in `.git/claude-evidence/`) | `python3 .claude/bin/gates.py fast` · `full` · `status` · `stress --targets "<tests>"` · `refs` |
| Prove a regression test | `python3 .claude/bin/mutation_check.py --test "<test command>"` |
| Watch a long run | `python3 .claude/bin/progress_probe.py <name> --repo .` |
| Control-plane self-check | `python3 .claude/bin/control_plane_check.py` |
| Toolchain | Node 24 (`.nvmrc`, `nvm use`), pnpm 10 (`packageManager`), Terraform pinned binary |

## 10. Reviews (QG-09)

Changes to auth, sessions, RLS/roles, `SECURITY DEFINER`, the tool guard, webhooks, integrations,
billing or privacy handlers need `/gate-ready`: it runs the `security-reviewer` and
`architecture-reviewer` agents on the diff, plus `invariant-reviewer` when a control path changed
(auth, RLS, tool guard, idempotency, usage ledger, state machines). HIGH/CRITICAL findings are fixed
with a mutation-proven test or stay open and block review.

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
- Founder-only, in every environment: accounts, credentials, provider consoles, `terraform apply`,
  merges to `main`, rulesets, DNS, contracts.

## 13. Control plane

Map and maintenance: `.claude/README.md`. Changes to `.claude/` or this file go through a reviewed PR;
`python3 .claude/bin/control_plane_check.py` must pass. Background and decisions:
`docs/control-plane/`.
