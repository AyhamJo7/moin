# EV-P02-085: The reserved rls-catalog and openapi-drift jobs are now live and green and are in the aggregate verify needs list. Supersedes EV-P02-040.

| Field | Value |
|---|---|
| Evidence ID | EV-P02-085 |
| Item | P02.06.05 |
| Date (UTC) | 2026-11-01 10:49 UTC |
| Commit | `be4591df127cd19e0bceee4e5426c325b119aed3` (while this record was written, only docs/evidence/INDEX.md and earlier records of the same batch differed from this commit; no code or configuration differed) |
| Environment | local clone /tmp/moin-c-rerun, main be4591d, clean tree; Node 24.21.0, pnpm 10.34.5, WSL2; private compose project implrerun (Postgres 17 pgvector, valkey, sqs, mail, oidc) |
| Command / procedure | At HEAD be4591d (clean tree): python3 asserts.py ci-jobs (gh api repos/AyhamJo7/moin/commits/be4591d/check-runs) -> exit 0; grep -n 'needs: \[static, unit, integration, build, e2e, e2e-slice, rls-catalog, openapi-drift\]' .github/workflows/verify.yml -> line 448 |
| Result | PASS: all 18 check-runs completed/success at be4591d, including verify, security-scan, container-scan |
| CI run / artifact | main be4591d check-runs all success: verify run https://github.com/AyhamJo7/moin/actions/runs/41269388046, security-scan run .../41269388037, container-scan run .../41269388053 |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).
