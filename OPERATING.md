# OPERATING

How a task gets from `ROADMAP.md` to `main`. Short on purpose: every rule here prevented a real
failure. The vote on each old rule is in `docs/audits/2026-11-14-owner-audit/README.md`.

## The flow

1. **Pick.** `/next` reads `NEXT.md` and takes the first item under "AI is doing now", or the
   first unblocked item of the AI queue in `ROADMAP.md`.
2. **Branch.** `git switch -c <type>/<queue-id>-<slug> origin/main`. Parallel items get one
   worktree each.
3. **PR at the first commit.** Push and `gh pr create --draft` straight away. A session never ends
   with commits that have no PR.
4. **Build.** Test first where there is logic. A bug fix needs a test that fails without it. On
   control paths (auth, sessions, RLS and roles, `SECURITY DEFINER`, tool guard, idempotency,
   usage ledger, billing, state machines) run
   `python3 .claude/bin/mutation_check.py --test "<cmd>"` and paste the result into the PR.
5. **Local loop.** `python3 .claude/bin/gates.py full` (format, lint, typecheck, unit, migration
   lint; no Docker needed). Integration tests: `/preflight`, then the targeted
   `pnpm exec vitest run --project integration <file>`.
6. **Ship.** `/ship <pr>`: waits for CI on the exact head SHA, runs the independent review on
   that SHA, squash-merges pinned to it. Any CRITICAL or HIGH finding blocks; fix and ship again.
   Several PRs: ship them in dependency order, one command each, no manual rebases (the
   up-to-date rule is off).
   A PR on a control path also gets the `invariant-reviewer` agent before `/ship`; its findings go
   into the PR.
   **Rollback first** for two kinds of PR: a migration that alters or drops existing data, and
   an identity or Keycloak change that could lock the owner out. Ship only after the rollback
   path has been run (down path or restore on a database holding the old data; owner sign-in
   restored on the local stack), and write one line about it in `NEXT.md`.
7. **Record.** The same PR ticks its item in `ROADMAP.md` and rewrites `NEXT.md`. Nothing else is
   kept by hand.

## Truth

- "Green", "merged" and "done" are said only with the command, its exit code and the SHA.
  CI on the head SHA is the proof for green; `gh pr checks <pr>` or `verify-head --pr <pr>` is the
  command to quote.
- The local `gates.py full` proves the working tree is worth pushing, nothing more.
- After green the wording is "ready for review" until the PR is merged.

## What is enforced, and where

| Failure it prevents                    | Mechanism                                                                               |
| -------------------------------------- | --------------------------------------------------------------------------------------- |
| Green claimed without proof on the SHA | `/ship` (CI plus review on the exact SHA); Stop hook `claim_check`                      |
| Services down blamed on the code       | `/preflight`; local `full` needs no services; CI runs integration with its own services |
| Bytecode committed                     | `.gitignore`                                                                            |
| Push after a failed formatter          | format-on-edit hook, lefthook pre-commit and pre-push, hook bypass denied               |
| Duplicate ledger IDs                   | no new ledger entries; `check-ledger-ids` in CI guards the frozen registry              |
| PRs merged one message at a time       | auto-merge on, up-to-date rule off, `/ship` in a loop                                   |
| Session ends before the PR             | step 3                                                                                  |
| Lost work                              | `git_guard` hook; bundle before pruning                                                 |
| Secrets                                | deny rules for secret files, gitleaks in pre-commit and CI                              |

## Hard limits (deny rules and the guard)

No reading or printing of secret files. No push to `main`, no force push, no hook bypass. No
`terraform apply`, no provider CLIs, no production data outside production. No download piped
into a shell. `BLUEPRINT.md` is read-only. Dropping a database or volume that the session did not
create needs the founder.

## Only the founder

Money, accounts, contracts, credentials, legal and privacy decisions, talking to customers,
production deploys, and the decisions in `ROADMAP.md` section 5 that have no safe default. These
live in the human queue; the AI prepares everything around them.

## Invariants

INV-01 to INV-20 in `PLAN.md` (`python3 .claude/bin/plan_section.py --invariants`) are product
rules, not process. A change that weakens one stops and goes to the founder.
