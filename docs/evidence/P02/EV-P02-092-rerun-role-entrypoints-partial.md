# EV-P02-092: All four role entrypoints boot from dist, but the server image cannot start voice or worker. Supersedes EV-P02-013.

| Field | Value |
|---|---|
| Evidence ID | EV-P02-092 |
| Item | P02.03.02 |
| Date (UTC) | 2026-11-01 10:52 UTC |
| Commit | `be4591df127cd19e0bceee4e5426c325b119aed3` (while this record was written, only docs/evidence/INDEX.md and earlier records of the same batch differed from this commit; no code or configuration differed) |
| Environment | local clone /tmp/moin-c-rerun, main be4591d, clean tree; Node 24.21.0, pnpm 10.34.5, WSL2; private compose project implrerun (Postgres 17 pgvector, valkey, sqs, mail, oidc) |
| Command / procedure | At HEAD be4591d (clean tree): /tmp/moin-review/rerun/roles.sh (node apps/server/dist/main-<role>.js, SERVER_ROLE and fake config) -> exit 0; /tmp/moin-review/rerun/image.sh (docker build -f apps/server/Dockerfile, host arch amd64) -> exit 1 |
| Result | PARTIAL: main-api, main-voice, main-worker and main-migrate boot from dist (exit 0); MISSING: from one image. The image built from apps/server/Dockerfile fails the voice and worker roles with ERR_MODULE_NOT_FOUND for @moin/telephony and @moin/integrations, because its runtime stage ships only contracts, db, kernel and observability. No CI job boots the roles from the image. |
| CI run / artifact | main be4591d check-runs all success: verify run https://github.com/AyhamJo7/moin/actions/runs/41269388046, security-scan run .../41269388037, container-scan run .../41269388053 |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).
