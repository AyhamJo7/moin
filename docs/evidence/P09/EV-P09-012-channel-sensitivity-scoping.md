# EV-P09-012: Channel and sensitivity scoping checkpoint; migration safety gate BLOCKED

| Field | Value |
|---|---|
| Evidence ID | EV-P09-012 |
| Item | P09.10.01 |
| Date (UTC) | 2026-10-12 01:17 UTC |
| Commit | `66563ab3250a1b79a40be507bb4b1cb7505ba6ee` |
| Environment | local synthetic; exported TEST_*; Node 24.21.0; pnpm 10.34.5 |
| Command / procedure | python3 .claude/bin/gates.py full (at 45a3672); node scripts/check-migrations.ts (NOT VALID checkpoint before commit) |
| Result | BLOCKED: full gates 8/14 then unit migration safety FAIL; direct check-migrations exit 1 after NOT VALID plus VALIDATE edit. Integration 7/7 passed 3x and 20x at prior implementation; harness 7/7 KILLED_ASSERTION at bcb43e1. Final checkpoint verification and HEAD-bound mutation pending. |
| CI run / artifact | worktree claude-evidence/20261012T011345Z-full.json; docs/verification/channels-mutation-results.json |
| Reviewer | static invariant review no blocker before NOT VALID edit; independent reconfirmation pending |

## Channel decision and scope

Choice **(b), extend**: `call|message|voice|email|web` is the common CHECK/service/filter vocabulary.
Legacy grants remain literal, not aliases: message-only does not imply email/web, call-only does not
imply voice. Existing approved arrays are not rewritten or widened. New unspecified scopes default
to all five; omitted retrieval context requires all five. Migration 0061 replaces the approved view
with v2 and documents transaction-local `app.knowledge_channel` enforcement (unknown denies all),
preserving security-invoker and base-table FORCE RLS. No DEFINER body is touched; digest re-pinning
is therefore not applicable. No stored columns are added; the privacy inventory documents changes
to the existing channel metadata and ephemeral context.

BLUEPRINT lines 360 and 622 require one shared approved business truth and operational context,
not indiscriminate exposure of every item on every channel. PLAN P09.10 supplies the permission
overlay: the same approved body is reused across each explicitly permitted channel, never copied
into per-channel knowledge silos. Sensitive FAQ cards retain approved/verbatim-only mode and never
ground generation; overdue sensitive/restricted suppression and servedState are reused, not rebuilt.

## Verification boundaries

- Seven integration tests passed three standalone fresh-database runs, followed by twenty further
  fresh runs (140/140). Stress reports are worktree-local `test-results/channels-stress-1.json` through
  `channels-stress-20.json` at `45a3672`. These precede the final NOT VALID edit.
- The harness proved seven named `KILLED_ASSERTION` results at `bcb43e1`; report and JSON are committed.
  The separate `mutation_check.py --fix-ref 28e11f1 --fix-paths packages/db/src/faq.ts` proof ran the
  omitted-context/legacy-grant regression: without fix exit 1, with fix exit 0, byte-identical restore.
  Its worktree `claude-evidence/mutation/latest.json` also names `bcb43e1`, **not the final checkpoint**.
- Full gates at `45a3672` passed 8/14, then unit migration-safety failed; integration, migrations,
  build, licences and secret-scan gates were not run. Adding NOT VALID plus separate VALIDATE
  statements did not clear the direct migration scanner. Repeated-failure stop rule applied; this
  record is a BLOCKED checkpoint, not successful closure.
- Static independent invariant/security review found no blocker before the NOT VALID edit.
  TypeScript db-package check exited 0 before that SQL-only edit. LSP diagnostics could not run:
  `typescript-language-server` is not installed. No verification tool or test was weakened.

Next implementer: diagnose the scanner's recognition of the new CHECK expressions, finish the
additive migration, refresh integration/mutation proofs at the actual final HEAD, and run full
gates to 14/14 before reconfirmation. P09.10 checklist items remain unticked. No PDF or LAUNCH scope.

Sensitive material is stored by reference only (PLAN.md evidence rules).
