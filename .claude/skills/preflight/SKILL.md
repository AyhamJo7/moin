---
name: preflight
description: Check that this machine can run the integration tests, and start the local stack when it is safe. Run before any integration run.
---

1. `pnpm preflight`: toolchain, Docker daemon, environment file keys.
2. `docker compose ps --format json`: postgres, valkey, sqs, s3, mail and oidc must each be
   `running` and `healthy`.
3. Stack down and no other session using it: `pnpm dev:up` (it waits for health), then
   `pnpm db:migrate`. Never stop or recreate containers that are already running, and never
   remove a volume.
4. The `TEST_*` variables must be exported. Take the names from `.env.example`; the founder owns
   `.env`.
5. Print one line: `{"docker":…,"stack":…,"oidc":…,"env":…}`.

Not ready after step 3: say exactly what is down and stop. Do not run the integration tests and
attribute the failures to the code.
