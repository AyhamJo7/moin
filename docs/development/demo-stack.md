# The packaged demo stack (M2D-2)

A local, repository-controlled KlarDesk you can show a restaurant owner over a screen share. It runs
the **release image** (`apps/server/Dockerfile`: one image, the role chosen by the start command, as
ADR-0001 and INV-17 require: `migrate`, `api` and the `web` owner app), PostgreSQL and Keycloak. The
image is built locally from the same Dockerfile CI builds for linux/arm64; the local build is for this
machine's architecture, so its digest is not the one CI checks. It is **not** a hosted demo, **not** a production baseline, and the call is **simulated**.

| Statement                                            | State                                                   |
| ---------------------------------------------------- | ------------------------------------------------------- |
| Local demo on this machine, from the packaged images | **Verified** (EV-P02-050)                               |
| A public or hosted demo                              | Unverified. Nothing here is published; there is no URL  |
| Production deployment, hosting, TLS, WAF, backups    | Unverified. No infrastructure exists (P17)              |
| Real telephone provider (Twilio) integration         | Unverified. The call below is the development simulator |

## Prerequisites

Docker (Docker Desktop with WSL integration on this machine), `curl`, `python3`, `ss`, free ports
**3000** and **8081** on loopback, and a Chromium-based browser or Firefox on the same machine (Safari
does not accept the `Secure` session cookie over `http://localhost`). No `.env` file and no personal
credential is read: every secret in the stack is a development-only fake that is already in the
repository (`docker/keycloak/realm-moin-local.json`, `docker/postgres/init/`). The one generated
value, the simulator's bearer, is created per install, lives in the `api` container's environment and
is never written to a file or printed. `demo.sh` finds the demo by Docker's Compose project label, so
it needs no token to tell whether the demo is absent, running or stopped; it reads the existing token
back from the `api` container (running or stopped) and reuses it, so repeating `up`, `start`, `restart`
or `call` never rotates it. If the container exists but its token cannot be read, the script stops and
says so rather than rotate; `reset --yes` is then the way out. A `DEMO_SIMULATOR_TOKEN` left in your
shell is ignored.

## Start, show, stop

```bash
deploy/demo/demo.sh up        # builds the image, starts everything, seeds the synthetic tenant (about 1 minute)
```

1. Open **http://localhost:3000** and choose **Anmelden**. Keycloak (the real sign-in form, at
   `localhost:8081`) asks for `inhaber@musterrestaurant.example`; the password is the fake in the realm
   file (`python3 -c "import json;r=json.load(open('docker/keycloak/realm-moin-local.json'));print(r['users'][0]['credentials'][0]['value'])"`).
2. Heute opens, empty. In a terminal: `deploy/demo/demo.sh call` (a simulated caller asks for a
   table reservation; `demo.sh call "your own text"` sends your wording). Within about 15 seconds
   the callback card appears **by itself**, with the caller's number and time.
3. Click **Erledigt**. The card leaves the list and the confirmation line appears.
4. Persistence: reload (F5); `deploy/demo/demo.sh restart-api`, reload; `deploy/demo/demo.sh stop` then
   `deploy/demo/demo.sh start`, reload. The completed callback stays completed.
5. Replay: the simulator accepts the same call twice without reopening finished work (shown by
   `e2e/packaged-demo`, not by a command).

```bash
deploy/demo/demo.sh status    # services and health
deploy/demo/demo.sh check     # curl-level smoke: page, static assets, anonymous API refused
deploy/demo/demo.sh logs api  # last 100 lines of one service
deploy/demo/demo.sh stop      # stops containers, keeps all data
deploy/demo/demo.sh start     # starts them again (data and sign-in intact)
deploy/demo/demo.sh down      # removes containers, keeps the data volumes
deploy/demo/demo.sh reset --yes   # DELETES the demo database and the demo Keycloak users, then run `up`
```

