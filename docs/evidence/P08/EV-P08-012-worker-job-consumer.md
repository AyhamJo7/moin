# EV-P08-012: ASYNC-1A: SQS job consumer in the worker role; job_runs row-lock execution lease in the tenant transaction; retry, poison, DLQ, visibility heartbeat, drain; real PostgreSQL, ElasticMQ and compiled-entrypoint tests

| Field | Value |
|---|---|
| Evidence ID | EV-P08-012 |
| Item | P08.05.01 |
| Date (UTC) | 2026-10-21 19:24 UTC |
| Commit | `8c754616b3face217d1eec91cde911ddb61efcbc` |
| Environment | Node 24.21.0, PostgreSQL 17 (pgvector), ElasticMQ, Keycloak, local worktree |
| Command / procedure | `.claude/bin/gates.py full`: `python3 .claude/bin/control_plane_check.py && python3 -m unittest discover -s .claude/tests -t .claude/tests` → pass (exit 0, 31.5 s); `uvx ruff@0.15.12 format --check --config .claude/ruff.toml .claude && uvx ruff@0.15.12 check --config .claude/ruff.toml .claude && uvx --from mypy==2.3.1 mypy --config-file .claude/mypy.ini` → pass (exit 0, 0.3 s); `node scripts/check-conventional-commit.ts --self-test && node scripts/check-no-ai-mentions.ts --self-test` → pass (exit 0, 0.2 s); `node scripts/check-adr-coverage.ts && node scripts/check-domain-coverage.ts && node scripts/check-dfd-coverage.ts && node scripts/check-threat-model-refs.ts && node scripts/check-data-classification.ts && node scripts/check-subprocessors.ts && node scripts/check-brand-strings.ts` → pass (exit 0, 2.0 s); `pnpm exec prettier --check .` → pass (exit 0, 11.4 s); `pnpm lint` → pass (exit 0, 5.1 s); `pnpm exec depcruise apps packages scripts --config .dependency-cruiser.cjs` → pass (exit 0, 1.6 s); `pnpm typecheck` → pass (exit 0, 1.5 s); `pnpm test` → pass (exit 0, 11.2 s); `pnpm test:integration` → pass (exit 0, 60.4 s); `node scripts/check-migrations.ts` → pass (exit 0, 0.1 s); `pnpm turbo run build` → pass (exit 0, 10.3 s); `node scripts/check-licences.ts` → pass (exit 0, 0.6 s); `gitleaks git --redact --no-banner --config .gitleaks.toml .` → pass (exit 0, 2.1 s) |
| Result | PASS |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).

## What this slice is, and is not

ASYNC-1A of the audit's M2. A real consumer in the worker role: SQS long-poll (ElasticMQ locally),
bounded concurrency, a visibility heartbeat, retry through `ChangeMessageVisibility`, DLQ-first
dead-lettering and a drain on SIGTERM. A delivery runs `executeJob` (`packages/db/src/job-execution.ts`):
one tenant transaction takes the `job_runs` row with `for update skip locked` (the execution lease),
runs the handler inside a savepoint, and writes `succeeded` in the same transaction as the handler's
effects. The queue message is deleted only after that commit.

**Not delivered:** no production job type has a handler (the registry is empty), nothing publishes
to the queue yet (outbox dispatcher, ASYNC-1B), no provider inbox, scheduler or SSE. The proof of
processing in the compiled-process test is the no-handler path; effect-bearing tests use test-only
handlers. The callback-to-outbox pipeline does not exist yet. P08.05.01–.04 stay open: P08.01.02
(per-class queues, visibility floors) and a handler contract for external calls are not done.

## Evidence

| What | Where | Result |
|---|---|---|
| Full gates, HEAD `8c75461` | `.claude/bin/gates.py full` (Keycloak, ElasticMQ and PostgreSQL running locally) | 14/14 PASS |
| Ledger execution, real PostgreSQL as `moin_app`, FORCE RLS | `packages/db/src/job-execution.integration.test.ts` | 14 tests |
| SQS adapter against ElasticMQ | `packages/integrations/src/queue/sqs-queue.integration.test.ts` | 5 tests |
| Consumer over SQS and PostgreSQL | `apps/server/src/modules/platform/job-consumer.integration.test.ts` | 21 tests |
| Compiled `dist/main-worker.js` as a process | `apps/server/src/modules/platform/worker-process.integration.test.ts` | 4 tests |
| Connection loss inside `withTenant` | `packages/db/src/tenant-connection-loss.integration.test.ts` | 1 test |
| Official `mutation_check.py` for the `tenant.ts` fix | `EV-P08-012-mutation-tenant-connection-loss.json` | KILLED, assertion failure |
| Manual semantic mutants of the new runtime (no pre-fix state exists, so the official tool does not apply) | `EV-P08-012-mutants-worker-runtime.json` | 23 of 23 KILLED by an assertion |

The manual mutants are one source edit each, run against the named test, restored byte-for-byte
(SHA-256 checked). Two survived on the first pass (a weak queue assertion and an invisible lease loss);
the tests were strengthened and the sweep rerun in full. The first harness run read the wrong report
file and recorded false survivors; it was discarded.

The compiled-process test found a dependency-injection error (`SHUTDOWN_STATE` not visible to the
new module) that no in-process test could. Another test found a bind-parameter error in `abandonJob`.

## Independent internal reviews (agents; not the founder's Codex review)

| Review | Verdict | Disposition |
|---|---|---|
| Security | OK to merge, 0 High | M1 endpoint override refused outside development and test (fixed, env test). L1 case-insensitive correlation id (fixed, mutant D9). M2 null-organisation jobs: open, see below. L2 connection error not logged: open. L3 SQS `maxReceiveCount` is `5` in `docker/elasticmq/elasticmq.conf`; the P05 topology must keep it. |
| Architecture | BLOCK MERGE, 3 High | H1 `stop()` waited for a busy slot: fixed (mutant C11). H2 no handler deadline: fixed, handler cap with slot release and no acknowledgement (mutant C12); a handler that never settles still holds its connection until `idle_in_transaction_session_timeout`. H3 rolled-back claims unbounded: fixed, receive ceiling dead-letters (mutant C13). M3 missing handler spent attempts: fixed (mutant C14). M4 visibility passed on receive: fixed; single queue versus per-class consumers: open. M1 `queued` conflates unpublished and retrying; M2 null-organisation jobs; M5 legacy `Worker`: open, below. |
| Invariant | No bypass on the wired paths; 4 findings | I1 same as H3, fixed. I2 `replayJob` publishes nothing: open (ASYNC-1B). I3 rejects leave a ledger row `queued`: open. I4 `replayJob` unaudited: open. |

## Open items carried to the next slices

- **ASYNC-1B prerequisite:** `queued` means both "never published" and "waiting for retry". The dispatcher needs a publish marker (expand-only column) or a distinct retry state, and `replayJob` must re-publish. Decide with ADR-0008.
- Null-organisation (system) jobs have no execution path; either forbid them by constraint or add an isolated system executor.
- Rejects for `job-unknown`, `job-mismatch` and `tenant-required` do not end the ledger row.
- `replayJob` writes no audit event (INV-10 question).
- The in-memory `Worker` class and its fault-injection tests (EV-P08-005, EV-P08-011) remain and test code that does not run in production. Port the scenarios to `JobConsumer`, then delete it.
- One physical queue (`SQS_QUEUE_JOBS`, DLQ `<name>-dlq`) instead of the per-class queues and visibility floors of P08.01.02.
- Handlers must do short database-only work; external calls need their own idempotency key (INV-11).
