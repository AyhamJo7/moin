# EV-P02-084: Migration safety check: tests pass, real migrations clean, wired into verify.yml. Supersedes EV-P02-034.

| Field | Value |
|---|---|
| Evidence ID | EV-P02-084 |
| Item | P02.06.04 |
| Date (UTC) | 2026-11-01 10:49 UTC |
| Commit | `be4591df127cd19e0bceee4e5426c325b119aed3` (while this record was written, only docs/evidence/INDEX.md and earlier records of the same batch differed from this commit; no code or configuration differed) |
| Environment | local clone /tmp/moin-c-rerun, main be4591d, clean tree; Node 24.21.0, pnpm 10.34.5, WSL2; private compose project implrerun (Postgres 17 pgvector, valkey, sqs, mail, oidc) |
| Command / procedure | At HEAD be4591d (clean tree): pnpm exec vitest run --project unit packages/db/src/migrate.test.ts apps/server/src/migrate-run.test.ts scripts/check-migrations.test.ts && node scripts/check-migrations.ts -> exit 0, 3 file(s), 17 tests passed; python3 asserts.py migcheck-wired -> exit 0; python3 .claude/bin/gates.py full -> RESULT PASS 14/14, exit 0, 0 changed files, HEAD be4591d (control-plane, control-plane-lint, conventions, docs-consistency, format, lint, boundaries, typecheck, unit, integration, migrations, build, licences, secret-scan) |
| Result | PASS: u-migrate exit 0: 17 tests in 3 file(s) passed; verify.yml runs node scripts/check-migrations.ts |
| CI run / artifact | main be4591d check-runs all success: verify run https://github.com/AyhamJo7/moin/actions/runs/41269388046, security-scan run .../41269388037, container-scan run .../41269388053 |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).
