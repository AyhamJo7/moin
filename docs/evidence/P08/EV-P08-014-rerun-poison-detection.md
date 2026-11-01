# EV-P08-014: Poison detection: schema-invalid and poison messages go to the DLQ immediately with a reason (worker unit tests, kernel retry tests, real-queue consumer integration tests). Supersedes EV-P08-005.

| Field | Value |
|---|---|
| Evidence ID | EV-P08-014 |
| Item | P08.05.03 |
| Date (UTC) | 2026-11-01 10:50 UTC |
| Commit | `be4591df127cd19e0bceee4e5426c325b119aed3` (while this record was written, only docs/evidence/INDEX.md and earlier records of the same batch differed from this commit; no code or configuration differed) |
| Environment | local clone /tmp/moin-c-rerun, main be4591d, clean tree; Node 24.21.0, pnpm 10.34.5, WSL2; private compose project implrerun (Postgres 17 pgvector, valkey, sqs, mail, oidc) |
| Command / procedure | At HEAD be4591d (clean tree): pnpm exec vitest run --reporter=verbose --project unit apps/server/src/modules/platform/worker.test.ts packages/kernel/src/retry.test.ts packages/db/src/killswitch.test.ts -> exit 0, 3 file(s), 12 tests passed; pnpm exec vitest run --reporter=verbose --project integration apps/server/src/modules/platform/job-consumer.integration.test.ts -> exit 0, 1 file(s), 26 tests passed; python3 .claude/bin/gates.py full -> RESULT PASS 14/14, exit 0, 0 changed files, HEAD be4591d (control-plane, control-plane-lint, conventions, docs-consistency, format, lint, boundaries, typecheck, unit, integration, migrations, build, licences, secret-scan) |
| Result | PASS: u-p08-worker exit 0: 12 tests in 3 file(s) passed; i-job-consumer exit 0: 26 tests in 1 file(s) passed |
| CI run / artifact | main be4591d check-runs all success: verify run https://github.com/AyhamJo7/moin/actions/runs/41269388046, security-scan run .../41269388037, container-scan run .../41269388053 |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).
