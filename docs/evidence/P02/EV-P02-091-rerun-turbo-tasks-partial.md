# EV-P02-091: Turborepo test and test:integration tasks are not defined in turbo.json. Supersedes EV-P02-008.

| Field | Value |
|---|---|
| Evidence ID | EV-P02-091 |
| Item | P02.02.02 |
| Date (UTC) | 2026-11-01 10:52 UTC |
| Commit | `be4591df127cd19e0bceee4e5426c325b119aed3` (while this record was written, only docs/evidence/INDEX.md and earlier records of the same batch differed from this commit; no code or configuration differed) |
| Environment | local clone /tmp/moin-c-rerun, main be4591d, clean tree; Node 24.21.0, pnpm 10.34.5, WSL2; private compose project implrerun (Postgres 17 pgvector, valkey, sqs, mail, oidc) |
| Command / procedure | At HEAD be4591d (clean tree): python3 asserts.py turbo -> exit 1 |
| Result | PARTIAL: turbo.json defines build, typecheck and lint with caching and dependsOn ^build; MISSING: the tasks test and test:integration named by the item, or a PLAN decision that the root vitest projects replace them. |
| CI run / artifact | main be4591d check-runs all success: verify run https://github.com/AyhamJo7/moin/actions/runs/41269388046, security-scan run .../41269388037, container-scan run .../41269388053 |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).
