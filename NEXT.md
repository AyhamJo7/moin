# NEXT

**AI is doing now:** S1: call persistence and disclosure. The local stack may need `pnpm dev:up`; integration runs need the `TEST_*` values from `.env.example` exported.

**AI next:** (1) S2: demo tenant seed. (2) A1: background runtime (now also ports the fault-injection tests to `JobConsumer` and deletes `platform/worker.ts`). (3) O1: sign-in and onboarding.

**You next:** (1) H3: answer Twilio's identity request (account reported suspended). (2) H2: trademark search and domain for KlarDesk. (3) H4: request Bedrock model access in eu-central-1.

**Needed from you (one list), optional:** the git guard refuses these to a session; both are archived in `~/backups/moin-pre-prune-20261117.bundle` (`refs/archive/dirty/*`, `refs/archive/stash/*`). (1) `git worktree remove --force ~/worktrees/moin/docs-ledger-status-correction` (one uncommitted edit to the frozen `PROGRESS.md`). (2) `git stash clear` (26 stashes). (3) Copy the 14 keys `pnpm preflight` reports missing from `.env.example` into `.env`.

**Rollback tested before merge:** #266 (session-bound CSRF): 4 of 4. #267 (0083) and #278 (0084, sign-in throttle): previous bodies restored on a migrated database, sign-in admits, no row lost, bucket count right; 1 of 1 each. Not in the class: #262, #263, #265, #269, X4, X1, X2 (no migration; the identity change only adds a cookie on reads).

**Last verified main SHA:** `1260917` (#282, X1; all PR checks passed on its head, independent review APPROVE, 2026-11-17). Done: C1 to C6, X3, X4, X1, X2 (pending merge).
