# NEXT

**AI is doing now:** A1: background runtime. A1a and A1b (outbox dispatch as `moin_dispatcher`, PR #288) are done. Next: the two FS-10 test follow-ups from the review that merged #287 (record the busy copy's message id and assert it stays unacknowledged while the handler is held, then is acknowledged with an empty DLQ; end the wait as soon as a second handler enters), then A1c (Idempotency-Key middleware) and A1d (chaos test). Integration runs need the `TEST_*` values from `.env.example` exported.

**AI next:** (1) O1: sign-in and onboarding. (2) B1: business API. (3) W1: owner views.

**Blocked:** S1 (#284, `feat/S1-call-persistence-disclosure`) and S2 (#285, `feat/S2-demo-tenant-seed`), both open, each refused three times by the independent review; every round was fixed, mutation-checked and documented in the PR. S1 round 3 wants, before a call stores caller data: verified full playback (S1b, needs H3); erasure, retention and export for calls and CallSid refusals (P1); a durable one-session claim (P11 Valkey); one webhook deadline with callback capture (S4); caller-id classification against all tenant numbers. Next: land A1 and P1, then rebase S1, or narrow it to fixture-only data. S2 round 3 (`9c7dcfa`) wants: refuse a provisioning id bound to another slug; schema-qualified catalog reads with a pinned search path; refuse superuser or BYPASSRLS seed roles; `withNewTenant` copying `actorId`/`correlationId` explicitly; one correlation id across provisioning and content; demo numbers from the BNetzA drama-number list (the current ones are on `main` too). Next: a fresh S2 attempt with all six. S3 and S4 wait on S1.

**You next:** (1) H3: answer Twilio's identity request (account reported suspended). (2) H2: trademark search and domain for KlarDesk; with its step 4, H9 (the worker's `DISPATCHER_DATABASE_URL` secret). (3) H4: request Bedrock model access in eu-central-1.

**Needed from you (one list), optional:** the git guard refuses these to a session; both are archived in `~/backups/moin-pre-prune-20261117.bundle` (`refs/archive/dirty/*`, `refs/archive/stash/*`). (1) `git worktree remove --force ~/worktrees/moin/docs-ledger-status-correction` (one uncommitted edit to the frozen `PROGRESS.md`). (2) `git stash clear` (26 stashes). (3) Copy the 14 keys `pnpm preflight` reports missing from `.env.example` into `.env` (sessions may not edit `.env`; tests run with `.env.example` exported).

**Rollback tested before merge:** #266 (session-bound CSRF): 4 of 4. #267 (0083) and #278 (0084, sign-in throttle): previous bodies restored on a migrated database, sign-in admits, no row lost, bucket count right; 1 of 1 each. Not in the class: X1 to X4, K1, A1a, A1b (no migration, no identity change).

**Last verified main SHA:** `d1db474` (#286, A1a; verify, codeql, container-scan and security-scan passed on it, 2026-11-22). Done: C1 to C6, X1 to X4, K1, A1a (#286, follow-ups #287), A1b (#288, pending merge).