`reset --yes` only touches the compose project `moin-demo` and its two volumes
(`moin-demo_postgres-data`, `moin-demo_keycloak-data`); the development stack (`moin_*`) cannot be
named by it. It is never part of `stop`, `down` or `restart`, and it refuses to run without `--yes`.
Do not use `docker compose down -v` yourself.

## What runs

| Component      | What it is                                                                                                                                               |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `edge` (nginx) | The stand-in for the load balancer: one origin, `/api/*` to the API, the rest to the owner app. Publishes 3000 and 8081 on loopback only.                |
| `api`          | `moin-server:demo`, the compiled API (`main-api.js`), user `node`, read-only root, `NODE_ENV=development` (see below)                                    |
| `web`          | the same image, role `web`: `node web/apps/web/server.js` (Next standalone with `.next/static` and `public/` copied in)                                  |
| `oidc`         | Keycloak with the committed realm; sign-in at `http://localhost:8081`                                                                                    |
| `postgres`     | PostgreSQL 17 + pgvector, not published; roles and migrations as in CI; the app runs as `moin_app` (NOBYPASSRLS, FORCE RLS)                              |
| `migrate`      | the same image, role `migrate` (`main-migrate.js`): the reviewed SQL migrations as `moin_migrator`, then exits; a failure exits 1 and `api` never starts |

`api`, `web` and `oidc` share the namespace of `edge` (`network_mode: service:edge`), like the
containers of one ECS task (production differs: separate services behind a load balancer, ADR-0001, so
this stack exercises the packaged code and configuration, not that network path). This keeps two guards exactly as they are: the owner app sends the session
cookie to the API only over HTTPS or loopback, and the API accepts only a loopback issuer for the
local Keycloak. Consequence: restart `api`, `web` or `oidc` on their own freely
(`demo.sh restart-api`), but if `edge` restarts, the others keep running in a dead namespace and still
report healthy from inside; `demo.sh status` probes the edge from the host and says so, and
`demo.sh restart` recovers it.

## Not a security baseline

The API runs with `NODE_ENV=development` because only that environment may use the local Keycloak and the
simulated-call entry point (`config/env.ts` refuses both elsewhere). Credentials are fakes, HTTP is
plain, Keycloak is in `start-dev` mode, and the simulator creates tasks without a telephone call.
Authentication, CSRF, FORCE RLS and the security headers are not relaxed (the acceptance suite refuses
a completion without the CSRF token and shows the hardened headers). Do not expose this stack to a
network. A public demo is a separate decision (hosting, TLS, a production identity provider).

## Failure and recovery (observed by hand on this machine, see EV-P02-050; not automated)

| Situation                                    | Behaviour                                                                                                                                           | Who recovers           |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| PostgreSQL stopped                           | API `/healthz` stays 200, `/readyz` returns 503, the owner app serves its error state; after the database returns, readiness is back within seconds | automatic              |
| Keycloak stopped                             | Signed-in sessions keep working; a new sign-in cannot start until it returns                                                                        | automatic once started |
| `api` restarted                              | The owner app's poll fails, then recovers; sessions are in the database and survive                                                                 | automatic              |
| Start order (web before API, API before DB)  | Compose waits for health: `web` after `api`, `api` after `migrate` and Keycloak, `migrate` after PostgreSQL                                         | automatic              |
| Missing or invalid configuration             | The container exits 1 naming the variable, never its value                                                                                          | operator               |
| Migration fails (e.g. wrong credentials)     | `migrate` exits 1 (`28P01`); `api` and `web` never start; the failure is never reported as success                                                  | operator               |
| Port 3000 or 8081 busy                       | `demo.sh up` stops before starting anything and names the port                                                                                      | operator               |
| Volume reuse (`down`, `up`; `stop`, `start`) | Data, the owner's Keycloak subject and sessions survive; the seed is idempotent                                                                     | automatic              |
| Session expiry or revocation                 | Heute shows the signed-out page and no task data; sign in again                                                                                     | owner                  |

