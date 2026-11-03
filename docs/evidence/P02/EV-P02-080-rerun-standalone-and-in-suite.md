# EV-P02-080: One example per test type passes in-suite (gates unit and integration) and standalone (clock test, harness test) on a freshly built template database. E2E ran only in CI. Supersedes EV-P02-033.

| Field | Value |
|---|---|
| Evidence ID | EV-P02-080 |
| Item | P02.05.06 |
| Date (UTC) | 2026-11-01 10:49 UTC |
| Commit | `be4591df127cd19e0bceee4e5426c325b119aed3` (while this record was written, only docs/evidence/INDEX.md and earlier records of the same batch differed from this commit; no code or configuration differed) |
| Environment | local clone /tmp/moin-c-rerun, main be4591d, clean tree; Node 24.21.0, pnpm 10.34.5, WSL2; private compose project implrerun (Postgres 17 pgvector, valkey, sqs, mail, oidc) |
| Command / procedure | At HEAD be4591d (clean tree): pnpm exec vitest run --project unit packages/testing/src/fault/inject.test.ts packages/kernel/src/clock.test.ts -> exit 0, 2 file(s), 9 tests passed; pnpm exec vitest run --reporter=verbose --project integration packages/testing/src/pg/harness.integration.test.ts -> exit 0, 1 file(s), 5 tests passed; python3 asserts.py ci-jobs (gh api repos/AyhamJo7/moin/commits/be4591d/check-runs) -> exit 0; python3 .claude/bin/gates.py full -> RESULT PASS 14/14, exit 0, 0 changed files, HEAD be4591d (control-plane, control-plane-lint, conventions, docs-consistency, format, lint, boundaries, typecheck, unit, integration, migrations, build, licences, secret-scan) |
| Result | PASS: u-fault-clock exit 0: 9 tests in 2 file(s) passed; i-harness exit 0: 5 tests in 1 file(s) passed; all 18 check-runs completed/success at be4591d, including verify, security-scan, container-scan |
| CI run / artifact | main be4591d check-runs all success: verify run https://github.com/AyhamJo7/moin/actions/runs/41269388046, security-scan run .../41269388037, container-scan run .../41269388053 |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).
