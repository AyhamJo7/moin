# EV-P02-086: All workflows: actions pinned by SHA, minimal permissions, concurrency, persist-credentials false. Supersedes EV-P02-039.

| Field | Value |
|---|---|
| Evidence ID | EV-P02-086 |
| Item | P02.06.06 |
| Date (UTC) | 2026-11-01 10:49 UTC |
| Commit | `be4591df127cd19e0bceee4e5426c325b119aed3` (while this record was written, only docs/evidence/INDEX.md and earlier records of the same batch differed from this commit; no code or configuration differed) |
| Environment | local clone /tmp/moin-c-rerun, main be4591d, clean tree; Node 24.21.0, pnpm 10.34.5, WSL2; private compose project implrerun (Postgres 17 pgvector, valkey, sqs, mail, oidc) |
| Command / procedure | At HEAD be4591d (clean tree): python3 asserts.py workflows -> exit 0 |
| Result | PASS: every remote action reference ends in a 40-hex SHA; permissions, concurrency declared; persist-credentials false on every checkout; no unpinned container image in a run block |
| CI run / artifact | main be4591d check-runs all success: verify run https://github.com/AyhamJo7/moin/actions/runs/41269388046, security-scan run .../41269388037, container-scan run .../41269388053 |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).
