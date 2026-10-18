# EV-P02-050: Packaged demo stack (M2D-2): one release image (migrate/api/web roles) with PostgreSQL and Keycloak, 7-test packaged browser acceptance, real migrate role, image checks in container-scan; local only, nothing deployed, not VERIFIED.

| Field | Value |
|---|---|
| Evidence ID | EV-P02-050 |
| Item | P02.06.03 |
| Date (UTC) | 2026-10-18 07:11 UTC |
| Commit | `949ac365d10a779a354ec6f5f862025271d12f37` |
| Environment | local |
| Command / procedure | `.claude/bin/gates.py full`: `python3 .claude/bin/control_plane_check.py && python3 -m unittest discover -s .claude/tests -t .claude/tests` → pass (exit 0, 21.8 s); `uvx ruff@0.15.12 format --check --config .claude/ruff.toml .claude && uvx ruff@0.15.12 check --config .claude/ruff.toml .claude && uvx --from mypy==2.3.1 mypy --config-file .claude/mypy.ini` → pass (exit 0, 0.6 s); `node scripts/check-conventional-commit.ts --self-test && node scripts/check-no-ai-mentions.ts --self-test` → pass (exit 0, 0.1 s); `node scripts/check-adr-coverage.ts && node scripts/check-domain-coverage.ts && node scripts/check-dfd-coverage.ts && node scripts/check-threat-model-refs.ts && node scripts/check-data-classification.ts && node scripts/check-subprocessors.ts && node scripts/check-brand-strings.ts` → pass (exit 0, 1.4 s); `pnpm exec prettier --check .` → pass (exit 0, 5.8 s); `pnpm lint` → pass (exit 0, 8.7 s); `pnpm exec depcruise apps packages scripts --config .dependency-cruiser.cjs` → pass (exit 0, 1.1 s); `pnpm typecheck` → pass (exit 0, 3.1 s); `pnpm test` → pass (exit 0, 6.2 s); `pnpm test:integration` → pass (exit 0, 32.2 s); `node scripts/check-migrations.ts` → pass (exit 0, 0.1 s); `pnpm turbo run build` → pass (exit 0, 4.2 s); `node scripts/check-licences.ts` → pass (exit 0, 0.4 s); `gitleaks git --redact --no-banner --config .gitleaks.toml .` → pass (exit 0, 1.3 s) |
| Result | PASS |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).

## Detail (M2D-2, branch `feat/p02-demo-packaged-stack`)

Runbook and design: `docs/development/demo-stack.md`. Local only; nothing deployed, no public URL.

**Packaged browser acceptance** (`pnpm exec playwright test -c playwright.demo.config.ts`, run against `deploy/demo/demo.sh up` on a freshly reset stack, 7 passed in 2.5 min): scripts served by the packaged owner app; real Keycloak sign-in at `localhost:8081`; the API speaks the versioned contract (G2) and the legacy shape without the header; a simulated callback appears by itself (15.6 s) and Erledigt completes it (status `done`, version 4, three audit events by one actor); CSRF refuses a completion without the token; reload, `restart-api` and `stop`/`start` keep the completed work; replay of the same call does not reopen it; a second session sees the state live; a revoked session shows the signed-out page and no task data.

**Observed by hand (not automated):** PostgreSQL stopped (`/healthz` 200, `/readyz` 503, back within seconds of restart); Keycloak stopped; invalid configuration exits 1 naming the variable; the `migrate` role with a wrong password exits 1 (`28P01`), and in an isolated throwaway project `api` and `web` stayed `created` (never started) while `migrate` exited 1; port 3000 busy stops `demo.sh up` before anything starts; `down`/`up` and `stop`/`start` keep data (15 tasks before and after); `reset --yes` removes only `moin-demo_*` volumes (the development volume `moin_postgres-data` untouched) and the next `up` seeds a clean tenant (0 tasks).

**Container checks:** `scripts/check-web-image.sh` (web role read-only; page plus 8 static assets and `public/icon.svg`) and `scripts/check-server-image.sh` (all 77 migrations) run in `container-scan`; negative controls (static assets removed, migrations removed, web role removed) each fail the check. hadolint clean; Trivy HIGH/CRITICAL with `--ignore-unfixed` on the single image: exit 0; session cookie `__Host-moin_sid` HttpOnly, Secure, SameSite=Lax; no `.env`/key files in the image; no token, cookie or fake password in service logs; only 127.0.0.1:3000 and :8081 published; unknown `Host` refused by the edge.

