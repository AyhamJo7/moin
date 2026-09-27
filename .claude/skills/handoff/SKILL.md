---
name: handoff
description: "End a working session cleanly: ledger entry, gate status, commit and push of the branch, and a one-paragraph resume prompt for the next local or cloud session. Use when the founder types /handoff."
argument-hint: "[note]"
disable-model-invocation: true
allowed-tools:
  - "Bash(git status *)"
  - "Bash(git log *)"
  - "Bash(git add *)"
  - "Bash(git commit *)"
  - "Bash(python3 .claude/bin/gates.py status)"
  - "Bash(python3 .claude/bin/plan_section.py *)"
---

# /handoff: leave the work resumable

Note from the founder: `$ARGUMENTS`

## Step 0: state

Run `git status --short --branch`, `git log --oneline -5` and `python3 .claude/bin/gates.py status`.

## Procedure

1. **Ledger.** In `PROGRESS.md` (from P02.01.04; before that, `docs/control-plane/PROGRESS.md`): update
   the front matter `status`, `updated` (UTC) and `next` (one concrete action), and add a log row:
   what was done, commits, EV IDs, what is blocked and on whom (`BLOCKED` = internal with owner,
   `WAITING_FOR_EXTERNAL` = third party with counterparty, request date, expected date, fallback).
2. **Status Ledger.** If a tier status changed this session (at most `READY_FOR_REVIEW`), make sure the
   Status Ledger row was updated first and the phase header second. If not already done, say so.
3. **Commit** with a Conventional Commit (no AI-tool mentions; the hook checks).
4. **Resume prompt.** Always print it, even when the push below still waits for approval. Print one paragraph the founder can paste into the next session (local or cloud):
   branch, phase and tier, the `next` action, the approved phase plan path, blockers, and the first
   command to run. Cloud sessions: remind that only the moin repository may be attached.
5. **Push** with `git push -u origin <branch>` (it asks the founder; never `main`). If the push is
   declined or pending, say so under the resume prompt.
6. Anything not verified in this session is listed as UNVERIFIED.
