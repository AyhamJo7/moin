# EV-P02-065: Zod config loader fails fast naming the variable and never echoes a secret (env and bootstrap tests). Supersedes EV-P02-014.

| Field | Value |
|---|---|
| Evidence ID | EV-P02-065 |
| Item | P02.03.03 |
| Date (UTC) | 2026-11-01 10:49 UTC |
| Commit | `be4591df127cd19e0bceee4e5426c325b119aed3` (while this record was written, only docs/evidence/INDEX.md and earlier records of the same batch differed from this commit; no code or configuration differed) |
| Environment | local clone /tmp/moin-c-rerun, main be4591d, clean tree; Node 24.21.0, pnpm 10.34.5, WSL2; private compose project implrerun (Postgres 17 pgvector, valkey, sqs, mail, oidc) |
| Command / procedure | At HEAD be4591d (clean tree): pnpm exec vitest run --project unit apps/server/src/config/env.test.ts apps/server/src/bootstrap.test.ts -> exit 0, 2 file(s), 34 tests passed; /tmp/moin-review/rerun/roles.sh (node apps/server/dist/main-<role>.js, SERVER_ROLE and fake config) -> exit 0; python3 .claude/bin/gates.py full -> RESULT PASS 14/14, exit 0, 0 changed files, HEAD be4591d (control-plane, control-plane-lint, conventions, docs-consistency, format, lint, boundaries, typecheck, unit, integration, migrations, build, licences, secret-scan) |
| Result | PASS: u-env-bootstrap exit 0: 34 tests in 2 file(s) passed; api, voice, worker: /healthz HTTP 200 and /readyz HTTP 200; migrate role applied 77 migrations, exit 0; SERVER_ROLE=voice with main-api.js exit 1; missing DATABASE_URL exit 1 naming the variable |
| CI run / artifact | main be4591d check-runs all success: verify run https://github.com/AyhamJo7/moin/actions/runs/41269388046, security-scan run .../41269388037, container-scan run .../41269388053 |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).
