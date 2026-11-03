# EV-P02-062: All lint and custom-rule bans reported by a fixture that violates them (46 tests in packages/config). Supersedes EV-P02-001.

| Field | Value |
|---|---|
| Evidence ID | EV-P02-062 |
| Item | P02.02.10 |
| Date (UTC) | 2026-11-01 10:49 UTC |
| Commit | `be4591df127cd19e0bceee4e5426c325b119aed3` (while this record was written, only docs/evidence/INDEX.md and earlier records of the same batch differed from this commit; no code or configuration differed) |
| Environment | local clone /tmp/moin-c-rerun, main be4591d, clean tree; Node 24.21.0, pnpm 10.34.5, WSL2; private compose project implrerun (Postgres 17 pgvector, valkey, sqs, mail, oidc) |
| Command / procedure | At HEAD be4591d (clean tree): pnpm exec vitest run --project unit packages/config -> exit 0, 4 file(s), 46 tests passed; python3 .claude/bin/gates.py full -> RESULT PASS 14/14, exit 0, 0 changed files, HEAD be4591d (control-plane, control-plane-lint, conventions, docs-consistency, format, lint, boundaries, typecheck, unit, integration, migrations, build, licences, secret-scan) |
| Result | PASS: u-config-bans exit 0: 46 tests in 4 file(s) passed |
| CI run / artifact | main be4591d check-runs all success: verify run https://github.com/AyhamJo7/moin/actions/runs/41269388046, security-scan run .../41269388037, container-scan run .../41269388053 |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).
