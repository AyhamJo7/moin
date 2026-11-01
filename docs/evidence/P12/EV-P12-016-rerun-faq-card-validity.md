# EV-P12-016: Expired, suspended and conflicted cards are never retrievable; FAQ answers are verbatim or escalate; sensitive and overdue gates hold per channel. Supersedes EV-P12-003.

| Field | Value |
|---|---|
| Evidence ID | EV-P12-016 |
| Item | P12.06.03 |
| Date (UTC) | 2026-11-01 10:50 UTC |
| Commit | `be4591df127cd19e0bceee4e5426c325b119aed3` (while this record was written, only docs/evidence/INDEX.md and earlier records of the same batch differed from this commit; no code or configuration differed) |
| Environment | local clone /tmp/moin-c-rerun, main be4591d, clean tree; Node 24.21.0, pnpm 10.34.5, WSL2; private compose project implrerun (Postgres 17 pgvector, valkey, sqs, mail, oidc) |
| Command / procedure | At HEAD be4591d (clean tree): pnpm exec vitest run --reporter=verbose --project integration packages/db/src/retrieval.integration.test.ts packages/db/src/faq.integration.test.ts -> exit 0, 2 file(s), 13 tests passed; pnpm exec vitest run --reporter=verbose --project unit apps/server/src/modules/voice/application/faq-answer.test.ts -> exit 0, 1 file(s), 2 tests passed; pnpm exec vitest run --reporter=verbose --project integration packages/db/src/channels.integration.test.ts -> exit 0, 1 file(s), 7 tests passed; python3 .claude/bin/gates.py full -> RESULT PASS 14/14, exit 0, 0 changed files, HEAD be4591d (control-plane, control-plane-lint, conventions, docs-consistency, format, lint, boundaries, typecheck, unit, integration, migrations, build, licences, secret-scan) |
| Result | PASS: i-p12-retrieval-faq exit 0: 13 tests in 2 file(s) passed; u-p12-faq exit 0: 2 tests in 1 file(s) passed; i-channels exit 0: 7 tests in 1 file(s) passed |
| CI run / artifact | main be4591d check-runs all success: verify run https://github.com/AyhamJo7/moin/actions/runs/41269388046, security-scan run .../41269388037, container-scan run .../41269388053 |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).
