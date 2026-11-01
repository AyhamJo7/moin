# EV-P04-013: Codec round-trip, signature fixture and TwiML snapshot tests pass inside the whole unit project. Supersedes EV-P04-005.

| Field | Value |
|---|---|
| Evidence ID | EV-P04-013 |
| Item | P04.04.05 |
| Date (UTC) | 2026-11-01 10:50 UTC |
| Commit | `be4591df127cd19e0bceee4e5426c325b119aed3` (while this record was written, only docs/evidence/INDEX.md and earlier records of the same batch differed from this commit; no code or configuration differed) |
| Environment | local clone /tmp/moin-c-rerun, main be4591d, clean tree; Node 24.21.0, pnpm 10.34.5, WSL2; private compose project implrerun (Postgres 17 pgvector, valkey, sqs, mail, oidc) |
| Command / procedure | At HEAD be4591d (clean tree): pnpm exec vitest run --project unit packages/telephony/src/twiml -> exit 0, 3 file(s), 16 tests passed; pnpm exec vitest run --project unit packages/telephony/src/protocol -> exit 0, 2 file(s), 20 tests passed; pnpm exec vitest run --project unit packages/telephony/src/signature packages/telephony/src/session -> exit 0, 3 file(s), 46 tests passed; python3 .claude/bin/gates.py full -> RESULT PASS 14/14, exit 0, 0 changed files, HEAD be4591d (control-plane, control-plane-lint, conventions, docs-consistency, format, lint, boundaries, typecheck, unit, integration, migrations, build, licences, secret-scan) |
| Result | PASS: u-telephony-twiml exit 0: 16 tests in 3 file(s) passed; u-telephony-protocol exit 0: 20 tests in 2 file(s) passed; u-telephony-signature exit 0: 46 tests in 3 file(s) passed |
| CI run / artifact | main be4591d check-runs all success: verify run https://github.com/AyhamJo7/moin/actions/runs/41269388046, security-scan run .../41269388037, container-scan run .../41269388053 |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).
