# EV-P02-053: Conventional Commit and no-attribution checks self-test and pass over the head commit; CI job 'title, body and commit conventions' is PR-only and is not run on main. Supersedes EV-P02-004.

| Field | Value |
|---|---|
| Evidence ID | EV-P02-053 |
| Item | P02.01.03 |
| Date (UTC) | 2026-11-01 10:49 UTC |
| Commit | `be4591df127cd19e0bceee4e5426c325b119aed3` (while this record was written, only docs/evidence/INDEX.md and earlier records of the same batch differed from this commit; no code or configuration differed) |
| Environment | local clone /tmp/moin-c-rerun, main be4591d, clean tree; Node 24.21.0, pnpm 10.34.5, WSL2; private compose project implrerun (Postgres 17 pgvector, valkey, sqs, mail, oidc) |
| Command / procedure | At HEAD be4591d (clean tree): node scripts/check-conventional-commit.ts --self-test && node scripts/check-no-ai-mentions.ts --self-test && node scripts/check-conventional-commit.ts --commits be4591d~1..be4591d && node scripts/check-no-ai-mentions.ts --commits be4591d~1..be4591d -> exit 0; python3 .claude/bin/gates.py full -> RESULT PASS 14/14, exit 0, 0 changed files, HEAD be4591d (control-plane, control-plane-lint, conventions, docs-consistency, format, lint, boundaries, typecheck, unit, integration, migrations, build, licences, secret-scan) |
| Result | PASS: u-conventions exit 0: passed |
| CI run / artifact | main be4591d check-runs all success: verify run https://github.com/AyhamJo7/moin/actions/runs/41269388046, security-scan run .../41269388037, container-scan run .../41269388053 |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).
