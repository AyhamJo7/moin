# EV-P02-090: Licence check rejects agpl, sspl, gpl and unknown fixtures (exit 1 each) and passes the real tree. Supersedes EV-P02-036.

| Field | Value |
|---|---|
| Evidence ID | EV-P02-090 |
| Item | P02.08.04 |
| Date (UTC) | 2026-11-01 10:49 UTC |
| Commit | `be4591df127cd19e0bceee4e5426c325b119aed3` (while this record was written, only docs/evidence/INDEX.md and earlier records of the same batch differed from this commit; no code or configuration differed) |
| Environment | local clone /tmp/moin-c-rerun, main be4591d, clean tree; Node 24.21.0, pnpm 10.34.5, WSL2; private compose project implrerun (Postgres 17 pgvector, valkey, sqs, mail, oidc) |
| Command / procedure | At HEAD be4591d (clean tree): pnpm exec vitest run --project unit scripts/check-licences.test.ts && node scripts/check-licences.ts && for f in agpl sspl gpl unknown; do node scripts/check-licences.ts --fixture $f; echo "fixture $f exit=$?"; done -> exit 0, 1 file(s), 7 tests passed; python3 .claude/bin/gates.py full -> RESULT PASS 14/14, exit 0, 0 changed files, HEAD be4591d (control-plane, control-plane-lint, conventions, docs-consistency, format, lint, boundaries, typecheck, unit, integration, migrations, build, licences, secret-scan) |
| Result | PASS: u-licences exit 0: 7 tests in 1 file(s) passed |
| CI run / artifact | main be4591d check-runs all success: verify run https://github.com/AyhamJo7/moin/actions/runs/41269388046, security-scan run .../41269388037, container-scan run .../41269388053 |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).
