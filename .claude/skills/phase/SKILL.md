---
name: phase
description: "Scope this session to one PLAN.md phase and tier: check tier-scoped dependencies against the Status Ledger, write the phase plan (item → EV ID → verification), then execute it; stop only for an unmet dependency, a PLAN ambiguity or a DG/EXT item without a usable default. Use when the founder types /phase Pxx [TIER]."
argument-hint: "Pxx [PILOT|MTLIVE|LAUNCH|SELL|TEN]"
disable-model-invocation: true
allowed-tools:
  - "Bash(python3 .claude/bin/plan_section.py *)"
  - "Bash(git status *)"
  - "Bash(git log *)"
  - "Bash(git branch *)"
---

# /phase: plan one phase, then execute it

Target: `$ARGUMENTS` (phase `$0`, tier `$1`, default: the earliest tier with open items).

## Step 0: orient

Run `python3 .claude/bin/plan_section.py --id $0` (the phase's Status Ledger row), `git status --short --branch`,
and read the front matter of `PROGRESS.md` if it exists (created by P02.01.04).

## Rules

- PLAN.md is authoritative; BLUEPRINT.md is read-only and read only by the line ranges PLAN cites.
- Read only: `plan_section.py --conventions`, `--ledger`, `--invariants`, `$0`, and `--id <ID>` for every
  ADR/EXT/DG/LG/PG/QG/FS the phase references. Never Read PLAN.md whole.
- Planning writes **one file** (the phase plan). Ticking items and Status Ledger changes happen
  during execution, under CLAUDE.md §4.

## Procedure

1. **Dependencies.** `python3 .claude/bin/plan_section.py --section "Phase dependencies (tier-scoped)"`
   gives the hard dependencies of `$0`. `P08@PILOT` means every `[G:PILOT]` section of P08 is VERIFIED.
   Compare with the Status Ledger. If a hard dependency is not met, STOP: print which ones, what would
   unblock them, and which independent items of `$0` could start anyway (only if the founder says so).
   P01 is founder discovery work: never plan it for execution.
2. **Read the phase** (`plan_section.py $0`) and every referenced ID. List the tier tags per section.
3. **Write `docs/phases/$0-plan.md`** (create `docs/phases/` if needed) with:
   - scope: phase, tier, target window, the sections in scope for that tier;
   - a table: checklist item → kind (implementation | verification) → the EV ID it will produce
     (`EV-$0-nnn`, numbering continues the registry) → the exact verification command, test file or
     procedure → files/packages touched;
   - every `[EXT]` item, EXT-nn and DG-nn: counterparty, what the founder must do, and the fallback;
     these become `WAITING_FOR_EXTERNAL` entries, never stubs marked done;
   - invariants at risk (INV IDs) and the test that proves each holds;
   - QG gates that apply (QG-01 always; QG-08/09/10/11/12 when triggered) and when the reviewers run;
   - the PR sequence: short-lived branches `<type>/<phase>-<section>-<slug>`, Conventional Commit
     titles, squash merge through `merge_gate.py` after the review loop (or by the founder for
     founder-merged paths, CLAUDE.md §8);
   - DG items whose recommended default the session may adopt (CLAUDE.md §7), and those it may not;
   - open questions where PLAN.md is ambiguous (ask; don't reinterpret).
4. **Decide.** If step 1 found an unmet hard dependency, or step 3 has an open PLAN ambiguity or a
   DG/EXT item that blocks the first section and has no adoptable default: stop and ask, listing them.
   Otherwise commit the plan, print a short digest (plan path, EXT list, adopted defaults) and start
   the first item. The founder may still stop or redirect at any time.