No retry loop is unbounded: health waits are bounded (`up` 300 s, `restart-api` 120 s).

## Troubleshooting

- `Docker is not running`: start Docker Desktop and enable the WSL integration for this distribution.
- `port ... already in use`: stop the process that holds it (a development server on 3000, for
  example); the development stack (`pnpm dev:up`) uses 8080 and 5432 and can run alongside.
- Sign-in shows an error after a `reset`: run `demo.sh up` again so the owner's new Keycloak subject is seeded.
- `demo.sh up` exits with an unhealthy service: `demo.sh logs <service>`; configuration errors name the variable.
- The browser shows a signed-out page right after `up`: sign in again; the sign-in cookie belongs to `localhost:3000`.

## Reproduce the verification

```bash
deploy/demo/demo.sh up
pnpm exec playwright test -c playwright.demo.config.ts   # 7 tests against the running stack, about 2.5 minutes
scripts/check-web-image.sh moin-server:demo              # the CI's check of the web role, on a local build
scripts/check-server-image.sh moin-server:demo           # every SQL migration is in the image
bash deploy/demo/tests/lifecycle.test.sh                 # demo.sh up/start/stop/reset decisions, with fake docker (also in the unit gate)
```

`playwright.demo.config.ts` starts nothing; it drives the stack at `http://localhost:3000` and restarts
services only through `demo.sh`. The existing 10-test slice suite (`playwright.slice.config.ts`, CI job
`full-stack browser acceptance`) is unchanged and still runs on every pull request; it tests a
developer build, this one tests the packages.

## Known limits

- The simulated call is not marked as simulated on Heute; the runbook and the endpoint path
  (`/api/dev/simulated-calls`) are what identify it.
- One synthetic tenant is seeded; cross-tenant isolation is proven by the integration suites, not
  re-proven in this browser suite.
- There is no sign-out button yet; sessions end by expiry or revocation (the suite revokes through the database).
- The seed runs as the Postgres superuser `moin_owner` (it bypasses RLS) and writes no audit event: it is synthetic bootstrap outside INV-10, idempotent, and only ever pointed at the `moin-demo` database.
- The role setup (`docker/postgres/init`) and the Keycloak realm import run only when their volume is first created. After a repository update that changes either, `up` keeps the old roles or realm until `reset --yes`.
- Behind the edge every caller shares one socket address, so the API's per-address auth throttle is one bucket for the whole demo.
- Keycloak in `start-dev` uses about 500 MiB; the whole stack about 700 MiB.
- G0/G1 web and API builds are not part of this stack. The M2D-1 matrix
  (`docs/development/api-web-rollout.md`) remains the authority for mixed versions; this stack runs the
  G2 web with the G2 API only, and a rollout beyond it needs an inventory of deployed builds.
- ADR-0001 names `web` as a role of the one image; this stack and the CI follow that. A release is therefore one digest, and the M2D-1 G0/G1/G2 rules still apply between releases.
- Review follow-ups, not yet done and not blocking: (F2) the package-manager absence probe in
  `container-scan` treats any failing `docker run` as "the tool is absent"; the positive check of the web
  role is what catches a container that cannot start. (F3) `docker/setup-qemu-action` is pinned by
  commit, but its default binfmt image is the mutable tag `latest`.
- The lifecycle test uses a fake `docker`; a repeated real `up` against a running demo is a manual
  check (`deploy/demo/demo.sh up` twice; the second must report no port conflict and keep the sign-in).
- The task title on Heute is a deterministic summary of the simulated call, not its words. It names a
  reservation or birthday celebration, a guest count and one weekday or month when the caller stated them
  clearly (for example "Rückruf: Reservierung für 6 Personen am Freitag"), the topic after "wegen" as before,
  and otherwise "Rückruf erbeten". The utterance itself is never stored.
