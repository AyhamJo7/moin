# EV-P06-095: The cross-tenant suite now measures route coverage against ApiRootModule and VoiceRootModule, and counts probes that were called. Before: a new module with GET /api/zz-leak/:id in ApiRootModule left the coverage test and the unit project green (exit 0), and a list route with an inventory row and no call left the xsuite at its baseline. After: 37/37 xsuite tests pass (14 before), 23 of 23 routes probed, mutation A fails the coverage tests (exit 1) and mutation C2 fails 'not called: GET /api/support/zzlist; executed 23 < required 24'. mutation_check.py: KILLED for both (records in the two JSON files beside this one).

| Field | Value |
|---|---|
| Evidence ID | EV-P06-095 |
| Item | P06.13.02 |
| Date (UTC) | 2026-11-01 12:32 UTC |
| Commit | `b445b9a9154cd4e6de9c54413287a81d221a9a76` |
| Environment | local clone /tmp/moin-xsuite, Node 24.21.0, private compose project implxsuite (Postgres 17, Keycloak for the login probe) |
| Command / procedure | `.claude/bin/gates.py full`: `python3 .claude/bin/control_plane_check.py && python3 -m unittest discover -s .claude/tests -t .claude/tests` → pass (exit 0, 26.1 s); `uvx ruff@0.15.12 format --check --config .claude/ruff.toml .claude && uvx ruff@0.15.12 check --config .claude/ruff.toml .claude && uvx --from mypy==2.3.1 mypy --config-file .claude/mypy.ini` → pass (exit 0, 1.3 s); `node scripts/check-conventional-commit.ts --self-test && node scripts/check-no-ai-mentions.ts --self-test` → pass (exit 0, 0.1 s); `node scripts/check-adr-coverage.ts && node scripts/check-domain-coverage.ts && node scripts/check-dfd-coverage.ts && node scripts/check-threat-model-refs.ts && node scripts/check-data-classification.ts && node scripts/check-subprocessors.ts && node scripts/check-brand-strings.ts` → pass (exit 0, 1.4 s); `pnpm exec prettier --check .` → pass (exit 0, 7.1 s); `pnpm lint` → pass (exit 0, 11.8 s); `pnpm exec depcruise apps packages scripts --config .dependency-cruiser.cjs` → pass (exit 0, 1.2 s); `pnpm typecheck` → pass (exit 0, 6.2 s); `pnpm test` → pass (exit 0, 6.1 s); `pnpm test:integration` → pass (exit 0, 65.0 s); `node scripts/check-migrations.ts` → pass (exit 0, 0.1 s); `pnpm turbo run build` → pass (exit 0, 5.2 s); `node scripts/check-licences.ts` → pass (exit 0, 0.4 s); `gitleaks git --redact --no-banner --config .gitleaks.toml .` → pass (exit 0, 1.1 s) |
| Result | PASS |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).
