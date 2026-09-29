# EV-P02-024: Six-service local stack, every image pinned by digest, all healthy

| Field | Value |
|---|---|
| Evidence ID | EV-P02-024 |
| Item | P02.04.01 |
| Date (UTC) | 2026-09-28 13:10 UTC |
| Commit | `adbe336fea37b1cf83e27b27cd928044e117afe4` (working tree had uncommitted changes) |
| Environment | local (docker 29.8.0) |
| Command / procedure | docker-compose.yml runs Postgres 17 + pgvector, Valkey 8, ElasticMQ (SQS API), Adobe S3Mock, Mailpit and Keycloak, each pinned by sha256 digest rather than a tag, and each bound to 127.0.0.1 explicitly. docker compose config exits 0. docker compose up -d --wait brings all six to healthy in 26 s from empty volumes. Postgres init scripts create the ADR-0003 role split (moin_app, moin_migrator, moin_readonly, all NOBYPASSRLS, none owning tables) and the extensions (vector, pgcrypto, citext, pg_trgm). ElasticMQ declares the same queue topology as P08 provisions in AWS, including FIFO and dead-letter queues. The Keycloak realm is committed as data and imported on boot, with PKCE S256 required. Verified: docker compose ps shows six healthy; psql as moin_app -> "ERROR: permission denied for schema public" on CREATE TABLE, so the runtime role genuinely cannot run DDL. |
| Result | PASS. The first version of the health checks used bash `/dev/tcp`, which none of these images ship, so three services were marked unhealthy while working correctly — a probe failure reported as a service failure. They now use tools each image actually has, and S3Mock is probed with a real ListBuckets rather than a port check, because it accepts connections before the initial buckets exist and a seed running in that window fails with NoSuchBucket. |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).
