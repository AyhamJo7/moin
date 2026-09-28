# EV-P02-018: Images build, containers start, health endpoints return 200, image size recorded

| Field | Value |
|---|---|
| Evidence ID | EV-P02-018 |
| Item | P02.03.07 |
| Date (UTC) | 2026-09-28 12:29 UTC |
| Commit | `f3065928572a2c60d699f2fb26e1e60dec550be3` (working tree had uncommitted changes) |
| Environment | local (docker 29.8.0, linux/arm64 via emulation) |
| Command / procedure | Build: docker buildx build --platform linux/arm64 -f apps/server/Dockerfile -t moin-server:p02-arm64 --load . -> exit 0. Start and probe, each with --read-only --tmpfs /tmp: api GET /healthz -> HTTP 200 {"status":"ok","role":"api"}; voice -> HTTP 200 {"status":"ok","role":"voice"}; worker -> HTTP 200 {"status":"ok","role":"worker"}; api GET /readyz with no database -> HTTP 503 {"status":"not_ready",...,"reason":"connection refused"}; migrate ran to completion, exit 0. Negative controls: SERVER_ROLE=voice against main-api.js exits 1; a missing DATABASE_URL exits 1 naming only the variable. Image size: 84.9 MB (docker image inspect .Size = 89,... bytes), Architecture arm64, USER node. |
| Result | PASS — all four roles build, start and behave correctly, including both negative controls. RECORDED LIMITATION: arm64 was exercised under emulation on an x86-64 host, which proves the image is correct for the architecture but not its performance there; native arm64 execution is verified on the CI runner in P02.06 and in staging in P05. |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).
