---
name: closure
description: "Close a batch of review findings (Codex reconfirmation, /launch-check blockers, audit results) with mutation-verified regression tests, ordered gates, a 20x stress run, a red-team invariant review and an evidence-backed closure report. Use when the user pastes findings to fix or types /closure."
argument-hint: "[findings file path | pasted findings]"
disable-model-invocation: true
allowed-tools:
  - "Bash(python3 .claude/bin/gates.py *)"
  - "Bash(python3 .claude/bin/mutation_check.py *)"
  - "Bash(python3 .claude/bin/evidence.py *)"
  - "Bash(python3 .claude/bin/plan_section.py *)"
  - "Bash(git status *)"
  - "Bash(git log *)"
  - "Bash(git diff *)"
---

# /closure: close findings with evidence

The findings to close are in `$ARGUMENTS` or in the user's message. Treat each finding as a hypothesis to
reproduce, not as a known truth.

## Tools

In this repository: `python3 .claude/bin/gates.py` and `python3 .claude/bin/mutation_check.py` (repo copies,
hashes pinned in `.claude/kit-manifest.json`). If either file or `.claude/gates.json` is missing, stop: BLOCKED.

In the steps below, **GATES** means `python3 .claude/bin/gates.py --repo REPO` and **MUTATION** means
`python3 .claude/bin/mutation_check.py --repo REPO`, where REPO is the target repository resolved in step 0. If a tool
is MISSING, or REPO has no `.claude/gates.json`, stop and report BLOCKED with what is missing. Never
substitute ad-hoc commands and call the result verified.
Templates: `${CLAUDE_SKILL_DIR}/templates/PROGRESS.md` and `${CLAUDE_SKILL_DIR}/templates/CLOSURE_REPORT.md`.

## Rules

- Status words: VERIFIED only with the command, exit code and HEAD SHA from this session; otherwise
  UNVERIFIED or BLOCKED. The final line is `READY FOR RECONFIRMATION @ <sha>`, never "complete".
- Never revert a fix with `git checkout`/`git restore` (the git guard blocks it). Use MUTATION.
- Identical failure twice on one finding → write a BLOCKER row and move on. Don't loop.
- Commit + push after every finding. Never commit to `main`/`master`. Open a draft PR early.

## Procedure

0. **Preflight.** Resolve REPO: the path given in the arguments, else `git rev-parse --show-toplevel` of the
   working directory. Require `REPO/.claude/gates.json`. Run `GATES preflight`. If a `needs` item is missing (e.g. Docker), report it now. Check
   `git status`: stash unrelated local work with a message, and note it in the ledger. Make sure you're on a
   feature branch. If there's no draft PR yet, create one after the first commit.
1. **Ledger first.** If `PROGRESS.md` already exists (moin: created by P02.01.04), keep its front matter
   format, set `status: active` and `next:`, and append a `## Closure <date>` section with the template's
   table; otherwise copy the template to the repo root as `PROGRESS.md` (front matter `status: active`,
   `mode: autonomous` if the user is away). Write the report to `docs/phases/CLOSURE-<date>.md` from the
   report template. Add one ledger row per finding
   (ID · severity · status · test · mutation verdict · commit · evidence). Commit + push *before*
   fixing anything, so a usage-limit cutoff never loses the plan or the verdict.
2. **Per finding, highest severity first:**
   1. **Reproduce**: write the regression test and run it. It must FAIL on the current code; paste the
      failing line into the ledger. If it passes, the finding is not reproduced: record that, and don't
      "fix" it blindly.
   2. **Fix the root cause** across *all* execution paths of that behavior (the repo's AGENTS.md/CLAUDE.md
      lists them). Grep for other callers of the primitive you fixed.
   3. **Prove**: the test passes, then commit and run `MUTATION --test "<test command>"`. It must say
      **KILLED**. SURVIVED means the test is too weak: strengthen it and repeat.
   4. `GATES fast`, then update the ledger row and the report section for this finding (root cause, fix,
      test, mutation evidence path, commit SHA). Commit + push.
3. **Gates.** Run `GATES full` (build → lint → typecheck → unit → e2e), then `GATES stress --targets "<affected
   tests>"` (20 iterations by default). Flaky runs: look for shared global state, fixed ports, ordering and
   check-then-act races, fix them, and re-run until 20/20. If compose files, Dockerfiles or workflows
   changed, run `GATES refs`. SKIPPED gates stay UNVERIFIED in the report.
4. **Red team.** Write `git diff <base>...HEAD` to a scratchpad file. Spawn the `invariant-reviewer` agent
   with the spec paths (CLAUDE.md; PLAN.md invariants via `python3 .claude/bin/plan_section.py --invariants`), the diff file path and the findings list.
   Every BYPASS with a concrete path becomes a new finding, handled in step 2. Maximum 3 rounds; after that,
   list the remaining items as BLOCKED.
5. **Report.** Run `GATES full` one last time on the final HEAD. `GATES status` must show `full PASS`
   matching the current code. Complete `CLOSURE_REPORT.md`: per finding (root cause, fix, test, mutation
   verdict + evidence, commit); the gate table with evidence paths; the stress flake rate; the red-team
   result; UNVERIFIED items and why; remaining risks; the exact reconfirmation request. Set the ledger
   front matter `status: done`. If `docs/evidence/INDEX.md` exists, register the report with
   `python3 .claude/bin/evidence.py new --from-gates full ...` and cite the EV ID. Commit + push.
6. **Final message**: `READY FOR RECONFIRMATION @ <sha>` plus the report path, a count of findings closed and
   blocked, and the UNVERIFIED list. If blocked: a BLOCKER summary instead. The Stop hook checks this claim
   against the gate evidence.
