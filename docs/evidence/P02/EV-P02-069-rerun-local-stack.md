# EV-P02-069: Six-service local stack, every image pinned by digest, all six healthy in an isolated project. Supersedes EV-P02-024.

| Field | Value |
|---|---|
| Evidence ID | EV-P02-069 |
| Item | P02.04.01 |
| Date (UTC) | 2026-11-01 10:49 UTC |
| Commit | `be4591df127cd19e0bceee4e5426c325b119aed3` (while this record was written, only docs/evidence/INDEX.md and earlier records of the same batch differed from this commit; no code or configuration differed) |
| Environment | local clone /tmp/moin-c-rerun, main be4591d, clean tree; Node 24.21.0, pnpm 10.34.5, WSL2; private compose project implrerun (Postgres 17 pgvector, valkey, sqs, mail, oidc) |
| Command / procedure | At HEAD be4591d (clean tree): python3 asserts.py compose -> exit 0; /tmp/moin-review/rerun/fresh.sh in a fresh clone at be4591d, COMPOSE_PROJECT_NAME=implfresh -> exit 0 |
| Result | PASS: 6 images all pinned by sha256 digest; every published port bound to 127.0.0.1; pnpm install --frozen-lockfile 1 s; pnpm dev:up 20 s with six services healthy; pnpm db:migrate applied 77 then 'nothing to apply'; pnpm db:seed 0 rows with the P06.04 note; pnpm dev:reset 23 s, pnpm dev:down 2 s, all exit 0 |
| CI run / artifact | main be4591d check-runs all success: verify run https://github.com/AyhamJo7/moin/actions/runs/41269388046, security-scan run .../41269388037, container-scan run .../41269388053 |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).
