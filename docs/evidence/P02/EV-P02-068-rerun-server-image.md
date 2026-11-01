# EV-P02-068: Server image built from apps/server/Dockerfile: non-root, no package manager at runtime, read-only compatible; CI builds and asserts it for arm64 (job 'hadolint, build, trivy image' success at be4591d). Local build was amd64. Supersedes EV-P02-017.

| Field | Value |
|---|---|
| Evidence ID | EV-P02-068 |
| Item | P02.03.06 |
| Date (UTC) | 2026-11-01 10:49 UTC |
| Commit | `be4591df127cd19e0bceee4e5426c325b119aed3` (while this record was written, only docs/evidence/INDEX.md and earlier records of the same batch differed from this commit; no code or configuration differed) |
| Environment | local clone /tmp/moin-c-rerun, main be4591d, clean tree; Node 24.21.0, pnpm 10.34.5, WSL2; private compose project implrerun (Postgres 17 pgvector, valkey, sqs, mail, oidc) |
| Command / procedure | At HEAD be4591d (clean tree): /tmp/moin-review/rerun/image.sh (docker build -f apps/server/Dockerfile, host arch amd64) -> exit 1; python3 asserts.py ci-jobs (gh api repos/AyhamJo7/moin/commits/be4591d/check-runs) -> exit 0 |
| Result | PASS: the assertions relevant here passed (user node; npm, npx, corepack, yarn, pnpm absent; all 77 SQL migrations present; api role boots read-only with no-new-privileges and answers /healthz 200); the script as a whole exits 1 because the voice and worker containers fail with ERR_MODULE_NOT_FOUND (@moin/telephony, @moin/integrations), which is why P02.03.02 and P02.03.07 are PARTIAL; all 18 check-runs completed/success at be4591d, including verify, security-scan, container-scan |
| CI run / artifact | main be4591d check-runs all success: verify run https://github.com/AyhamJo7/moin/actions/runs/41269388046, security-scan run .../41269388037, container-scan run .../41269388053 |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).
