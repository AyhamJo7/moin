# EV-P06-105: Round-1 review of PR 259: the production-route scan now walks the whole prototype chain with Nest's metadata scanner, so a handler inherited from a base controller is listed. Codex's inherited variant of mutation A: without the fix the suite stays green (not detected), with it the suite fails (KILLED, mutation_check). Correction to EV-P06-096: that record's KILLED mutation deleted its own test file ('No test files found'); the real mutations, tests intact, are a revert of only the verify.yml wiring (KILLED: the workflow assertion fails) and a coverageArtifact change that drops the unprobed list (detected: 1 of 2 tests fail). EV-P06-096 is kept as written.

| Field | Value |
|---|---|
| Evidence ID | EV-P06-105 |
| Item | P06.13.02 |
| Date (UTC) | 2026-11-01 17:38 UTC |
| Commit | `691b9561678c68a4739809617216497733e0b0df` |
| Environment | local |
| Command / procedure | `.claude/bin/gates.py full`: `python3 .claude/bin/control_plane_check.py && python3 -m unittest discover -s .claude/tests -t .claude/tests` → pass (exit 0, 27.4 s); `uvx ruff@0.15.12 format --check --config .claude/ruff.toml .claude && uvx ruff@0.15.12 check --config .claude/ruff.toml .claude && uvx --from mypy==2.3.1 mypy --config-file .claude/mypy.ini` → pass (exit 0, 0.6 s); `node scripts/check-conventional-commit.ts --self-test && node scripts/check-no-ai-mentions.ts --self-test` → pass (exit 0, 0.1 s); `node scripts/check-adr-coverage.ts && node scripts/check-domain-coverage.ts && node scripts/check-dfd-coverage.ts && node scripts/check-threat-model-refs.ts && node scripts/check-data-classification.ts && node scripts/check-subprocessors.ts && node scripts/check-brand-strings.ts` → pass (exit 0, 1.6 s); `pnpm exec prettier --check .` → pass (exit 0, 7.9 s); `pnpm lint` → pass (exit 0, 4.2 s); `pnpm exec depcruise apps packages scripts --config .dependency-cruiser.cjs` → pass (exit 0, 1.2 s); `pnpm typecheck` → pass (exit 0, 1.1 s); `pnpm test` → pass (exit 0, 6.5 s); `pnpm test:integration` → pass (exit 0, 64.0 s); `node scripts/check-migrations.ts` → pass (exit 0, 0.1 s); `pnpm turbo run build` → pass (exit 0, 4.3 s); `node scripts/check-licences.ts` → pass (exit 0, 0.4 s); `gitleaks git --redact --no-banner --config .gitleaks.toml .` → pass (exit 0, 1.3 s) |
| Result | PASS |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).

## Round 1 of the independent review of PR 259 (REQUEST_CHANGES: 1 HIGH, 1 MEDIUM)

**HIGH, inherited handlers.** `routesOfController` read only a controller's own prototype. Nest also
mounts decorated methods inherited from a base controller, so a module whose controller extends such
a base had no routes in the scan and the coverage gate stayed green. The scan now walks the whole
chain with Nest's `MetadataScanner`; an override resolves to the subclass method and an undecorated
override is skipped, as the router does.

- Regression tests: an inherited id route and an inherited static route are reported as unprobed when
  only the production root registers the module; a real Nest and Fastify app with the same shape
  serves exactly the routes the scanner lists, and an undecorated override mounts nothing.
- Mutation (`mutation_check.py`, fix commit `64cd636`, fix path `root-routes.ts`, the reviewer's
  source-only inherited variant of mutation A, applied with the suite as it stood before this
  round so only the scanner decides): **KILLED**. Without the fix: not detected (vitest exit 0).
  With the fix: detected (vitest exit 1). Record: `EV-P06-105-mutation-inherited-handler.json`.

**MEDIUM, EV-P06-096.** The mutation recorded as KILLED there removed `coverage-artifact.test.ts`
itself; its without-fix result is "No test files found", not a failed assertion. EV-P06-096 stays as
written (append-only). The real mutations, with the tests intact:

- Revert only `.github/workflows/verify.yml` to its state before `644bc77`: **KILLED**, 1 of 2 tests
  fails on the workflow assertion; with the wiring it passes. Record:
  `EV-P06-105-mutation-workflow-artifact.json`.
- Change `coverageArtifact` to drop the unprobed list (`unprobed: []`): the artifact test fails
  (1 failed, 1 passed), baseline 2 of 2 pass. Log: `EV-P06-105-mutation-artifact-field.log`.

**Gates.** `python3 .claude/bin/gates.py full` at `691b956`: PASS 14/14, exit 0, on the second run.
The first run failed in the integration gate (36 tests in 7 files) because the private stack had
only PostgreSQL running; the identity provider the suite signs in against was not up. It is an
environment error of this session, not a code failure: with the full private stack the xsuite
integration folder passes 20 of 20 and the gate passes. The mutation records above were untracked
files in the tree during the run; the tested tree was otherwise clean. Independent re-review pending;
nothing here is VERIFIED.
