# NEXT

**AI is doing now:** X3, X1, X2: the review follow-ups (throttle clock and sweep, cross-tenant suite, identity).

**AI next:** (1) S1: call persistence and disclosure. (2) S2: demo tenant seed. (3) A1: background runtime (now also ports the fault-injection tests to `JobConsumer` and deletes `platform/worker.ts`).

**You next:** (1) H3: answer Twilio's identity request (account reported suspended). (2) H2: trademark search and domain for KlarDesk. (3) H4: request Bedrock model access in eu-central-1.

**Needed from you (one list), optional:** the git guard refuses these to a session; both are archived in `~/backups/moin-pre-prune-20261117.bundle` (`refs/archive/dirty/*`, `refs/archive/stash/*`). (1) `git worktree remove --force ~/worktrees/moin/docs-ledger-status-correction` (one uncommitted edit to the frozen `PROGRESS.md`). (2) `git stash clear` (26 stashes).

**Rollback tested before merge:** #266 (session-bound CSRF): 4 of 4. #267 (migration 0083, sign-in throttle): old function bodies restored on a migrated database, sign-in admits, no row lost, bucket count right; 1 of 1. Not in the class: #262, #263, #265, #269.

**Last verified main SHA:** `5063b64` (#276, C3; all 20 PR checks passed on head `7fea3fd`, 2026-11-17). Done: C1 to C5; C6 in this pull request.