**Official mutation:** the `migrate` role (`main-migrate.ts`, reversed): KILLED, without the fix the compiled role exits 0 and logs "migration run complete" against an unreachable database (`EV-P02-050-mutation-migrate-role.json`); the release image (`apps/server/Dockerfile`, reversed): KILLED, without the fix `web/apps/web/server.js` is missing (`MODULE_NOT_FOUND`) (`EV-P02-050-mutation-release-image.json`). An earlier run of the second check ended in a timeout, not an assertion; the script hung on a stale published port, was fixed to fail fast, and the run above replaced it.

**Measurements (this machine, amd64):** image 468 MB (was 413 MB without the web role); build 18 s warm; arm64 build under emulation 1 min 45 s; `demo.sh up` 45-52 s warm; suite 2.5 min; memory at rest api 84 MiB, web 79 MiB, Keycloak 490 MiB, PostgreSQL 31 MiB, edge 3 MiB; volumes 68 MB (PostgreSQL), 0.7 MB (Keycloak); the docker build cache grew by about 2 GB (task-owned, not pruned).

**Reviews:** security review: no Critical/High; Low findings fixed (Host refusal, pinned Keycloak hostname, dropped capabilities, `mktemp`) or documented (shared throttle bucket, seed as superuser). Architecture review: two High and four Medium findings; fixed (the web role folded into the single image per ADR-0001/INV-17, the `migrate` role made real with a unit test and a compiled-role check, the evidence record, the topology wording, the first-run-only init note, edge probe in `status`).

**Not proven:** hosting, TLS, public exposure, real telephony, arm64 execution of the whole stack, a clean-clone first start (images and the Playwright browser were already present), CI result of the new `container-scan` steps (see the PR).

## Remediation of review finding F1 (demo lifecycle, commit `a3a37b8`)

**Finding (independent review, REQUEST_CHANGES at `bf9f13c`):** `demo.sh up` asked Compose whether the project was running before it had a simulator token; Compose cannot parse the file without one (`${DEMO_SIMULATOR_TOKEN:?...}`), the error was swallowed, so the script read its own running stack as absent, called its own ports 3000 and 8081 a conflict, and token recovery (`start`, `restart`, `call`) generated a new token instead of reading the existing one. I had only ever run `up` after `down`, so I missed it.

**Fix:** discovery asks Docker for containers by the Compose project label (read-only, no token needed; empty output with exit 0 is absence, a non-zero exit is an error); the token is read back from the existing `api` container, running or stopped, and the script stops (never rotates) if the container exists but the token is unreadable or not unique; an inherited `DEMO_SIMULATOR_TOKEN` is ignored; `compose` gives a placeholder only to subcommands that create no container, and `up`/`create`/`run` refuse to run without the real token; the port check is skipped only when the edge container (the one that publishes them) is running. The fixed project name, the volume rules and `reset --yes` are untouched.

**Tests:** `deploy/demo/tests/lifecycle.test.sh` (45 checks, also run in the unit gate via `scripts/demo-lifecycle.test.ts`) drives the real script with a fake `docker` that fails Compose exactly as the real one does without the token: absent, running (repeated) and stopped demo with the token unset; a failing container query is an error, not absence; Docker down; a foreign process on 3000 or 8081 refused for absent and stopped demos; an unreadable token fails closed; an inherited token ignored; `stop`, `start`, `down` and `reset` semantics; no token in stdout or stderr. Against the original script 14 of the checks fail (the reported defect, and the token rotation in `start`).

**Official mutation:** `mutation_check.py --fix-ref a3a37b8 --fix-paths deploy/demo/demo.sh --test "bash deploy/demo/tests/lifecycle.test.sh"`: KILLED. Without the fix 11 of 45 checks fail on assertions (for example a false "already in use", no "refusing to rotate", the inherited token used, `start` re-creating under a new token); with it 45 of 45 pass; restored byte-identical; the tree unchanged. Record `EV-P02-050-mutation-demo-lifecycle.json`.

**Real Docker, read-only, against the running demo with the token unset:** the project reads as `running` (and a name that does not exist as `absent`), the `api` token is recovered and equals the container's value, `status` works, and the edge is reachable. A repeated real `up` was not run against the founder's running stack, to avoid altering it; it is a one-line manual check (see the runbook).

**Packaged runtime unchanged:** the image, the Compose topology and the seven-test browser suite are not touched by this change, so they were not rebuilt or re-run; the ten-test CI acceptance still runs.

**Follow-ups, not resolved (recorded as found by the review):** F2, the package-manager probe treats any failing `docker run` as the tool being absent (the positive web check prevents a green run on a container that cannot start); F3, the QEMU setup action is pinned but its default binfmt image is the mutable `latest` tag.
