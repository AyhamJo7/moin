# EV-P02-013: Four role entrypoints with per-role root modules, from one image (INV-17)

| Field | Value |
|---|---|
| Evidence ID | EV-P02-013 |
| Item | P02.03.02 |
| Date (UTC) | 2026-09-28 12:29 UTC |
| Commit | `f3065928572a2c60d699f2fb26e1e60dec550be3` (working tree had uncommitted changes) |
| Environment | local + arm64 container |
| Command / procedure | apps/server/src/main-{api,voice,worker,migrate}.ts with ApiRootModule, VoiceRootModule, WorkerRootModule and MigrateRootModule. One image, role chosen by the start command. Verified in the container: api -> {"status":"ok","role":"api"} HTTP 200; voice -> {"status":"ok","role":"voice"} HTTP 200; worker -> {"status":"ok","role":"worker"} HTTP 200; migrate ran to completion and exited 0 with {"outcome":"no migrations to apply","count":0}. Mismatch guard: running main-api.js with SERVER_ROLE=voice exits 1 with a message naming both, so an image can never silently run the wrong module graph. |
| Result | PASS — four roles, one image, verified live. |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).
