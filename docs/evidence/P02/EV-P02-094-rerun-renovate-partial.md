# EV-P02-094: Renovate configuration is complete but the app has never opened a pull request. Supersedes EV-P02-037.

| Field | Value |
|---|---|
| Evidence ID | EV-P02-094 |
| Item | P02.08.01 |
| Date (UTC) | 2026-11-01 10:52 UTC |
| Commit | `be4591df127cd19e0bceee4e5426c325b119aed3` (while this record was written, only docs/evidence/INDEX.md and earlier records of the same batch differed from this commit; no code or configuration differed) |
| Environment | local clone /tmp/moin-c-rerun, main be4591d, clean tree; Node 24.21.0, pnpm 10.34.5, WSL2; private compose project implrerun (Postgres 17 pgvector, valkey, sqs, mail, oidc) |
| Command / procedure | At HEAD be4591d (clean tree): python3 asserts.py renovate -> exit 0; gh pr list --state all --search 'author:app/renovate' --json number -> exit 0 |
| Result | PARTIAL: renovate.json passes the configuration assertions; MISSING: evidence that Renovate runs (its first pull request). Installing the GitHub App is a founder action. |
| CI run / artifact | main be4591d check-runs all success: verify run https://github.com/AyhamJo7/moin/actions/runs/41269388046, security-scan run .../41269388037, container-scan run .../41269388053 |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).
