# NEXT

**AI is doing now:** A1: background runtime (worker handlers for outbox dispatch, timers, finaliser and reconciler sweeps; publisher; Idempotency-Key middleware; chaos test; port FS-01, FS-10 and FS-18 from `fault-injection.test.ts` to `JobConsumer` and delete `platform/worker.ts`). Integration runs need the `TEST_*` values from `.env.example` exported.

**AI next:** (1) O1: sign-in and onboarding. (2) B1: business API. (3) W1: owner views.

**Blocked:** S1 (#284, branch `feat/S1-call-persistence-disclosure`, open). The independent review refused it three times (`580b3a2`, `bd408fa`, `c0e8297`). Each round was fixed, mutation-checked and documented in the PR. Round 3 still wants these before a voice call stores caller data: verified full playback before real traffic (S1b, needs H3); erasure, retention and export covering calls and CallSid refusals (P1); a durable cross-instance one-session claim (P11 Valkey); one end-to-end webhook deadline with callback capture (S4, P11.08); caller-id classification against all of the tenant's numbers. Next: land A1 and P1 first, then rebase S1 onto them, or narrow S1 to fixture-only data. S3 and S4 wait on S1.

**You next:** (1) H3: answer Twilio's identity request (account reported suspended). (2) H2: trademark search and domain for KlarDesk. (3) H4: request Bedrock model access in eu-central-1.

**Needed from you (one list), optional:** the git guard refuses these to a session; both are archived in `~/backups/moin-pre-prune-20261117.bundle` (`refs/archive/dirty/*`, `refs/archive/stash/*`). (1) `git worktree remove --force ~/worktrees/moin/docs-ledger-status-correction` (one uncommitted edit to the frozen `PROGRESS.md`). (2) `git stash clear` (26 stashes). (3) Copy the 14 keys `pnpm preflight` reports missing from `.env.example` into `.env` (sessions may not edit `.env`; tests run with `.env.example` exported).

**Rollback tested before merge:** #266 (session-bound CSRF): 4 of 4. #267 (0083) and #278 (0084, sign-in throttle): previous bodies restored on a migrated database, sign-in admits, no row lost, bucket count right; 1 of 1 each. Not in the class: X1 to X4, K1, S2 (no migration, and no identity or Keycloak change: the seed creates no users, the realm file is unchanged).

**Last verified main SHA:** `4ccc5da` (#280, K1; verify, codeql, container-scan and security-scan passed on it, 2026-11-17). Done: C1 to C6, X1 to X4, K1, S2 (pending merge).
