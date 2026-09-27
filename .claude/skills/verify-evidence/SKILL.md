---
name: verify-evidence
description: "Audit a phase's evidence against PLAN.md's evidence rules: every ticked item has an EV ID, every EV ID has a complete record whose commit exists, and the recorded verification still reproduces. Never marks anything VERIFIED in the Status Ledger. Use when the founder types /verify-evidence Pxx."
argument-hint: "Pxx"
disable-model-invocation: true
allowed-tools:
  - "Bash(python3 .claude/bin/evidence.py *)"
  - "Bash(python3 .claude/bin/plan_section.py *)"
  - "Bash(python3 .claude/bin/gates.py *)"
  - "Bash(git status *)"
  - "Bash(git log *)"
  - "Bash(git rev-parse *)"
  - "Bash(git cat-file *)"
---

# /verify-evidence: audit one phase's evidence

Phase: `$0`.

## Step 0: registry check

Run `python3 .claude/bin/evidence.py check --phase $0` and keep its table.

## Procedure

1. If the registry is not initialised (before P02.01.04), write that into the report and stop.
2. Start from the table above (OK / MISSING / INCOMPLETE / STALE / DUPLICATE). For each OK record,
   read it and judge it against PLAN.md's "Checklist rules — no fake completion"
   (`python3 .claude/bin/plan_section.py --section "Checklist rules — no fake completion"`): mocks, skipped
   tests, in-suite-only data tests, sandbox-only billing, requested-but-not-received reviews are not
   evidence. Mark such records `INSUFFICIENT` with the rule they break.
3. Re-run each verification whose command is deterministic and local (tests, lint, gates, scripts),
   using `python3 .claude/bin/gates.py run <name>` where a gate exists. Record the result as
   `REPRODUCED` or `NOT REPRODUCED` with the exit code and HEAD SHA. Never re-run anything that
   touches external accounts; list it as `NOT RE-RUN (external)`.
4. Check that implementation and verification are separate items and that every section has at least
   one verification item with evidence.
5. Write `docs/phases/$0-evidence-check.md`: date, HEAD SHA, one row per EV ID / ticked item with its
   status and reason, and a summary count. Do not edit PLAN.md, INDEX.md or the records.
6. Final message: the report path and the counts. Anything not reproduced in this session is
   UNVERIFIED.
