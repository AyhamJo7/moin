# NEXT

**AI is doing now:** S2: demo tenant seed (`pnpm db:seed` through `provision_tenant`; idempotent; row-count test). The local stack may need `pnpm dev:up`; integration runs need the `TEST_*` values from `.env.example` exported.

**AI next:** (1) A1: background runtime (also ports the fault-injection tests to `JobConsumer` and deletes `platform/worker.ts`). (2) O1: sign-in and onboarding. (3) B1: business API.

**You next:** (1) H3: answer Twilio's identity request (account reported suspended). (2) H2: trademark search and domain for KlarDesk. (3) H4: request Bedrock model access in eu-central-1.

**Needed from you (one list), optional:** the git guard refuses these to a session; both are archived in `~/backups/moin-pre-prune-20261117.bundle` (`refs/archive/dirty/*`, `refs/archive/stash/*`). (1) `git worktree remove --force ~/worktrees/moin/docs-ledger-status-correction` (one uncommitted edit to the frozen `PROGRESS.md`). (2) `git stash clear` (26 stashes). (3) Copy the 14 keys `pnpm preflight` reports missing from `.env.example` into `.env` (sessions may not edit `.env`; tests run with `.env.example` exported).

**Rollback tested before merge:** #266 (session-bound CSRF): 4 of 4. #267 (0083) and #278 (0084, sign-in throttle): previous bodies restored on a migrated database, sign-in admits, no row lost, bucket count right; 1 of 1 each. Not in the class: X1 to X4, K1, S1 (0085 adds three empty tables and one new function, alters no existing data).

**Last verified main SHA:** `4ccc5da` (#280, K1; verify, codeql, container-scan and security-scan passed on it, 2026-11-17). Done: C1 to C6, X1 to X4, K1, S1 (pending merge; the voice role now refuses staging and production until S4 and P1).
