# EV-P02-074: Fresh clone to a running stack with migrations applied, timed: about 23 s of command time on a warm machine. Deviation: .env was not copied (rule), DATABASE_MIGRATION_URL was exported instead. Supersedes EV-P02-022.

| Field | Value |
|---|---|
| Evidence ID | EV-P02-074 |
| Item | P02.04.06 |
| Date (UTC) | 2026-11-01 10:49 UTC |
| Commit | `be4591df127cd19e0bceee4e5426c325b119aed3` (while this record was written, only docs/evidence/INDEX.md and earlier records of the same batch differed from this commit; no code or configuration differed) |
| Environment | local clone /tmp/moin-c-rerun, main be4591d, clean tree; Node 24.21.0, pnpm 10.34.5, WSL2; private compose project implrerun (Postgres 17 pgvector, valkey, sqs, mail, oidc) |
| Command / procedure | At HEAD be4591d (clean tree): /tmp/moin-review/rerun/fresh.sh in a fresh clone at be4591d, COMPOSE_PROJECT_NAME=implfresh -> exit 0 |
| Result | PASS: pnpm install --frozen-lockfile 1 s; pnpm dev:up 20 s with six services healthy; pnpm db:migrate applied 77 then 'nothing to apply'; pnpm db:seed 0 rows with the P06.04 note; pnpm dev:reset 23 s, pnpm dev:down 2 s, all exit 0 |
| CI run / artifact | main be4591d check-runs all success: verify run https://github.com/AyhamJo7/moin/actions/runs/41269388046, security-scan run .../41269388037, container-scan run .../41269388053 |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).
