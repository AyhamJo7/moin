# EV-P06-097: The two-tenant seed covers 8 of 55 FORCE-RLS tables, and the suite now says so and cannot drift: every live FORCE-RLS table is seeded or carries a registered reason, and the 8 seeded tables are checked to hold a row for A and for B. Before: a migration adding a tenant table left the suite green. After: it fails with 'no seed and no registered reason: zz_new_tenant_table'. mutation_check.py: KILLED. P06.13.01 is NOT closed by this record: 47 tables are registered, not seeded.

| Field | Value |
|---|---|
| Evidence ID | EV-P06-097 |
| Item | P06.13.01 |
| Date (UTC) | 2026-11-01 12:32 UTC |
| Commit | `b445b9a9154cd4e6de9c54413287a81d221a9a76` (while this record was written, only docs/evidence/INDEX.md and earlier records of this batch differed from this commit; no code or configuration differed) |
| Environment | local clone /tmp/moin-xsuite, Node 24.21.0, private compose project implxsuite (Postgres 17, Keycloak for the login probe) |
| Command / procedure | `.claude/bin/gates.py full`: `python3 .claude/bin/control_plane_check.py && python3 -m unittest discover -s .claude/tests -t .claude/tests` → pass (exit 0, 26.1 s); `uvx ruff@0.15.12 format --check --config .claude/ruff.toml .claude && uvx ruff@0.15.12 check --config .claude/ruff.toml .claude && uvx --from mypy==2.3.1 mypy --config-file .claude/mypy.ini` → pass (exit 0, 1.3 s); `node scripts/check-conventional-commit.ts --self-test && node scripts/check-no-ai-mentions.ts --self-test` → pass (exit 0, 0.1 s); `node scripts/check-adr-coverage.ts && node scripts/check-domain-coverage.ts && node scripts/check-dfd-coverage.ts && node scripts/check-threat-model-refs.ts && node scripts/check-data-classification.ts && node scripts/check-subprocessors.ts && node scripts/check-brand-strings.ts` → pass (exit 0, 1.4 s); `pnpm exec prettier --check .` → pass (exit 0, 7.1 s); `pnpm lint` → pass (exit 0, 11.8 s); `pnpm exec depcruise apps packages scripts --config .dependency-cruiser.cjs` → pass (exit 0, 1.2 s); `pnpm typecheck` → pass (exit 0, 6.2 s); `pnpm test` → pass (exit 0, 6.1 s); `pnpm test:integration` → pass (exit 0, 65.0 s); `node scripts/check-migrations.ts` → pass (exit 0, 0.1 s); `pnpm turbo run build` → pass (exit 0, 5.2 s); `node scripts/check-licences.ts` → pass (exit 0, 0.4 s); `gitleaks git --redact --no-banner --config .gitleaks.toml .` → pass (exit 0, 1.1 s) |
| Result | PASS |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).
