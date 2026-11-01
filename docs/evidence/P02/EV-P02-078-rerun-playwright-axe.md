# EV-P02-078: Playwright config declares chromium, firefox, webkit and two phone projects with an axe smoke test; CI job 'end-to-end (chromium) and accessibility' succeeded at be4591d. No browser is installed locally, so the smoke test was not executed here. Supersedes EV-P02-032.

| Field | Value |
|---|---|
| Evidence ID | EV-P02-078 |
| Item | P02.05.04 |
| Date (UTC) | 2026-11-01 10:49 UTC |
| Commit | `be4591df127cd19e0bceee4e5426c325b119aed3` (while this record was written, only docs/evidence/INDEX.md and earlier records of the same batch differed from this commit; no code or configuration differed) |
| Environment | local clone /tmp/moin-c-rerun, main be4591d, clean tree; Node 24.21.0, pnpm 10.34.5, WSL2; private compose project implrerun (Postgres 17 pgvector, valkey, sqs, mail, oidc) |
| Command / procedure | At HEAD be4591d (clean tree): PLAYWRIGHT_FULL_MATRIX=true pnpm exec playwright test --list -> exit 0; python3 asserts.py ci-jobs (gh api repos/AyhamJo7/moin/commits/be4591d/check-runs) -> exit 0 |
| Result | PASS: 5 projects (chromium, firefox, webkit, mobile-chrome, mobile-safari), 4 smoke tests each, 20 in total; all 18 check-runs completed/success at be4591d, including verify, security-scan, container-scan |
| CI run / artifact | main be4591d check-runs all success: verify run https://github.com/AyhamJo7/moin/actions/runs/41269388046, security-scan run .../41269388037, container-scan run .../41269388053 |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).
