---
name: gate-ready
description: "Verify a phase tier: gates full, stress where relevant, security-reviewer and architecture-reviewer (QG-09), invariant-reviewer on control paths, documentation (QG-10), tier completeness, independent reviewer concurrence; writes a gate-review evidence record and sets VERIFIED (or READY_FOR_REVIEW when the reviewer has not concurred). Use when the founder types /gate-ready Pxx TIER."
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

- The strongest status this skill may set is `VERIFIED`, under the conditions in CLAUDE.md §4.
  `COMPLETE` (deployed) is the founder's call. Never loosen a gate or threshold (that needs a
  change-log entry and founder approval).
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
   `python3 .claude/bin/mutation_check.py`) or listed as open, which blocks READY_FOR_REVIEW. The
   independent reviewer re-verifies each fix; after two rounds of disagreement, list the finding for
   the founder's tie-break and treat it as open.
4. **Documentation (QG-10).** Check the phase's Documentation subsection is satisfied (ADRs, runbooks,
   README/CONTRIBUTING, claims) and that no behaviour change lacks its document.
5. **Record.** With the registry present:
   `python3 .claude/bin/evidence.py new --phase $0 --item $0 --slug gate-review-<tier> --summary "..." --from-gates full`
   then edit the new record to add the reviewer verdicts, open findings and doc checks. Before
   P02.01.04: write `docs/phases/$0-$1-gate.md` instead and say so.
6. **Apply.** Send the head SHA, the diff and the gate-review record to the independent reviewer. If it
   concurs on that SHA (recorded in the evidence record), set the tier to `VERIFIED`: Status Ledger
   row first, phase header second, `PROGRESS.md` row third. Otherwise set `READY_FOR_REVIEW` and list
   what the reviewer still disputes.
7. Final message: gate results with evidence paths, reviewer verdicts, the status set, open items and
   the UNVERIFIED list (never "complete").
