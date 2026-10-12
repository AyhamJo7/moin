# EV-P09-012: Channel and sensitivity scoping — ready for reconfirmation

| Field | Value |
|---|---|
| Evidence ID | EV-P09-012 |
| Item | P09.10.01 |
| Date (UTC) | 2026-10-12 (gate run 01:23:51 UTC; supersedes blocked checkpoint at 01:17 UTC) |
| Commit | `f3a52e6444` (scanner exception; full gates and refreshed mutation proofs measured here) |
| Environment | local synthetic; exported TEST_*; Node 24.21.0; pnpm 10.34.5 |
| Command / procedure | `node scripts/check-migrations.ts`; `python3 .claude/bin/gates.py full`; `node scripts/mutation-sweep.ts --manifest docs/verification/channels-mutation-manifest.json --report docs/verification/channels-mutation-report.md --json docs/verification/channels-mutation-results.json`; `mutation_check.py --fix-ref 28e11f1 --fix-paths packages/db/src/faq.ts --test "pnpm exec vitest run --project integration packages/db/src/channels.integration.test.ts -t 'omitted context is fail closed and legacy grants are not aliases'"` |
| Result | PASS: migration scan no findings (exit 0); full gates 14/14 (exit 0); harness 7/7 KILLED_ASSERTION (exit 0); mutation_check KILLED, without fix exit 1 / with fix exit 0, byte-identical restore (runner exit 0). Ready for independent reconfirmation, not merged. |
| CI run / artifact | Draft PR #105; worktree Git directory `claude-evidence/20261012T012351Z-full.json`; committed `docs/verification/channels-mutation-report.md` and `channels-mutation-results.json` measured at f3a52e6 |
| Reviewer | Static invariant review found no blocker; founder authorized scanner exception; independent reconfirmation pending |

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

## Scanner false-positive resolution

The founder identified the `add-check-validated` scanner's 120-character negative-lookahead limit:
the new CHECK expressions put `NOT VALID` beyond its scan window. Migration 0016 supplies the
existing reasoned-exception precedent. Commit `f3a52e6` adds the exact founder-authorized
`migration-check: allow add-check-validated because ...` annotation to new, unshipped 0061.
Both `NOT VALID` declarations and separate `VALIDATE CONSTRAINT` statements remain unchanged.
No applied migration, scanner, gate, test, or constraint was weakened.

## Verification and HEAD boundaries

- Seven integration tests passed three standalone fresh-database runs, followed by twenty further
  fresh runs (140/140). Stress reports are worktree-local `test-results/channels-stress-1.json` through
  `channels-stress-20.json` at `45a3672`. These precede the final NOT VALID edit.
- The refreshed harness proved seven named `KILLED_ASSERTION` results at `f3a52e6`; report and JSON
  were committed as `81555cd`. These include view, catalogue, candidates, FAQ, grounded-sensitive,
  getLiveVersion and servedState guards.
  The separate `mutation_check.py --fix-ref 28e11f1 --fix-paths packages/db/src/faq.ts` proof ran the
  omitted-context/legacy-grant regression: without fix exit 1, with fix exit 0, byte-identical restore.
  The refreshed proof initially names `f3a52e6`; the final documentation HEAD is measured separately
  using the same command after committing this record. Its actual measured HEAD is authoritative
  in the worktree Git directory's `claude-evidence/mutation/latest.json`.
- Full gates at `f3a52e6` passed every configured gate: control-plane, control-plane-lint,
  conventions, docs-consistency, format, lint, boundaries, typecheck, unit, integration, migrations,
  build, licences, and secret-scan. Artifact `20261012T012351Z-full.json` records the measured HEAD.
  Subsequent commits update reports, PLAN P09.10 annotations, registry and ledger only.
- Final-HEAD sweep outputs use the ignored worktree-local paths
  `test-results/channels-final-head-mutation-report.md` and
  `test-results/channels-final-head-mutation-results.json`, avoiding a report/commit/HEAD cycle.
  Read the measured HEAD and verdicts there together with `mutation/latest.json`.
- Static independent invariant/security review found no blocker before the NOT VALID edit.
  TypeScript db-package check exited 0 before that SQL-only edit. LSP diagnostics could not run:
  `typescript-language-server` is not installed, and no SQL LSP server is configured for the changed
  migration. Migration scan and real-database integration gates passed. No verification tool or test
  was weakened.

## Superseded checkpoint

The initial full run at `45a3672` passed 8/14 and stopped at the scanner false positive
(`20261012T011345Z-full.json`). The direct scanner also rejected the correct NOT VALID statements;
the repeated-failure stop rule produced checkpoint `7f08419` / draft PR #105. That BLOCKED status is
superseded by the founder-directed annotation and passing full gates above. Ledger history remains
append-only. Initial mutation evidence at `bcb43e1` is superseded by the refreshed records.

Next: independent reconfirmation on draft PR #105. P09.10 checklist items remain unticked pending
founder review. No PDF or LAUNCH scope; no merge performed.

Sensitive material is stored by reference only (PLAN.md evidence rules).
