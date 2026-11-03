# EV-P02-052: CODEOWNERS, PR template (all seven fields) and issue templates present; the template is in use on the open PRs. Supersedes EV-P02-003.

| Field | Value |
|---|---|
| Evidence ID | EV-P02-052 |
| Item | P02.01.02 |
| Date (UTC) | 2026-11-01 10:49 UTC |
| Commit | `be4591df127cd19e0bceee4e5426c325b119aed3` (while this record was written, only docs/evidence/INDEX.md and earlier records of the same batch differed from this commit; no code or configuration differed) |
| Environment | local clone /tmp/moin-c-rerun, main be4591d, clean tree; Node 24.21.0, pnpm 10.34.5, WSL2; private compose project implrerun (Postgres 17 pgvector, valkey, sqs, mail, oidc) |
| Command / procedure | At HEAD be4591d (clean tree): python3 asserts.py surfaces -> exit 0 |
| Result | PASS: CODEOWNERS present; the PR template carries all seven fields; three issue templates present |
| CI run / artifact | main be4591d check-runs all success: verify run https://github.com/AyhamJo7/moin/actions/runs/41269388046, security-scan run .../41269388037, container-scan run .../41269388053 |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).
