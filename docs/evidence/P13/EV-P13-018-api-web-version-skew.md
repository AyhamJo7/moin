# EV-P13-018: Today contract negotiation: web announces the versioned contract, API serves the legacy shape otherwise, web tolerates a pre-version API without inventing a version; matrix, official mutation KILLED (API and web), browser suite 10/10 locally. Nothing deployed; not VERIFIED.

| Field | Value |
|---|---|
| Evidence ID | EV-P13-018 |
| Item | P13.03.02 |
| Date (UTC) | 2026-10-18 05:37 UTC |
| Commit | `8f3566e670fa8afdef6725939ebf343a3991cf35` |
| Environment | local |
| Command / procedure | `.claude/bin/gates.py full`: `python3 .claude/bin/control_plane_check.py && python3 -m unittest discover -s .claude/tests -t .claude/tests` → pass (exit 0, 21.1 s); `uvx ruff@0.15.12 format --check --config .claude/ruff.toml .claude && uvx ruff@0.15.12 check --config .claude/ruff.toml .claude && uvx --from mypy==2.3.1 mypy --config-file .claude/mypy.ini` → pass (exit 0, 0.2 s); `node scripts/check-conventional-commit.ts --self-test && node scripts/check-no-ai-mentions.ts --self-test` → pass (exit 0, 0.1 s); `node scripts/check-adr-coverage.ts && node scripts/check-domain-coverage.ts && node scripts/check-dfd-coverage.ts && node scripts/check-threat-model-refs.ts && node scripts/check-data-classification.ts && node scripts/check-subprocessors.ts && node scripts/check-brand-strings.ts` → pass (exit 0, 1.4 s); `pnpm exec prettier --check .` → pass (exit 0, 5.7 s); `pnpm lint` → pass (exit 0, 11.4 s); `pnpm exec depcruise apps packages scripts --config .dependency-cruiser.cjs` → pass (exit 0, 1.0 s); `pnpm typecheck` → pass (exit 0, 5.7 s); `pnpm test` → pass (exit 0, 6.2 s); `pnpm test:integration` → pass (exit 0, 28.9 s); `node scripts/check-migrations.ts` → pass (exit 0, 0.1 s); `pnpm turbo run build` → pass (exit 0, 3.5 s); `node scripts/check-licences.ts` → pass (exit 0, 0.4 s); `gitleaks git --redact --no-banner --config .gitleaks.toml .` → pass (exit 0, 1.2 s) |
| Result | PASS |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).

## Detail (M2D-1)

Design and matrix: `docs/development/api-web-rollout.md`.

- Official mutation, API: `mutation_check.py --fix-ref 6f96f34 --fix-paths apps/server/src/modules/work/http/today.controller.ts` with the `callback-today` integration suite: KILLED. Without the fix 2 of 33 fail (the frozen pre-M2A schema parses a body that carries `version`); with it 33 pass. Record `EV-P13-018-mutation-api-legacy-shape.json`.
- Official mutation, web: `--fix-paths apps/web/lib/today-view.ts` with `today-view.test.ts`: KILLED, 4 of 13 fail without the fix (header sent, legacy body read as version-unknown, Erledigt withheld). Record `EV-P13-018-mutation-web-tolerance.json`.
- Browser suite on a clean build of `6f96f34`: 10 passed (3.0 m), real Keycloak and PostgreSQL. This is G2 web with G2 API only.
- Reviews: security reviewer, no Critical or High; architecture reviewer, two Medium doc findings (contract-step order, matrix rows) fixed in `8f3566e`, boundary rule added; the fingerprint flap during a mixed roll-out is accepted and documented.
- Not proven: no real G0/G1 artifact was run; no browser test against a legacy-shaped API.
