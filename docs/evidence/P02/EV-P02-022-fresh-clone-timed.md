# EV-P02-022: Fresh clone to a running stack with migrations applied, timed

| Field | Value |
|---|---|
| Evidence ID | EV-P02-022 |
| Item | P02.04.06 |
| Date (UTC) | 2026-09-28 13:09 UTC |
| Commit | `adbe336fea37b1cf83e27b27cd928044e117afe4` |
| Environment | local (WSL2 Ubuntu, Node 24.21.0, pnpm 10.34.5, docker 29.8.0) |
| Command / procedure | Cloned the branch into an empty directory outside the repository and ran the documented sequence, timing each step with date +%s. docker compose down --volumes first, so Postgres initialised from scratch (roles and extensions re-created by the init scripts). Steps: git clone 0 s; nvm use -> v24.21.0; pnpm install --frozen-lockfile 2 s; pnpm dev:up (compose up -d --wait, six services to healthy) 26 s; pnpm db:migrate -> "applied 1: 0001_schema_migrations" and pnpm db:seed -> "seeded 0 row(s)" with the P06 note, 1 s combined. Total 29 s. node scripts/doctor.ts then reported five of six checks ok. |
| Result | PASS against the 15-minute acceptance criterion, with two caveats recorded rather than hidden. (1) WARM MACHINE: the pnpm store (5.0 GiB) and every container image were already present, so 29 s is a lower bound, not a first-run figure. The cold path additionally downloads 1.73 GiB of images (Keycloak 756 MB, pgvector 627 MB, S3Mock 231 MB, ElasticMQ 129 MB, Valkey 62 MB, Mailpit 51 MB) plus this project s dependency closure; at 50 Mbit/s that is roughly 5 minutes of download, leaving the total inside 15 minutes with margin. A genuinely cold measurement needs a machine with no Docker cache and is a founder action. (2) The `cp .env.example .env` step was NOT executed by this session: the control plane blocks any command touching `.env` (INV-15), and that rule was not worked around. doctor correctly reports "env: no .env" and names the fix. Every other step was executed and timed. |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).
