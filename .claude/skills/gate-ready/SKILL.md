---
name: gate-ready
description: "Prepare a phase tier for founder review: gates full, stress where relevant, security-reviewer and architecture-reviewer (QG-09), invariant-reviewer on control paths, documentation (QG-10), tier completeness; writes a gate-review evidence record and proposes READY_FOR_REVIEW. Use when the founder types /gate-ready Pxx TIER."
argument-hint: "Pxx [PILOT|MTLIVE|LAUNCH|SELL|TEN]"
disable-model-invocation: true
allowed-tools:
  - "Bash(python3 .claude/bin/gates.py *)"
  - "Bash(python3 .claude/bin/evidence.py *)"
  - "Bash(python3 .claude/bin/plan_section.py *)"
  - "Bash(python3 .claude/bin/mutation_check.py *)"
  - "Bash(git status *)"
  - "Bash(git log *)"
  - "Bash(git diff *)"
  - "Bash(git rev-parse *)"
---

# /gate-ready: assemble the gate evidence for one phase tier

Phase `$0`, tier `$1`.

## Step 0: state

Run `python3 .claude/bin/gates.py status` and `python3 .claude/bin/evidence.py check --phase $0`.

## Rules

- The strongest status this skill may propose is `READY_FOR_REVIEW`. `VERIFIED`/`COMPLETE` for a phase
  tier are the founder's call. Never loosen a gate or threshold (that needs a change-log entry and
  founder approval).
- A skipped gate or a gate that did not run is UNVERIFIED, not green.

## Procedure

1. **Completeness.** List every item of the `[G:$1]` sections of `$0`
   (`python3 .claude/bin/plan_section.py $0`): ticked with an EV ID, open, or waiting on EXT. Open
   items → stop and report BLOCKED with the list.
2. **Gates.** `python3 .claude/bin/gates.py full` (QG-01 locally). If the phase touched concurrency,
   queues, idempotency or shared state: `python3 .claude/bin/gates.py stress --targets "<tests>"`. If
   compose files, Dockerfiles or workflows changed: `python3 .claude/bin/gates.py refs`.
3. **Reviews (QG-09).** Write `git diff <base>...HEAD` to a scratch file. Run the `security-reviewer` and
   `architecture-reviewer` agents on it (in parallel). If the diff touches a control path (auth,
   RLS/roles, tool guard, idempotency, billing/usage ledger, state machines), also run
   `invariant-reviewer`. Every HIGH/CRITICAL finding is either fixed (with a regression test proven by
   `python3 .claude/bin/mutation_check.py`) or listed as open, which blocks READY_FOR_REVIEW.
4. **Documentation (QG-10).** Check the phase's Documentation subsection is satisfied (ADRs, runbooks,
   README/CONTRIBUTING, claims) and that no behaviour change lacks its document.
5. **Record.** With the registry present:
   `python3 .claude/bin/evidence.py new --phase $0 --item $0 --slug gate-review-<tier> --summary "..." --from-gates full`
   then edit the new record to add the reviewer verdicts, open findings and doc checks. Before
   P02.01.04: write `docs/phases/$0-$1-gate.md` instead and say so.
6. **Propose, don't apply.** Show the exact Status Ledger row change you propose
   (`READY_FOR_REVIEW` for the tier) and the phase header change. The founder applies it, or tells
   you to.
7. Final message: gate results with evidence paths, reviewer verdicts, open items, UNVERIFIED list,
   and "ready for founder review" (never "complete").
