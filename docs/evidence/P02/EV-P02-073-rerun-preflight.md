# EV-P02-073: pnpm preflight (scripts/doctor.ts, renamed from doctor because pnpm doctor is a built-in) checks node, pnpm, docker, dependencies, env and ports and fails with a fix line. Supersedes EV-P02-023.

| Field | Value |
|---|---|
| Evidence ID | EV-P02-073 |
| Item | P02.04.05 |
| Date (UTC) | 2026-11-01 10:49 UTC |
| Commit | `be4591df127cd19e0bceee4e5426c325b119aed3` (while this record was written, only docs/evidence/INDEX.md and earlier records of the same batch differed from this commit; no code or configuration differed) |
| Environment | local clone /tmp/moin-c-rerun, main be4591d, clean tree; Node 24.21.0, pnpm 10.34.5, WSL2; private compose project implrerun (Postgres 17 pgvector, valkey, sqs, mail, oidc) |
| Command / procedure | At HEAD be4591d (clean tree): node scripts/doctor.ts (pnpm preflight) -> exit 1 |
| Result | PASS: reports node, pnpm, docker, dependencies, env and ports; exit 1 because env has no .env (not created, by rule) and ports are held by the private stack, which is the designed failure path |
| CI run / artifact | main be4591d check-runs all success: verify run https://github.com/AyhamJo7/moin/actions/runs/41269388046, security-scan run .../41269388037, container-scan run .../41269388053 |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).
