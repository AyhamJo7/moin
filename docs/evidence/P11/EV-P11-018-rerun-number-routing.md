# EV-P11-018: Inbound routing: resolve_route returns organisation and location only, quarantined and unknown numbers get the neutral message, tenants never see each other's numbers. Supersedes EV-P11-001.

| Field | Value |
|---|---|
| Evidence ID | EV-P11-018 |
| Item | P11.01.01 |
| Date (UTC) | 2026-11-01 10:50 UTC |
| Commit | `be4591df127cd19e0bceee4e5426c325b119aed3` (while this record was written, only docs/evidence/INDEX.md and earlier records of the same batch differed from this commit; no code or configuration differed) |
| Environment | local clone /tmp/moin-c-rerun, main be4591d, clean tree; Node 24.21.0, pnpm 10.34.5, WSL2; private compose project implrerun (Postgres 17 pgvector, valkey, sqs, mail, oidc) |
| Command / procedure | At HEAD be4591d (clean tree): pnpm exec vitest run --reporter=verbose --project unit apps/server/src/modules/voice/application/inbound-route.test.ts apps/server/src/modules/voice/application/voice-config.test.ts packages/telephony/src/twiml/unassigned.test.ts -> exit 0, 3 file(s), 6 tests passed; pnpm exec vitest run --reporter=verbose --project integration packages/db/src/resolve-route.integration.test.ts apps/server/src/modules/voice/application/inbound-route.integration.test.ts -> exit 0, 2 file(s), 8 tests passed; python3 .claude/bin/gates.py full -> RESULT PASS 14/14, exit 0, 0 changed files, HEAD be4591d (control-plane, control-plane-lint, conventions, docs-consistency, format, lint, boundaries, typecheck, unit, integration, migrations, build, licences, secret-scan) |
| Result | PASS: u-p11-route exit 0: 6 tests in 3 file(s) passed; i-p11-route exit 0: 8 tests in 2 file(s) passed |
| CI run / artifact | main be4591d check-runs all success: verify run https://github.com/AyhamJo7/moin/actions/runs/41269388046, security-scan run .../41269388037, container-scan run .../41269388053 |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).
