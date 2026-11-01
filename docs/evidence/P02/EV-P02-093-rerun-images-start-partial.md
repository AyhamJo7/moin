# EV-P02-093: The server image builds, non-root and read-only, but only the api role starts; image size 467.7 MB (host arch). Supersedes EV-P02-018.

| Field | Value |
|---|---|
| Evidence ID | EV-P02-093 |
| Item | P02.03.07 |
| Date (UTC) | 2026-11-01 10:52 UTC |
| Commit | `be4591df127cd19e0bceee4e5426c325b119aed3` (while this record was written, only docs/evidence/INDEX.md and earlier records of the same batch differed from this commit; no code or configuration differed) |
| Environment | local clone /tmp/moin-c-rerun, main be4591d, clean tree; Node 24.21.0, pnpm 10.34.5, WSL2; private compose project implrerun (Postgres 17 pgvector, valkey, sqs, mail, oidc) |
| Command / procedure | At HEAD be4591d (clean tree): /tmp/moin-review/rerun/image.sh (docker build -f apps/server/Dockerfile, host arch amd64) -> exit 1 |
| Result | PARTIAL: image builds; api answers /healthz 200 read-only; MISSING: voice and worker do not start (ERR_MODULE_NOT_FOUND). Image size recorded: 467672259 bytes on amd64 (EV-P02-018 recorded 84.9 MB for arm64). |
| CI run / artifact | main be4591d check-runs all success: verify run https://github.com/AyhamJo7/moin/actions/runs/41269388046, security-scan run .../41269388037, container-scan run .../41269388053 |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).
